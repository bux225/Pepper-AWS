export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getOutboxItemById, updateOutboxItem, updateOutboxStatus, deleteOutboxItem } from '@/lib/outbox';
import { outboxPatchSchema } from '@/lib/validation';
import { rateLimit } from '@/lib/rate-limit';
import logger from '@/lib/logger';
import type { OutboxStatus } from '@/lib/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const limited = rateLimit(request, 120, 60_000);
  if (limited) return limited;

  const { id } = await params;
  const item = getOutboxItemById(id);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(item);
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const limited = rateLimit(request, 60, 60_000);
  if (limited) return limited;

  const { id } = await params;
  const rawBody = await request.json();
  const parsed = outboxPatchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const body = parsed.data;

  const existing = getOutboxItemById(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (body.status) {
    const validTransitions: Record<OutboxStatus, OutboxStatus[]> = {
      draft: ['approved'],
      approved: ['draft', 'sent'],
      sent: [],
    };
    if (!validTransitions[existing.status].includes(body.status)) {
      return NextResponse.json(
        { error: `Cannot transition from "${existing.status}" to "${body.status}"` },
        { status: 400 },
      );
    }
    const updated = updateOutboxStatus(id, body.status);
    return NextResponse.json(updated);
  }

  if (existing.status !== 'draft') {
    return NextResponse.json({ error: 'Can only edit items in draft status' }, { status: 400 });
  }

  const updated = updateOutboxItem(id, {
    subject: body.subject,
    content: body.content,
    to: body.to,
    metadata: body.metadata,
  });

  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  const { id } = await params;
  const deleted = deleteOutboxItem(id);
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  logger.info({ id }, 'Outbox item deleted');
  return NextResponse.json({ deleted: true });
}
