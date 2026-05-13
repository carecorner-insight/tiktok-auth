import type { Platform } from '../types/state';
import type { RedisClient } from '../lib/redis';

type WhitelistStatus = 'approved' | 'pending' | 'unknown';

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
      console.log(`[whitelist] cache hit: key=${key} status=${cached}`);
      return cached === 'approved';
    }

    console.log(`[whitelist] cache miss: key=${key} — fetching from SharePoint`);
    const status = await this.fetchFromSharePoint(platform, userId);

    if (status) {
      await this.redis.set(key, status, { ex: CACHE_TTL_SECONDS });
      console.log(`[whitelist] cached: key=${key} status=${status} ttl=${CACHE_TTL_SECONDS}s`);
    } else {
      console.warn(`[whitelist] no status returned for key=${key} — user will be denied`);
    }

    return status === 'approved';
  }
}
