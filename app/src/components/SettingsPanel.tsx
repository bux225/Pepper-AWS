'use client';

import { useState, useEffect, useCallback } from 'react';

interface Account {
  id: string;
  name: string;
  provider: 'microsoft';
  tenantId?: string;
  clientId: string;
  scopes: string[];
  enabled: boolean;
  connected: boolean;
}

const READ_SCOPES = ['Mail.Read', 'Chat.Read', 'User.Read'];
const WRITE_SCOPES = ['Mail.ReadWrite', 'Chat.ReadWrite', 'User.Read'];

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [edgeImporting, setEdgeImporting] = useState(false);
  const [edgeResult, setEdgeResult] = useState('');
  const [edgeDaysBack, setEdgeDaysBack] = useState(7);

  // Email rules state
  const [emailRulesText, setEmailRulesText] = useState('');
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesMessage, setRulesMessage] = useState('');

  // Knowledge Base state
  const [knowledgeBases, setKnowledgeBases] = useState<Array<{id: string; name: string; description: string; kbId: string}>>([]);
  const [showAddKb, setShowAddKb] = useState(false);
  const [newKbName, setNewKbName] = useState('');
  const [newKbId, setNewKbId] = useState('');
  const [newKbDescription, setNewKbDescription] = useState('');
  const [kbSaving, setKbSaving] = useState(false);
  const [kbMessage, setKbMessage] = useState('');

  // SharePoint allowlist state
  const [sharePointAllowlist, setSharePointAllowlist] = useState<string[]>([]);
  const [newSitePattern, setNewSitePattern] = useState('');
  const [allowlistSaving, setAllowlistSaving] = useState(false);
  const [allowlistMessage, setAllowlistMessage] = useState('');

  // Add form state
  const [newName, setNewName] = useState('');
  const [newClientId, setNewClientId] = useState('');
  const [newTenantId, setNewTenantId] = useState('consumers');
  const [newWriteAccess, setNewWriteAccess] = useState(false);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts');
      if (!res.ok) throw new Error('Failed to load accounts');
      const data = await res.json();
      setAccounts(data.accounts);
    } catch (err) {
      console.error('Failed to load accounts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    setRulesLoading(true);
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Failed to load settings');
      const data = await res.json();
      setEmailRulesText(data.review?.emailRulesText ?? '');
      setKnowledgeBases(data.knowledgeBases ?? []);
      setSharePointAllowlist(data.sharePointAllowlist ?? []);
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchSettings();
  }, [fetchAccounts, fetchSettings]);

  const addAccount = async () => {
    if (!newName.trim() || !newClientId.trim()) return;
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName.trim(),
        provider: 'microsoft',
        clientId: newClientId.trim(),
        tenantId: newTenantId.trim() || 'common',
        scopes: newWriteAccess ? WRITE_SCOPES : READ_SCOPES,
      }),
    });
    if (res.ok) {
      setNewName('');
      setNewClientId('');
      setNewTenantId('consumers');
      setShowAddForm(false);
      fetchAccounts();
    }
  };

  const toggleAccount = async (id: string, enabled: boolean) => {
    await fetch('/api/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled }),
    });
    fetchAccounts();
  };

  const removeAccount = async (id: string) => {
    if (!confirm('Remove this account? This will disconnect it and delete stored tokens.')) return;
    await fetch(`/api/accounts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    fetchAccounts();
  };

  const connectAccount = (id: string) => {
    window.location.href = `/api/auth/microsoft/login?accountId=${encodeURIComponent(id)}`;
  };

  const toggleWriteAccess = async (account: Account) => {
    const hasWrite = account.scopes.some(s => s.includes('Write'));
    const newScopes = hasWrite ? READ_SCOPES : WRITE_SCOPES;
    if (!hasWrite && !confirm('Write access (Mail.ReadWrite, Chat.ReadWrite) may require IT/admin approval for work accounts. Continue?')) return;
    await fetch('/api/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: account.id, scopes: newScopes }),
    });
    fetchAccounts();
  };

  const saveEmailRules = async () => {
    setRulesSaving(true);
    setRulesMessage('');
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review: { emailRulesText } }),
      });
      if (!res.ok) throw new Error('Failed to save rules');
      setRulesMessage('Rules saved successfully!');
      setTimeout(() => setRulesMessage(''), 3000);
    } catch (err) {
      setRulesMessage(`Error: ${err instanceof Error ? err.message : 'failed to save'}`);
    } finally {
      setRulesSaving(false);
    }
  };

  const addKnowledgeBase = async () => {
    if (!newKbName.trim() || !newKbId.trim()) return;
    setKbSaving(true);
    setKbMessage('');
    try {
      const newKb = {
        id: crypto.randomUUID(),
        name: newKbName.trim(),
        description: newKbDescription.trim(),
        kbId: newKbId.trim(),
      };
      const updated = [...knowledgeBases, newKb];
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledgeBases: updated }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setKnowledgeBases(updated);
      setNewKbName('');
      setNewKbId('');
      setNewKbDescription('');
      setShowAddKb(false);
      setKbMessage('Knowledge base added!');
      setTimeout(() => setKbMessage(''), 3000);
    } catch (err) {
      setKbMessage(`Error: ${err instanceof Error ? err.message : 'failed to save'}`);
    } finally {
      setKbSaving(false);
    }
  };

  const removeKnowledgeBase = async (id: string) => {
    if (!confirm('Remove this knowledge base from Pepper? (This does not delete the KB in AWS.)')) return;
    const updated = knowledgeBases.filter(kb => kb.id !== id);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledgeBases: updated }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setKnowledgeBases(updated);
    } catch { /* silent */ }
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Settings</h2>
        <button
          onClick={onClose}
          className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Microsoft Accounts */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Microsoft Accounts</h3>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="rounded-lg px-3 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
          >
            {showAddForm ? 'Cancel' : '+ Add Account'}
          </button>
        </div>

        {showAddForm && (
          <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800">
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Account Name</label>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Personal Microsoft 365"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Client ID
                  <span className="ml-1 font-normal text-zinc-400">(from Azure AD app registration)</span>
                </label>
                <input
                  value={newClientId}
                  onChange={e => setNewClientId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-mono text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Tenant ID
                  <span className="ml-1 font-normal text-zinc-400">(&quot;consumers&quot; for personal, org domain for work)</span>
                </label>
                <input
                  value={newTenantId}
                  onChange={e => setNewTenantId(e.target.value)}
                  placeholder="consumers"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-mono text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="write-access"
                  checked={newWriteAccess}
                  onChange={e => setNewWriteAccess(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-blue-600 dark:border-zinc-600"
                />
                <label htmlFor="write-access" className="text-xs text-zinc-600 dark:text-zinc-400">
                  Write access <span className="text-zinc-400 dark:text-zinc-500">(send email &amp; Teams — may need IT approval)</span>
                </label>
              </div>
              <button
                onClick={addAccount}
                disabled={!newName.trim() || !newClientId.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add Account
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-4 text-center text-sm text-zinc-400">Loading…</div>
        ) : accounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 py-8 text-center dark:border-zinc-700">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No accounts configured.</p>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              Add a Microsoft account to import emails and Teams chats.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {accounts.map(account => (
              <div
                key={account.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-700"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{account.name}</span>
                    {account.connected ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900 dark:text-green-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        Connected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        Disconnected
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {account.tenantId === 'consumers' ? 'Personal' : account.tenantId} · {account.scopes.join(', ')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!account.connected ? (
                    <button
                      onClick={() => connectAccount(account.id)}
                      className="rounded-lg px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                    >
                      Connect
                    </button>
                  ) : (
                    <button
                      onClick={() => connectAccount(account.id)}
                      className="rounded-lg px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                      title="Re-authenticate to pick up scope changes"
                    >
                      Reconnect
                    </button>
                  )}
                  <button
                    onClick={() => toggleWriteAccess(account)}
                    className="rounded-lg px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    title={account.scopes.some(s => s.includes('Write')) ? 'Switch to read-only (no admin approval needed)' : 'Enable write access (may need admin approval)'}
                  >
                    {account.scopes.some(s => s.includes('Write')) ? '→ Read-only' : '→ Read/Write'}
                  </button>
                  <button
                    onClick={() => toggleAccount(account.id, !account.enabled)}
                    className={`rounded-lg px-3 py-1 text-xs font-medium ${
                      account.enabled
                        ? 'text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40'
                        : 'text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/40'
                    }`}
                  >
                    {account.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => removeAccount(account.id)}
                    className="rounded-lg px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Browser History Import */}
      <section className="mb-8">
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Browser History Import</h3>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800">
          <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
            Import recently visited pages from Microsoft Edge into the knowledge base.
          </p>
          <div className="mb-3 flex items-center gap-3">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Days back:</label>
            <input
              type="number"
              min={1}
              max={365}
              value={edgeDaysBack}
              onChange={e => setEdgeDaysBack(parseInt(e.target.value) || 7)}
              className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-700"
            />
          </div>
          <button
            onClick={async () => {
              setEdgeImporting(true);
              setEdgeResult('');
              try {
                const res = await fetch('/api/import/edge-history', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ daysBack: edgeDaysBack }),
                });
                const data = await res.json();
                setEdgeResult(`Imported ${data.imported} pages (${data.skipped} skipped)${data.errors?.length > 0 ? `, ${data.errors.length} errors` : ''}`);
              } catch (err) {
                setEdgeResult(`Error: ${err instanceof Error ? err.message : 'failed'}`);
              } finally {
                setEdgeImporting(false);
              }
            }}
            disabled={edgeImporting}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {edgeImporting ? 'Importing…' : 'Import from Edge'}
          </button>
          {edgeResult && (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{edgeResult}</p>
          )}
        </div>
      </section>

      {/* Email Review Rules */}
      <section className="mb-8">
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Email Dismiss Rules</h3>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800">
          <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
            Automatically dismiss emails matching these rules during ingestion. One rule per line.
          </p>
          <div className="mb-3 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-900 rounded p-2 font-mono space-y-1">
            <div><span className="text-amber-600 dark:text-amber-400">from:</span>sender@domain.com — dismiss emails from sender</div>
            <div><span className="text-amber-600 dark:text-amber-400">subject:</span>keyword — dismiss if subject contains keyword</div>
            <div><span className="text-amber-600 dark:text-amber-400">contains:</span>text — dismiss if email contains text</div>
          </div>
          {rulesLoading ? (
            <div className="py-4 text-center text-sm text-zinc-400">Loading rules…</div>
          ) : (
            <>
              <textarea
                value={emailRulesText}
                onChange={(e) => setEmailRulesText(e.target.value)}
                placeholder={`from:notifications@example.com\nsubject:daily digest\ncontains:unsubscribe`}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-mono text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                rows={5}
              />
              <div className="mt-3 flex items-center justify-between">
                <button
                  onClick={saveEmailRules}
                  disabled={rulesSaving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {rulesSaving ? 'Saving…' : 'Save Rules'}
                </button>
                {rulesMessage && (
                  <span className={`text-xs ${rulesMessage.startsWith('Error') ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {rulesMessage}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Knowledge Bases */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Custom Knowledge Bases</h3>
          <button
            onClick={() => setShowAddKb(!showAddKb)}
            className="rounded-lg px-3 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
          >
            {showAddKb ? 'Cancel' : '+ Add KB'}
          </button>
        </div>

        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
          Register additional Bedrock Knowledge Bases for topic-specific documents. The agent will search these alongside your main KB.
        </p>

        {showAddKb && (
          <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800">
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Name</label>
                <input
                  value={newKbName}
                  onChange={e => setNewKbName(e.target.value)}
                  placeholder="e.g., Product Documentation"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Bedrock Knowledge Base ID
                  <span className="ml-1 font-normal text-zinc-400">(from AWS console)</span>
                </label>
                <input
                  value={newKbId}
                  onChange={e => setNewKbId(e.target.value)}
                  placeholder="XXXXXXXXXX"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-mono text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Description
                  <span className="ml-1 font-normal text-zinc-400">(helps the agent decide when to search this KB)</span>
                </label>
                <input
                  value={newKbDescription}
                  onChange={e => setNewKbDescription(e.target.value)}
                  placeholder="e.g., Internal product specs, API docs, and architecture decisions"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
              <button
                onClick={addKnowledgeBase}
                disabled={!newKbName.trim() || !newKbId.trim() || kbSaving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {kbSaving ? 'Adding…' : 'Add Knowledge Base'}
              </button>
            </div>
          </div>
        )}

        {kbMessage && (
          <p className={`mb-3 text-xs ${kbMessage.startsWith('Error') ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
            {kbMessage}
          </p>
        )}

        {knowledgeBases.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 py-6 text-center dark:border-zinc-700">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No custom knowledge bases configured.</p>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              Create a Bedrock KB in AWS, then register it here.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {knowledgeBases.map(kb => (
              <div
                key={kb.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-700"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{kb.name}</span>
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{kb.kbId}</span>
                  </div>
                  {kb.description && (
                    <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{kb.description}</p>
                  )}
                </div>
                <button
                  onClick={() => removeKnowledgeBase(kb.id)}
                  className="ml-3 rounded-lg px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* SharePoint Site Allowlist */}
      <section className="mb-8">
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">SharePoint Site Allowlist</h3>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
          When syncing shared files, only files from known contacts or matching these site patterns are imported. Add SharePoint site names or URL fragments to allow.
        </p>

        <div className="mb-3 flex gap-2">
          <input
            value={newSitePattern}
            onChange={e => setNewSitePattern(e.target.value)}
            placeholder="e.g., sites/MyTeamSite or sharepoint.com/sites/Projects"
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
            onKeyDown={e => {
              if (e.key === 'Enter' && newSitePattern.trim()) {
                const updated = [...sharePointAllowlist, newSitePattern.trim()];
                setSharePointAllowlist(updated);
                setNewSitePattern('');
                setAllowlistSaving(true);
                fetch('/api/settings', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sharePointAllowlist: updated }),
                }).then(res => {
                  setAllowlistMessage(res.ok ? 'Saved' : 'Error saving');
                  setTimeout(() => setAllowlistMessage(''), 2000);
                }).finally(() => setAllowlistSaving(false));
              }
            }}
          />
          <button
            onClick={() => {
              if (!newSitePattern.trim()) return;
              const updated = [...sharePointAllowlist, newSitePattern.trim()];
              setSharePointAllowlist(updated);
              setNewSitePattern('');
              setAllowlistSaving(true);
              fetch('/api/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sharePointAllowlist: updated }),
              }).then(res => {
                setAllowlistMessage(res.ok ? 'Saved' : 'Error saving');
                setTimeout(() => setAllowlistMessage(''), 2000);
              }).finally(() => setAllowlistSaving(false));
            }}
            disabled={!newSitePattern.trim() || allowlistSaving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {allowlistMessage && (
          <p className={`mb-3 text-xs ${allowlistMessage.startsWith('Error') ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
            {allowlistMessage}
          </p>
        )}

        {sharePointAllowlist.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 py-6 text-center dark:border-zinc-700">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No site patterns configured.</p>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              Shared files will only be imported from your known contacts.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {sharePointAllowlist.map((pattern, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-2 dark:border-zinc-700"
              >
                <span className="text-sm font-mono text-zinc-700 dark:text-zinc-300">{pattern}</span>
                <button
                  onClick={() => {
                    const updated = sharePointAllowlist.filter((_, i) => i !== idx);
                    setSharePointAllowlist(updated);
                    setAllowlistSaving(true);
                    fetch('/api/settings', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ sharePointAllowlist: updated }),
                    }).then(res => {
                      setAllowlistMessage(res.ok ? 'Removed' : 'Error saving');
                      setTimeout(() => setAllowlistMessage(''), 2000);
                    }).finally(() => setAllowlistSaving(false));
                  }}
                  className="ml-3 rounded-lg px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Setup Guide */}
      <section>
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Setup Guide</h3>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          <ol className="list-inside list-decimal space-y-2">
            <li>
              <strong>Register an Azure AD app</strong> at{' '}
              <span className="font-mono text-xs">portal.azure.com → App registrations</span>
            </li>
            <li>
              Add redirect URI: <code className="rounded bg-zinc-200 px-1 py-0.5 text-xs dark:bg-zinc-700">http://localhost:3000/api/auth/microsoft/callback</code>
            </li>
            <li>
              Create a client secret and add to <code className="rounded bg-zinc-200 px-1 py-0.5 text-xs dark:bg-zinc-700">.env.local</code> as <code className="rounded bg-zinc-200 px-1 py-0.5 text-xs dark:bg-zinc-700">MS_CLIENT_SECRET</code>
            </li>
            <li>
              Configure AWS credentials in <code className="rounded bg-zinc-200 px-1 py-0.5 text-xs dark:bg-zinc-700">.env.local</code> (AWS_REGION, S3 bucket, Bedrock agent/KB IDs)
            </li>
            <li>Add the account above with the <strong>Application (client) ID</strong></li>
            <li>Click <strong>Connect</strong> to start the OAuth flow</li>
          </ol>
        </div>
      </section>
    </div>
  );
}
