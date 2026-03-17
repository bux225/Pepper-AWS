import { NextRequest, NextResponse } from 'next/server';
import { getEnabledAccounts } from '@/lib/config';
import { pollEmails } from '@/lib/adapters/email';
import { rateLimit } from '@/lib/rate-limit';
import logger from '@/lib/logger';

export async function POST(request: NextRequest) {
  const isInternal = request.headers.get('X-Pepper-Internal') === '1';
  if (!isInternal) {
    const limited = rateLimit(request, 5, 60_000);
    if (limited) return limited;
  }

  const accounts = getEnabledAccounts('microsoft');
  if (accounts.length === 0) {
    return NextResponse.json({ message: 'No enabled Microsoft accounts' });
  }

  const results = [];
  for (const account of accounts) {
    if (!account.scopes.some(s => s.toLowerCase().includes('mail'))) continue;

    try {
      const result = await pollEmails(account);
      results.push({ account: account.name, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ account: account.name, err: msg }, 'Email poll failed');
      results.push({ account: account.name, imported: 0, errors: [msg] });
    }
  }

  return NextResponse.json({ results });
}
