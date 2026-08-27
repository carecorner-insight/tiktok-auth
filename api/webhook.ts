import { waitUntil } from '@vercel/functions';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getRedis, RedisClient } from '../src/lib/redis';

import { processMessage } from '../src/graph/runner';
import { TikTokAdapter } from '../src/adapters/tiktok';
import { TelegramAdapter } from '../src/adapters/telegram';
import { WhitelistService } from '../src/services/whitelistService';
import { SessionManager } from '../src/services/sessionManager';
import { SharePointLogger } from '../src/services/sharePointLogger';
import { DemographicsLogger } from '../src/services/demographicsLogger';
import { makeSocialCoachClient } from '../src/services/makeSocialCoachClient';
import { makeCareyAIClient } from '../src/services/makeCareyAIClient';
import { DirectLLMClient } from '../src/services/directLLMClient';
import { INTENT_CLASSIFIER_PROMPT } from '../src/nodes/intentClassifierNode';
import type { IPlatformAdapter } from '../src/types/platform';
import type { Platform } from '../src/types/state';
import { pushUatLog, providerFromChatId } from '../src/lib/uatLog';
import { getMenuMode, type MenuMode } from '../src/lib/menuMode';
import { getStoredAge, setStoredAge } from '../src/lib/ageStore';
import { loadLiveCoachPrompt } from '../src/lib/promptStore';

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

// Exported for api/webhook-study.ts, which runs the same pipeline against the
// study configuration (prefixed Redis, study bot token, own log list).
export interface HandleMessageOptions {
  /** Skip the Redis menu-mode lookup and pin a mode (study build). */
  menuMode?: MenuMode;
  /** Override the SharePoint log webhook; null disables logging. */
  logUrl?: string | null;
}

export async function handleMessage(
  adapter: IPlatformAdapter,
  body: unknown,
  redis: RedisClient,
  opts: HandleMessageOptions = {},
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
    const menuMode = opts.menuMode ?? (await getMenuMode(redis));
    const services = {
      whitelist: new WhitelistService(redis, fetchWhitelistStatus),
      session: new SessionManager(redis),
      menuMode,
      // Carey's client — AIBots+Dify by default, or direct Qwen when
      // USE_DIRECT_LLM=true (efficacy experiment; off by default).
      aiBots: makeCareyAIClient(),
      // Growing We social coach. Direct Qwen by default (holds our own prompt
      // + the [CRISIS]/[REFERRAL] tag contract); COACH_PROVIDER=aibots switches
      // to the seeded Directus bot with its Dify fallback. An admin-published
      // prompt from the prompt store wins over the bundled one; any store
      // problem falls back to bundled (loadLiveCoachPrompt never throws). The
      // study endpoint forces DYNAMIC_COACH_PROMPT=false, so it always gets
      // the bundled prompt.
      socialCoach: makeSocialCoachClient((await loadLiveCoachPrompt(redis))?.prompt),
      // Intent classification for the open-ended post-screener entry — a
      // direct OpenAI-compatible call (single-token output, no AIBots session).
      intentLLM: new DirectLLMClient({
        apiKey: process.env.QWEN_API_KEY ?? '',
        baseURL: process.env.QWEN_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        model: process.env.INTENT_LLM_MODEL ?? 'qwen-turbo',
        systemPrompt: INTENT_CLASSIFIER_PROMPT,
      }),
      typing: adapter,
      // Persistent per-user age (F2) — survives the 6h session, so a returning
      // user is never re-asked and referral triage still works.
      ageStore: {
        get: (p: Platform, u: string) => getStoredAge(redis, p, u),
        set: (p: Platform, u: string, a: number) => setStoredAge(redis, p, u, a),
      },
    };

    const logUrl =
      opts.logUrl !== undefined ? opts.logUrl : process.env.POWER_AUTOMATE_WEBHOOK_URL;
    const logger = logUrl ? new SharePointLogger(logUrl) : null;

    // UAT live-log capture is enabled only when UAT_LOG_TOKEN is set, so no
    // plaintext conversation content is buffered in production by default.
    const uatEnabled = (await redis.get('uat:enabled')) === '1';

    let result;
    let responseText = "I'm having trouble right now. Please try again in a moment.";
    try {
      result = await processMessage(msg, services);
      responseText = result.response;
    } catch (err) {
      console.error('[webhook] processMessage failed:', err);
      await adapter.sendMessage(msg.userId, responseText, msg.conversationId);
    
      const fallbackState = await services.session.load(msg.platform, msg.userId);
      if (logger && fallbackState) {
        // Await: fire-and-forget would be dropped when the serverless function
        // freezes before the HTTP POST completes. logger.log never throws.
        await logger.log(fallbackState, msg.text, responseText, msg.username);
      }
      if (uatEnabled) {
        try {
          await pushUatLog(redis, {
            platform: msg.platform,
            userId: msg.userId,
            authorized: fallbackState?.isAuthorized ?? false,
            userMessage: msg.text,
            botReply: responseText,
            phase: fallbackState?.conversationPhase ?? 'unknown',
            tag: fallbackState?.tag ?? null,
            crisis: fallbackState?.crisisDetected ?? false,
            provider: providerFromChatId(fallbackState?.aiBotChatId),
            latencyMs: Date.now() - tTotal,
            error: true,
          });
        } catch (e) {
          console.error('[uat] log push failed:', e);
        }
      }
      return;
    }

    await adapter.sendMessage(msg.userId, result.response, msg.conversationId);

    // Send user ID as a separate message so unauthorized users can long-press to copy it
    if (!result.state.isAuthorized) {
      await adapter.sendMessage(msg.userId, msg.userId, msg.conversationId);
    }

    // Await: the user already has their reply (sendMessage above), so this adds
    // no perceived latency, and awaiting prevents the log POST being dropped
    // when the serverless function freezes. logger.log never throws.
    if (logger) await logger.log(result.state, msg.text, result.response, msg.username);

    if (uatEnabled) {
      try {
        await pushUatLog(redis, {
          platform: msg.platform,
          userId: msg.userId,
          authorized: result.state.isAuthorized,
          userMessage: msg.text,
          botReply: result.response,
          phase: result.state.conversationPhase,
          tag: result.state.tag ?? null,
          crisis: result.state.crisisDetected,
          provider: providerFromChatId(result.state.aiBotChatId),
          latencyMs: Date.now() - tTotal,
          error: false,
        });
      } catch (e) {
        console.error('[uat] log push failed:', e);
      }
    }

    // Demographic capture — log the user's actual age once, deduped in Redis.
    // The NX key persists ~1 year so a returning user isn't re-logged.
    const demoUrl = process.env.DEMOGRAPHICS_WEBHOOK_URL;
    if (demoUrl && result.state.age != null) {
      try {
        const demoKey = `demographic:${msg.platform}:${msg.userId}`;
        const firstTime = await redis.set(demoKey, '1', { ex: 365 * 24 * 3600, nx: true });
        if (firstTime !== null) {
          await new DemographicsLogger(demoUrl).log(msg.platform, msg.userId, result.state.age);
        }
      } catch (e) {
        console.error('[demographics] dedup/log error:', e);
      }
    }

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
