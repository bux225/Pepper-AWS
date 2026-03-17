import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT 1 as ok').get() as { ok: number } | undefined;
    if (!row || row.ok !== 1) {
      return NextResponse.json({ status: 'error', db: 'failed' }, { status: 503 });
    }
    return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ status: 'error', error: msg }, { status: 503 });
  }
}
