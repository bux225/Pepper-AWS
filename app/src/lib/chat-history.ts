import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db';
import logger from './logger';
import type { ChatSession, ChatMessage } from './types';

// === Sessions ===

export function createSession(title?: string): ChatSession {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO chat_sessions (id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(id, title || 'New chat', now, now);

  return { id, title: title || 'New chat', createdAt: now, updatedAt: now };
}

export function listSessions(limit = 50): ChatSession[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT s.id, s.title, s.created_at, s.updated_at,
      (SELECT content FROM chat_messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message
    FROM chat_sessions s
    ORDER BY s.updated_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    last_message: string | null;
  }>;

  return rows.map(r => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastMessage: r.last_message ?? undefined,
  }));
}

export function getSession(id: string): ChatSession | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as {
    id: string; title: string; created_at: string; updated_at: string;
  } | undefined;
  if (!row) return null;
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function updateSessionTitle(id: string, title: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET title = ?, updated_at = datetime(?) WHERE id = ?')
    .run(title, new Date().toISOString(), id);
}

export function deleteSession(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
  return result.changes > 0;
}

function touchSession(sessionId: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET updated_at = datetime(?) WHERE id = ?')
    .run(new Date().toISOString(), sessionId);
}

// === Messages ===

export function addMessage(sessionId: string, role: 'user' | 'assistant' | 'action', content: string): ChatMessage {
  const db = getDb();
  const now = new Date().toISOString();

  const result = db.prepare(`
    INSERT INTO chat_messages (session_id, role, content, created_at)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, role, content, now);

  touchSession(sessionId);

  return {
    id: Number(result.lastInsertRowid),
    sessionId,
    role,
    content,
    createdAt: now,
  };
}

export function getMessages(sessionId: string): ChatMessage[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, session_id, role, content, created_at
    FROM chat_messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(sessionId) as Array<{
    id: number;
    session_id: string;
    role: string;
    content: string;
    created_at: string;
  }>;

  return rows.map(r => ({
    id: r.id,
    sessionId: r.session_id,
    role: r.role as 'user' | 'assistant' | 'action',
    content: r.content,
    createdAt: r.created_at,
  }));
}

/**
 * Auto-generate a session title from the first user message.
 */
export function autoTitleSession(sessionId: string): void {
  const db = getDb();
  const row = db.prepare(`
    SELECT content FROM chat_messages
    WHERE session_id = ? AND role = 'user'
    ORDER BY created_at ASC LIMIT 1
  `).get(sessionId) as { content: string } | undefined;

  if (row) {
    const title = row.content.length > 60 ? row.content.slice(0, 57) + '…' : row.content;
    updateSessionTitle(sessionId, title);
    logger.debug({ sessionId, title }, 'Auto-titled chat session');
  }
}
