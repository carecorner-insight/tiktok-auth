import IoRedis from 'ioredis';

// Shared interface used by services and the singleton wrapper.
// Matches the option-object style of @upstash/redis so callers don't care
// which client sits underneath.
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<'OK' | null>;
  del(key: string): Promise<unknown>;
  lpush(key: string, ...values: string[]): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  expire(key: string, seconds: number): Promise<unknown>;
}

class RedisWrapper implements RedisClient {
  constructor(private readonly client: IoRedis) {}

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(
    key: string,
    value: unknown,
    opts?: { ex?: number; nx?: boolean },
  ): Promise<'OK' | null> {
    const str = typeof value === 'string' ? value : JSON.stringify(value);

    if (opts?.ex && opts?.nx) {
      return this.client.set(key, str, 'EX', opts.ex, 'NX') as Promise<'OK' | null>;
    }
    if (opts?.ex) {
      return this.client.set(key, str, 'EX', opts.ex);
    }
    if (opts?.nx) {
      return this.client.set(key, str, 'NX') as Promise<'OK' | null>;
    }
    return this.client.set(key, str);
  }

  del(key: string): Promise<unknown> {
    return this.client.del(key);
  }

  lpush(key: string, ...values: string[]): Promise<number> {
    return this.client.lpush(key, ...values);
  }

  ltrim(key: string, start: number, stop: number): Promise<unknown> {
    return this.client.ltrim(key, start, stop);
  }

  lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lrange(key, start, stop);
  }

  expire(key: string, seconds: number): Promise<unknown> {
    return this.client.expire(key, seconds);
  }
}

let instance: RedisWrapper | null = null;

export function getRedis(): RedisWrapper {
  if (!instance) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL is not set');
    instance = new RedisWrapper(new IoRedis(url, { lazyConnect: false, enableOfflineQueue: true }));
  }
  return instance;
}
