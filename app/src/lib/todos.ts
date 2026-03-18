import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db';
import logger from './logger';
import type { Todo, CreateTodoInput, UpdateTodoInput, TodoStatus } from './types';

interface TodoRow {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  due_date: string | null;
  source_doc_id: string | null;
  source_type: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as Todo['status'],
    priority: row.priority as Todo['priority'],
    dueDate: row.due_date ?? undefined,
    sourceDocId: row.source_doc_id ?? undefined,
    sourceType: row.source_type as Todo['sourceType'],
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createTodo(input: CreateTodoInput): Todo {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO todos (id, title, description, status, priority, due_date, source_doc_id, source_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.title,
    input.description ?? '',
    input.status ?? 'open',
    input.priority ?? 'medium',
    input.dueDate ?? null,
    input.sourceDocId ?? null,
    input.sourceType ?? 'manual',
    now,
    now,
  );

  logger.info({ id, title: input.title }, 'Todo created');
  return getTodoById(id)!;
}

export function getTodoById(id: string): Todo | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as TodoRow | undefined;
  return row ? rowToTodo(row) : null;
}

export interface ListTodosOptions {
  status?: TodoStatus;
  priority?: Todo['priority'];
  limit?: number;
  offset?: number;
}

export function listTodos(options: ListTodosOptions = {}): Todo[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  }
  if (options.priority) {
    clauses.push('priority = ?');
    params.push(options.priority);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
  const offset = Math.max(options.offset ?? 0, 0);

  const sql = `
    SELECT * FROM todos ${where}
    ORDER BY
      CASE status WHEN 'open' THEN 0 WHEN 'suggested' THEN 1 WHEN 'done' THEN 2 WHEN 'cancelled' THEN 3 END,
      CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END,
      created_at DESC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(sql).all(...params, limit, offset) as TodoRow[];
  return rows.map(rowToTodo);
}

export function countTodos(status?: TodoStatus): number {
  const db = getDb();
  if (status) {
    const row = db.prepare('SELECT COUNT(*) as count FROM todos WHERE status = ?').get(status) as { count: number };
    return row.count;
  }
  const row = db.prepare('SELECT COUNT(*) as count FROM todos').get() as { count: number };
  return row.count;
}

export function updateTodo(id: string, input: UpdateTodoInput): Todo | null {
  const db = getDb();
  const existing = getTodoById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [now];

  if (input.title !== undefined) { sets.push('title = ?'); params.push(input.title); }
  if (input.description !== undefined) { sets.push('description = ?'); params.push(input.description); }
  if (input.status !== undefined) {
    sets.push('status = ?');
    params.push(input.status);
    if (input.status === 'done' || input.status === 'cancelled') {
      sets.push('completed_at = ?');
      params.push(now);
    } else if (input.status === 'open') {
      sets.push('completed_at = NULL');
    }
  }
  if (input.priority !== undefined) { sets.push('priority = ?'); params.push(input.priority); }
  if (input.dueDate !== undefined) { sets.push('due_date = ?'); params.push(input.dueDate); }

  params.push(id);
  db.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  return getTodoById(id);
}

export function deleteTodo(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM todos WHERE id = ?').run(id);
  return result.changes > 0;
}
