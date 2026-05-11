import type { Platform } from '@/types/state';

type WhitelistStatus = 'approved' | 'pending' | 'unknown';

type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts: { ex: number }): Promise<unknown>;
};

type FetchWhitelistFn = (
  platform: Platform,
  userId: string,
) => Promise<WhitelistStatus | null>;

const CACHE_TTL_SECONDS = 300; // 5 minutes

export class WhitelistService {
  constructor(
    private readonly redis: RedisClient,
    private readonly fetchFromSharePoint: FetchWhitelistFn,
  ) {}

  async isAuthorized(platform: Platform, userId: string): Promise<boolean> {
    const key = `whitelist:${platform}:${userId}`;

    const cached = await this.redis.get(key);
    if (cached !== null) {
      return cached === 'approved';
    }

    const status = await this.fetchFromSharePoint(platform, userId);
    if (status) {
      await this.redis.set(key, status, { ex: CACHE_TTL_SECONDS });
    }

    return status === 'approved';
  }
}
