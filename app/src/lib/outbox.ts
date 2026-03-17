import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db';
import type { OutboxItem, CreateOutboxInput, OutboxStatus } from './types';

interface OutboxRow {
  id: string;
  destination: string;
  subject: string;
  content: string;
  recipients: string;
  status: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToOutbox(row: OutboxRow): OutboxItem {
  return {
    id: row.id,
    destination: row.destination as OutboxItem['destination'],
    subject: row.subject,
    content: row.content,
    to: JSON.parse(row.recipients) as string[],
    status: row.status as OutboxStatus,
    metadata: JSON.parse(row.metadata) as Record<string, string>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createOutboxItem(input: CreateOutboxInput): OutboxItem {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO outbox (id, destination, subject, content, recipients, status, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)
  `).run(
    id,
    input.destination,
    input.subject,
    input.content,
    JSON.stringify(input.to ?? []),
    JSON.stringify(input.metadata ?? {}),
    now,
    now,
  );

  return getOutboxItemById(id)!;
}

export function getOutboxItemById(id: string): OutboxItem | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM outbox WHERE id = ?').get(id) as OutboxRow | undefined;
  return row ? rowToOutbox(row) : null;
}

export function listOutboxItems(options?: {
  status?: OutboxStatus;
  limit?: number;
  offset?: number;
}): OutboxItem[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const rows = db.prepare(`
    SELECT * FROM outbox ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as OutboxRow[];

  return rows.map(rowToOutbox);
}

export function updateOutboxItem(
  id: string,
  updates: Partial<Pick<OutboxItem, 'subject' | 'content' | 'to' | 'metadata'>>,
): OutboxItem | null {
  const existing = getOutboxItemById(id);
  if (!existing) return null;

  const db = getDb();
  const fields: string[] = [];
  const params: unknown[] = [];

  if (updates.subject !== undefined) { fields.push('subject = ?'); params.push(updates.subject); }
  if (updates.content !== undefined) { fields.push('content = ?'); params.push(updates.content); }
  if (updates.to !== undefined) { fields.push('recipients = ?'); params.push(JSON.stringify(updates.to)); }
  if (updates.metadata !== undefined) { fields.push('metadata = ?'); params.push(JSON.stringify(updates.metadata)); }

  if (fields.length === 0) return existing;

  fields.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE outbox SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getOutboxItemById(id);
}

export function updateOutboxStatus(id: string, status: OutboxStatus): OutboxItem | null {
  const existing = getOutboxItemById(id);
  if (!existing) return null;

  const db = getDb();
  db.prepare("UPDATE outbox SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  return getOutboxItemById(id);
}

export function deleteOutboxItem(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM outbox WHERE id = ?').run(id);
  return result.changes > 0;
}

export function countOutboxItems(status?: OutboxStatus): number {
  const db = getDb();
  if (status) {
    const row = db.prepare('SELECT COUNT(*) as count FROM outbox WHERE status = ?').get(status) as { count: number };
    return row.count;
  }
  const row = db.prepare('SELECT COUNT(*) as count FROM outbox').get() as { count: number };
  return row.count;
}
