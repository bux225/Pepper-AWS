import { countObjects } from './s3-client';
import { listOutboxItems } from './outbox';
import { countTodos } from './todos';
import { invokeModel } from './bedrock-llm';
import { getDb } from './db';
import logger from './logger';

export interface DigestStats {
  totalDocs: number;
  recentDocs: number;
  bySource: Record<string, number>;
  outboxDrafts: number;
  outboxSent: number;
  todosOpen: number;
  todosDone: number;
}

export interface DigestResult {
  summary: string;
  stats: DigestStats;
  dateRange: { from: string; to: string };
  createdAt?: string;
}

/**
 * Generate a daily digest summarizing recent activity.
 * Uses the sync_journal for doc counts and Bedrock for summarization.
 */
export async function generateDigest(daysBack = 1): Promise<DigestResult> {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffISO = cutoff.toISOString();

  // Count recent docs from sync journal
  const recentRows = db.prepare(`
    SELECT source_type, COUNT(*) as count
    FROM sync_journal
    WHERE uploaded_at >= ?
    GROUP BY source_type
  `).all(cutoffISO) as Array<{ source_type: string; count: number }>;

  const bySource: Record<string, number> = {};
  let recentDocs = 0;
  for (const row of recentRows) {
    bySource[row.source_type] = row.count;
    recentDocs += row.count;
  }

  // Total S3 doc count (cached in sync_journal)
  const totalRow = db.prepare('SELECT COUNT(*) as count FROM sync_journal').get() as { count: number };
  const totalDocs = totalRow.count;

  // Outbox & todo stats
  const drafts = listOutboxItems({ status: 'draft' });
  const sent = listOutboxItems({ status: 'sent' });
  const todosOpen = countTodos('open');
  const todosDone = countTodos('done');

  const stats: DigestStats = {
    totalDocs,
    recentDocs,
    bySource,
    outboxDrafts: drafts.length,
    outboxSent: sent.length,
    todosOpen,
    todosDone,
  };

  // Generate LLM summary
  let summary: string;
  if (recentDocs === 0) {
    summary = `No new items in the past ${daysBack} day${daysBack !== 1 ? 's' : ''}. Your knowledge base has ${totalDocs} total documents.`;
  } else {
    summary = await generateSummary(stats, daysBack);
  }

  return { summary, stats, dateRange: { from: cutoffISO, to: new Date().toISOString() } };
}

async function generateSummary(stats: DigestStats, daysBack: number): Promise<string> {
  const prompt = `Generate a digest for the past ${daysBack} day${daysBack !== 1 ? 's' : ''}.

Stats:
- Total documents: ${stats.totalDocs}
- New documents: ${stats.recentDocs}
- By source: ${Object.entries(stats.bySource).map(([k, v]) => `${k}: ${v}`).join(', ')}
- Open todos: ${stats.todosOpen}
- Completed todos: ${stats.todosDone}
- Outbox drafts pending: ${stats.outboxDrafts}
- Messages sent: ${stats.outboxSent}`;

  try {
    return await invokeModel(
      [{ role: 'user', content: prompt }],
      {
        system: `You are Pepper, a personal AI assistant generating a daily digest. Summarize the user's recent activity in a helpful, concise way. Keep it to 3-5 short paragraphs. Be conversational but professional. Do not invent information — only reference what's in the provided stats.`,
        maxTokens: 1024,
        temperature: 0.5,
      },
    );
  } catch (err) {
    logger.error({ err }, 'Digest generation failed');
    return `You added ${stats.recentDocs} new documents in the past ${daysBack} day${daysBack !== 1 ? 's' : ''}. Sources: ${Object.entries(stats.bySource).map(([k, v]) => `${v} ${k}`).join(', ')}.`;
  }
}

/**
 * Save a generated digest to the database.
 */
export function saveDigest(digest: DigestResult, daysBack: number): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO digests (days_back, summary, stats_json, highlights_json)
     VALUES (?, ?, ?, ?)`
  ).run(
    daysBack,
    digest.summary,
    JSON.stringify(digest.stats),
    JSON.stringify([]),
  );
  logger.info({ daysBack }, 'Digest saved');
}

/**
 * Get the most recent stored digest.
 */
export function getLatestDigest(daysBack?: number): DigestResult | null {
  const db = getDb();
  const query = daysBack != null
    ? db.prepare('SELECT * FROM digests WHERE days_back = ? ORDER BY created_at DESC LIMIT 1')
    : db.prepare('SELECT * FROM digests ORDER BY created_at DESC LIMIT 1');

  const row = (daysBack != null ? query.get(daysBack) : query.get()) as {
    summary: string;
    stats_json: string;
    highlights_json: string;
    created_at: string;
  } | undefined;

  if (!row) return null;

  return {
    summary: row.summary,
    stats: JSON.parse(row.stats_json),
    dateRange: { from: '', to: '' },
    createdAt: row.created_at,
  };
}
