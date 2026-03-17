import { NextRequest, NextResponse } from 'next/server';
import { handleCallback } from '@/lib/auth';
import { loadConfig } from '@/lib/config';
import logger from '@/lib/logger';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const error = request.nextUrl.searchParams.get('error');
  const errorDescription = request.nextUrl.searchParams.get('error_description');

  if (error) {
    logger.error({ error, errorDescription }, 'OAuth callback error');
    return NextResponse.redirect(
      new URL(`/?settings=true&authError=${encodeURIComponent(errorDescription ?? error)}`, request.url),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/?settings=true&authError=Missing+code+or+state', request.url),
    );
  }

  const config = loadConfig();
  const microsoftAccounts = config.accounts.filter(a => a.provider === 'microsoft');

  let handled = false;
  for (const account of microsoftAccounts) {
    try {
      await handleCallback(code, state, account);
      logger.info({ name: account.name }, 'Token exchange successful');
      handled = true;
      break;
    } catch (err) {
      logger.debug({ name: account.name, err: err instanceof Error ? err.message : String(err) }, 'Token exchange failed');
    }
  }

  if (!handled) {
    return NextResponse.redirect(
      new URL('/?settings=true&authError=OAuth+state+mismatch', request.url),
    );
  }

  return NextResponse.redirect(new URL('/?settings=true&authSuccess=true', request.url));
}
