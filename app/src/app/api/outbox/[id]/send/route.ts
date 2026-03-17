export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getOutboxItemById, updateOutboxStatus } from '@/lib/outbox';
import { getEnabledAccounts } from '@/lib/config.node';
import { sendEmail, sendTeamsMessage } from '@/lib/adapters/send';
import { rateLimit } from '@/lib/rate-limit';
import logger from '@/lib/logger';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = rateLimit(request, 10, 60_000);
  if (limited) return limited;

  const { id } = await params;
  const item = getOutboxItemById(id);

  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (item.status !== 'approved') {
    return NextResponse.json(
      { error: `Item must be approved before sending (current: ${item.status})` },
      { status: 400 },
    );
  }

  if (item.destination === 'clipboard') {
    updateOutboxStatus(id, 'sent');
    return NextResponse.json({
      sent: true,
      message: 'Content ready to copy — use the clipboard button in the UI',
      content: item.content,
    });
  }

  const accounts = getEnabledAccounts('microsoft');
  if (accounts.length === 0) {
    return NextResponse.json(
      { error: 'No enabled Microsoft accounts — connect one in Settings' },
      { status: 400 },
    );
  }

  const accountId = item.metadata.accountId;
  const account = accountId ? accounts.find(a => a.id === accountId) : accounts[0];
  if (!account) {
    return NextResponse.json({ error: 'Specified account not found or disabled' }, { status: 400 });
  }

  try {
    if (item.destination === 'email') {
      await sendEmail(account, item);
    } else if (item.destination === 'teams') {
      await sendTeamsMessage(account, item);
    }

    const updated = updateOutboxStatus(id, 'sent');
    logger.info({ id, destination: item.destination }, 'Outbox item sent');
    return NextResponse.json({ sent: true, item: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ id, err: msg }, 'Failed to send outbox item');
    return NextResponse.json({ error: `Send failed: ${msg}` }, { status: 500 });
  }
}
