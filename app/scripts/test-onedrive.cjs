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

async function graphPost(token, path, body) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph POST ${res.status}: ${res.statusText} — ${text}`);
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

  const SHOW = 10;
  console.log('=============================================');
  console.log(' OneDrive: 3 Approaches to Finding Shared Files');
  console.log('=============================================\n');

  // Step 0: Get stored token
  let token;
  try {
    token = getAccessToken();
    pass('Token loaded', `${token.slice(0, 20)}...`);
  } catch (err) {
    fail('Token', err.message);
    process.exit(1);
  }

  // Step 1: Get my drive ID + user ID
  let myDriveId, myUserId, myDisplayName;
  console.log(`\n${yellow('→')} Fetching identity info ...`);
  try {
    const [drive, me] = await Promise.all([
      graphGet(token, '/me/drive?$select=id'),
      graphGet(token, '/me?$select=id,displayName'),
    ]);
    myDriveId = drive.id;
    myUserId = me.id;
    myDisplayName = me.displayName;
    pass('Identity', `${myDisplayName} | driveId=${myDriveId} | userId=${myUserId}`);
  } catch (err) {
    fail('Identity', err.message);
    process.exit(1);
  }

  // ========================================
  // APPROACH 1: /me/drive/root/search(q='')
  // Only searches YOUR OneDrive. Shared files won't appear.
  // ========================================
  console.log(`\n${'━'.repeat(50)}`);
  console.log(yellow(' APPROACH 1: /me/drive/root/search(q=\'\')'));
  console.log(dim(' Scope: Only YOUR OneDrive. Will not find shared files.'));
  console.log('━'.repeat(50));

  try {
    const select = 'name,webUrl,remoteItem,parentReference,createdBy,lastModifiedDateTime,size,file,folder';
    const data = await graphGet(token, `/me/drive/root/search(q='')?$top=50&$select=${encodeURIComponent(select)}`);
    const files = data.value || [];
    const { owned, shared } = classify(files, myDriveId, myUserId);
    pass(`Returned ${files.length} items`, `${owned.length} owned, ${shared.length} shared`);

    if (shared.length > 0) {
      console.log(`\n  ${green('Shared items found (unexpected!):')}`);
      shared.slice(0, SHOW).forEach(printItem);
    } else {
      console.log(dim('  No shared items — expected, this only searches your drive'));
    }
  } catch (err) {
    fail('drive/root/search', err.message);
  }

  // ========================================
  // APPROACH 2: /me/drive/sharedWithMe
  // Only returns direct shares (link or explicit permission). Misses team/group shares.
  // ========================================
  console.log(`\n${'━'.repeat(50)}`);
  console.log(yellow(' APPROACH 2: /me/drive/sharedWithMe'));
  console.log(dim(' Scope: Only files explicitly shared via link/permission.'));
  console.log(dim(' Known to be incomplete. Being deprecated.'));
  console.log('━'.repeat(50));

  try {
    const data = await graphGet(token, '/me/drive/sharedWithMe?$top=200');
    const files = data.value || [];
    pass(`Returned ${files.length} items`);
    files.slice(0, SHOW).forEach(printItem);
    if (files.length === 0) console.log(dim('  (none)'));
  } catch (err) {
    fail('sharedWithMe', err.message);
  }

  // ========================================
  // APPROACH 3: /search/query (Microsoft Search API)
  // Searches ALL content you can access: your OneDrive, SharePoint, shared files.
  // This is the recommended modern approach.
  // Requires Files.Read.All scope (already configured).
  // Now uses KQL date filter + pagination.
  // ========================================
  console.log(`\n${'━'.repeat(50)}`);
  console.log(yellow(' APPROACH 3: POST /search/query (Microsoft Search API)'));
  console.log(dim(' Scope: ALL accessible content — your OneDrive + SharePoint + shared.'));
  console.log(dim(' Uses KQL lastModifiedTime filter + pagination (25/page).'));
  console.log('━'.repeat(50));

  const SEARCH_LOOKBACK_DAYS = 30;
  const SEARCH_LIMIT = 100;

  try {
    const since = new Date(Date.now() - SEARCH_LOOKBACK_DAYS * 86400000);
    const sinceStr = since.toISOString().slice(0, 10);
    const kql = `lastModifiedTime>=${sinceStr}`;
    console.log(dim(`  KQL: ${kql}  |  limit: ${SEARCH_LIMIT}`));

    const allItems = [];
    let from = 0;
    let totalAvailable = 0;
    const PAGE_SIZE = 25;

    while (allItems.length < SEARCH_LIMIT) {
      const searchBody = {
        requests: [{
          entityTypes: ['driveItem'],
          query: { queryString: kql },
          from,
          size: PAGE_SIZE,
        }],
      };
      const data = await graphPost(token, '/search/query', searchBody);
      const container = data.value?.[0]?.hitsContainers?.[0];
      if (!container) break;

      totalAvailable = container.total || 0;
      const hits = container.hits || [];
      if (hits.length === 0) break;

      allItems.push(...hits.map(h => h.resource));
      process.stdout.write(dim(`  fetched ${allItems.length}/${totalAvailable}...\r`));

      if (!container.moreResultsAvailable) break;
      from += hits.length;
    }
    console.log(); // clear progress line

    pass(`Fetched ${allItems.length} items`, `${totalAvailable} total match KQL filter`);

    const { owned: searchOwned, shared: searchShared } = classify(allItems, myDriveId, myUserId);
    console.log(`  Classified: ${searchOwned.length} owned, ${searchShared.length} shared`);

    console.log(`\n  ${green('── Owned files from Search API ──')} (up to ${SHOW})`);
    if (searchOwned.length === 0) {
      console.log('  (none found — expected, Approach 1 covers these)');
    } else {
      searchOwned.slice(0, SHOW).forEach(printItem);
    }

    console.log(`\n  ${green('── Shared files from Search API ──')} (up to ${SHOW})`);
    if (searchShared.length === 0) {
      console.log('  (none found)');
    } else {
      searchShared.slice(0, SHOW).forEach(printItem);
    }

    if (searchShared.length > 0) {
      console.log(`\n  ${dim('── Classification signals (first 3 shared) ──')}`);
      searchShared.slice(0, 3).forEach((item, i) => {
        console.log(`  ${i + 1}. ${item.name}`);
        console.log(`     remoteItem: ${item.remoteItem ? 'YES' : 'no'}`);
        console.log(`     parentRef.driveId: ${item.parentReference?.driveId || '(none)'} ${item.parentReference?.driveId !== myDriveId ? '≠ mine' : '= mine'}`);
        console.log(`     createdBy.user.id: ${item.createdBy?.user?.id || '(none)'} ${item.createdBy?.user?.id !== myUserId ? '≠ mine' : '= mine'}`);
      });
    }

  } catch (err) {
    fail('Search API', err.message);
  }

  // ========================================
  // SUMMARY
  // ========================================
  console.log(`\n${'='.repeat(50)}`);
  console.log(' HYBRID APPROACH (what the app now uses):');
  console.log(' • Owned files:  /me/drive/root/search (Approach 1)');
  console.log(' • Shared files: /search/query + KQL date filter (Approach 3)');
  console.log('   → classify by driveId ≠ myDriveId');
  console.log(`   → lookback: ${SEARCH_LOOKBACK_DAYS} days, limit: ${SEARCH_LIMIT}`);
  console.log('='.repeat(50));
}

main().catch((err) => {
  console.error(red('Unexpected error:'), err);
  process.exit(1);
});
