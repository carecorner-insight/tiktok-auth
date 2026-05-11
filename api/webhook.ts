import { Redis } from '@upstash/redis';
import { waitUntil } from '@vercel/functions';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { processMessage } from '../src/graph/runner';
import { TikTokAdapter } from '../src/adapters/tiktok';
import { TelegramAdapter } from '../src/adapters/telegram';
import { WhitelistService } from '../src/services/whitelistService';
import { SessionManager } from '../src/services/sessionManager';
import { SharePointLogger } from '../src/services/sharePointLogger';
import { AIBotsClient } from '../src/services/aiBotsClient';
import type { IPlatformAdapter } from '../src/types/platform';
import type { Platform } from '../src/types/state';

export const config = { runtime: 'nodejs', maxDuration: 60 };

// ── SharePoint whitelist fetch ────────────────────────────────────────────────

type WhitelistStatus = 'approved' | 'pending' | 'unknown';

async function fetchWhitelistStatus(
  platform: Platform,
  userId: string,
): Promise<WhitelistStatus | null> {
  const url = process.env.SHAREPOINT_WHITELIST_WEBHOOK_URL;
  if (!url) return null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, userId }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: string };
    const s = data.status;
    if (s === 'approved' || s === 'pending') return s;
    return null;
  } catch {
    return null;
  }
}

// ── Background message handler ────────────────────────────────────────────────

async function handleMessage(
  adapter: IPlatformAdapter,
  body: unknown,
  redis: Redis,
): Promise<void> {
  // Normalize — throws for bot messages, non-text, unsupported events
  let msg;
  try {
    msg = adapter.normalizeMessage(body);
  } catch {
    return;
  }

  // Idempotency dedup on platform message ID
  if (msg.messageId) {
    const isNew = await redis.set(`dedup:${msg.platform}:${msg.messageId}`, 1, {
      ex: 3600,
      nx: true,
    });
    if (isNew === null) return; // duplicate delivery
  }

  const services = {
    whitelist: new WhitelistService(redis, fetchWhitelistStatus),
    session: new SessionManager(redis),
    aiBots: new AIBotsClient(
      process.env.DIRECTUS_CREATE_CHAT_URL ?? '',
      process.env.DIRECTUS_SEND_MESSAGE_URL ?? '',
    ),
  };

  let result;
  try {
    result = await processMessage(msg, services);
  } catch (err) {
    console.error('[webhook] processMessage failed:', err);
    await adapter.sendMessage(
      msg.userId,
      "I'm having trouble right now. Please try again in a moment.",
      msg.conversationId,
    );
    return;
  }

  await adapter.sendMessage(msg.userId, result.response, msg.conversationId);

  const logUrl = process.env.POWER_AUTOMATE_WEBHOOK_URL;
  if (logUrl) {
    const logger = new SharePointLogger(logUrl);
    await logger.log(result.state, msg.text, result.response);
  }
}

// ── Vercel handler ────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, message: 'Webhook is running' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const platform = String(req.query['platform'] ?? '');
  const redis = new Redis();

  let adapter: IPlatformAdapter;

  if (platform === 'tiktok') {
    adapter = new TikTokAdapter(async () => {
      const token = await redis.get('tiktok_access_token');
      return token ?? '';
    });
  } else if (platform === 'telegram') {
    adapter = new TelegramAdapter(process.env.TELEGRAM_BOT_TOKEN ?? '');
  } else {
    console.warn('[webhook] Unknown platform:', platform);
    return res.status(200).json({ ok: true }); // ack so the platform doesn't retry
  }

  // Respond immediately — platforms will retry if they don't receive 200 quickly
  res.status(200).json({ ok: true });

  waitUntil(handleMessage(adapter, req.body, redis));
}
