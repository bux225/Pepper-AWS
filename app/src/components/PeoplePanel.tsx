'use client';

import { useState, useEffect } from 'react';

interface Person {
  id: number;
  name: string;
  normalizedName: string;
  email: string | null;
  firstSeen: string;
  lastSeen: string;
  mentionCount: number;
}

interface PersonDoc {
  docId: string;
  title: string;
  source: string;
  context: string;
  createdAt: string;
}

interface PersonDetail extends Person {
  docs: PersonDoc[];
}

const SOURCE_ICONS: Record<string, string> = {
  email: '📧',
  teams: '💬',
  note: '📝',
  document: '📄',
  reference: '🔗',
};

export default function PeoplePanel() {
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState('');
  const [selectedPerson, setSelectedPerson] = useState<PersonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetchPeople();
  }, []);

  const fetchPeople = async (query?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set('search', query);
      const res = await fetch(`/api/people?${params}`);
      if (res.ok) {
        const data = await res.json();
        setPeople(data.people);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    fetchPeople(search || undefined);
  };

  const selectPerson = async (person: Person) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/people/${person.id}`);
      if (res.ok) {
        const data: PersonDetail = await res.json();
        setSelectedPerson(data);
      }
    } catch {
      // ignore
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="flex h-full">
      {/* People list */}
      <div className={`${selectedPerson ? 'w-1/3 border-r border-zinc-200 dark:border-zinc-800' : 'w-full'} flex flex-col overflow-hidden`}>
        <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-100">People</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search people…"
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <button
              onClick={handleSearch}
              className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              Search
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-sm text-zinc-500">Loading…</div>
          ) : people.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              <p>No people found.</p>
              <p className="mt-1 text-xs text-zinc-400">People are extracted automatically from emails and Teams messages.</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {people.map(person => (
                <button
                  key={person.id}
                  onClick={() => selectPerson(person)}
                  className={`w-full px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
                    selectedPerson?.id === person.id ? 'bg-blue-50 dark:bg-blue-950/20' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {person.name}
                      </div>
                      {person.email && (
                        <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {person.email}
                        </div>
                      )}
                    </div>
                    <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      {person.mentionCount}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Person detail */}
      {selectedPerson && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {selectedPerson.name}
                </h3>
                {selectedPerson.email && (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">{selectedPerson.email}</p>
                )}
              </div>
              <button
                onClick={() => setSelectedPerson(null)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                ✕
              </button>
            </div>
            <div className="mt-2 flex gap-4 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{selectedPerson.mentionCount} mention{selectedPerson.mentionCount !== 1 ? 's' : ''}</span>
              <span>First seen {new Date(selectedPerson.firstSeen + 'Z').toLocaleDateString()}</span>
              <span>Last seen {new Date(selectedPerson.lastSeen + 'Z').toLocaleDateString()}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {detailLoading ? (
              <div className="text-center text-sm text-zinc-500">Loading…</div>
            ) : selectedPerson.docs.length === 0 ? (
              <p className="text-center text-sm text-zinc-500">No related documents found.</p>
            ) : (
              <div className="space-y-2">
                <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Related items ({selectedPerson.docs.length})
                </h4>
                {selectedPerson.docs.map(doc => (
                  <div
                    key={doc.docId}
                    className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-800"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{SOURCE_ICONS[doc.source] ?? '📄'}</span>
                      <span className="flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {doc.title}
                      </span>
                      <span className="text-xs text-zinc-400">
                        {new Date(doc.createdAt + 'Z').toLocaleDateString()}
                      </span>
                    </div>
                    {doc.context && (
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{doc.context}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
