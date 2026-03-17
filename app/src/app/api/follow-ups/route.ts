export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { detectEmailFollowUps, listFollowUps, updateFollowUpStatus, countFollowUps } from '@/lib/follow-ups';
import { getDb } from '@/lib/db';
import { getDocument } from '@/lib/s3-client';
import { rateLimit } from '@/lib/rate-limit';
import logger from '@/lib/logger';

export async function POST(request: NextRequest) {
  const isInternal = request.headers.get('X-Pepper-Internal') === '1';
  if (!isInternal) {
    const limited = rateLimit(request, 5, 60_000);
    if (limited) return limited;
  }

  try {
    // Get recent email S3 keys from sync_journal (last 14 days)
    const db = getDb();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    const rows = db.prepare(
      `SELECT s3_key FROM sync_journal WHERE source_type = 'email' AND uploaded_at >= ? ORDER BY uploaded_at DESC LIMIT 50`
    ).all(cutoff.toISOString()) as { s3_key: string }[];

    if (rows.length === 0) {
      return NextResponse.json({ scanned: 0, created: 0, message: 'No recent emails to analyze' });
    }

    // Read email documents from S3
    interface S3Email {
      type: string;
      subject: string;
      from: string;
      to: string[];
      body: string;
      receivedAt: string;
      conversationId?: string;
    }

    const emails: Array<{
      docId: string;
      subject: string;
      from: string;
      content: string;
      receivedAt: string;
      people: string[];
    }> = [];

    for (const row of rows) {
      const doc = await getDocument<S3Email>(row.s3_key);
      if (!doc) continue;

      const people: string[] = [];
      if (doc.from) people.push(doc.from.replace(/<.*>/, '').trim());
      if (Array.isArray(doc.to)) {
        for (const r of doc.to) people.push(r.replace(/<.*>/, '').trim());
      }

      emails.push({
        docId: row.s3_key,
        subject: doc.subject || '(No subject)',
        from: doc.from || '',
        content: doc.body || '',
        receivedAt: doc.receivedAt || '',
        people: people.filter(Boolean),
      });
    }

    const created = await detectEmailFollowUps(emails);
    logger.info({ scanned: emails.length, created }, 'Follow-up detection completed');

    return NextResponse.json({ scanned: emails.length, created });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'Follow-up detection failed');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  const status = request.nextUrl.searchParams.get('status') as 'waiting' | 'resolved' | 'dismissed' | null;
  const direction = request.nextUrl.searchParams.get('direction') as 'awaiting_reply' | 'needs_response' | null;
  const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '50', 10);

  const followUps = listFollowUps({
    status: status ?? undefined,
    direction: direction ?? undefined,
    limit,
  });
  const total = countFollowUps(status ?? 'waiting');

  return NextResponse.json({ followUps, total });
}

export async function PATCH(request: NextRequest) {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  const body = await request.json();
  const { id, status } = body as { id: number; status: 'resolved' | 'dismissed' };

  if (!id || !status || !['resolved', 'dismissed'].includes(status)) {
    return NextResponse.json({ error: 'id and status (resolved|dismissed) required' }, { status: 400 });
  }

  const updated = updateFollowUpStatus(id, status);
  if (!updated) return NextResponse.json({ error: 'Follow-up not found' }, { status: 404 });

  return NextResponse.json({ updated: true });
}
