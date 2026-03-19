'use client';

import { useState, useEffect, useCallback } from 'react';

interface FollowUp {
  id: number;
  sourceDocId: string;
  sourceType: string;
  status: string;
  direction: string;
  contactName: string;
  summary: string;
  staleDays: number;
}

export default function FollowUpPanel() {
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'waiting' | 'resolved' | 'dismissed'>('waiting');
  const [scanning, setScanning] = useState(false);
  const [lastIngest, setLastIngest] = useState<string | null>(null);

  const fetchIngestStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/ingest/status');
      if (res.ok) {
        const data = await res.json();
        setLastIngest(data.lastIngest);
      }
    } catch { /* non-critical */ }
  }, []);

  const fetchFollowUps = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/follow-ups?status=${filter}`);
      if (res.ok) {
        const data = await res.json();
        setFollowUps(data.followUps ?? []);
      }
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchFollowUps();
  }, [fetchFollowUps]);

  useEffect(() => {
    fetchIngestStatus();
  }, [fetchIngestStatus]);

  const updateStatus = async (id: number, status: 'resolved' | 'dismissed') => {
    try {
      await fetch('/api/follow-ups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      fetchFollowUps();
    } catch { /* silent */ }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Follow-ups</h2>
          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/40 dark:text-orange-400">
            {followUps.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              setScanning(true);
              try {
                await fetch('/api/follow-ups', { method: 'POST', headers: { 'X-Pepper-Internal': '1' } });
                await Promise.all([fetchFollowUps(), fetchIngestStatus()]);
              } catch { /* silent */ } finally {
                setScanning(false);
              }
            }}
            disabled={scanning}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            title="Scan emails for follow-ups now"
          >
            {scanning ? 'Scanning…' : '⟳ Scan'}
          </button>
          {(['waiting', 'resolved', 'dismissed'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                filter === s
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Ingest status */}
      {lastIngest && (
        <div className="border-b border-zinc-100 px-4 py-1.5 text-[11px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
          Last ingest: {new Date(lastIngest).toLocaleString()}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">Loading…</div>
        ) : followUps.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {filter === 'waiting' ? 'No pending follow-ups. You\'re all caught up!' : `No ${filter} follow-ups.`}
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {followUps.map(fu => (
              <li key={fu.id} className="flex items-start gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-orange-400 text-xs text-orange-500 dark:border-orange-600 dark:text-orange-400">
                  ⏳
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-800 dark:text-zinc-200">{fu.summary}</p>
                  <div className="mt-1 flex items-center gap-2 text-[11px]">
                    <span className="text-orange-600 dark:text-orange-400">
                      {fu.sourceType === 'email' ? '📧' : '💬'} {fu.contactName}
                    </span>
                    {fu.staleDays > 0 && (
                      <span className={`font-medium ${
                        fu.staleDays >= 5 ? 'text-red-600 dark:text-red-400' :
                        fu.staleDays >= 3 ? 'text-orange-600 dark:text-orange-400' :
                        'text-zinc-500 dark:text-zinc-400'
                      }`}>
                        {fu.staleDays}d ago
                      </span>
                    )}
                    <span className="text-zinc-400">
                      {fu.direction === 'awaiting_reply' ? 'Waiting for their reply' : 'Needs your response'}
                    </span>
                  </div>
                </div>
                {filter === 'waiting' && (
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      onClick={() => updateStatus(fu.id, 'resolved')}
                      className="rounded p-1.5 text-emerald-600 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900/40"
                      title="Mark as resolved"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => updateStatus(fu.id, 'dismissed')}
                      className="rounded p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                      title="Dismiss"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
