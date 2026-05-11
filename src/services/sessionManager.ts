import type { CareyBotState, Platform } from '@/types/state';

type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts: { ex: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

const SESSION_TTL_SECONDS = 21600; // 6 hours

export class SessionManager {
  constructor(private readonly redis: RedisClient) {}

  private key(platform: Platform, userId: string): string {
    return `session:${platform}:${userId}`;
  }

  async load(platform: Platform, userId: string): Promise<CareyBotState | null> {
    const raw = await this.redis.get(this.key(platform, userId));
    if (!raw) return null;
    return JSON.parse(raw) as CareyBotState;
  }

  async save(state: CareyBotState): Promise<void> {
    await this.redis.set(
      this.key(state.platform, state.userId),
      JSON.stringify(state),
      { ex: SESSION_TTL_SECONDS },
    );
  }

  async clear(platform: Platform, userId: string): Promise<void> {
    await this.redis.del(this.key(platform, userId));
  }
}
