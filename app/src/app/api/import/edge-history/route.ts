export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { importEdgeHistory } from '@/lib/edge-history';
import { syncKnowledgeBase } from '@/lib/s3-ingest';
import { rateLimit } from '@/lib/rate-limit';
import logger from '@/lib/logger';

export async function POST(request: NextRequest) {
  const isInternal = request.headers.get('X-Pepper-Internal') === '1';
  if (!isInternal) {
    const limited = rateLimit(request, 5, 60_000);
    if (limited) return limited;
  }

  const result = await importEdgeHistory();

  if (result.imported > 0) {
    syncKnowledgeBase().catch(err =>
      logger.warn({ err }, 'KB sync after edge history import failed'),
    );
  }

  return NextResponse.json(result);
}
