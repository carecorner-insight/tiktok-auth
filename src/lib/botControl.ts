import { createHash, randomUUID } from 'crypto';
import type { RedisClient } from './redis';
import type { CareyAIClient } from '../services/makeCareyAIClient';
import type { SessionManager } from '../services/sessionManager';

export const MAINTENANCE_NOTICE =
  'Carey is temporarily unavailable for maintenance. Please try again later. ' +
  'Messages sent during maintenance will not be answered later.\n\n' +
  'If you need urgent help, contact emergency services or someone you trust.';

// These are model IDs, not guarantees of account availability or clinical quality.
export const COACH_MODELS = [
  { id: 'qwen-plus', label: 'Qwen Plus', description: 'Balanced option; current code default.' },
  { id: 'qwen-flash', label: 'Qwen Flash', description: 'Speed-focused option. Validate reply quality before use.' },
  { id: 'qwen-max', label: 'Qwen Max', description: 'Higher-capability option. Check cost and availability first.' },
] as const;

export interface BotMode { enabled: boolean; revision: string; updatedAt: string | null }
export interface CoachModelSetting { model: string | null; updatedAt: string | null }
const DEFAULT_MODE: BotMode = { enabled: true, revision: 'initial', updatedAt: null };

export function controlScope(env = process.env): string {
  if (env.VERCEL_ENV === 'production') return 'production:main';
  if (env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF?.trim()) {
    const ref = createHash('sha256').update(env.VERCEL_GIT_COMMIT_REF).digest('hex');
    return `preview:${ref}:main`;
  }
  if (!env.VERCEL && (!env.VERCEL_ENV || env.VERCEL_ENV === 'development')) return 'development:main';
  if (env.VERCEL_ENV === 'development') return 'development:main';
  throw new Error('Bot control scope is unavailable');
}

function key(kind: 'mode' | 'model'): string { return `bot-control:${controlScope()}:${kind}`; }
function validTime(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 30 && Number.isFinite(Date.parse(value));
}
export function allowedCoachModel(value: unknown): value is string {
  return typeof value === 'string' && COACH_MODELS.some(item => item.id === value);
}

export async function readBotMode(redis: RedisClient): Promise<BotMode> {
  const raw = await redis.get(key('mode'));
  if (raw === null) return { ...DEFAULT_MODE };
  if (raw.length > 1024) throw new Error('Invalid bot control state');
  const mode = JSON.parse(raw) as Partial<BotMode> | null;
  if (!mode || typeof mode.enabled !== 'boolean' || typeof mode.revision !== 'string' ||
      !/^[a-f\d-]{36}$/.test(mode.revision) || !validTime(mode.updatedAt)) {
    throw new Error('Invalid bot control state');
  }
  return mode as BotMode;
}

export async function setBotMode(redis: RedisClient, enabled: boolean): Promise<void> {
  if (typeof enabled !== 'boolean') throw new Error('Expected a boolean');
  // Independent atomic SET: changing a model cannot resurrect a paused bot.
  const result = await redis.set(key('mode'), { enabled, revision: randomUUID(), updatedAt: new Date().toISOString() });
  if (result !== 'OK') throw new Error('Bot control write failed');
}

export async function readCoachModel(redis: RedisClient): Promise<CoachModelSetting> {
  const raw = await redis.get(key('model'));
  if (raw === null) return { model: null, updatedAt: null };
  if (raw.length > 1024) throw new Error('Invalid model setting');
  const value = JSON.parse(raw) as Partial<CoachModelSetting> | null;
  if (!value || (value.model !== null && !allowedCoachModel(value.model)) || !validTime(value.updatedAt)) {
    throw new Error('Invalid model setting');
  }
  return value as CoachModelSetting;
}

export async function setCoachModel(redis: RedisClient, model: string | null): Promise<void> {
  if (model !== null && !allowedCoachModel(model)) throw new Error('Model is not allowed');
  const result = await redis.set(key('model'), { model, updatedAt: new Date().toISOString() });
  if (result !== 'OK') throw new Error('Model write failed');
}

export class BotPausedError extends Error {
  constructor() { super('Bot is in maintenance mode or control state is unavailable'); }
}

/** A mode revision fences old turns even when OFF is quickly followed by ON. */
export class BotTurnControl {
  private constructor(private readonly redis: RedisClient, private readonly admitted: BotMode | null) {}

  static async start(redis: RedisClient): Promise<BotTurnControl> {
    return new BotTurnControl(redis, await readBotMode(redis).catch(() => null));
  }

  async active(): Promise<boolean> {
    if (!this.admitted?.enabled) return false;
    try {
      const current = await readBotMode(this.redis);
      return current.enabled && current.revision === this.admitted.revision;
    } catch { return false; }
  }

  async assertActive(): Promise<void> {
    if (!await this.active()) throw new BotPausedError();
  }

  guardClient(client: CareyAIClient): CareyAIClient {
    return { chat: async (...args) => {
      await this.assertActive();
      return client.chat(...args);
    } };
  }

  guardSession(session: SessionManager): Pick<SessionManager, 'load' | 'save' | 'clear'> {
    return {
      load: (platform, userId) => session.load(platform, userId),
      save: async state => { await this.assertActive(); await session.save(state); },
      clear: async (platform, userId) => { await this.assertActive(); await session.clear(platform, userId); },
    };
  }
}
