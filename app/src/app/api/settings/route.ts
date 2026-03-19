export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { loadConfig, saveConfig } from '@/lib/config.node';
import { settingsSchema } from '@/lib/validation';
import { rateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  const config = loadConfig();
  return NextResponse.json(config);
}

export async function PATCH(request: NextRequest) {
  const limited = rateLimit(request, 10, 60_000);
  if (limited) return limited;

  const body = await request.json();
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const config = loadConfig();
  if (parsed.data.review) {
    config.review = { ...config.review, ...parsed.data.review };
  }
  if (parsed.data.knowledgeBases !== undefined) {
    config.knowledgeBases = parsed.data.knowledgeBases;
  }
  if (parsed.data.sharePointAllowlist !== undefined) {
    config.sharePointAllowlist = parsed.data.sharePointAllowlist;
  }
  saveConfig(config);
  return NextResponse.json({ ok: true });
}
