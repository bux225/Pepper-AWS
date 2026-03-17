import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { uploadDocument } from './s3-client';
import { startKbSync } from './bedrock-kb';
import { getDb } from './db';
import logger from './logger';
import type { DocSourceType, DocMetadata } from './types';

// === Sync journal (dedup) ===

function isAlreadySynced(contentHash: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM sync_journal WHERE content_hash = ?').get(contentHash);
  return !!row;
}

function recordSync(contentHash: string, s3Key: string, sourceType: string): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO sync_journal (content_hash, s3_key, source_type)
    VALUES (?, ?, ?)
  `).run(contentHash, s3Key, sourceType);
}

// === Content hashing ===

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// === Email ingestion ===

export interface EmailDoc {
  messageId: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: Array<{ name: string; email: string }>;
  body: string;
  receivedAt: string;
  conversationId?: string;
  webLink?: string;
}

export async function ingestEmail(email: EmailDoc): Promise<string | null> {
  const contentHash = hashContent(`email:${email.messageId}:${email.body}`);
  if (isAlreadySynced(contentHash)) return null;

  const s3Key = `emails/${email.messageId}.json`;
  const people = [email.from, ...email.to.map(r => r.name)].filter(Boolean);

  const content = {
    type: 'email',
    subject: email.subject,
    from: `${email.from} <${email.fromEmail}>`,
    to: email.to.map(r => `${r.name} <${r.email}>`),
    body: email.body,
    receivedAt: email.receivedAt,
    conversationId: email.conversationId,
    webLink: email.webLink,
  };

  const metadata: DocMetadata = {
    source: 'email',
    title: email.subject,
    from: email.fromEmail,
    to: email.to.map(r => r.email),
    people,
    date: email.receivedAt,
    conversationId: email.conversationId,
  };

  await uploadDocument(s3Key, content, metadata);
  recordSync(contentHash, s3Key, 'email');

  logger.info({ messageId: email.messageId, subject: email.subject }, 'Ingested email to S3');
  return s3Key;
}

// === Teams message ingestion ===

export interface TeamsMessageDoc {
  messageId: string;
  chatId: string;
  from: string;
  fromEmail?: string;
  body: string;
  createdAt: string;
}

export async function ingestTeamsMessage(msg: TeamsMessageDoc): Promise<string | null> {
  const contentHash = hashContent(`teams:${msg.chatId}:${msg.messageId}:${msg.body}`);
  if (isAlreadySynced(contentHash)) return null;

  const s3Key = `teams/${msg.chatId}/${msg.messageId}.json`;

  const content = {
    type: 'teams',
    chatId: msg.chatId,
    from: msg.from,
    body: msg.body,
    createdAt: msg.createdAt,
  };

  const metadata: DocMetadata = {
    source: 'teams',
    title: `Teams: ${msg.from}`,
    from: msg.fromEmail,
    people: [msg.from].filter(Boolean),
    date: msg.createdAt,
    conversationId: msg.chatId,
  };

  await uploadDocument(s3Key, content, metadata);
  recordSync(contentHash, s3Key, 'teams');

  logger.debug({ chatId: msg.chatId, messageId: msg.messageId }, 'Ingested Teams message to S3');
  return s3Key;
}

// === Note ingestion ===

export interface NoteDoc {
  title: string;
  content: string;
  tags?: string[];
}

export async function ingestNote(note: NoteDoc): Promise<string> {
  const id = uuidv4();
  const s3Key = `notes/${id}.json`;
  const now = new Date().toISOString();

  const content = {
    type: 'note',
    title: note.title,
    content: note.content,
    createdAt: now,
  };

  const metadata: DocMetadata = {
    source: 'note',
    title: note.title,
    people: [],
    date: now,
    tags: note.tags,
  };

  await uploadDocument(s3Key, content, metadata);
  recordSync(hashContent(`note:${id}:${note.content}`), s3Key, 'note');

  logger.info({ title: note.title }, 'Ingested note to S3');
  return s3Key;
}

// === File/document ingestion ===

export interface FileDoc {
  filename: string;
  content: string;
  mimeType?: string;
}

export async function ingestFile(file: FileDoc): Promise<string> {
  const id = uuidv4();
  const s3Key = `documents/${id}.json`;
  const now = new Date().toISOString();

  const content = {
    type: 'document',
    filename: file.filename,
    content: file.content,
    mimeType: file.mimeType,
    createdAt: now,
  };

  const metadata: DocMetadata = {
    source: 'document',
    title: file.filename,
    people: [],
    date: now,
  };

  await uploadDocument(s3Key, content, metadata);
  recordSync(hashContent(`file:${id}:${file.content}`), s3Key, 'document');

  logger.info({ filename: file.filename }, 'Ingested file to S3');
  return s3Key;
}

// === Browser history ingestion ===

export interface BrowserVisitDoc {
  url: string;
  title: string;
  visitTime: string;
  visitCount: number;
}

export async function ingestBrowserVisits(visits: BrowserVisitDoc[]): Promise<number> {
  let count = 0;
  for (const visit of visits) {
    const contentHash = hashContent(`browser:${visit.url}:${visit.visitTime}`);
    if (isAlreadySynced(contentHash)) continue;

    const id = uuidv4();
    const s3Key = `browser/${id}.json`;

    const content = {
      type: 'browser',
      url: visit.url,
      title: visit.title,
      visitTime: visit.visitTime,
      visitCount: visit.visitCount,
    };

    const metadata: DocMetadata = {
      source: 'browser',
      title: visit.title || visit.url,
      people: [],
      date: visit.visitTime,
      url: visit.url,
    };

    await uploadDocument(s3Key, content, metadata);
    recordSync(contentHash, s3Key, 'browser');
    count++;
  }

  if (count > 0) {
    logger.info({ count }, 'Ingested browser visits to S3');
  }
  return count;
}

// === Trigger KB sync after ingestion ===

export async function syncKnowledgeBase(): Promise<string> {
  return startKbSync();
}
