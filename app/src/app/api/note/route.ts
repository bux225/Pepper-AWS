import { NextRequest, NextResponse } from 'next/server';
import { ingestNote } from '@/lib/s3-ingest';
import { syncKnowledgeBase } from '@/lib/s3-ingest';
import { ingestNoteSchema } from '@/lib/validation';
import { rateLimit } from '@/lib/rate-limit';
import logger from '@/lib/logger';

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  const body = await request.json();
  const parsed = ingestNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const s3Key = await ingestNote(parsed.data);
  logger.info({ title: parsed.data.title, s3Key }, 'Note ingested');

  // Trigger KB sync in the background
  syncKnowledgeBase().catch(err =>
    logger.warn({ err }, 'KB sync after note ingestion failed'),
  );

  return NextResponse.json({ s3Key }, { status: 201 });
}
