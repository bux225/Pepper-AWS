export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getTodoById, updateTodo, deleteTodo } from '@/lib/todos';
import { createFollowUp } from '@/lib/follow-ups';
import { updateTodoSchema } from '@/lib/validation';
import { rateLimit } from '@/lib/rate-limit';
import logger from '@/lib/logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const limited = rateLimit(request, 120, 60_000);
  if (limited) return limited;

  const { id } = await params;
  const todo = getTodoById(id);
  if (!todo) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  return NextResponse.json(todo);
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const limited = rateLimit(request, 60, 60_000);
  if (limited) return limited;

  const { id } = await params;
  const body = await request.json();

  // Convert todo to follow-up
  if (body.action === 'convert_to_followup') {
    const todo = getTodoById(id);
    if (!todo) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });

    const followUpId = createFollowUp({
      sourceDocId: todo.sourceDocId,
      sourceType: (todo.sourceType === 'email' || todo.sourceType === 'teams') ? todo.sourceType : 'email',
      direction: 'awaiting_reply',
      contactName: '',
      summary: todo.title,
    });

    updateTodo(id, { status: 'cancelled' });
    return NextResponse.json({ converted: true, followUpId });
  }

  const parsed = updateTodoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const todo = updateTodo(id, parsed.data);
  if (!todo) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });

  if (parsed.data.status === 'done') logger.info({ id, title: todo.title }, 'Todo completed');
  return NextResponse.json(todo);
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  const { id } = await params;
  const deleted = deleteTodo(id);
  if (!deleted) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });

  logger.info({ id }, 'Todo deleted');
  return NextResponse.json({ deleted: true });
}
