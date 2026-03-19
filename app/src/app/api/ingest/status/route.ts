export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

interface StatusRow {
  last_ingest: string | null;
  last_todo_scan: string | null;
  docs_7d: number;
}

export async function GET() {
  try {
    const db = getDb();

    const lastIngest = (db.prepare(
      `SELECT MAX(uploaded_at) as ts FROM sync_journal WHERE source_type IN ('email', 'teams')`
    ).get() as { ts: string | null } | undefined)?.ts ?? null;

    const lastTodoScan = (db.prepare(
      `SELECT MAX(scanned_at) as ts FROM todo_scan_log`
    ).get() as { ts: string | null } | undefined)?.ts ?? null;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const docs7d = (db.prepare(
      `SELECT COUNT(*) as cnt FROM sync_journal WHERE source_type IN ('email', 'teams') AND uploaded_at >= ?`
    ).get(cutoff.toISOString()) as { cnt: number })?.cnt ?? 0;

    return NextResponse.json({
      lastIngest: lastIngest ? lastIngest.replace(' ', 'T') + 'Z' : null,
      lastTodoScan: lastTodoScan ? lastTodoScan.replace(' ', 'T') + 'Z' : null,
      docsLast7Days: docs7d,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
