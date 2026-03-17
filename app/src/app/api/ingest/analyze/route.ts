export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { syncKnowledgeBase } from '@/lib/s3-ingest';
import { rateLimit } from '@/lib/rate-limit';
import logger from '@/lib/logger';

export async function POST(request: NextRequest) {
  const isInternal = request.headers.get('X-Pepper-Internal') === '1';
  if (!isInternal) {
    const limited = rateLimit(request, 5, 60_000);
    if (limited) return limited;
  }

  try {
    const syncId = await syncKnowledgeBase();
    logger.info({ syncId }, 'KB sync triggered');
    return NextResponse.json({ syncId, status: 'started' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'KB sync failed');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
