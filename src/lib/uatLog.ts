import type { RedisClient } from './redis';

// Ephemeral ring buffer of recent conversation turns, for the UAT live-log page.
// Capture is gated on UAT_LOG_TOKEN being set (see webhook.ts), so nothing is
// stored when UAT logging is disabled. Entries carry plaintext message content,
// so the buffer is capped and short-lived by design.

const KEY = 'uat:logs';
const MAX_ENTRIES = 200;
const TTL_SECONDS = 24 * 60 * 60; // 24h

export interface UatLogEntry {
  id: string;
  ts: number;
  platform: string;
  userId: string;
  authorized: boolean;
  userMessage: string;
  botReply: string;
  phase: string;
  tag: string | null;
  crisis: boolean;
  provider: 'aibots' | 'dify' | 'none';
  latencyMs: number;
  error: boolean;
}

function providerFromChatId(chatId: string | null | undefined): UatLogEntry['provider'] {
  if (!chatId) return 'none';
  if (chatId.startsWith('dify:')) return 'dify';
  if (chatId.startsWith('aibots:')) return 'aibots';
  return 'none';
}

export async function pushUatLog(
  redis: RedisClient,
  entry: Omit<UatLogEntry, 'id' | 'ts'> & { ts?: number },
): Promise<void> {
  const ts = entry.ts ?? Date.now();
  const full: UatLogEntry = {
    ...entry,
    ts,
    id: `${ts}-${Math.random().toString(36).slice(2, 8)}`,
  };
  await redis.lpush(KEY, JSON.stringify(full));
  await redis.ltrim(KEY, 0, MAX_ENTRIES - 1);
  await redis.expire(KEY, TTL_SECONDS);
}

// Returns newest-first. When `since` is given, only entries strictly newer
// than that timestamp are returned (for incremental polling).
export async function readUatLogs(
  redis: RedisClient,
  since?: number,
): Promise<UatLogEntry[]> {
  const raw = await redis.lrange(KEY, 0, MAX_ENTRIES - 1);
  const entries: UatLogEntry[] = [];
  for (const item of raw) {
    try {
      const parsed = JSON.parse(item) as UatLogEntry;
      if (since === undefined || parsed.ts > since) entries.push(parsed);
    } catch {
      // skip malformed entries
    }
  }
  return entries;
}

export async function toggleUatLogging(redis: RedisClient, enabled: boolean): Promise<void> {
  if (enabled) {
    await redis.set('uat:enabled', '1', { ex: TTL_SECONDS });
  } else {
    await redis.del('uat:enabled');
  }
}

export { providerFromChatId };
