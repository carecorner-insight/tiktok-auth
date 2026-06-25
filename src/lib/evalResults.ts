import type { RedisClient } from './redis';

// Durable-ish summary buffer for the eval results tab. SharePoint is the
// permanent archive (full transcripts); Redis holds compact summaries the
// results tab reads. Capped + long TTL so a year of 2-day cycles fits.

const KEY = 'eval:results';
const FULL_PREFIX = 'eval:result:';
const MAX_ENTRIES = 500;
const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

export interface EvalSummary {
  id: string; // `${runId}__${persona}` — key to lazy-load the full record
  runId: string;
  ts: number;
  persona: string;
  userType: string;
  outcomeLabel: string;
  status: 'completed' | 'error';
  referralPresentPct: number | null;
  referralAbsentCount: number;
  wellbeingCheckReached: boolean | null;
  passed: boolean;
  finalTag: string | null;
  finalPhase: string | null;
  crisisDetected: boolean;
  selectedOption: number | null;
}

export function resultId(runId: string, persona: string): string {
  return `${runId}__${persona}`;
}

export async function pushEvalSummary(
  redis: RedisClient,
  summary: EvalSummary,
): Promise<void> {
  await redis.lpush(KEY, JSON.stringify(summary));
  await redis.ltrim(KEY, 0, MAX_ENTRIES - 1);
  await redis.expire(KEY, TTL_SECONDS);
}

export async function readEvalSummaries(redis: RedisClient): Promise<EvalSummary[]> {
  const raw = await redis.lrange(KEY, 0, MAX_ENTRIES - 1);
  const out: EvalSummary[] = [];
  for (const item of raw) {
    try {
      out.push(JSON.parse(item) as EvalSummary);
    } catch {
      // skip malformed
    }
  }
  return out;
}

// Full record (incl. transcript + assertion detail), keyed by id for drill-down.
export async function setFullResult(
  redis: RedisClient,
  id: string,
  full: unknown,
): Promise<void> {
  await redis.set(`${FULL_PREFIX}${id}`, JSON.stringify(full), { ex: TTL_SECONDS });
}

export async function getFullResult(
  redis: RedisClient,
  id: string,
): Promise<unknown | null> {
  const raw = await redis.get(`${FULL_PREFIX}${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
