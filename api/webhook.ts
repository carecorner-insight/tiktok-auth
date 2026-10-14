import { waitUntil } from '@vercel/functions';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getRedis, getControlRedis, RedisClient } from '../src/lib/redis';
import { BotPausedError, BotTurnControl, MAINTENANCE_NOTICE, readCoachModel } from '../src/lib/botControl';
import { scenarioMenuEnabled } from '../src/lib/pivotFlags';

import { processMessage } from '../src/graph/runner';
import { TikTokAdapter } from '../src/adapters/tiktok';
import { TelegramAdapter } from '../src/adapters/telegram';
import { WhitelistService } from '../src/services/whitelistService';
import { SessionManager } from '../src/services/sessionManager';
import { SharePointLogger } from '../src/services/sharePointLogger';
import { DemographicsLogger } from '../src/services/demographicsLogger';
import { makeSocialCoachClient } from '../src/services/makeSocialCoachClient';
import { makeCareyAIClient, CareyAIClient } from '../src/services/makeCareyAIClient';
import { DirectLLMClient } from '../src/services/directLLMClient';
import { INTENT_CLASSIFIER_PROMPT } from '../src/nodes/intentClassifierNode';
import type { IPlatformAdapter } from '../src/types/platform';
import type { Platform } from '../src/types/state';
import { pushUatLog, providerFromChatId } from '../src/lib/uatLog';
import { getMenuMode, type MenuMode } from '../src/lib/menuMode';
import { getStoredAge, setStoredAge } from '../src/lib/ageStore';
import { coachProvider, resolveCoachConfig } from '../src/services/resolveCoachConfig';
import { randomUUID, timingSafeEqual } from 'crypto';
import { KpiCollector, collectionEnabled } from '../src/analytics/collector';
import { initialState, type CareyBotState } from '../src/types/state';
import { newKpiState } from '../src/analytics/contract';

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

