import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db';
import { normalizeUrl, extractUrls } from './text';
import {
  searchDriveFiles,
  searchRecentFiles,
  fetchMyDriveId,
  fetchMyUserId,
  classifyDriveFiles,
  type GraphDriveItem,
} from './graph';
import { getEnabledAccounts, loadConfig } from './config.node';
import logger from './logger';

const log = logger.child({ module: 'reference-links' });

// === Types ===

export interface ReferenceLink {
  id: string;
  url: string;
  title: string;
  tags: string[];
  category: string;
  sourceType: string;
  status: 'confirmed' | 'recommended' | 'dismissed';
  lastModified: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UrlRow {
  id: string;
  url: string;
  normalized_url: string;
  title: string;
  tags: string;
  category: string;
  source_type: string;
  source_doc_id: string | null;
  status: string;
  last_modified: string | null;
  created_at: string;
  updated_at: string;
}

function rowToLink(r: UrlRow): ReferenceLink {
  let tags: string[] = [];
  try { tags = JSON.parse(r.tags); } catch { /* ignore */ }
  return {
    id: r.id,
    url: r.url,
    title: r.title,
    tags,
    category: r.category,
    sourceType: r.source_type,
    status: r.status as ReferenceLink['status'],
    lastModified: r.last_modified,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// === Queries ===

const VALID_SORT_COLUMNS: Record<string, string> = {
  last_modified: 'last_modified',
  created_at: 'created_at',
  title: 'title',
};

export function getLinks(opts: {
  status?: string;
  category?: string;
  sourceType?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}): { links: ReferenceLink[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.status) {
    conditions.push('status = ?');
    params.push(opts.status);
  }
  if (opts.category) {
    conditions.push('category = ?');
    params.push(opts.category);
  }
  if (opts.sourceType) {
    conditions.push('source_type = ?');
    params.push(opts.sourceType);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortCol = VALID_SORT_COLUMNS[opts.sort ?? ''] ?? 'last_modified';
  const sortDir = opts.order === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const rows = db.prepare(`
    SELECT * FROM urls ${where}
    ORDER BY ${sortCol} ${sortDir} NULLS LAST, created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as UrlRow[];

  const total = (db.prepare(
    `SELECT COUNT(*) as count FROM urls ${where}`
  ).get(...params) as { count: number }).count;

  return { links: rows.map(rowToLink), total };
}

export function updateLink(id: string, fields: { title?: string; tags?: string[] }): ReferenceLink | null {
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (fields.title !== undefined) {
    sets.push('title = ?');
    params.push(fields.title);
  }
  if (fields.tags !== undefined) {
    sets.push('tags = ?');
    params.push(JSON.stringify(fields.tags));
  }

  if (sets.length === 0) return null;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE urls SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  const row = db.prepare('SELECT * FROM urls WHERE id = ?').get(id) as UrlRow | undefined;
  return row ? rowToLink(row) : null;
}

export function acceptLink(id: string): ReferenceLink | null {
  const db = getDb();
  db.prepare(`
    UPDATE urls SET status = 'confirmed', updated_at = datetime('now') WHERE id = ? AND status = 'recommended'
  `).run(id);
  const row = db.prepare('SELECT * FROM urls WHERE id = ?').get(id) as UrlRow | undefined;
  return row ? rowToLink(row) : null;
}

export function dismissLink(id: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    UPDATE urls SET status = 'dismissed', updated_at = datetime('now') WHERE id = ?
  `).run(id);
  return result.changes > 0;
}

export function deleteLink(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM urls WHERE id = ?').run(id);
  return result.changes > 0;
}

export function bulkDismiss(ids: string[]): number {
  const db = getDb();
  const stmt = db.prepare(`UPDATE urls SET status = 'dismissed', updated_at = datetime('now') WHERE id = ?`);
  let changed = 0;
  const tx = db.transaction(() => {
    for (const id of ids) {
      changed += stmt.run(id).changes;
    }
  });
  tx();
  return changed;
}

export function bulkDelete(ids: string[]): number {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM urls WHERE id = ?');
  let changed = 0;
  const tx = db.transaction(() => {
    for (const id of ids) {
      changed += stmt.run(id).changes;
    }
  });
  tx();
  return changed;
}

/** Delete all OneDrive-sourced URL references (both owned and shared). */
export function clearOneDriveLinks(): { deleted: number } {
  const db = getDb();
  // Delete by source_type AND by URL pattern (catches legacy rows imported as 'manual')
  const result = db.prepare(
    `DELETE FROM urls WHERE source_type IN ('onedrive', 'onedrive-shared')
       OR url LIKE '%sharepoint.com%'
       OR url LIKE '%1drv.ms%'
       OR url LIKE '%my.sharepoint.com%'`
  ).run();
  return { deleted: result.changes };
}

// === Upsert helpers ===

/**
 * Insert a URL if its normalized form doesn't already exist.
 * Returns the id if inserted, null if already present.
 */
function upsertUrl(opts: {
  url: string;
  title: string;
  tags?: string[];
  category?: string;
  sourceType: string;
  sourceDocId?: string;
  lastModified?: string;
  status: 'confirmed' | 'recommended';
}): string | null {
  const db = getDb();
  const normalized = normalizeUrl(opts.url);

  const existing = db.prepare('SELECT id, status FROM urls WHERE normalized_url = ?').get(normalized) as
    { id: string; status: string } | undefined;

  if (existing) {
    // Update last_modified if we have a newer value
    if (opts.lastModified) {
      db.prepare(`UPDATE urls SET last_modified = ?, updated_at = datetime('now') WHERE id = ? AND (last_modified IS NULL OR last_modified < ?)`)
        .run(opts.lastModified, existing.id, opts.lastModified);
    }
    return null;
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO urls (id, url, normalized_url, title, tags, category, source_type, source_doc_id, last_modified, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.url,
    normalized,
    opts.title,
    JSON.stringify(opts.tags ?? []),
    opts.category ?? 'uncategorized',
    opts.sourceType,
    opts.sourceDocId ?? null,
    opts.lastModified ?? null,
    opts.status,
  );

  return id;
}

// === OneDrive recents ===

function categorizeOneDriveItem(item: GraphDriveItem): string {
  const url = (item.webUrl ?? '').toLowerCase();
  const name = (item.name ?? '').toLowerCase();
  if (url.includes('sharepoint.com') || url.includes('sharepoint')) return 'sharepoint';
  if (name.endsWith('.docx') || name.endsWith('.doc') || name.endsWith('.pdf')) return 'docs';
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) return 'docs';
  if (name.endsWith('.pptx') || name.endsWith('.ppt')) return 'docs';
  return 'reference';
}

function tagsFromDriveItem(item: GraphDriveItem): string[] {
  const tags: string[] = [];
  const name = item.name ?? '';
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext && ext !== name.toLowerCase()) tags.push(ext);

  const parent = item.parentReference?.name;
  if (parent && parent !== 'root') tags.push(parent);

  return tags;
}

export async function syncOneDriveRecents(): Promise<{ imported: number; errors: string[] }> {
  const accounts = getEnabledAccounts('microsoft').filter(a =>
    a.scopes.some(s => s.toLowerCase().startsWith('files.read'))
  );

  if (accounts.length === 0) {
    return { imported: 0, errors: ['No accounts with Files.Read scope found'] };
  }

  let imported = 0;
  const errors: string[] = [];
  const SHARED_LOOKBACK_DAYS = 30;
  const SHARED_LIMIT = 200;

  for (const account of accounts) {
    try {
      // Get user identity for ownership classification
      const [myDriveId, myUserId] = await Promise.all([
        fetchMyDriveId(account),
        fetchMyUserId(account),
      ]);

      // --- Owned files: /me/drive/root/search(q='') ---
      // This only searches your own OneDrive, so all results are owned.
      // Filter to Documents/ folder only — skips Attachments, Desktop, Meetings, etc.
      const ownedFiles = await searchDriveFiles(account, 200);
      let ownedImported = 0;
      let ownedSkipped = 0;

      // DEBUG: log sample parentReference.path values to see actual format
      log.info(
        {
          samplePaths: ownedFiles.slice(0, 15).map(item => ({
            name: item.name,
            parentPath: item.parentReference?.path,
            parentName: item.parentReference?.name,
            webUrl: item.webUrl?.slice(0, 80),
          })),
        },
        'DEBUG: owned file parentReference paths',
      );

      for (const item of ownedFiles) {
        if (!item.webUrl || item.folder) continue;

        // Only import files under /Documents
        const parentPath = item.parentReference?.path ?? '';
        if (!parentPath.includes('/Documents')) {
          ownedSkipped++;
          continue;
        }

        const id = upsertUrl({
          url: item.webUrl,
          title: item.name || item.webUrl,
          tags: tagsFromDriveItem(item),
          category: categorizeOneDriveItem(item),
          sourceType: 'onedrive',
          lastModified: item.lastModifiedDateTime || undefined,
          status: 'confirmed',
        });
        if (id) ownedImported++;
      }

      // --- Shared files: Search API with date filter ---
      // Searches all M365 content, then filters to items NOT on your drive.
      const { items: searchResults, total: searchTotal } = await searchRecentFiles(
        account,
        SHARED_LOOKBACK_DAYS,
        SHARED_LIMIT,
      );

      // Classify to extract only shared items (driveId ≠ mine)
      const { shared } = classifyDriveFiles(searchResults, myDriveId, myUserId);

      // --- Filtering: people filter + SharePoint site allowlist ---
      const db = getDb();
      const knownEmails = new Set<string>(
        (db.prepare('SELECT DISTINCT lower(email) as email FROM people WHERE email IS NOT NULL').all() as { email: string }[])
          .map(r => r.email),
      );
      const config = loadConfig();
      const siteAllowlist = (config.sharePointAllowlist ?? []).map(s => s.toLowerCase());

      let sharedImported = 0;
      let sharedSkipped = 0;

      for (const item of shared) {
        const resolved = item.remoteItem ?? item;
        if (!resolved.webUrl || resolved.folder) continue;

        const creatorEmail = resolved.createdBy?.user?.email?.toLowerCase();
        const webUrlLower = resolved.webUrl.toLowerCase();

        // Accept if creator is a known contact
        const fromKnownPerson = !!creatorEmail && knownEmails.has(creatorEmail);
        // Accept if URL matches an allowlisted SharePoint site
        const onAllowlistedSite = siteAllowlist.length > 0 && siteAllowlist.some(site => webUrlLower.includes(site));

        if (!fromKnownPerson && !onAllowlistedSite) {
          sharedSkipped++;
          continue;
        }

        const id = upsertUrl({
          url: resolved.webUrl,
          title: resolved.name || resolved.webUrl,
          tags: [...tagsFromDriveItem(resolved), 'shared'],
          category: categorizeOneDriveItem(resolved),
          sourceType: 'onedrive-shared',
          lastModified: resolved.lastModifiedDateTime || undefined,
          status: 'confirmed',
        });
        if (id) sharedImported++;
      }

      imported += ownedImported + sharedImported;
      log.info(
        { owned: ownedFiles.length, ownedSkipped, shared: shared.length, sharedSkipped, searchTotal, ownedImported, sharedImported },
        'OneDrive sync complete',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`OneDrive sync for "${account.name}": ${msg}`);
      log.error({ account: account.name, error: msg }, 'OneDrive sync failed');
    }
  }

  log.info({ imported }, 'OneDrive sync complete');
  return { imported, errors };
}

// === Extract recommended URLs from content ===

const SKIP_DOMAINS = new Set([
  'aka.ms', 'go.microsoft.com', 'login.microsoftonline.com',
  'login.windows.net', 'outlook.office365.com', 'outlook.office.com',
  'outlook.live.com', 'teams.microsoft.com',
  'statics.teams.cdn.office.net', 'graph.microsoft.com',
]);

function shouldSkipUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (SKIP_DOMAINS.has(host)) return true;
    // Skip tracking/unsubscribe/pixel URLs
    if (/\/(unsubscribe|track|click|open|pixel|beacon)/i.test(parsed.pathname)) return true;
    // Skip very short paths that are likely redirects
    if (parsed.pathname === '/' && !parsed.search) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Extract URLs from text content (email body, Teams message) and insert as recommended.
 * Should be called during email/teams polling.
 */
export function extractAndRecommendUrls(
  text: string,
  sourceType: 'email' | 'teams',
  sourceDocId?: string,
): number {
  const urls = extractUrls(text);
  let count = 0;

  for (const url of urls) {
    if (shouldSkipUrl(url)) continue;

    const id = upsertUrl({
      url,
      title: '', // Will be populated by the user when accepting
      sourceType,
      sourceDocId,
      status: 'recommended',
    });
    if (id) count++;
  }

  return count;
}
