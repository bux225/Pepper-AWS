import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 60, 60_000);
  if (limited) return limited;

  const db = getDb();
  const { searchParams } = request.nextUrl;
  const category = searchParams.get('category') ?? undefined;
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '100', 10), 1), 500);
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10), 0);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT * FROM urls ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<{
    id: string;
    url: string;
    title: string;
    category: string;
    source_doc_id: string | null;
    created_at: string;
  }>;

  const total = (db.prepare(`SELECT COUNT(*) as count FROM urls ${where}`).get(...params) as { count: number }).count;

  const urls = rows.map(r => ({
    id: r.id,
    url: r.url,
    title: r.title,
    category: r.category,
    sourceDocId: r.source_doc_id,
    createdAt: r.created_at,
  }));

  return NextResponse.json({ urls, total, limit, offset });
}
