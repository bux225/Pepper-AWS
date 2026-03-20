export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { detectEmailFollowUps, listFollowUps, updateFollowUpStatus, countFollowUps } from '@/lib/follow-ups';
import { getDb } from '@/lib/db';
import { getDocumentText } from '@/lib/s3-client';
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
    const emails: Array<{
      docId: string;
      subject: string;
      from: string;
      content: string;
      receivedAt: string;
      people: string[];
    }> = [];

    for (const row of rows) {
      const raw = await getDocumentText(row.s3_key);
      if (!raw) continue;

      // Parse structured plain-text headers
      const lines = raw.split('\n');
      let subject = '', from = '', to = '', date = '';
      let bodyStart = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('Subject: ')) subject = lines[i].slice(9);
        else if (lines[i].startsWith('From: ')) from = lines[i].slice(6);
        else if (lines[i].startsWith('To: ')) to = lines[i].slice(4);
        else if (lines[i].startsWith('Date: ')) date = lines[i].slice(6);
        else if (lines[i] === '' && i > 0) { bodyStart = i + 1; break; }
      }
      const body = lines.slice(bodyStart).join('\n');

      const people: string[] = [];
      if (from) people.push(from.replace(/<.*>/, '').trim());
      for (const r of to.split(',')) {
        const name = r.replace(/<.*>/, '').trim();
        if (name) people.push(name);
      }

      emails.push({
        docId: row.s3_key,
        subject: subject || '(No subject)',
        from: from || '',
        content: body || '',
        receivedAt: date || '',
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
