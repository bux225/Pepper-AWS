export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { createTodo, listTodos, countTodos } from '@/lib/todos';
import { createTodoSchema, todoQuerySchema } from '@/lib/validation';
import { rateLimit } from '@/lib/rate-limit';
import logger from '@/lib/logger';

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 120, 60_000);
  if (limited) return limited;

  const { searchParams } = request.nextUrl;
  const parsed = todoQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { status, priority, limit, offset } = parsed.data;
  const todos = listTodos({ status, priority, limit, offset });
  const total = countTodos(status);

  return NextResponse.json({ todos, total, limit, offset });
}

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 60, 60_000);
  if (limited) return limited;

  const body = await request.json();
  const parsed = createTodoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const todo = createTodo(parsed.data);
  logger.info({ id: todo.id, title: todo.title }, 'Todo created via API');
  return NextResponse.json(todo, { status: 201 });
}
