import Database from 'better-sqlite3';
import { existsSync, copyFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ingestBrowserVisits, type BrowserVisitDoc } from './s3-ingest';
import logger from './logger';

const log = logger.child({ module: 'edge-history' });

const EDGE_HISTORY_PATHS: Record<string, string> = {
  darwin: join(
    process.env.HOME ?? '',
    'Library/Application Support/Microsoft Edge/Default/History',
  ),
  win32: join(
    process.env.LOCALAPPDATA ?? '',
    'Microsoft/Edge/User Data/Default/History',
  ),
  linux: join(process.env.HOME ?? '', '.config/microsoft-edge/Default/History'),
};

interface HistoryRow {
  url: string;
  title: string;
  visit_count: number;
  last_visit_time: number;
  total_dwell_seconds: number;
}

/**
 * Import recent browser history from Microsoft Edge → S3.
 * Edge locks its DB, so we copy it to a temp file first.
 */
export async function importEdgeHistory(options?: {
  daysBack?: number;
  minVisits?: number;
  minDwellSeconds?: number;
  urlFilter?: string;
}): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const daysBack = options?.daysBack ?? 7;
  const minVisits = options?.minVisits ?? 1;
  const minDwellSeconds = options?.minDwellSeconds ?? 60;
  const urlFilter = options?.urlFilter;

  const historyPath = EDGE_HISTORY_PATHS[process.platform];
  if (!historyPath || !existsSync(historyPath)) {
    return { imported: 0, skipped: 0, errors: ['Edge history database not found at expected location'] };
  }

  const tempPath = join(tmpdir(), `edge-history-${Date.now()}.db`);
  try {
    copyFileSync(historyPath, tempPath);
  } catch (err) {
    return { imported: 0, skipped: 0, errors: [`Failed to copy history DB: ${err instanceof Error ? err.message : 'unknown'}`] };
  }

  const errors: string[] = [];
  let skipped = 0;

  try {
    const histDb = new Database(tempPath, { readonly: true });

    // Chrome/Edge timestamps are microseconds since 1601-01-01
    const cutoffChromeTime = ((Date.now() / 1000) + 11644473600 - (daysBack * 86400)) * 1000000;

    let query = `
      SELECT u.url, u.title, u.visit_count, u.last_visit_time,
             COALESCE(SUM(v.visit_duration), 0) / 1000000 AS total_dwell_seconds
      FROM urls u
      LEFT JOIN visits v ON v.url = u.id AND v.visit_time > ?
      WHERE u.last_visit_time > ?
        AND u.visit_count >= ?
        AND u.title != ''
      GROUP BY u.id
      HAVING total_dwell_seconds >= ?
    `;
    const params: unknown[] = [cutoffChromeTime, cutoffChromeTime, minVisits, minDwellSeconds];

    if (urlFilter) {
      query += ' AND u.url LIKE ?';
      params.push(`%${urlFilter}%`);
    }

    query += ' ORDER BY u.last_visit_time DESC LIMIT 200';

    const rows = histDb.prepare(query).all(...params) as HistoryRow[];
    histDb.close();

    // Filter out internal/junk URLs
    const visits: BrowserVisitDoc[] = [];
    for (const row of rows) {
      if (
        row.url.startsWith('edge://') ||
        row.url.startsWith('chrome://') ||
        row.url.startsWith('about:') ||
        row.url.startsWith('file://') ||
        /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(row.url)
      ) {
        skipped++;
        continue;
      }

      const junkTitles = [
        'working...', 'loading...', 'please wait', 'redirecting',
        'choose an account to continue', 'sign in to your account',
        'saml response', 'single sign', 'authenticating',
        'content for undefined',
      ];
      const junkPatterns = [/^inbox\s*\(\d/i];
      if (
        junkTitles.some(j => row.title.toLowerCase().includes(j)) ||
        junkPatterns.some(p => p.test(row.title))
      ) {
        skipped++;
        continue;
      }

      const visitDate = new Date(row.last_visit_time / 1000 - 11644473600000);

      visits.push({
        url: row.url,
        title: row.title || row.url,
        visitTime: visitDate.toISOString(),
        visitCount: row.visit_count,
      });
    }

    // Ingest to S3 (dedup handled by sync journal)
    const imported = await ingestBrowserVisits(visits);

    log.info({ imported, skipped, total: rows.length }, 'Edge history import complete');
    return { imported, skipped, errors };
  } catch (err) {
    errors.push(`Edge history import failed: ${err instanceof Error ? err.message : 'unknown'}`);
    return { imported: 0, skipped, errors };
  } finally {
    try { unlinkSync(tempPath); } catch { /* ignore */ }
  }
}
