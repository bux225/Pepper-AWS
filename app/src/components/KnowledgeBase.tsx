'use client';

import { useState, useCallback, useEffect } from 'react';
import ChatPanel from './ChatPanel';
import SettingsPanel from './SettingsPanel';
import TodoPanel from './TodoPanel';
import UrlDirectoryPanel from './UrlDirectoryPanel';
import DigestPanel from './DigestPanel';
import PeoplePanel from './PeoplePanel';
import NoteForm from './NoteForm';
import OutboxPanel from './OutboxPanel';
import FollowUpPanel from './FollowUpPanel';

type ViewMode = 'todos' | 'urls' | 'digest' | 'people' | 'outbox' | 'follow-ups' | 'note' | 'settings';
type ChatState = 'collapsed' | 'default' | 'expanded';

const NAV_ITEMS: Array<{ key: ViewMode; label: string; icon: string }> = [
  { key: 'todos', label: 'Todos', icon: '☑' },
  { key: 'follow-ups', label: 'Follow-ups', icon: '⏳' },
  { key: 'outbox', label: 'Outbox', icon: '📤' },
  { key: 'urls', label: 'Reference Links', icon: '🔗' },
  { key: 'digest', label: 'Morning Digest', icon: '📰' },
  { key: 'people', label: 'People', icon: '👥' },
  { key: 'note', label: 'New Note', icon: '📝' },
  { key: 'settings', label: 'Settings', icon: '⚙' },
];

export default function KnowledgeBase() {
  const [viewMode, setViewMode] = useState<ViewMode>('todos');
  const [chatState, setChatState] = useState<ChatState>('default');
  const [refreshKey, setRefreshKey] = useState(0);

  const toggleChat = useCallback(() => {
    setChatState(prev => {
      if (prev === 'collapsed') return 'default';
      if (prev === 'default') return 'expanded';
      return 'collapsed';
    });
  }, []);

  const collapseChat = useCallback(() => setChatState('collapsed'), []);
  const expandChat = useCallback(() => setChatState('expanded'), []);

  const handleChatAction = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  const chatWidthClass =
    chatState === 'collapsed' ? 'w-0' :
    chatState === 'expanded' ? 'w-2/3' : 'w-1/3';

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      switch (e.key.toLowerCase()) {
        case 'k':
          e.preventDefault();
          if (chatState === 'collapsed') setChatState('default');
          setTimeout(() => {
            document.getElementById('pepper-chat-input')?.focus();
          }, 50);
          break;
        case 'n':
          e.preventDefault();
          setViewMode('note');
          break;
        case 'j':
          e.preventDefault();
          setChatState(prev =>
            prev === 'collapsed' ? 'default' : 'collapsed'
          );
          break;
        case '1':
          e.preventDefault();
          setViewMode('todos');
          break;
        case '2':
          e.preventDefault();
          setViewMode('urls');
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [chatState]);

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      {/* Sidebar */}
      <aside className="flex w-14 flex-col items-center border-r border-zinc-200 bg-white py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4 text-lg font-bold text-orange-500" title="Pepper">🌶</div>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map(item => (
            <button
              key={item.key}
              onClick={() => setViewMode(item.key)}
              title={item.label}
              className={`flex h-10 w-10 items-center justify-center rounded-lg text-base transition-colors ${
                viewMode === item.key
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              {item.icon}
            </button>
          ))}
        </nav>
        <div className="mt-auto">
          <button
            onClick={toggleChat}
            title={chatState === 'collapsed' ? 'Show chat' : chatState === 'expanded' ? 'Collapse chat' : 'Expand chat'}
            className={`flex h-10 w-10 items-center justify-center rounded-lg text-base transition-colors ${
              chatState !== 'collapsed'
                ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
                : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }`}
          >
            💬
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className={`flex-1 overflow-hidden transition-all duration-200 ${chatState === 'expanded' ? 'w-1/3' : ''}`}>
        {viewMode === 'settings' ? (
          <div className="h-full overflow-y-auto">
            <SettingsPanel onClose={() => setViewMode('todos')} />
          </div>
        ) : viewMode === 'todos' ? (
          <TodoPanel key={refreshKey} />
        ) : viewMode === 'urls' ? (
          <UrlDirectoryPanel key={refreshKey} />
        ) : viewMode === 'people' ? (
          <PeoplePanel key={refreshKey} />
        ) : viewMode === 'outbox' ? (
          <OutboxPanel key={refreshKey} />
        ) : viewMode === 'follow-ups' ? (
          <FollowUpPanel key={refreshKey} />
        ) : viewMode === 'note' ? (
          <NoteForm
            onSaved={() => setViewMode('todos')}
            onCancel={() => setViewMode('todos')}
          />
        ) : null}
        {/* DigestPanel stays mounted to preserve state across tab switches */}
        <div className={viewMode === 'digest' ? 'h-full' : 'hidden'}>
          <DigestPanel key={refreshKey} />
        </div>
      </main>

      {/* Chat panel */}
      <div className={`${chatWidthClass} flex-shrink-0 overflow-hidden border-l border-zinc-200 bg-white transition-all duration-200 dark:border-zinc-800 dark:bg-zinc-900 ${chatState === 'collapsed' ? 'border-l-0' : ''}`}>
        {chatState !== 'collapsed' && (
          <ChatPanel
            onAction={handleChatAction}
            onCollapse={collapseChat}
            onExpand={expandChat}
            isExpanded={chatState === 'expanded'}
          />
        )}
      </div>
    </div>
  );
}
