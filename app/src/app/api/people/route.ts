export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { listPeople, countPeople } from '@/lib/people';
import { rateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  const search = request.nextUrl.searchParams.get('search') ?? undefined;
  const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '100', 10);
  const offset = parseInt(request.nextUrl.searchParams.get('offset') ?? '0', 10);

  const people = listPeople({ search, limit, offset });
  const total = countPeople();

  return NextResponse.json({ people, total });
}
