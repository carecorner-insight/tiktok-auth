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
  constructor(private readonly client: IoRedis, private readonly waitForReady = false) {}

  private async ready(): Promise<void> {
    if (!this.waitForReady || this.client.status === 'ready') return;
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => {
        clearTimeout(timer);
        this.client.off('ready', onReady); this.client.off('error', onError);
        error ? reject(error) : resolve();
      };
      const onReady = () => done();
      const onError = () => done(new Error('Control store is unavailable'));
      const timer = setTimeout(() => done(new Error('Control store connection timed out')), 2000);
      this.client.once('ready', onReady); this.client.once('error', onError);
    });
  }

  async get(key: string): Promise<string | null> {
    await this.ready();
    return this.client.get(key);
  }

  async set(
    key: string,
    value: unknown,
    opts?: { ex?: number; nx?: boolean },
  ): Promise<'OK' | null> {
    await this.ready();
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
let controlInstance: RedisWrapper | null = null;

// Control operations must not queue an old ON write for replay after an outage.
export function getControlRedis(): RedisClient {
  if (!controlInstance) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL is not set');
    controlInstance = new RedisWrapper(new IoRedis(url, {
      enableOfflineQueue: false, commandTimeout: 2000, connectTimeout: 2000,
      maxRetriesPerRequest: 0, autoResendUnfulfilledCommands: false,
    }), true);
  }
  return controlInstance;
}

export function getRedis(): RedisWrapper {
  if (!instance) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL is not set');
    instance = new RedisWrapper(new IoRedis(url, { lazyConnect: false, enableOfflineQueue: true }));
  }
  return instance;
}
