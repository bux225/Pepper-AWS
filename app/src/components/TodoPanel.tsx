'use client';

import { useState, useEffect, useCallback } from 'react';

interface Todo {
  id: string;
  title: string;
  description: string;
  status: 'open' | 'done' | 'cancelled' | 'suggested';
  priority: 'high' | 'medium' | 'low';
  dueDate?: string;
  sourceDocId?: string;
  sourceType: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

type FilterStatus = 'open' | 'done' | 'all';

const PRIORITY_BADGES = {
  high: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  low: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

const SOURCE_LABELS: Record<string, string> = {
  manual: '',
  email: '📧',
  teams: '💬',
  chat: '🤖',
};

export default function TodoPanel() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [suggested, setSuggested] = useState<Todo[]>([]);
  const [filter, setFilter] = useState<FilterStatus>('open');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [scanning, setScanning] = useState(false);
  const [lastIngest, setLastIngest] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<string | null>(null);

  const fetchIngestStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/ingest/status');
      if (res.ok) {
        const data = await res.json();
        setLastIngest(data.lastIngest);
        setLastScan(data.lastTodoScan);
      }
    } catch { /* non-critical */ }
  }, []);

  const fetchTodos = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const status = filter === 'all' ? '' : `status=${filter}`;
      const res = await fetch(`/api/todos?${status}&limit=500`);
      if (!res.ok) throw new Error(`Failed to load todos (${res.status})`);
      const data = await res.json();
      setTodos(data.todos ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load todos');
      setTodos([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const fetchSuggested = useCallback(async () => {
    try {
      const res = await fetch('/api/todos?status=suggested&limit=50');
      if (res.ok) {
        const data = await res.json();
        setSuggested(data.todos ?? []);
      }
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  useEffect(() => {
    fetchSuggested();
  }, [fetchSuggested]);

  useEffect(() => {
    fetchIngestStatus();
  }, [fetchIngestStatus]);

  const approveTodo = async (id: string) => {
    try {
      await fetch(`/api/todos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'open' }),
      });
      fetchTodos();
      fetchSuggested();
    } catch { /* silent */ }
  };

  const dismissTodo = async (id: string) => {
    try {
      await fetch(`/api/todos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      fetchSuggested();
    } catch { /* silent */ }
  };

  const addTodo = async () => {
    const title = newTitle.trim();
    if (!title) return;

    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, priority: newPriority, sourceType: 'manual' }),
      });
      if (!res.ok) throw new Error('Failed to create todo');
      setNewTitle('');
      setNewPriority('medium');
      setShowAddForm(false);
      fetchTodos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create todo');
    }
  };

  const toggleTodo = async (todo: Todo) => {
    const newStatus = todo.status === 'open' ? 'done' : 'open';
    try {
      const res = await fetch(`/api/todos/${todo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update todo');
      fetchTodos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const updatePriority = async (todo: Todo, priority: 'high' | 'medium' | 'low') => {
    try {
      await fetch(`/api/todos/${todo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority }),
      });
      fetchTodos();
    } catch { /* silent */ }
  };

  const saveEdit = async (id: string) => {
    const title = editTitle.trim();
    if (!title) return;
    try {
      await fetch(`/api/todos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      setEditingId(null);
      fetchTodos();
    } catch { /* silent */ }
  };

  const deleteTodo = async (id: string) => {
    try {
      await fetch(`/api/todos/${id}`, { method: 'DELETE' });
      fetchTodos();
    } catch { /* silent */ }
  };

  const convertToFollowUp = async (id: string) => {
    try {
      await fetch(`/api/todos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'convert_to_followup' }),
      });
      fetchTodos();
      fetchSuggested();
    } catch { /* silent */ }
  };

  const scanNow = async () => {
    setScanning(true);
    try {
      await fetch('/api/todos/extract', { method: 'POST', headers: { 'X-Pepper-Internal': '1' } });
      await Promise.all([fetchTodos(), fetchSuggested(), fetchIngestStatus()]);
    } catch { /* silent */ } finally {
      setScanning(false);
    }
  };

  const openTodos = todos.filter(t => t.status === 'open');

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Todos</h2>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
            {openTodos.length} open
          </span>
          {suggested.length > 0 && (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-400">
              {suggested.length} suggested
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(['open', 'done', 'all'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                filter === s
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              {s === 'all' ? 'All' : s === 'open' ? 'Open' : 'Done'}
            </button>
          ))}
          <button
            onClick={scanNow}
            disabled={scanning}
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            title="Scan emails for suggested todos"
          >
            {scanning ? 'Scanning…' : '⟳ Scan'}
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
          >
            + Add
          </button>
        </div>
      </div>

      {/* Ingest status */}
      {(lastIngest || lastScan) && (
        <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-1.5 text-[11px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
          {lastIngest && (
            <span>
              Last ingest: {new Date(lastIngest).toLocaleString(undefined, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
            </span>
          )}
          {lastScan && (
            <span>
              Last scan: {new Date(lastScan).toLocaleString(undefined, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
            </span>
          )}
        </div>
      )}

      {/* Add form */}
      {showAddForm && (
        <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
          <div className="flex gap-2">
            <input
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTodo()}
              placeholder="What needs to be done?"
              className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              autoFocus
            />
            <select
              value={newPriority}
              onChange={e => setNewPriority(e.target.value as 'high' | 'medium' | 'low')}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <button
              onClick={addTodo}
              disabled={!newTitle.trim()}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Add
            </button>
            <button
              onClick={() => { setShowAddForm(false); setNewTitle(''); }}
              className="rounded-md px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-4 mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Todo list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">Loading…</div>
        ) : todos.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {filter === 'open' ? 'No open todos. You\'re all caught up!' : 'No todos found.'}
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {todos.map(todo => (
              <li key={todo.id} className={`group flex items-start gap-3 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${todo.status === 'done' ? 'opacity-60' : ''}`}>
                {/* Checkbox */}
                <button
                  onClick={() => toggleTodo(todo)}
                  className={`mt-0.5 flex h-4.5 w-4.5 flex-shrink-0 items-center justify-center rounded border transition-colors ${
                    todo.status === 'done'
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-zinc-300 hover:border-blue-500 dark:border-zinc-600'
                  }`}
                >
                  {todo.status === 'done' && (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  {editingId === todo.id ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveEdit(todo.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onBlur={() => saveEdit(todo.id)}
                      className="w-full rounded border border-blue-400 bg-white px-2 py-0.5 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
                      autoFocus
                    />
                  ) : (
                    <p
                      className={`text-sm ${todo.status === 'done' ? 'line-through text-zinc-400 dark:text-zinc-500' : 'text-zinc-900 dark:text-zinc-100'}`}
                      onDoubleClick={() => { setEditingId(todo.id); setEditTitle(todo.title); }}
                    >
                      {SOURCE_LABELS[todo.sourceType] && (
                        <span className="mr-1" title={`From ${todo.sourceType}`}>{SOURCE_LABELS[todo.sourceType]}</span>
                      )}
                      {todo.title}
                    </p>
                  )}

                  {/* Meta row */}
                  <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                    <button
                      onClick={() => {
                        const next = todo.priority === 'high' ? 'medium' : todo.priority === 'medium' ? 'low' : 'high';
                        updatePriority(todo, next);
                      }}
                      className={`rounded-full px-1.5 py-0.5 font-medium ${PRIORITY_BADGES[todo.priority]}`}
                      title="Click to cycle priority"
                    >
                      {todo.priority}
                    </button>
                    {todo.dueDate && (
                      <span className="text-zinc-500 dark:text-zinc-400">
                        Due {new Date(todo.dueDate).toLocaleDateString()}
                      </span>
                    )}
                    {todo.description && (
                      <span className="truncate text-zinc-400 dark:text-zinc-500" title={todo.description}>
                        {todo.description}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
                  <button
                    onClick={() => convertToFollowUp(todo.id)}
                    className="rounded px-1 py-0.5 text-[11px] font-medium text-orange-500 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-900/40"
                    title="Move to Follow-ups"
                  >
                    → FU
                  </button>
                  <button
                    onClick={() => { setEditingId(todo.id); setEditTitle(todo.title); }}
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                    title="Edit"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteTodo(todo.id)}
                    className="rounded p-1 text-zinc-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/40 dark:hover:text-red-400"
                    title="Delete"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Suggested Todos Section */}
        {filter === 'open' && suggested.length > 0 && (
          <div className="border-t border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between bg-violet-50/50 px-4 py-2.5 dark:bg-violet-950/20">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-violet-700 dark:text-violet-400">
                  💡 Suggested
                </span>
                <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-400">
                  {suggested.length}
                </span>
              </div>
            </div>
            <ul className="divide-y divide-violet-100 dark:divide-violet-900/30">
              {suggested.map(todo => (
                <li key={todo.id} className="flex items-start gap-3 bg-violet-50/30 px-4 py-2.5 dark:bg-violet-950/10">
                  <div className="mt-0.5 flex h-4.5 w-4.5 flex-shrink-0 items-center justify-center rounded-full border border-violet-400 text-[10px] text-violet-500 dark:border-violet-600 dark:text-violet-400">
                    ?
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-800 dark:text-zinc-200">
                      {SOURCE_LABELS[todo.sourceType] && (
                        <span className="mr-1" title={`From ${todo.sourceType}`}>{SOURCE_LABELS[todo.sourceType]}</span>
                      )}
                      {todo.title}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                      <span className={`rounded-full px-1.5 py-0.5 font-medium ${PRIORITY_BADGES[todo.priority]}`}>
                        {todo.priority}
                      </span>
                      {todo.description && (
                        <span className="truncate text-zinc-400 dark:text-zinc-500" title={todo.description}>
                          {todo.description}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      onClick={() => approveTodo(todo.id)}
                      className="rounded px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900/40"
                      title="Approve — add to your todos"
                    >
                      ✓ Keep
                    </button>
                    <button
                      onClick={() => dismissTodo(todo.id)}
                      className="rounded px-2 py-1 text-xs font-medium text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                      title="Dismiss suggestion"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
