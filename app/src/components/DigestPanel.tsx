'use client';

import { useState, useEffect } from 'react';

interface DigestData {
  summary: string;
  stats: {
    totalDocs: number;
    recentDocs: number;
    bySource: Record<string, number>;
    outboxDrafts: number;
    outboxSent: number;
    todosOpen: number;
    todosDone: number;
  };
  highlights: Array<{
    s3Key: string;
    title: string;
    source: string;
  }>;
  createdAt?: string;
}

export default function DigestPanel() {
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [daysBack, setDaysBack] = useState(1);
  const [isStored, setIsStored] = useState(false);

  // Load latest stored digest on mount
  useEffect(() => {
    fetch('/api/digest?latest=1')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && !data.error) {
          setDigest(data);
          setIsStored(true);
        }
      })
      .catch(() => {});
  }, []);

  const fetchDigest = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/digest?days=${daysBack}`);
      if (!res.ok) throw new Error('Failed to generate digest');
      const data = await res.json();
      setDigest(data);
      setIsStored(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h2 className="mb-2 text-xl font-semibold text-zinc-900 dark:text-zinc-100">Daily Digest</h2>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        AI-generated summary of your recent knowledge base activity.
      </p>

      <div className="mb-6 flex items-center gap-3">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Period:</label>
        <div className="flex gap-1">
          {[1, 3, 7].map(d => (
            <button
              key={d}
              onClick={() => setDaysBack(d)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                daysBack === d
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
              }`}
            >
              {d === 1 ? 'Today' : `${d} days`}
            </button>
          ))}
        </div>
        <button
          onClick={fetchDigest}
          disabled={loading}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </div>
      )}

      {digest && (
        <div className="space-y-6">
          {digest.createdAt && isStored && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Auto-generated {new Date(digest.createdAt + 'Z').toLocaleString()}
            </p>
          )}

          {/* Stats bar */}
          <div className="flex flex-wrap gap-3">
            <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800">
              <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{digest.stats.recentDocs}</div>
              <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">new docs</div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800">
              <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{digest.stats.totalDocs}</div>
              <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">total</div>
            </div>
            {digest.stats.todosOpen > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 dark:border-blue-800 dark:bg-blue-950/30">
                <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{digest.stats.todosOpen}</div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-blue-600">open todos</div>
              </div>
            )}
            {digest.stats.todosDone > 0 && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 dark:border-green-800 dark:bg-green-950/30">
                <div className="text-2xl font-bold text-green-700 dark:text-green-400">{digest.stats.todosDone}</div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-green-600">done todos</div>
              </div>
            )}
            {Object.entries(digest.stats.bySource).map(([source, count]) => (
              <div key={source} className="rounded-lg border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800">
                <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{count}</div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{source}</div>
              </div>
            ))}
            {digest.stats.outboxDrafts > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-800 dark:bg-amber-950/30">
                <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">{digest.stats.outboxDrafts}</div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-amber-600">drafts pending</div>
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-800">
            <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">Summary</h3>
            <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
              {digest.summary}
            </div>
          </div>

          {/* Highlights */}
          {digest.highlights.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">Recent Highlights</h3>
              <div className="space-y-1">
                {digest.highlights.map(h => (
                  <div key={h.s3Key} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {h.source}
                    </span>
                    <span className="flex-1 truncate text-zinc-800 dark:text-zinc-200">{h.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
