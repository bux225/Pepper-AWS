import { getAccessToken } from './auth';
import type { AccountConfig } from './types';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Authenticated fetch against Microsoft Graph API.
 */
export async function graphFetch(
  account: AccountConfig,
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const token = await getAccessToken(account);

  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Graph API ${res.status}: ${res.statusText} — ${body}`);
  }

  return res;
}

/** Fetch a full Graph API URL (e.g. @odata.nextLink) */
async function graphFetchRaw(
  account: AccountConfig,
  fullUrl: string,
  options?: RequestInit,
): Promise<Response> {
  const token = await getAccessToken(account);

  const res = await fetch(fullUrl, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Graph API ${res.status}: ${res.statusText} — ${body}`);
  }

  return res;
}

// === Email types ===

export interface GraphEmail {
  id: string;
  subject: string;
  bodyPreview: string;
  body: { contentType: string; content: string };
  from: { emailAddress: { name: string; address: string } };
  toRecipients: { emailAddress: { name: string; address: string } }[];
  receivedDateTime: string;
  webLink: string;
  isRead: boolean;
  conversationId?: string;
  meetingMessageType?: string;
}

interface GraphEmailResponse {
  value: GraphEmail[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

/**
 * Fetch emails from the user's inbox.
 * Uses delta query for incremental updates when a deltaLink is provided.
 */
export async function fetchEmails(
  account: AccountConfig,
  deltaLink?: string | null,
): Promise<{ emails: GraphEmail[]; deltaLink: string | null }> {
  let response: GraphEmailResponse;

  if (deltaLink) {
    const token = await getAccessToken(account);
    const res = await fetch(deltaLink, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'outlook.body-content-type="text"',
      },
    });
    if (!res.ok) throw new Error(`Graph delta ${res.status}`);
    response = await res.json() as GraphEmailResponse;
  } else {
    const path = '/me/mailFolders/inbox/messages?$select=subject,bodyPreview,body,from,toRecipients,receivedDateTime,webLink,isRead,conversationId&$orderby=receivedDateTime desc&$top=1000';
    const res = await graphFetch(account, path, {
      headers: { Prefer: 'outlook.body-content-type="text"' },
    });
    response = await res.json() as GraphEmailResponse;
  }

  const isInitialFetch = !deltaLink;
  const allEmails = [...response.value];
  let resolvedDeltaLink = response['@odata.deltaLink'] ?? null;

  // Follow pagination only for incremental (delta) polls
  if (!isInitialFetch) {
    let nextLink = response['@odata.nextLink'];
    while (nextLink) {
      const token = await getAccessToken(account);
      const pageRes = await fetch(nextLink, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'outlook.body-content-type="text"',
        },
      });
      if (!pageRes.ok) break;
      const page = await pageRes.json() as GraphEmailResponse;
      allEmails.push(...page.value);
      if (page['@odata.deltaLink']) {
        resolvedDeltaLink = page['@odata.deltaLink'];
      }
      nextLink = page['@odata.nextLink'];
    }
  }

  return { emails: allEmails, deltaLink: resolvedDeltaLink };
}

// === Teams types ===

export interface GraphChatMessage {
  id: string;
  messageType: string;
  body: { contentType: string; content: string };
  from: { user?: { displayName: string; id: string } } | null;
  createdDateTime: string;
  chatId: string;
  webUrl?: string;
}

export interface GraphChat {
  id: string;
  topic: string | null;
  chatType: string;
  lastUpdatedDateTime: string;
  members?: { displayName: string; userId: string }[];
}

interface GraphChatsResponse {
  value: GraphChat[];
  '@odata.nextLink'?: string;
}

interface GraphMessagesResponse {
  value: GraphChatMessage[];
  '@odata.nextLink'?: string;
}

export async function fetchChats(account: AccountConfig): Promise<GraphChat[]> {
  const res = await graphFetch(account, '/me/chats?$top=50');
  const data = await res.json() as GraphChatsResponse;
  return data.value;
}

export async function fetchCurrentUserId(account: AccountConfig): Promise<string> {
  const res = await graphFetch(account, '/me?$select=id');
  const data = await res.json() as { id: string };
  return data.id;
}

