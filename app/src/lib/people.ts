import { getDb } from './db';
import logger from './logger';
import type { Person } from './types';

const log = logger.child({ module: 'people' });

// === Types (query result extensions) ===

export interface PersonWithDocs extends Person {
  docs: Array<{
    docId: string;
    context: string;
    createdAt: string;
  }>;
}

// === Name normalization ===

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEmail(raw: string): string | null {
  const match = raw.match(/<([^>]+@[^>]+)>/);
  if (match) return match[1].toLowerCase();
  if (raw.includes('@') && !raw.includes(' ')) return raw.toLowerCase();
  return null;
}

function extractDisplayName(raw: string): string {
  const cleaned = raw.replace(/<[^>]+>/, '').trim();
  return cleaned.replace(/^["']|["']$/g, '').trim();
}

// === DB operations ===

function upsertPerson(name: string, email: string | null): number {
  const db = getDb();
  const normalized = normalizeName(name);
  if (!normalized) return -1;

  const existing = db.prepare(
    'SELECT id FROM people WHERE normalized_name = ?'
  ).get(normalized) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE people SET
        last_seen = datetime('now'),
        mention_count = mention_count + 1,
        email = COALESCE(?, email)
      WHERE id = ?`
    ).run(email, existing.id);
    return existing.id;
  }

  const result = db.prepare(
    'INSERT INTO people (name, normalized_name, email) VALUES (?, ?, ?)'
  ).run(name, normalized, email);
  return Number(result.lastInsertRowid);
}

function addMention(personId: number, docId: string, context: string): void {
  if (personId < 0) return;
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO person_mentions (person_id, doc_id, context)
     VALUES (?, ?, ?)`
  ).run(personId, docId, context.slice(0, 200));
}

// === Extraction from S3 document metadata ===

/**
 * Extract people from a document's people/from/to arrays.
 * Called after S3 ingestion to populate the people index.
 */
export function extractPeopleFromDoc(
  docId: string,
  title: string,
  people: string[],
  from?: string,
  to?: string[],
): number {
  let linked = 0;

  for (const raw of people) {
    const displayName = extractDisplayName(raw);
    const email = extractEmail(raw);
    if (!displayName || normalizeName(displayName).length < 2) continue;

    const personId = upsertPerson(displayName, email);
    addMention(personId, docId, title);
    linked++;
  }

  // Extract from explicit from/to fields (email addresses)
  const extraFields: Array<{ field: string; values: string[] }> = [];
  if (from) extraFields.push({ field: 'from', values: [from] });
  if (to?.length) extraFields.push({ field: 'to', values: to });

  for (const { field, values } of extraFields) {
    for (const part of values) {
      const displayName = extractDisplayName(part);
      const email = extractEmail(part) ?? (part.includes('@') ? part.toLowerCase() : null);
      if (!displayName || normalizeName(displayName).length < 2) continue;

      const personId = upsertPerson(displayName, email);
      addMention(personId, docId, `${field}: ${displayName}`);
      linked++;
    }
  }

  return linked;
}

// === Query functions ===

export function listPeople(options?: {
  search?: string;
  limit?: number;
  offset?: number;
}): Person[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.search) {
    const escaped = options.search.replace(/[%_]/g, c => `\\${c}`);
    conditions.push('(name LIKE ? ESCAPE ? OR email LIKE ? ESCAPE ?)');
    params.push(`%${escaped}%`, '\\', `%${escaped}%`, '\\');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
  const offset = Math.max(options?.offset ?? 0, 0);

  const rows = db.prepare(`
    SELECT * FROM people ${where}
    ORDER BY mention_count DESC, last_seen DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<{
    id: number;
    name: string;
    normalized_name: string;
    email: string | null;
    first_seen: string;
    last_seen: string;
    mention_count: number;
  }>;

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    normalizedName: r.normalized_name,
    email: r.email ?? undefined,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    mentionCount: r.mention_count,
  }));
}

export function getPersonWithDocs(personId: number): PersonWithDocs | null {
  const db = getDb();

  const person = db.prepare('SELECT * FROM people WHERE id = ?').get(personId) as {
    id: number;
    name: string;
    normalized_name: string;
    email: string | null;
    first_seen: string;
    last_seen: string;
    mention_count: number;
  } | undefined;

  if (!person) return null;

  const docs = db.prepare(`
    SELECT doc_id, context, created_at
    FROM person_mentions
    WHERE person_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(personId) as Array<{
    doc_id: string;
    context: string;
    created_at: string;
  }>;

  return {
    id: person.id,
    name: person.name,
    normalizedName: person.normalized_name,
    email: person.email ?? undefined,
    firstSeen: person.first_seen,
    lastSeen: person.last_seen,
    mentionCount: person.mention_count,
    docs: docs.map(d => ({
      docId: d.doc_id,
      context: d.context,
      createdAt: d.created_at,
    })),
  };
}

export function searchPerson(query: string): PersonWithDocs | null {
  const db = getDb();
  const normalized = normalizeName(query);
  if (!normalized) return null;

  // Exact match
  let row = db.prepare(
    'SELECT id FROM people WHERE normalized_name = ?'
  ).get(normalized) as { id: number } | undefined;

  // Prefix match
  if (!row) {
    row = db.prepare(
      'SELECT id FROM people WHERE normalized_name LIKE ? ORDER BY mention_count DESC LIMIT 1'
    ).get(`${normalized}%`) as { id: number } | undefined;
  }

  // Contains
  if (!row) {
    row = db.prepare(
      'SELECT id FROM people WHERE normalized_name LIKE ? ORDER BY mention_count DESC LIMIT 1'
    ).get(`%${normalized}%`) as { id: number } | undefined;
  }

  if (!row) return null;
  return getPersonWithDocs(row.id);
}

export function countPeople(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM people').get() as { count: number };
  return row.count;
}
