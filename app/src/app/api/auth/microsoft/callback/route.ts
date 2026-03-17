export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { handleCallback, decodeOAuthState } from '@/lib/auth';
import { getAccountById } from '@/lib/config.node';
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

  // Decode state to find the target account directly
  const decoded = decodeOAuthState(state);
  if (!decoded) {
    return NextResponse.redirect(
      new URL('/?settings=true&authError=Invalid+OAuth+state', request.url),
    );
  }

  const account = getAccountById(decoded.accountId);
  if (!account || account.provider !== 'microsoft') {
    return NextResponse.redirect(
      new URL('/?settings=true&authError=Account+not+found', request.url),
    );
  }

  try {
    await handleCallback(code, state, account);
    logger.info({ name: account.name }, 'Token exchange successful');
    return NextResponse.redirect(new URL('/?settings=true&authSuccess=true', request.url));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ name: account.name, err: msg }, 'Token exchange failed');
    return NextResponse.redirect(
      new URL(`/?settings=true&authError=${encodeURIComponent(msg)}`, request.url),
    );
  }
}
