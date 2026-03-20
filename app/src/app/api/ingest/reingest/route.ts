export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listKeys, deleteDocument } from '@/lib/s3-client';
import logger from '@/lib/logger';

/**
 * POST /api/ingest/reingest
 *
 * Clear old S3 documents and sync journal entries for a given source type,
 * then reset the delta watermark so the next poll re-ingests everything
 * with the improved plain-text format.
 *
 * Body: { source: "email" | "teams" | "all" }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const source: string = body.source ?? 'all';

    const db = getDb();
    const stats = { journalCleared: 0, s3Deleted: 0, watermarksReset: 0 };

    const sources = source === 'all' ? ['email', 'teams'] : [source];

    for (const src of sources) {
      // 1. Clear sync journal entries for this source
      const result = db.prepare('DELETE FROM sync_journal WHERE source_type = ?').run(src);
      stats.journalCleared += result.changes;

      // 2. Delete old .json documents from S3 (they'll be re-created as .txt)
      const prefix = src === 'email' ? 'emails/' : src === 'teams' ? 'teams/' : `${src}/`;
      const keys = await listKeys(prefix, 10000);
      const jsonKeys = keys.filter(k => k.endsWith('.json'));

      for (const key of jsonKeys) {
        await deleteDocument(key);
        stats.s3Deleted++;
      }

      // 3. Reset the delta watermark so next poll does a full fetch
      if (src === 'email' || src === 'teams') {
        const wResult = db.prepare('DELETE FROM poll_watermarks WHERE source_type = ?').run(src);
        stats.watermarksReset += wResult.changes;
      }
    }

    logger.info({ source, stats }, 'Re-ingest preparation complete');

    return NextResponse.json({
      message: `Cleared ${stats.journalCleared} sync journal entries, deleted ${stats.s3Deleted} old S3 JSON docs, reset ${stats.watermarksReset} watermarks. Trigger email/teams poll to re-ingest with improved format.`,
      stats,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'Re-ingest failed');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
