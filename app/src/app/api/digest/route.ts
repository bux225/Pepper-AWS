export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { generateDigest, saveDigest, getLatestDigest } from '@/lib/digest';
import { rateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  const isInternal = request.headers.get('X-Pepper-Internal') === '1';
  if (!isInternal) {
    const limited = rateLimit(request, 10, 60_000);
    if (limited) return limited;
  }

  const days = parseInt(request.nextUrl.searchParams.get('days') ?? '1', 10);
  const auto = request.nextUrl.searchParams.get('auto') === '1';

  // For auto-generated digests, check if we already have one today
  if (auto) {
    const latest = getLatestDigest(days);
    if (latest?.createdAt) {
      const latestDate = new Date(latest.createdAt).toDateString();
      if (latestDate === new Date().toDateString()) {
        return NextResponse.json(latest);
      }
    }
  }

  const digest = await generateDigest(days);

  if (auto) {
    saveDigest(digest, days);
  }

  return NextResponse.json(digest);
}
