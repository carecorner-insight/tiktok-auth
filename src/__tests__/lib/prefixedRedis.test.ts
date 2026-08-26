import { withKeyPrefix } from '@/lib/prefixedRedis';
import type { RedisClient } from '@/lib/redis';

function recordingRedis(calls: Array<[string, ...unknown[]]>): RedisClient {
  return {
    get: async (key) => {
      calls.push(['get', key]);
      return 'value';
    },
    set: async (key, value, opts) => {
      calls.push(['set', key, value, opts]);
      return 'OK';
    },
    del: async (key) => {
      calls.push(['del', key]);
      return 1;
    },
    lpush: async (key, ...values) => {
      calls.push(['lpush', key, ...values]);
      return values.length;
    },
    ltrim: async (key, start, stop) => {
      calls.push(['ltrim', key, start, stop]);
      return 'OK';
    },
    lrange: async (key, start, stop) => {
      calls.push(['lrange', key, start, stop]);
      return ['a'];
    },
    expire: async (key, seconds) => {
      calls.push(['expire', key, seconds]);
      return 1;
    },
  };
}

describe('withKeyPrefix', () => {
  it('prefixes the key on every method', async () => {
    const calls: Array<[string, ...unknown[]]> = [];
    const redis = withKeyPrefix(recordingRedis(calls), 'study:');

    await redis.get('session:telegram:u1');
    await redis.set('lock:telegram:u1', '1', { ex: 30, nx: true });
    await redis.del('lock:telegram:u1');
    await redis.lpush('uat:logs', 'entry');
    await redis.ltrim('uat:logs', 0, 99);
    await redis.lrange('uat:logs', 0, 99);
    await redis.expire('uat:logs', 60);

    expect(calls.map(c => c[1])).toEqual([
      'study:session:telegram:u1',
      'study:lock:telegram:u1',
      'study:lock:telegram:u1',
      'study:uat:logs',
      'study:uat:logs',
      'study:uat:logs',
      'study:uat:logs',
    ]);
  });

  it('passes arguments and return values through unchanged', async () => {
    const calls: Array<[string, ...unknown[]]> = [];
    const redis = withKeyPrefix(recordingRedis(calls), 'study:');

    await expect(redis.get('k')).resolves.toBe('value');
    await expect(redis.set('k', 'v', { ex: 5 })).resolves.toBe('OK');
    await expect(redis.lrange('k', 0, 1)).resolves.toEqual(['a']);

    expect(calls[1]).toEqual(['set', 'study:k', 'v', { ex: 5 }]);
  });
});