export async function fetchChatMessages(
  account: AccountConfig,
  chatId: string,
  since?: string,
): Promise<GraphChatMessage[]> {
  const params = new URLSearchParams({
    '$top': '50',
    '$orderby': 'createdDateTime desc',
  });

  const path = `/me/chats/${encodeURIComponent(chatId)}/messages?${params.toString()}`;
  const res = await graphFetch(account, path);
  const data = await res.json() as GraphMessagesResponse;

  let messages = data.value.map(msg => ({ ...msg, chatId }));

  if (since) {
    const sinceTime = new Date(since).getTime();
    messages = messages.filter(msg => new Date(msg.createdDateTime).getTime() > sinceTime);
  }

  return messages;
}

// === OneDrive / SharePoint Files ===

export interface GraphDriveItem {
  id: string;
  name: string;
  webUrl: string;
  lastModifiedDateTime: string;
  createdDateTime: string;
  size: number;
  file?: { mimeType: string };
  folder?: { childCount: number };
  createdBy?: { user?: { displayName: string; email?: string; id?: string } };
  lastModifiedBy?: { user?: { displayName: string; email?: string } };
  parentReference?: { path?: string; name?: string; driveId?: string };
  remoteItem?: GraphDriveItem;
}

interface GraphDriveItemResponse {
  value: GraphDriveItem[];
  '@odata.nextLink'?: string;
}

export async function fetchRecentFiles(account: AccountConfig): Promise<GraphDriveItem[]> {
  const res = await graphFetch(account, '/me/drive/recent?$top=100');
  const data = await res.json() as GraphDriveItemResponse;
  return data.value;
}

export async function fetchSharedWithMe(account: AccountConfig): Promise<GraphDriveItem[]> {
  const res = await graphFetch(account, '/me/drive/sharedWithMe?$top=200');
  const data = await res.json() as GraphDriveItemResponse;
  return data.value;
}

/** List children of a OneDrive folder. Pass '' or '/' for root. */
export async function listDriveChildren(
  account: AccountConfig,
  folderPath: string,
): Promise<GraphDriveItem[]> {
  const segment = folderPath && folderPath !== '/'
    ? `/me/drive/root:/${encodeURIComponent(folderPath)}:/children`
    : '/me/drive/root/children';
  const select = 'name,webUrl,folder,parentReference,lastModifiedDateTime,size';
  const res = await graphFetch(account, `${segment}?$select=${encodeURIComponent(select)}&$top=200`);
  const data = await res.json() as GraphDriveItemResponse;
  return data.value;
}

export async function fetchMyDriveId(account: AccountConfig): Promise<string> {
  const res = await graphFetch(account, '/me/drive?$select=id');
  const data = await res.json() as { id: string };
  return data.id;
}

export async function fetchMyUserId(account: AccountConfig): Promise<string> {
  const res = await graphFetch(account, '/me?$select=id');
  const data = await res.json() as { id: string };
  return data.id;
}

/**
 * Search all files in the user's OneDrive using the search endpoint.
 * Paginates through all pages up to `maxItems` results.
 */
export async function searchDriveFiles(account: AccountConfig, maxItems = 200, folderPath?: string): Promise<GraphDriveItem[]> {
  const select = 'name,webUrl,remoteItem,parentReference,createdBy,lastModifiedDateTime,createdDateTime,size,file,folder';
  const pageSize = Math.min(maxItems, 200);
  const all: GraphDriveItem[] = [];

  const root = folderPath
    ? `/me/drive/root:/${encodeURIComponent(folderPath)}:/search(q='')`
    : `/me/drive/root/search(q='')`;
  let url: string | null = `${root}?$top=${pageSize}&$select=${encodeURIComponent(select)}`;

  while (url && all.length < maxItems) {
    const isFullUrl = url.startsWith('http');
    const res = isFullUrl
      ? await graphFetchRaw(account, url)
      : await graphFetch(account, url);
    const data = await res.json() as GraphDriveItemResponse;
    all.push(...data.value);
    url = data['@odata.nextLink'] ?? null;
  }

  return all.slice(0, maxItems);
}

/**
 * Classify files into owned vs shared using the approach from distinguish_onedrive_files.py:
 * - remoteItem facet → shared
 * - parentReference.driveId differs from user's driveId → shared
 * - createdBy.user.id differs from user's id → shared (fallback)
 */
