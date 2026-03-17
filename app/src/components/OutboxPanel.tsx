'use client';

import { useCallback, useEffect, useState } from 'react';

interface OutboxItem {
  id: string;
  destination: 'email' | 'teams' | 'clipboard';
  subject: string;
  content: string;
  to: string[];
  status: 'draft' | 'approved' | 'sent';
  createdAt: string;
  updatedAt: string;
}

export default function OutboxPanel() {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'draft' | 'approved' | 'sent'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchItems = useCallback(async () => {
    try {
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const res = await fetch(`/api/outbox${params}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const selectedItem = items.find(i => i.id === selected);

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    setError('');
    try {
      const res = await fetch(`/api/outbox/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed');
      }
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSend = async (id: string) => {
    setActionLoading(id);
    setError('');
    try {
      const res = await fetch(`/api/outbox/${id}/send`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Send failed');
      }
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevert = async (id: string) => {
    setActionLoading(id);
    setError('');
    try {
      const res = await fetch(`/api/outbox/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed');
      }
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    setActionLoading(id);
    setError('');
    try {
      const res = await fetch(`/api/outbox/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Delete failed');
      }
      if (selected === id) setSelected(null);
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActionLoading(null);
    }
  };

  const statusBadge = (status: string) => {
    const styles = {
      draft: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
      approved: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
      sent: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[status as keyof typeof styles] || ''}`}>
        {status}
      </span>
    );
  };

  const destIcon = (destination: string) => {
    if (destination === 'email') return '✉️';
    if (destination === 'teams') return '💬';
    return '📋';
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
        Loading outbox…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h2 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">Outbox</h2>

      {/* Filters */}
      <div className="mb-4 flex gap-2">
        {(['all', 'draft', 'approved', 'sent'] as const).map(f => (
          <button
            key={f}
            onClick={() => { setFilter(f); setSelected(null); }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
              filter === f
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No items in outbox{filter !== 'all' ? ` with status "${filter}"` : ''}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <button
              key={item.id}
              onClick={() => setSelected(selected === item.id ? null : item.id)}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                selected === item.id
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
                  : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-750'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">{destIcon(item.destination)}</span>
                <span className="flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {item.subject || item.content.slice(0, 60) || 'Untitled'}
                </span>
                {statusBadge(item.status)}
              </div>
              {item.to.length > 0 && (
                <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                  To: {item.to.join(', ')}
                </p>
              )}
              <p className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                {new Date(item.createdAt).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selectedItem && (
        <div className="mt-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <div className="flex items-center gap-2">
              <span>{destIcon(selectedItem.destination)}</span>
              <h3 className="flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {selectedItem.subject || 'No subject'}
              </h3>
              {statusBadge(selectedItem.status)}
            </div>
            {selectedItem.to.length > 0 && (
              <p className="mt-1 text-xs text-zinc-500">To: {selectedItem.to.join(', ')}</p>
            )}
          </div>
          <div className="p-4">
            <pre className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">
              {selectedItem.content}
            </pre>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
            {selectedItem.status === 'draft' && (
              <button
                onClick={() => handleApprove(selectedItem.id)}
                disabled={actionLoading === selectedItem.id}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Approve
              </button>
            )}
            {selectedItem.status === 'approved' && (
              <>
                <button
                  onClick={() => handleSend(selectedItem.id)}
                  disabled={actionLoading === selectedItem.id}
                  className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Send
                </button>
                <button
                  onClick={() => handleRevert(selectedItem.id)}
                  disabled={actionLoading === selectedItem.id}
                  className="rounded-lg border border-zinc-200 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Revert to Draft
                </button>
              </>
            )}
            {selectedItem.status !== 'sent' && (
              <button
                onClick={() => handleDelete(selectedItem.id)}
                disabled={actionLoading === selectedItem.id}
                className="rounded-lg border border-red-200 px-4 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
