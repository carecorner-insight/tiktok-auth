import type { RedisClient } from '@/lib/redis';

export function memoryRedis() {
  const data = new Map<string, string>();
  const client = {
    get: jest.fn(async (key: string) => data.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && data.has(key)) return null;
      data.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      return 'OK' as const;
    }),
    del: jest.fn(async (key: string) => data.delete(key)),
    lpush: jest.fn(async () => 1), ltrim: jest.fn(async () => null),
    lrange: jest.fn(async () => [] as string[]), expire: jest.fn(async () => 1),
  } satisfies RedisClient;
  return { data, client };
}
