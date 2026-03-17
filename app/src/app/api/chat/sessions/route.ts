import { NextRequest, NextResponse } from 'next/server';
import { listSessions, createSession, deleteSession } from '@/lib/chat-history';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 120, 60_000);
  if (limited) return limited;

  const sessions = listSessions(50);
  return NextResponse.json({ sessions });
}

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 60, 60_000);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const schema = z.object({ title: z.string().max(200).optional() });
  const parsed = schema.safeParse(body);

  const session = createSession(parsed.success ? parsed.data.title : undefined);
  return NextResponse.json(session, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const limited = rateLimit(request, 60, 60_000);
  if (limited) return limited;

  const body = await request.json();
  const schema = z.object({ id: z.string().uuid() });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const deleted = deleteSession(parsed.data.id);
  if (!deleted) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
