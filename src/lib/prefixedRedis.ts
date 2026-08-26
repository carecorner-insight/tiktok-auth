import type { RedisClient } from './redis';

/**
 * Wraps a RedisClient so every key gets a namespace prefix.
 *
 * The study and pivot bots share one Redis database, but a Telegram user has
 * the SAME numeric ID on both bots — without a namespace, talking to one bot
 * would corrupt the other's session, age record, dedup and lock keys. The
 * study webhook wraps its client with `withKeyPrefix(redis, 'study:')` so the
 * two bots' state can never collide.
 */
export function withKeyPrefix(redis: RedisClient, prefix: string): RedisClient {
  const k = (key: string) => `${prefix}${key}`;
  return {
    get: (key) => redis.get(k(key)),
    set: (key, value, opts) => redis.set(k(key), value, opts),
    del: (key) => redis.del(k(key)),
    lpush: (key, ...values) => redis.lpush(k(key), ...values),
    ltrim: (key, start, stop) => redis.ltrim(k(key), start, stop),
    lrange: (key, start, stop) => redis.lrange(k(key), start, stop),
    expire: (key, seconds) => redis.expire(k(key), seconds),
  };
}
