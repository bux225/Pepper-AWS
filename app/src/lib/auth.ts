import { ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node';
import { getToken, upsertToken, isTokenExpired, getMsalCache, saveMsalCache } from './tokens';
import logger from './logger';
import type { AccountConfig } from './types';

const log = logger.child({ module: 'auth' });

const cryptoProvider = new CryptoProvider();
const msalApps = new Map<string, ConfidentialClientApplication>();

function getMsalApp(account: AccountConfig): ConfidentialClientApplication {
  const existing = msalApps.get(account.id);
  if (existing) return existing;

  const clientId = account.clientId;
  const clientSecret = process.env.MS_CLIENT_SECRET ?? '';
  const tenant = account.tenantId ?? 'common';
  const authority = `https://login.microsoftonline.com/${tenant}`;

  logger.info({ name: account.name, clientId, tenant }, 'Creating MSAL confidential client');

  const app = new ConfidentialClientApplication({
    auth: { clientId, clientSecret, authority },
  });

  msalApps.set(account.id, app);
  return app;
}

const REDIRECT_URI = 'http://localhost:3000/api/auth/microsoft/callback';

function encodeState(accountId: string, verifier: string): string {
  const payload = JSON.stringify({ a: accountId, v: verifier });
  return Buffer.from(payload).toString('base64url');
}

function decodeState(state: string): { accountId: string; verifier: string } | null {
  try {
    const payload = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
    if (payload.a && payload.v) return { accountId: payload.a, verifier: payload.v };
    return null;
  } catch {
    return null;
  }
}

/** Public wrapper for use in callback route to decode state before calling handleCallback */
export function decodeOAuthState(state: string): { accountId: string; verifier: string } | null {
  return decodeState(state);
}

export async function getAuthUrl(account: AccountConfig): Promise<{ url: string; state: string }> {
  msalApps.delete(account.id);
  const app = getMsalApp(account);
  const { verifier, challenge } = await cryptoProvider.generatePkceCodes();
  const state = encodeState(account.id, verifier);

  const url = await app.getAuthCodeUrl({
    redirectUri: REDIRECT_URI,
    scopes: account.scopes,
    state,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
  });

  return { url, state };
}

export async function handleCallback(
  code: string,
  state: string,
  account: AccountConfig,
): Promise<void> {
  const decoded = decodeState(state);
  if (!decoded || decoded.accountId !== account.id) {
    throw new Error('Invalid OAuth state');
  }

  // Always create a fresh MSAL app for callback to avoid stale instance issues
  // (the in-memory cache may be cleared between login redirect and callback)
  msalApps.delete(account.id);
  const app = getMsalApp(account);
  const result = await app.acquireTokenByCode({
    code,
    redirectUri: REDIRECT_URI,
    scopes: account.scopes,
    codeVerifier: decoded.verifier,
  });

  if (!result) throw new Error('Token acquisition failed');

  upsertToken(
    account.id,
    result.accessToken,
    null,
    result.expiresOn ?? new Date(Date.now() + 3600_000),
    account.scopes,
  );

  // Persist MSAL cache so refresh tokens survive server restarts
  const cacheContents = app.getTokenCache().serialize();
  saveMsalCache(account.id, cacheContents);
}

export async function getAccessToken(account: AccountConfig): Promise<string> {
  const app = getMsalApp(account);

  // Restore persisted MSAL cache (contains refresh tokens) if in-memory cache is empty
  try {
    const cachedAccounts = await app.getTokenCache().getAllAccounts();
    if (cachedAccounts.length === 0) {
      const stored = getMsalCache(account.id);
      if (stored) {
        app.getTokenCache().deserialize(stored);
      }
    }
  } catch (err) {
    log.warn({ error: err instanceof Error ? err.message : String(err) }, 'Failed to restore MSAL cache');
  }

  try {
    const accounts = await app.getTokenCache().getAllAccounts();
    if (accounts.length > 0) {
      const result = await app.acquireTokenSilent({
        account: accounts[0],
        scopes: account.scopes,
      });
      if (result) {
        upsertToken(account.id, result.accessToken, null, result.expiresOn ?? new Date(Date.now() + 3600_000), account.scopes);
        // Update persisted cache with refreshed tokens
        saveMsalCache(account.id, app.getTokenCache().serialize());
        return result.accessToken;
      }
    }
  } catch {
    // Silent acquisition failed, fall through to DB token
  }

  const stored = getToken(account.id);
  if (!stored) throw new Error(`No token for account "${account.name}" — OAuth required`);
  if (isTokenExpired(stored)) throw new Error(`Token expired for account "${account.name}" — re-authentication required`);
  return stored.accessToken;
}

export function isAccountConnected(accountId: string): boolean {
  const token = getToken(accountId);
  return token !== null && !isTokenExpired(token);
}
