export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { loadConfig, saveConfig } from '@/lib/config.node';
import { createAccountSchema } from '@/lib/validation';
import { rateLimit } from '@/lib/rate-limit';
import { randomUUID } from 'crypto';
import { getToken } from '@/lib/tokens';

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  const config = loadConfig();
  // Return all accounts (not just enabled) so the UI can manage them
  const accounts = config.accounts.map(a => ({
    id: a.id,
    name: a.name,
    provider: a.provider,
    tenantId: a.tenantId,
    clientId: a.clientId,
    scopes: a.scopes,
    enabled: a.enabled,
    connected: !!getToken(a.id), // check token presence
  }));
  return NextResponse.json({ accounts });
}

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 10, 60_000);
  if (limited) return limited;

  const body = await request.json();
  const parsed = createAccountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const config = loadConfig();
  const newAccount = {
    id: randomUUID(),
    name: parsed.data.name,
    provider: 'microsoft' as const,
    clientId: parsed.data.clientId,
    tenantId: parsed.data.tenantId || 'common',
    scopes: parsed.data.scopes,
    envKey: 'MS_CLIENT_SECRET',
    enabled: true,
  };
  config.accounts.push(newAccount);
  saveConfig(config);
  return NextResponse.json({ account: newAccount }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const limited = rateLimit(request, 10, 60_000);
  if (limited) return limited;

  const body = await request.json();
  const { id, enabled, scopes } = body;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const config = loadConfig();
  const account = config.accounts.find(a => a.id === id);
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  if (typeof enabled === 'boolean') account.enabled = enabled;
  if (Array.isArray(scopes)) account.scopes = scopes;
  saveConfig(config);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const limited = rateLimit(request, 10, 60_000);
  if (limited) return limited;

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const config = loadConfig();
  config.accounts = config.accounts.filter(a => a.id !== id);
  saveConfig(config);
  return NextResponse.json({ ok: true });
}
