import type { CareyBotState, Platform } from '../types/state';
import type { RedisClient } from '../lib/redis';
import { encrypt, decrypt, isEncrypted } from '../lib/encryption';

const SESSION_TTL_SECONDS = 21600; // 6 hours

export class SessionManager {
  private readonly encryptionKey: string;

  constructor(private readonly redis: RedisClient) {
    const key = process.env.SESSION_ENCRYPTION_KEY ?? '';
    if (!key) {
      throw new Error(
        'SESSION_ENCRYPTION_KEY is not set. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
    }
    this.encryptionKey = key;
  }

  private redisKey(platform: Platform, userId: string): string {
    return `session:${platform}:${userId}`;
  }

  async load(platform: Platform, userId: string): Promise<CareyBotState | null> {
    const raw = await this.redis.get(this.redisKey(platform, userId));
    if (!raw) return null;

    // Backward-compat: sessions written before encryption was added are plain
    // JSON (start with '{').  Decrypt them transparently during the rollout
    // window; they will be re-saved encrypted on the next write.
    if (isEncrypted(raw)) {
      const json = decrypt(raw, this.encryptionKey);
      return JSON.parse(json) as CareyBotState;
    }

    console.warn('[session] loaded legacy plaintext session — will be re-encrypted on next save');
    return JSON.parse(raw) as CareyBotState;
  }

  async save(state: CareyBotState): Promise<void> {
    const json    = JSON.stringify(state);
    const payload = encrypt(json, this.encryptionKey);

    await this.redis.set(
      this.redisKey(state.platform, state.userId),
      payload,
      { ex: SESSION_TTL_SECONDS },
    );
  }

  async clear(platform: Platform, userId: string): Promise<void> {
    await this.redis.del(this.redisKey(platform, userId));
  }
}
