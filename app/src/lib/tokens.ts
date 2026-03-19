import { getDb } from './db';
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer | null {
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyHex) return null;
  return Buffer.from(keyHex, 'hex');
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `enc:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(stored: string): string {
  if (!stored.startsWith('enc:')) return stored;

  const key = getEncryptionKey();
  if (!key) return stored;

  const parts = stored.split(':');
  if (parts.length !== 4) return stored;

  const iv = Buffer.from(parts[1], 'hex');
  const authTag = Buffer.from(parts[2], 'hex');
  const encrypted = Buffer.from(parts[3], 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

export interface StoredToken {
  accountId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scopes: string[];
}

interface TokenRow {
  account_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  scopes: string;
}

function rowToToken(row: TokenRow): StoredToken {
  return {
    accountId: row.account_id,
    accessToken: decrypt(row.access_token),
    refreshToken: row.refresh_token ? decrypt(row.refresh_token) : null,
    expiresAt: row.expires_at,
    scopes: JSON.parse(row.scopes) as string[],
  };
}

export function getToken(accountId: string): StoredToken | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM account_tokens WHERE account_id = ?').get(accountId) as TokenRow | undefined;
  return row ? rowToToken(row) : null;
}

export function upsertToken(
  accountId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date,
  scopes: string[],
): void {
  const db = getDb();
  const encryptedAccess = encrypt(accessToken);
  const encryptedRefresh = refreshToken ? encrypt(refreshToken) : null;

  db.prepare(`
    INSERT INTO account_tokens (account_id, access_token, refresh_token, expires_at, scopes, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(account_id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = COALESCE(excluded.refresh_token, account_tokens.refresh_token),
      expires_at = excluded.expires_at,
      scopes = excluded.scopes,
      updated_at = datetime('now')
  `).run(accountId, encryptedAccess, encryptedRefresh, expiresAt.toISOString(), JSON.stringify(scopes));
}

export function deleteToken(accountId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM account_tokens WHERE account_id = ?').run(accountId);
}

export function isTokenExpired(token: StoredToken): boolean {
  const bufferMs = 5 * 60 * 1000;
  return new Date(token.expiresAt).getTime() - bufferMs < Date.now();
}

export function getMsalCache(accountId: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT msal_cache FROM account_tokens WHERE account_id = ?').get(accountId) as { msal_cache: string | null } | undefined;
  return row?.msal_cache ?? null;
}

export function saveMsalCache(accountId: string, cache: string): void {
  const db = getDb();
  db.prepare(`UPDATE account_tokens SET msal_cache = ?, updated_at = datetime('now') WHERE account_id = ?`).run(cache, accountId);
}

// === Poll watermarks ===

export interface PollWatermark {
  accountId: string;
  sourceType: 'email' | 'teams';
  lastPolledAt: string;
  deltaLink: string | null;
}

export function getWatermark(accountId: string, sourceType: 'email' | 'teams'): PollWatermark | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM poll_watermarks WHERE account_id = ? AND source_type = ?'
  ).get(accountId, sourceType) as { account_id: string; source_type: string; last_polled_at: string; delta_link: string | null } | undefined;

  if (!row) return null;
  return {
    accountId: row.account_id,
    sourceType: row.source_type as 'email' | 'teams',
    lastPolledAt: row.last_polled_at,
    deltaLink: row.delta_link,
  };
}

export function upsertWatermark(accountId: string, sourceType: 'email' | 'teams', deltaLink: string | null): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO poll_watermarks (account_id, source_type, last_polled_at, delta_link)
    VALUES (?, ?, datetime('now'), ?)
    ON CONFLICT(account_id, source_type) DO UPDATE SET
      last_polled_at = datetime('now'),
      delta_link = excluded.delta_link
  `).run(accountId, sourceType, deltaLink);
}
