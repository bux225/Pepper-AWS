'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant' | 'action';
  content: string;
}

interface Citation {
  text: string;
  location?: string;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessage?: string;
}

interface ChatPanelProps {
  onAction?: () => void;
  onCollapse?: () => void;
  onExpand?: () => void;
  isExpanded?: boolean;
}

/** Render basic markdown: links, bold, italic, inline code */
function renderMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1] && match[2]) {
      parts.push(
        <a key={key++} href={match[2]} target="_blank" rel="noopener noreferrer"
          className="text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
          {match[1]}
        </a>
      );
    } else if (match[3]) {
      parts.push(<strong key={key++}>{match[3]}</strong>);
    } else if (match[4]) {
      parts.push(<em key={key++}>{match[4]}</em>);
    } else if (match[5]) {
      parts.push(
        <code key={key++} className="rounded bg-zinc-200 px-1 py-0.5 text-xs dark:bg-zinc-700">
          {match[5]}
        </code>
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

export default function ChatPanel({ onAction, onCollapse, onExpand, isExpanded }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [citations, setCitations] = useState<Citation[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Session state
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  // Load sessions on mount
  useEffect(() => {
    fetch('/api/chat/sessions')
      .then(res => res.json())
      .then(data => setSessions(data.sessions ?? []))
      .catch(() => {});
  }, []);

  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      const msgs: ChatMessage[] = (data.messages ?? []).map((m: { role: string; content: string }) => ({
        role: m.role as ChatMessage['role'],
        content: m.content,
      }));
      setMessages(msgs);
      setActiveSessionId(sessionId);
      setShowHistory(false);
      setCitations([]);
    } catch {
      // silent
    }
  }, []);

  const startNewChat = useCallback(() => {
    setMessages([]);
    setActiveSessionId(null);
    setCitations([]);
    setShowHistory(false);
    inputRef.current?.focus();
  }, []);

  const deleteSessionHandler = async (id: string) => {
    try {
      await fetch('/api/chat/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setSessions(prev => prev.filter(s => s.id !== id));
      if (activeSessionId === id) startNewChat();
    } catch {
      // silent
    }
  };

  const refreshSessions = () => {
    fetch('/api/chat/sessions')
      .then(res => res.json())
      .then(data => setSessions(data.sessions ?? []))
      .catch(() => {});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

    const userMessage: ChatMessage = { role: 'user', content: trimmed };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setStreaming(true);
    setCitations([]);

    let triggeredAction = false;
    let assistantContent = '';

    try {
      const sessionParam = activeSessionId ? `?sessionId=${encodeURIComponent(activeSessionId)}` : '';
      const res = await fetch(`/api/chat${sessionParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });

      if (!res.ok) throw new Error(`Chat failed (${res.status})`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let startedStreaming = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = '';
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) {
            currentEvent = '';
            continue;
          }

          if (trimmedLine.startsWith('event: ')) {
            currentEvent = trimmedLine.slice(7);
            continue;
          }

          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(6);
            try {
              const parsed = JSON.parse(data);

              switch (currentEvent) {
                case 'text':
                  if (!startedStreaming) {
                    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
                    startedStreaming = true;
                  }
                  assistantContent += parsed.content;
                  setMessages(prev => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      role: 'assistant',
                      content: assistantContent,
                    };
                    return updated;
                  });
                  // Capture sessionId from first text event
                  if (parsed.sessionId && !activeSessionId) {
                    setActiveSessionId(parsed.sessionId);
                  }
                  break;

                case 'citation':
                  setCitations(prev => [...prev, { text: parsed.text, location: parsed.location }]);
                  break;

                case 'action':
                  triggeredAction = true;
                  setMessages(prev => [...prev, {
                    role: 'action',
                    content: `${parsed.function}(${Object.values(parsed.parameters ?? {}).join(', ')})`,
                  }]);
                  break;

                case 'done':
                  if (parsed.sessionId && !activeSessionId) {
                    setActiveSessionId(parsed.sessionId);
                  }
                  break;

                case 'error':
                  throw new Error(parsed.message);
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Something went wrong';
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${errorMessage}` }]);
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
      if (triggeredAction) onAction?.();
      refreshSessions();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            title="Chat history"
            className={`rounded p-1 transition-colors ${showHistory ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'}`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            {activeSessionId && sessions.find(s => s.id === activeSessionId)?.title !== 'New chat'
              ? sessions.find(s => s.id === activeSessionId)?.title ?? 'Chat'
              : 'Chat'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={startNewChat}
            title="New chat"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
          {isExpanded ? (
            <button
              onClick={onExpand}
              title="Shrink"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            </button>
          ) : (
            <button
              onClick={onExpand}
              title="Expand"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            </button>
          )}
          <button
            onClick={onCollapse}
            title="Close chat"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Session history */}
      {showHistory && (
        <div className="max-h-64 overflow-y-auto border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
          {sessions.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-zinc-400">No previous chats</div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {sessions.map(s => (
                <li key={s.id} className="group flex items-center">
                  <button
                    onClick={() => loadSession(s.id)}
                    className={`flex-1 px-3 py-2 text-left text-xs transition-colors ${activeSessionId === s.id ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400' : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'}`}
                  >
                    <p className="truncate font-medium">{s.title}</p>
                    <p className="mt-0.5 text-[10px] text-zinc-400">{new Date(s.updatedAt).toLocaleDateString()}</p>
                  </button>
                  <button
                    onClick={() => deleteSessionHandler(s.id)}
                    className="mr-2 rounded p-1 text-zinc-400 opacity-0 hover:bg-red-100 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-900/40 dark:hover:text-red-400"
                    title="Delete"
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-zinc-400">
              <p className="text-sm">Ask anything, draft emails, or save notes — all from here.</p>
              <p className="mt-1 text-xs text-zinc-500">Powered by AWS Bedrock Agent with your personal knowledge base</p>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-3">
            {messages.map((msg, i) => (
              msg.role === 'action' ? (
                <div key={i} className="flex justify-center">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {msg.content}
                  </span>
                </div>
              ) : (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">
                      {msg.role === 'assistant' ? renderMarkdown(msg.content || '…') : (msg.content || '…')}
                    </div>
                  </div>
                </div>
              )
            ))}

            {citations.length > 0 && !streaming && (
              <div className="text-xs text-zinc-400">
                <span className="font-medium">Sources:</span>{' '}
                {citations.map((c, i) => (
                  <span key={i}>
                    {i > 0 && ', '}
                    <span className="text-zinc-500" title={c.location}>{c.text.slice(0, 80) || c.location || 'Source'}</span>
                  </span>
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <form onSubmit={handleSubmit} className="mx-auto flex max-w-2xl gap-2">
          <textarea
            id="pepper-chat-input"
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question, draft an email, save a note…"
            rows={1}
            disabled={streaming}
            className="flex-1 resize-none rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {streaming ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
