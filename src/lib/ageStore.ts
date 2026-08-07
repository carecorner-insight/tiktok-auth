import type { RedisClient } from './redis';

/**
 * Age persisted per user, OUTSIDE the 6-hour conversation session (F2).
 *
 * Two jobs:
 *  1. A returning user is never asked their age again.
 *  2. The referral link is auto-selected from the stored age (25 & under →
 *     INSIGHT, 26+ → CREST) with no question at the referral moment.
 *
 * Keyed by platform + platform user id, mirroring the demographics dedup key.
 * This is the "pegged to the Telegram ID" persistence the brief requires.
 */

/** ~1 year — matches the demographics dedup window. */
export const AGE_TTL_SECONDS = 365 * 24 * 60 * 60;

const MIN_AGE = 5;
const MAX_AGE = 120;

const key = (platform: string, userId: string) => `age:${platform}:${userId}`;

/**
 * Extracts a plausible age from a free-text reply.
 *
 * Deliberately permissive about phrasing ("im 19") but strict about range:
 * storing a wrong age is worse than storing none, because it silently drives
 * referral triage. Out-of-range or unparseable input returns null, which the
 * caller treats as "not answered" — never as a reason to exclude the user.
 */
export function parseAge(input: string): number | null {
  const match = input.trim().match(/\b(\d{1,3})\b/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  if (Number.isNaN(n) || n < MIN_AGE || n > MAX_AGE) return null;
  return n;
}

export async function getStoredAge(
  redis: RedisClient,
  platform: string,
  userId: string,
): Promise<number | null> {
  try {
    const raw = await redis.get(key(platform, userId));
    if (raw === null) return null;
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? null : n;
  } catch {
    // A Redis blip must not block the conversation — treat as "unknown age".
    return null;
  }
}

export async function setStoredAge(
  redis: RedisClient,
  platform: string,
  userId: string,
  age: number,
): Promise<void> {
  try {
    await redis.set(key(platform, userId), String(age), { ex: AGE_TTL_SECONDS });
  } catch (err) {
    console.error('[age] persist failed (non-fatal):', err);
  }
}
