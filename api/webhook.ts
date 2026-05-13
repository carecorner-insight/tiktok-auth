import { waitUntil } from '@vercel/functions';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getRedis, RedisClient } from '../src/lib/redis';

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
  if (!url) {
    console.warn('[whitelist] SHAREPOINT_WHITELIST_WEBHOOK_URL is not set — all users will be denied');
    return null;
  }

  const normalizedPlatform = platform.toLowerCase().trim();
  const normalizedUserId = userId.trim();
  console.log(`[whitelist] checking: platform=${normalizedPlatform} userId=${normalizedUserId}`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: normalizedPlatform, userId: normalizedUserId }),
    });

    console.log(`[whitelist] response status: ${res.status}`);

    if (!res.ok) {
      console.error(`[whitelist] Power Automate returned HTTP ${res.status}`);
      return null;
    }

    const data = (await res.json()) as { status?: string };
    console.log(`[whitelist] raw response: ${JSON.stringify(data)}`);

    const s = data.status?.toLowerCase().trim();
    console.log(`[whitelist] normalised status: "${s}"`);

    if (s === 'approved' || s === 'pending') return s;

    console.warn(`[whitelist] unrecognised status value: "${s}"`);
    return null;
  } catch (err) {
    console.error('[whitelist] fetch error:', err);
    return null;
  }
}

// ── Per-user processing lock (prevents race conditions on fast replies) ───────

async function withUserLock<T>(
  redis: RedisClient,
  platform: string,
  userId: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const lockKey = `lock:${platform}:${userId}`;
  const acquired = await redis.set(lockKey, '1', { ex: 30, nx: true });

  if (acquired === null) {
    // Lock held — wait 2 s and retry once
    await new Promise(r => setTimeout(r, 2000));
    const retry = await redis.set(lockKey, '1', { ex: 30, nx: true });
    if (retry === null) return undefined; // still locked, drop
  }

  try {
    return await fn();
  } finally {
    await redis.del(lockKey);
  }
}

// ── Background message handler ────────────────────────────────────────────────

async function handleMessage(
  adapter: IPlatformAdapter,
  body: unknown,
  redis: RedisClient,
): Promise<void> {
  const tTotal = Date.now();

  // Normalize — throws for bot messages, non-text, unsupported events
  let msg;
  try {
    msg = adapter.normalizeMessage(body);
  } catch {
    return;
  }

  // Idempotency dedup on platform message ID
  if (msg.messageId) {
    const tDedup = Date.now();
    const isNew = await redis.set(`dedup:${msg.platform}:${msg.messageId}`, 1, {
      ex: 3600,
      nx: true,
    });
    console.log(`[perf] dedup check: ${Date.now() - tDedup}ms`);
    if (isNew === null) return; // duplicate delivery
  }

  const tLock = Date.now();
  await withUserLock(redis, msg.platform, msg.userId, async () => {
    console.log(`[perf] lock acquire: ${Date.now() - tLock}ms`);
    const services = {
      whitelist: new WhitelistService(redis, fetchWhitelistStatus),
      session: new SessionManager(redis),
      aiBots: new AIBotsClient(
        process.env.DIRECTUS_CREATE_CHAT_URL ?? '',
        process.env.DIRECTUS_SEND_MESSAGE_URL ?? '',
      ),
    };

    const logUrl = process.env.POWER_AUTOMATE_WEBHOOK_URL;
    const logger = logUrl ? new SharePointLogger(logUrl) : null;

    let result;
    let responseText = "I'm having trouble right now. Please try again in a moment.";
    try {
      result = await processMessage(msg, services);
      responseText = result.response;
    } catch (err) {
      console.error('[webhook] processMessage failed:', err);
      await adapter.sendMessage(msg.userId, responseText, msg.conversationId);
      if (logger) {
        const fallbackState = await services.session.load(msg.platform, msg.userId);
        if (fallbackState) void logger.log(fallbackState, msg.text, responseText);
      }
      return;
    }

    await adapter.sendMessage(msg.userId, result.response, msg.conversationId);

    if (logger) void logger.log(result.state, msg.text, result.response);
    console.log(`[perf] handleMessage total: ${Date.now() - tTotal}ms`);
  });
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
  const redis = getRedis();

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
