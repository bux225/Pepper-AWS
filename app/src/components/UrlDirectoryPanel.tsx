'use client';

import { useState, useEffect, useCallback } from 'react';

interface UrlReference {
  id: number;
  url: string;
  title: string;
  sourceType: string;
  category: string;
  extractedAt: string;
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  docs: { label: 'Docs', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' },
  wiki: { label: 'Wiki', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400' },
  article: { label: 'Article', color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' },
  tool: { label: 'Tool', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400' },
  project: { label: 'Project', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400' },
  sharepoint: { label: 'SharePoint', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400' },
  reference: { label: 'Reference', color: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  general: { label: 'Uncategorized', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' },
};

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function UrlDirectoryPanel() {
  const [urls, setUrls] = useState<UrlReference[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [total, setTotal] = useState(0);

  const fetchUrls = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (categoryFilter) params.set('category', categoryFilter);
      params.set('limit', '200');
      const res = await fetch(`/api/urls?${params}`);
      if (!res.ok) throw new Error(`Failed to load URLs (${res.status})`);
      const data = await res.json();
      setUrls(data.urls ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load URLs');
      setUrls([]);
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter]);

  useEffect(() => {
    fetchUrls();
  }, [fetchUrls]);

  // Group by category for display
  const grouped = urls.reduce<Record<string, UrlReference[]>>((acc, url) => {
    const cat = url.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(url);
    return acc;
  }, {});

  const categories = Object.keys(grouped).sort((a, b) => {
    const order = ['docs', 'wiki', 'project', 'tool', 'article', 'sharepoint', 'reference', 'general'];
    return (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b));
  });

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">URL Directory</h2>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
            {total}
          </span>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-2 dark:border-zinc-800">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search URLs or titles…"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        >
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([key, { label }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </div>
      )}

      {/* URL list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-5 text-sm text-zinc-500 dark:text-zinc-400">Loading…</div>
        ) : urls.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {search || categoryFilter ? 'No URLs match your search.' : 'No URLs collected yet. They\'ll appear here as Pepper analyzes your emails and messages.'}
          </div>
        ) : categoryFilter ? (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {urls.map(url => (
              <UrlRow key={url.id} url={url} />
            ))}
          </ul>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {categories.map(cat => (
              <div key={cat}>
                <div className="sticky top-0 z-10 bg-zinc-50 px-5 py-2 dark:bg-zinc-950">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${CATEGORY_LABELS[cat]?.color ?? CATEGORY_LABELS.general.color}`}>
                    {CATEGORY_LABELS[cat]?.label ?? cat} ({grouped[cat].length})
                  </span>
                </div>
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                  {grouped[cat].map(url => (
                    <UrlRow key={url.id} url={url} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UrlRow({ url }: { url: UrlReference }) {
  return (
    <li className="flex items-start gap-3 px-5 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
      <div className="min-w-0 flex-1">
        <a
          href={url.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
        >
          {url.title || getDomain(url.url)}
        </a>
        <div className="mt-0.5 flex items-center gap-2 text-[11px]">
          <span className="truncate text-zinc-400 dark:text-zinc-500" title={url.url}>
            {getDomain(url.url)}
          </span>
          {url.sourceType && url.sourceType !== 'unknown' && (
            <span className="text-zinc-400 dark:text-zinc-500">
              via {url.sourceType}
            </span>
          )}
          <span className="text-zinc-400 dark:text-zinc-500">
            {new Date(url.extractedAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </li>
  );
}
