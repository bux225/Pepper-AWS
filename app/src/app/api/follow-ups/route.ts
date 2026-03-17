import { NextRequest, NextResponse } from 'next/server';
import { listFollowUps, updateFollowUpStatus, countFollowUps } from '@/lib/follow-ups';
import { rateLimit } from '@/lib/rate-limit';

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
