export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import {
  getLinks,
  updateLink,
  acceptLink,
  dismissLink,
  deleteLink,
  bulkDismiss,
  bulkDelete,
  syncOneDriveRecents,
} from '@/lib/reference-links';

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 60, 60_000);
  if (limited) return limited;

  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status') ?? undefined;
  const category = searchParams.get('category') ?? undefined;
  const sourceType = searchParams.get('sourceType') ?? undefined;
  const sort = searchParams.get('sort') ?? undefined;
  const order = searchParams.get('order') === 'asc' ? 'asc' as const : searchParams.get('order') === 'desc' ? 'desc' as const : undefined;
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '200', 10), 1), 500);
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10), 0);

  const { links, total } = getLinks({ status, category, sourceType, sort, order, limit, offset });

  return NextResponse.json({ links, total, limit, offset });
}

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 20, 60_000);
  if (limited) return limited;

  const body = await request.json();
  const action = body?.action;

  if (action === 'accept' && typeof body.id === 'string') {
    const link = acceptLink(body.id);
    if (!link) return NextResponse.json({ error: 'Link not found or not recommended' }, { status: 404 });
    return NextResponse.json({ link });
  }

  if (action === 'dismiss' && typeof body.id === 'string') {
    const ok = dismissLink(body.id);
    if (!ok) return NextResponse.json({ error: 'Link not found or not recommended' }, { status: 404 });
    return NextResponse.json({ success: true });
  }

  if (action === 'delete' && typeof body.id === 'string') {
    const ok = deleteLink(body.id);
    if (!ok) return NextResponse.json({ error: 'Link not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  }

  if (action === 'sync-onedrive') {
    const result = await syncOneDriveRecents();
    return NextResponse.json(result);
  }

  if (action === 'bulk-dismiss' && Array.isArray(body.ids)) {
    const ids = body.ids.filter((id: unknown) => typeof id === 'string').slice(0, 500);
    const changed = bulkDismiss(ids);
    return NextResponse.json({ changed });
  }

  if (action === 'bulk-delete' && Array.isArray(body.ids)) {
    const ids = body.ids.filter((id: unknown) => typeof id === 'string').slice(0, 500);
    const changed = bulkDelete(ids);
    return NextResponse.json({ changed });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

export async function PATCH(request: NextRequest) {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  const body = await request.json();
  const id = body?.id;
  if (typeof id !== 'string') {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const fields: { title?: string; tags?: string[] } = {};
  if (typeof body.title === 'string') fields.title = body.title;
  if (Array.isArray(body.tags)) fields.tags = body.tags.map(String);

  const link = updateLink(id, fields);
  if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 });

  return NextResponse.json({ link });
}
