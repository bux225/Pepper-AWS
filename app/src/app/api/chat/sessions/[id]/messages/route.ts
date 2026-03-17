export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getMessages, addMessage, getSession, autoTitleSession } from '@/lib/chat-history';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = rateLimit(request, 120, 60_000);
  if (limited) return limited;

  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const messages = getMessages(id);
  return NextResponse.json({ session, messages });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = rateLimit(request, 120, 60_000);
  if (limited) return limited;

  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const body = await request.json();
  const schema = z.object({
    role: z.enum(['user', 'assistant', 'action']),
    content: z.string().min(1).max(100_000),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const message = addMessage(id, parsed.data.role, parsed.data.content);

  // Auto-title after the first user message
  if (parsed.data.role === 'user') {
    const existing = getMessages(id);
    const userMessages = existing.filter(m => m.role === 'user');
    if (userMessages.length === 1) autoTitleSession(id);
  }

  return NextResponse.json(message, { status: 201 });
}
