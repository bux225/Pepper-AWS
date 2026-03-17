import { NextRequest, NextResponse } from 'next/server';
import { createOutboxItem, listOutboxItems, countOutboxItems } from '@/lib/outbox';
import { outboxCreateSchema } from '@/lib/validation';
import { rateLimit } from '@/lib/rate-limit';
import logger from '@/lib/logger';
import type { OutboxStatus } from '@/lib/types';

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 120, 60_000);
  if (limited) return limited;

  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status') as OutboxStatus | null;
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 1), 500);
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10) || 0, 0);

  const items = listOutboxItems({ status: status ?? undefined, limit, offset });
  const total = countOutboxItems(status ?? undefined);

  return NextResponse.json({ items, total, limit, offset });
}

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  const body = await request.json();
  const parsed = outboxCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const item = createOutboxItem(parsed.data);
  logger.info({ id: item.id, destination: parsed.data.destination }, 'Outbox item created');
  return NextResponse.json(item, { status: 201 });
}
