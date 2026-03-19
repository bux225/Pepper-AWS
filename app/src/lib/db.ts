import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import logger from './logger';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'pepper.db');

const globalForDb = globalThis as unknown as { __db?: Database.Database };

export function getDb(): Database.Database {
  if (globalForDb.__db) return globalForDb.__db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate(db);

  globalForDb.__db = db;
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT name FROM migrations').all() as { name: string }[])
      .map((row) => row.name)
  );

  for (const migration of migrations) {
    if (!applied.has(migration.name)) {
      db.transaction(() => {
        db.exec(migration.sql);
        db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migration.name);
      })();
      logger.info({ name: migration.name }, 'Applied migration');
    }
  }
}

const migrations = [
  {
    name: '001_create_account_tokens',
    sql: `
      CREATE TABLE account_tokens (
        account_id TEXT PRIMARY KEY,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        expires_at TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE poll_watermarks (
        account_id TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK(source_type IN ('email', 'teams')),
        last_polled_at TEXT NOT NULL DEFAULT (datetime('now')),
        delta_link TEXT,
        PRIMARY KEY (account_id, source_type)
      );

      CREATE TABLE pending_auth (
        state TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        verifier TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    name: '002_create_todos',
    sql: `
      CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'done', 'cancelled')),
        priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high', 'medium', 'low')),
        due_date TEXT,
        source_doc_id TEXT,
        source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('manual', 'email', 'teams', 'chat')),
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_todos_status ON todos(status);
      CREATE INDEX idx_todos_priority ON todos(priority);
      CREATE INDEX idx_todos_due_date ON todos(due_date);
    `,
  },
  {
    name: '003_create_outbox',
    sql: `
      CREATE TABLE outbox (
        id TEXT PRIMARY KEY,
        destination TEXT NOT NULL CHECK(destination IN ('clipboard', 'email', 'teams')),
        subject TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        recipients TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'approved', 'sent')),
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_outbox_status ON outbox(status);
    `,
  },
  {
    name: '004_create_chat_history',
    sql: `
      CREATE TABLE chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New chat',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'action')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, created_at);
      CREATE INDEX idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
    `,
  },
  {
    name: '005_create_digests',
    sql: `
      CREATE TABLE digests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        days_back INTEGER NOT NULL DEFAULT 1,
        summary TEXT NOT NULL,
        stats_json TEXT NOT NULL,
        highlights_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_digests_created ON digests(created_at DESC);
    `,
  },
  {
    name: '006_create_people',
    sql: `
      CREATE TABLE people (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL UNIQUE,
        email TEXT,
        first_seen TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen TEXT NOT NULL DEFAULT (datetime('now')),
        mention_count INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE person_mentions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        doc_id TEXT NOT NULL,
        context TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(person_id, doc_id)
      );

      CREATE INDEX idx_people_normalized ON people(normalized_name);
      CREATE INDEX idx_people_mentions ON people(mention_count DESC);
      CREATE INDEX idx_person_mentions_person ON person_mentions(person_id);
      CREATE INDEX idx_person_mentions_doc ON person_mentions(doc_id);
    `,
  },
  {
    name: '007_create_urls',
    sql: `
      CREATE TABLE urls (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'uncategorized',
        source_doc_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_urls_category ON urls(category);
    `,
  },
  {
    name: '008_create_follow_ups',
    sql: `
      CREATE TABLE follow_ups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_doc_id TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK(source_type IN ('email', 'teams')),
        status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting', 'resolved', 'dismissed')),
        direction TEXT NOT NULL CHECK(direction IN ('awaiting_reply', 'needs_response')),
        contact_name TEXT NOT NULL DEFAULT '',
        contact_email TEXT,
        summary TEXT NOT NULL DEFAULT '',
        detected_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_checked TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT,
        stale_days INTEGER NOT NULL DEFAULT 0,
        UNIQUE(source_doc_id, direction)
      );

      CREATE INDEX idx_follow_ups_status ON follow_ups(status, detected_at DESC);
    `,
  },
  {
    name: '009_create_sync_journal',
    sql: `
      CREATE TABLE sync_journal (
        content_hash TEXT PRIMARY KEY,
        s3_key TEXT NOT NULL UNIQUE,
        source_type TEXT NOT NULL,
        uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_sync_journal_source ON sync_journal(source_type);
    `,
  },
  {
    name: '010_create_dismiss_rules',
    sql: `
      CREATE TABLE dismiss_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT NOT NULL UNIQUE,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    name: '011_add_suggested_todo_status',
    sql: `
      -- SQLite doesn't support ALTER CHECK directly, so we recreate with the new constraint
      CREATE TABLE todos_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'done', 'cancelled', 'suggested')),
        priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high', 'medium', 'low')),
        due_date TEXT,
        source_doc_id TEXT,
        source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('manual', 'email', 'teams', 'chat')),
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO todos_new SELECT * FROM todos;
      DROP TABLE todos;
      ALTER TABLE todos_new RENAME TO todos;
      CREATE INDEX idx_todos_status ON todos(status);
      CREATE INDEX idx_todos_priority ON todos(priority);
      CREATE INDEX idx_todos_due_date ON todos(due_date);
    `,
  },
  {
    name: '012_create_todo_scan_log',
    sql: `
      CREATE TABLE todo_scan_log (
        s3_key TEXT PRIMARY KEY,
        scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    name: '013_enhance_urls_for_reference_links',
    sql: `
      CREATE TABLE urls_new (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        normalized_url TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        category TEXT NOT NULL DEFAULT 'uncategorized',
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_doc_id TEXT,
        status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'recommended', 'dismissed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO urls_new (id, url, normalized_url, title, tags, category, source_doc_id, status, created_at, updated_at)
        SELECT id, url, url, title, '[]', category, source_doc_id, 'confirmed', created_at, created_at FROM urls;

      DROP TABLE urls;
      ALTER TABLE urls_new RENAME TO urls;

      CREATE UNIQUE INDEX idx_urls_normalized ON urls(normalized_url);
      CREATE INDEX idx_urls_category ON urls(category);
      CREATE INDEX idx_urls_status ON urls(status);
    `,
  },
  {
    name: '014_add_urls_last_modified',
    sql: `
      ALTER TABLE urls ADD COLUMN last_modified TEXT;
      CREATE INDEX idx_urls_last_modified ON urls(last_modified);
    `,
  },
  {
    name: '015_add_msal_cache',
    sql: `
      ALTER TABLE account_tokens ADD COLUMN msal_cache TEXT;
    `,
  },
];