export function classifyDriveFiles(
  files: GraphDriveItem[],
  myDriveId: string,
  myUserId: string,
): { owned: GraphDriveItem[]; shared: GraphDriveItem[] } {
  const owned: GraphDriveItem[] = [];
  const shared: GraphDriveItem[] = [];

  for (const item of files) {
    if (item.remoteItem) {
      shared.push(item);
      continue;
    }
    if (item.parentReference?.driveId && item.parentReference.driveId !== myDriveId) {
      shared.push(item);
      continue;
    }
    const creatorId = item.createdBy?.user?.id;
    if (creatorId && creatorId !== myUserId) {
      shared.push(item);
      continue;
    }
    owned.push(item);
  }

  return { owned, shared };
}

interface GraphSearchResponse {
  value: {
    hitsContainers: {
      hits: { hitId: string; resource: GraphDriveItem }[];
      total: number;
      moreResultsAvailable: boolean;
    }[];
  }[];
}

export async function searchFiles(account: AccountConfig, query: string, limit = 25): Promise<GraphDriveItem[]> {
  const body = {
    requests: [{
      entityTypes: ['driveItem'],
      query: { queryString: query },
      from: 0,
      size: limit,
    }],
  };

  const token = await getAccessToken(account);
  const res = await fetch(`${GRAPH_BASE}/search/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Graph Search API ${res.status}: ${res.statusText} — ${errBody}`);
  }

  const data = await res.json() as GraphSearchResponse;
  const containers = data.value?.[0]?.hitsContainers ?? [];
  const hits = containers[0]?.hits ?? [];
  return hits.map(hit => hit.resource);
}

/**
 * Search for recently-modified files across all M365 content the user can access.
 * Uses the Microsoft Search API with a KQL date filter to keep results manageable.
 * Returns items along with the total available count.
 */
export async function searchRecentFiles(
  account: AccountConfig,
  sinceDaysAgo = 30,
  limit = 200,
): Promise<{ items: GraphDriveItem[]; total: number }> {
  const since = new Date(Date.now() - sinceDaysAgo * 86400_000);
  const sinceStr = since.toISOString().slice(0, 10); // YYYY-MM-DD
  const kql = `lastModifiedTime>=${sinceStr}`;

  const allItems: GraphDriveItem[] = [];
  let from = 0;
  let total = 0;
  const pageSize = Math.min(limit, 25); // Search API max per request is 25

  while (allItems.length < limit) {
    const body = {
      requests: [{
        entityTypes: ['driveItem'],
        query: { queryString: kql },
        from,
        size: pageSize,
        fields: ['name', 'webUrl', 'parentReference', 'createdBy', 'lastModifiedDateTime', 'size', 'file', 'folder'],
      }],
    };

    const token = await getAccessToken(account);
    const res = await fetch(`${GRAPH_BASE}/search/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Graph Search API ${res.status}: ${res.statusText} — ${errBody}`);
    }

    const data = await res.json() as GraphSearchResponse;
    const container = data.value?.[0]?.hitsContainers?.[0];
    if (!container) break;

    total = container.total ?? 0;
    const hits = container.hits ?? [];
    if (hits.length === 0) break;

    allItems.push(...hits.map(h => h.resource));
    if (!container.moreResultsAvailable) break;
    from += hits.length;
  }

  return { items: allItems.slice(0, limit), total };
}

/**
 * Fetch file metadata from a OneDrive/SharePoint URL using the /shares API.
 */
export async function fetchFileMetadataFromUrl(account: AccountConfig, url: string): Promise<GraphDriveItem | null> {
  try {
    const base64 = Buffer.from(url).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const path = `/shares/u!${base64}/driveItem`;
    const res = await graphFetch(account, path);
    if (!res.ok) return null;
    return await res.json() as GraphDriveItem;
  } catch {
    return null;
  }
}

/**
 * Send an email via Graph API.
 */
export async function sendEmail(
  account: AccountConfig,
  to: string[],
  subject: string,
  body: string,
): Promise<void> {
  await graphFetch(account, '/me/sendMail', {
    method: 'POST',
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: body },
        toRecipients: to.map(addr => ({ emailAddress: { address: addr } })),
      },
    }),
  });
}

/**
 * Send a Teams chat message.
 */
export async function sendTeamsMessage(
  account: AccountConfig,
  chatId: string,
  content: string,
): Promise<void> {
  await graphFetch(account, `/me/chats/${encodeURIComponent(chatId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      body: { contentType: 'html', content },
    }),
  });
}