const USER_LOCK_WAIT_MS = 10_000;
const USER_LOCK_RETRY_MS = 500;
// Outlive the webhook's 60-second execution limit, including a slow AI call.
const USER_LOCK_TTL_SECONDS = 90;
const RELEASE_USER_LOCK = `-- user-lock-release-v1
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;
const BUSY_REPLY = "I'm still finishing your previous message. Please send this message again in a moment.";

async function withUserLock<T>(
  redis: RedisClient,
  platform: string,
  userId: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  if (!redis.eval) throw new Error('Atomic conversation locking is unavailable');
  const lockKey = `lock:${platform}:${userId}`;
  const owner = randomUUID();
  const deadline = Date.now() + USER_LOCK_WAIT_MS;
  while (await redis.set(lockKey, owner, { ex: USER_LOCK_TTL_SECONDS, nx: true }) === null) {
    // Give an in-flight reply time to finish, without using the whole function
    // budget. The caller explicitly asks for a retry if this wait expires.
    if (Date.now() >= deadline) return undefined;
    await new Promise(resolve => setTimeout(resolve, USER_LOCK_RETRY_MS));
  }

  try {
    return await fn();
  } finally {
    // A late completion must never remove a newer request's lock.
    await redis.eval(RELEASE_USER_LOCK, [lockKey], [owner]);
  }
}

// ── Background message handler ────────────────────────────────────────────────

// Exported for api/webhook-study.ts, which runs the same pipeline against the
// study configuration (prefixed Redis, study bot token, own log list).
export interface HandleMessageOptions {
  /** Set only by the separate study endpoint, never from incoming payloads. */
  study?: boolean;
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
  const dedupKey = msg.messageId ? `dedup:${msg.platform}:${msg.messageId}` : null;
  if (dedupKey) {
    const tDedup = Date.now();
    const isNew = await redis.set(dedupKey, 1, {
      ex: 3600,
      nx: true,
    });
    console.log(`[perf] dedup check: ${Date.now() - tDedup}ms`);
    if (isNew === null) return; // duplicate delivery
  }

  const controlRedis = opts.study ? null : getControlRedis();
  let collector: KpiCollector | null = null;
  let contact: { sessionId: string; startedAt: number; observed: boolean; isNew: boolean } | undefined;
  let measuredState: CareyBotState | null = null;
  if (!opts.study && msg.platform === 'telegram' && collectionEnabled() && controlRedis) {
    try {
      collector = new KpiCollector(controlRedis, msg);
      const age = await getStoredAge(controlRedis, msg.platform, msg.userId);
      const existingMeasurementSession = await new SessionManager(controlRedis).load(msg.platform, msg.userId);
      contact = await collector.activity(age, existingMeasurementSession);
      measuredState = {
        ...initialState(msg.platform, msg.userId, msg.conversationId ?? ''), age,
        sessionId: contact.sessionId, kpi: newKpiState(contact.startedAt, contact.observed),
      };
    } catch {
      console.error('[kpi] activity collection failed; coaching continues with a possible data gap');
      if (collector) await collector.safely(async () => { throw new Error('Activity could not be saved'); });
      collector = null;
    }
  }
  const recordOutcome = async (delivery: 'sent' | 'maintenance' | 'failed') => {
    if (!collector || !measuredState) return;
    await collector.safely(() => collector!.completed(measuredState!, delivery, collector!.metadata));
  };
  const flushKpi = async () => {
    if (collector) await collector.safely(() => collector!.outbox.flush());
  };
  const control = controlRedis ? await BotTurnControl.start(controlRedis) : null;
  let noticeSent = false;
  const maintenance = async () => {
    if (noticeSent) return;
    noticeSent = true;
    try {
      await adapter.sendMessage(msg.userId, MAINTENANCE_NOTICE, msg.conversationId);
      await recordOutcome('maintenance');
    } catch (error) {
      await recordOutcome('failed');
      throw error;
    }
  };
  const active = () => control ? control.active() : Promise.resolve(true);
  if (!await active()) {
    try { await maintenance(); } finally { await flushKpi(); }
    return;
  }
  const guard = (client: CareyAIClient) => control ? control.guardClient(client) : client;
  const reply = async (text: string) => {
    if (!await active()) { await maintenance(); return false; }
    await adapter.sendMessage(msg.userId, text, msg.conversationId);
    return true;
  };

  const tLock = Date.now();
  let enteredLock = false;
  let finishLogging: (() => Promise<void>) | undefined;
  try {
    await withUserLock(redis, msg.platform, msg.userId, async () => {
      enteredLock = true;
      if (!await active()) { await maintenance(); return; }
      console.log(`[perf] lock acquire: ${Date.now() - tLock}ms`);
      const menuMode = opts.menuMode ?? (await getMenuMode(redis));
      let modelSetting;
      try {
        modelSetting = controlRedis && scenarioMenuEnabled() && coachProvider() === 'direct'
          ? await readCoachModel(controlRedis) : undefined;
      } catch { await maintenance(); return; }
      const coachConfig = await resolveCoachConfig(redis, modelSetting, !!collector && !opts.study);
      if (collector) collector.metadata = coachConfig.metadata;
      console.log('[coach-config]', { ...coachConfig.metadata, menuMode });
      const session = new SessionManager(redis);
      const services = {
        ...(collector ? { kpi: collector, kpiContact: contact } : {}),
        whitelist: new WhitelistService(redis, fetchWhitelistStatus),
        session: control ? control.guardSession(session) : session,
        menuMode,
        // Carey's client — AIBots+Dify by default, or direct Qwen when
        // USE_DIRECT_LLM=true (efficacy experiment; off by default).
        aiBots: guard(makeCareyAIClient()),
        // Growing We social coach. Direct Qwen by default (holds our own prompt
        // + the [CRISIS]/[REFERRAL] tag contract); COACH_PROVIDER=aibots switches
        // to the seeded Directus bot with its Dify fallback. An admin-published
        // prompt from the prompt store wins over the bundled one; any store
        // problem falls back to bundled (loadLiveCoachPrompt never throws). The
        // study endpoint forces DYNAMIC_COACH_PROMPT=false, so it always gets
        // the bundled prompt.
        socialCoach: guard(makeSocialCoachClient(coachConfig)),
        // Intent classification for the open-ended post-screener entry — a
        // direct OpenAI-compatible call (single-token output, no AIBots session).
        intentLLM: guard(new DirectLLMClient({
          apiKey: process.env.QWEN_API_KEY ?? '',
          baseURL: process.env.QWEN_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
          model: process.env.INTENT_LLM_MODEL ?? 'qwen-turbo',
          systemPrompt: INTENT_CLASSIFIER_PROMPT,
        })),
        typing: { sendTypingIndicator: async (userId: string) => {
          if (await active()) await adapter.sendTypingIndicator(userId);
        } },
        // Persistent per-user age (F2) — survives the 6h session, so a returning
        // user is never re-asked and referral triage still works.
        ageStore: {
          get: (p: Platform, u: string) => getStoredAge(redis, p, u),
          set: async (p: Platform, u: string, a: number) => {
            if (control) await control.assertActive();
            await setStoredAge(redis, p, u, a);
          },
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
        if (err instanceof BotPausedError || !await active()) { await maintenance(); return; }
        console.error('[webhook] processMessage failed:', err);
        if (!await reply(responseText)) return;

        const fallbackState = await services.session.load(msg.platform, msg.userId);
        if (fallbackState) measuredState = {
          ...fallbackState, ...(fallbackState.kpi ? { kpi: { ...fallbackState.kpi, facts: [] } } : {}),
        };
        await recordOutcome('failed');
        finishLogging = async () => {
          if (logger && fallbackState) {
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
                coach: coachConfig.metadata,
              });
            } catch (e) {
              console.error('[uat] log push failed:', e);
            }
          }
        };
        return;
      }

      measuredState = result.state;
      const referral = collector ? await collector.safely(() => collector!.referral(result.state, result.response)) : null;
      if (referral) result.response = referral.reply;
      try {
        if (!await reply(result.response)) return;
      } catch (error) {
        // A question generated by the graph is not an observed check-in until
        // Telegram accepts the send. Do not bind a future number to an unsent ask.
        if (result.state.kpi) {
          const unsentCheckin = result.state.kpi.facts.some(fact => fact.eventType === 'checkin_reached');
          result.state.kpi = {
            ...result.state.kpi, pendingQuestion: null,
            checkinReached: unsentCheckin ? false : result.state.kpi.checkinReached,
          };
          try { await services.session.save(result.state); } catch { /* original transport error takes precedence */ }
        }
        await recordOutcome('failed');
        throw error;
      }
      if (collector) {
        await collector.safely(() => collector!.completed(result.state, 'sent', coachConfig.metadata));
        if (referral) await collector.safely(() => collector!.outbox.record(referral.event));
      }

      // Send user ID as a separate message so unauthorized users can long-press to copy it
      if (!result.state.isAuthorized) {
        if (!await reply(msg.userId)) return;
      }

      // The saved state and delivered reply belong to this turn. Log that
      // snapshot after unlocking so the participant can answer immediately.
      finishLogging = async () => {
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
              coach: coachConfig.metadata,
            });
          } catch (e) {
            console.error('[uat] log push failed:', e);
          }
        }

        // Atomic dedup still permits only one demographic export per user,
        // even when the next conversation turn has already begun.
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
      };
    });
    if (!enteredLock) {
      // Nothing was processed: don't permanently mark the update as handled.
      // Telegram was already acknowledged, so tell the participant to retry.
      if (dedupKey) await redis.del(dedupKey);
      if (await reply(BUSY_REPLY)) await recordOutcome('failed');
    }
  } finally {
    // Keep both deliveries inside waitUntil, but outside the conversation lock.
    // Run independently so a slow transcript flow cannot delay KPI retries.
    await Promise.all([finishLogging?.(), flushKpi()]);
    console.log(`[perf] handleMessage total: ${Date.now() - tTotal}ms`);
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
  if (platform === 'telegram') {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (collectionEnabled() && !secret) return res.status(503).json({ error: 'Telegram sender verification must be configured before KPI collection' });
    if (secret) {
      const header = req.headers['x-telegram-bot-api-secret-token'];
      const received = typeof header === 'string' ? Buffer.from(header) : Buffer.alloc(0);
      const expected = Buffer.from(secret);
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) return res.status(401).json({ error: 'Unauthorized' });
    }
  }
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
