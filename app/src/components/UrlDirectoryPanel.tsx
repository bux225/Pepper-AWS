'use client';

import { useState, useEffect, useCallback } from 'react';

interface ReferenceLink {
  id: string;
  url: string;
  title: string;
  tags: string[];
  category: string;
  sourceType: string;
  status: 'confirmed' | 'recommended' | 'dismissed';
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  docs: { label: 'Docs', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' },
  wiki: { label: 'Wiki', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400' },
  article: { label: 'Article', color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' },
  tool: { label: 'Tool', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400' },
  project: { label: 'Project', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400' },
  sharepoint: { label: 'SharePoint', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400' },
  reference: { label: 'Reference', color: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  uncategorized: { label: 'Uncategorized', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' },
};

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function UrlDirectoryPanel() {
  const [confirmed, setConfirmed] = useState<ReferenceLink[]>([]);
  const [recommended, setRecommended] = useState<ReferenceLink[]>([]);
  const [confirmedTotal, setConfirmedTotal] = useState(0);
  const [recommendedTotal, setRecommendedTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ status: 'confirmed', limit: '200' });
      if (categoryFilter) params.set('category', categoryFilter);
      const [confirmedRes, recommendedRes] = await Promise.all([
        fetch(`/api/urls?${params}`),
        fetch('/api/urls?status=recommended&limit=100'),
      ]);
      if (!confirmedRes.ok) throw new Error(`Failed to load links (${confirmedRes.status})`);
      if (!recommendedRes.ok) throw new Error(`Failed to load recommendations (${recommendedRes.status})`);
      const cData = await confirmedRes.json();
      const rData = await recommendedRes.json();
      setConfirmed(cData.links ?? []);
      setConfirmedTotal(cData.total ?? 0);
      setRecommended(rData.links ?? []);
      setRecommendedTotal(rData.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load links');
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  const handleSyncOneDrive = async () => {
    setSyncing(true);
    setError('');
    try {
      const res = await fetch('/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync-onedrive' }),
      });
      if (!res.ok) throw new Error(`Sync failed (${res.status})`);
      const data = await res.json();
      if (data.errors?.length > 0) {
        setError(data.errors.join('; '));
      }
      await fetchLinks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleAccept = async (id: string) => {
    try {
      const res = await fetch('/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept', id }),
      });
      if (!res.ok) throw new Error('Accept failed');
      await fetchLinks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Accept failed');
    }
  };

  const handleDismiss = async (id: string) => {
    try {
      const res = await fetch('/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss', id }),
      });
      if (!res.ok) throw new Error('Dismiss failed');
      setRecommended(prev => prev.filter(r => r.id !== id));
      setRecommendedTotal(prev => prev - 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dismiss failed');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch('/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      });
      if (!res.ok) throw new Error('Delete failed');
      await fetchLinks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  // Filter confirmed links by search
  const filtered = search.trim()
    ? confirmed.filter(l =>
        l.title.toLowerCase().includes(search.toLowerCase()) ||
        l.url.toLowerCase().includes(search.toLowerCase()) ||
        l.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
      )
    : confirmed;

  // Group confirmed links by category
  const grouped = filtered.reduce<Record<string, ReferenceLink[]>>((acc, link) => {
    const cat = link.category || 'uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(link);
    return acc;
  }, {});

  const categories = Object.keys(grouped).sort((a, b) => {
    const order = ['docs', 'wiki', 'project', 'tool', 'article', 'sharepoint', 'reference', 'uncategorized'];
    return (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b));
  });

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Reference Links</h2>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
            {confirmedTotal}
          </span>
          {recommendedTotal > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
              {recommendedTotal} new
            </span>
          )}
        </div>
        <button
          onClick={handleSyncOneDrive}
          disabled={syncing}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {syncing ? 'Syncing…' : 'Sync OneDrive'}
        </button>
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-2 dark:border-zinc-800">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search links, titles, or tags…"
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-5 text-sm text-zinc-500 dark:text-zinc-400">Loading…</div>
        ) : (
          <>
            {/* Recommended links section */}
            {recommended.length > 0 && (
              <div className="border-b border-zinc-200 dark:border-zinc-800">
                <div className="bg-amber-50 px-5 py-2 dark:bg-amber-950/30">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                    Recommended ({recommended.length})
                  </h3>
                  <p className="mt-0.5 text-[11px] text-amber-600/80 dark:text-amber-400/60">
                    Links found in your emails and Teams chats
                  </p>
                </div>
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                  {recommended.map(link => (
                    <RecommendedRow
                      key={link.id}
                      link={link}
                      onAccept={() => handleAccept(link.id)}
                      onDismiss={() => handleDismiss(link.id)}
                    />
                  ))}
                </ul>
              </div>
            )}

            {/* Confirmed links */}
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                {search || categoryFilter
                  ? 'No links match your search.'
                  : 'No reference links yet. Sync OneDrive or accept recommendations to get started.'}
              </div>
            ) : categoryFilter ? (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filtered.map(link => (
                  <EditableLinkRow key={link.id} link={link} onDelete={handleDelete} onUpdate={fetchLinks} />
                ))}
              </ul>
            ) : (
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {categories.map(cat => (
                  <div key={cat}>
                    <div className="sticky top-0 z-10 bg-zinc-50 px-5 py-2 dark:bg-zinc-950">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${CATEGORY_LABELS[cat]?.color ?? CATEGORY_LABELS.uncategorized.color}`}>
                        {CATEGORY_LABELS[cat]?.label ?? cat} ({grouped[cat].length})
                      </span>
                    </div>
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                      {grouped[cat].map(link => (
                        <EditableLinkRow key={link.id} link={link} onDelete={handleDelete} onUpdate={fetchLinks} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// === Recommended link row (accept / dismiss) ===

function RecommendedRow({
  link,
  onAccept,
  onDismiss,
}: {
  link: ReferenceLink;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-5 py-2.5 hover:bg-amber-50/50 dark:hover:bg-amber-950/20">
      <div className="min-w-0 flex-1">
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
        >
          {link.title || getDomain(link.url)}
        </a>
        <div className="mt-0.5 flex items-center gap-2 text-[11px]">
          <span className="truncate text-zinc-400 dark:text-zinc-500" title={link.url}>
            {getDomain(link.url)}
          </span>
          <span className="text-zinc-400 dark:text-zinc-500">
            via {link.sourceType}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onAccept}
          title="Accept – add to my links"
          className="rounded-md bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-400 dark:hover:bg-green-900/60"
        >
          ✓ Keep
        </button>
        <button
          onClick={onDismiss}
          title="Dismiss – hide this link"
          className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
        >
          ✕
        </button>
      </div>
    </li>
  );
}

// === Editable link row for confirmed links ===

function EditableLinkRow({
  link,
  onDelete,
  onUpdate,
}: {
  link: ReferenceLink;
  onDelete: (id: string) => void;
  onUpdate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(link.title);
  const [tagInput, setTagInput] = useState(link.tags.join(', '));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const tags = tagInput
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);
      const res = await fetch('/api/urls', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: link.id, title, tags }),
      });
      if (!res.ok) throw new Error('Save failed');
      setEditing(false);
      onUpdate();
    } catch {
      // keep editing open on failure
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <li className="space-y-2 border-l-2 border-blue-500 px-5 py-3">
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <input
          type="text"
          value={tagInput}
          onChange={e => setTagInput(e.target.value)}
          placeholder="Tags (comma-separated)"
          className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={() => { setEditing(false); setTitle(link.title); setTagInput(link.tags.join(', ')); }}
            className="rounded-md bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"
          >
            Cancel
          </button>
          <button
            onClick={() => onDelete(link.id)}
            className="ml-auto rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            Delete
          </button>
        </div>
      </li>
    );
  }

  return (
    <li
      className="group flex cursor-pointer items-start gap-3 px-5 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      onClick={() => setEditing(true)}
    >
      <div className="min-w-0 flex-1">
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
        >
          {link.title || getDomain(link.url)}
        </a>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="truncate text-zinc-400 dark:text-zinc-500" title={link.url}>
            {getDomain(link.url)}
          </span>
          {link.sourceType && link.sourceType !== 'manual' && (
            <span className="text-zinc-400 dark:text-zinc-500">
              via {link.sourceType}
            </span>
          )}
          {link.tags.length > 0 && link.tags.map(tag => (
            <span
              key={tag}
              className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
      <span className="hidden text-[11px] text-zinc-400 group-hover:inline dark:text-zinc-500">
        click to edit
      </span>
    </li>
  );
}
