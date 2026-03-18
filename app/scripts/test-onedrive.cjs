/**
 * OneDrive smoke test — fetches files via Graph search, classifies them as owned vs shared.
 * Usage: cd app && node scripts/test-onedrive.cjs
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');
const crypto = require('crypto');

// Load .env.local
const envPath = resolve(__dirname, '..', '.env.local');
try {
  const envFile = readFileSync(envPath, 'utf-8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* no .env.local */ }

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function pass(label, detail) { console.log(`${green('✓ PASS')}: ${label}${detail ? ' — ' + detail : ''}`); }
function fail(label, err) { console.log(`${red('✗ FAIL')}: ${label}\n  ${err}`); }

// --- Config ---
const ACCOUNT_ID = '92c718d3-087e-4a23-b615-37598f6415a5';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// --- Token decryption (mirrors tokens.ts) ---
function decrypt(stored) {
  if (!stored.startsWith('enc:')) return stored;
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyHex) return stored;
  const key = Buffer.from(keyHex, 'hex');
  const parts = stored.split(':');
  if (parts.length !== 4) return stored;
  const iv = Buffer.from(parts[1], 'hex');
  const authTag = Buffer.from(parts[2], 'hex');
  const encrypted = Buffer.from(parts[3], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

// --- Get token from SQLite ---
function getAccessToken() {
  const Database = require('better-sqlite3');
  const dbPath = resolve(__dirname, '..', 'data', 'pepper.db');
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare('SELECT access_token, expires_at FROM account_tokens WHERE account_id = ?').get(ACCOUNT_ID);
  db.close();

  if (!row) throw new Error('No token found — authenticate via the app first');

  const expiresAt = new Date(row.expires_at);
  if (expiresAt.getTime() - 5 * 60 * 1000 < Date.now()) {
    throw new Error(`Token expired at ${expiresAt.toISOString()} — re-authenticate via the app`);
  }

  return decrypt(row.access_token);
}

// --- Graph helpers ---
async function graphGet(token, path) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Graph ${res.status}: ${res.statusText} — ${body}`);
  }
  return res.json();
}

// --- classify (mirrors graph.ts classifyDriveFiles) ---
function classify(files, myDriveId, myUserId) {
  const owned = [];
  const shared = [];

  for (const item of files) {
    if (item.remoteItem) { shared.push(item); continue; }
    if (item.parentReference?.driveId && item.parentReference.driveId !== myDriveId) { shared.push(item); continue; }
    const creatorId = item.createdBy?.user?.id;
    if (creatorId && creatorId !== myUserId) { shared.push(item); continue; }
    owned.push(item);
  }
  return { owned, shared };
}

// --- Pretty print a file item ---
function printItem(item, idx) {
  const path = item.parentReference?.path?.replace('/drive/root:', '') || '';
  const kind = item.folder ? '📁' : '📄';
  const size = item.size ? `${(item.size / 1024).toFixed(1)}KB` : '';
  const modified = item.lastModifiedDateTime?.slice(0, 10) || '';
  console.log(`  ${dim(`${idx + 1}.`)} ${kind} ${item.name}`);
  if (path) console.log(`     ${dim('path:')} ${path}`);
  if (size || modified) console.log(`     ${dim('size:')} ${size}  ${dim('modified:')} ${modified}`);
  if (item.remoteItem) console.log(`     ${dim('→ remoteItem present (shared)')}`);
  if (item.createdBy?.user?.displayName) console.log(`     ${dim('creator:')} ${item.createdBy.user.displayName}`);
}

async function main() {

  const SHOW = 5;
  console.log('=========================================');
  console.log(' OneDrive File Fetch + Classification');
  console.log('=========================================\n');

  // Step 0: Get stored token
  let token;
  try {
    token = getAccessToken();
    pass('Token loaded', `${token.slice(0, 20)}...`);
  } catch (err) {
    fail('Token', err.message);
    process.exit(1);
  }

  // Step 1: Get my drive ID
  let myDriveId;
  console.log(`\n${yellow('→')} Fetching /me/drive ...`);
  try {
    const drive = await graphGet(token, '/me/drive?$select=id');
    myDriveId = drive.id;
    pass('My drive ID', myDriveId);
  } catch (err) {
    fail('/me/drive', err.message);
    process.exit(1);
  }

  // Step 2: Get my user ID
  let myUserId;
  console.log(`\n${yellow('→')} Fetching /me ...`);
  try {
    const me = await graphGet(token, '/me?$select=id,displayName');
    myUserId = me.id;
    pass('My user ID', `${me.displayName} (${myUserId})`);
  } catch (err) {
    fail('/me', err.message);
    process.exit(1);
  }

  // Step 3: Search drive files
  const TOP = 50; // keep it small for test
  console.log(`\n${yellow('→')} Searching drive files (top ${TOP}) ...`);
  let files;
  try {
    const select = 'name,webUrl,remoteItem,parentReference,createdBy,lastModifiedDateTime,createdDateTime,size,file,folder';
    const data = await graphGet(token, `/me/drive/root/search(q='')?$top=${TOP}&$select=${encodeURIComponent(select)}`);
    files = data.value || [];
    pass('Search returned', `${files.length} items`);
  } catch (err) {
    fail('Search', err.message);
    process.exit(1);
  }

  // Step 4: Classify
  const { owned, shared } = classify(files, myDriveId, myUserId);
  console.log(`\n${yellow('→')} Classification results:`);
  console.log(`  Owned: ${owned.length}   Shared: ${shared.length}`);

  // Step 5: Filter owned to /Documents
  const docsOnly = owned.filter(f => {
    const path = f.parentReference?.path || '';
    return path.includes('/Documents');
  });
  console.log(`  Owned in /Documents: ${docsOnly.length}`);

  // Step 6: Fetch sharedWithMe
  console.log(`\n${yellow('→')} Fetching /me/drive/sharedWithMe ...`);
  let sharedWithMe = [];
  try {
    const select = 'name,webUrl,remoteItem,parentReference,createdBy,lastModifiedDateTime,createdDateTime,size,file,folder';
    const data = await graphGet(token, `/me/drive/sharedWithMe?$top=${SHOW}&$select=${encodeURIComponent(select)}`);
    sharedWithMe = data.value || [];
    pass('sharedWithMe returned', `${sharedWithMe.length} items`);
  } catch (err) {
    fail('/me/drive/sharedWithMe', err.message);
  }

  console.log(`\n${green('── Files from sharedWithMe ──')} (showing up to ${SHOW})`);
  if (sharedWithMe.length === 0) {
    console.log('  (none found)');
  } else {
    sharedWithMe.slice(0, SHOW).forEach(printItem);
  }
  // Print samples
  // (SHOW already declared at top of main)

  console.log(`\n${green('── Owned files (in /Documents) ──')} (showing up to ${SHOW})`);
  if (docsOnly.length === 0) {
    console.log('  (none found)');
  } else {
    docsOnly.slice(0, SHOW).forEach(printItem);
  }

  const ownedOutsideDocs = owned.filter(f => {
    const path = f.parentReference?.path || '';
    return !path.includes('/Documents');
  });
  if (ownedOutsideDocs.length > 0) {
    console.log(`\n${yellow('── Owned files OUTSIDE /Documents ──')} (showing up to ${SHOW}, these would be EXCLUDED)`);
    ownedOutsideDocs.slice(0, SHOW).forEach(printItem);
  }

  console.log(`\n${green('── Shared files ──')} (showing up to ${SHOW})`);
  if (shared.length === 0) {
    console.log('  (none found)');
  } else {
    shared.slice(0, SHOW).forEach(printItem);
  }

  console.log(`\n${'='.repeat(41)}`);
  console.log(` Total: ${files.length}  Owned: ${owned.length} (Docs: ${docsOnly.length})  Shared: ${shared.length}`);
  console.log('=========================================');
}

main().catch((err) => {
  console.error(red('Unexpected error:'), err);
  process.exit(1);
});
