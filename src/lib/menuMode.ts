import type { RedisClient } from './redis';

// Global A/B switch for the post-screener entry experience, toggled from the
// UAT live-log page. `intent` = open-ended prompt + LLM intent classification
// (default); `numbered` = the classic numbered menu (no LLM classify).
// Persistent (no TTL) — it's a config flag, not a capture switch.

export type MenuMode = 'intent' | 'numbered';

const KEY = 'menu:mode';

export async function getMenuMode(redis: RedisClient): Promise<MenuMode> {
  return (await redis.get(KEY)) === 'numbered' ? 'numbered' : 'intent';
}

export async function setMenuMode(redis: RedisClient, mode: MenuMode): Promise<void> {
  await redis.set(KEY, mode);
}
