import {
  validatePromptText,
  assembleCoachPrompt,
  loadLiveCoachPrompt,
  saveCoachPrompt,
  listPromptHistory,
  PROMPT_MIN_CHARS,
  PROMPT_MAX_CHARS,
} from '@/lib/promptStore';
import { REPLY_TAG_CONTRACT } from '@/config/socialCoachPrompt';
import type { RedisClient } from '@/lib/redis';

function memoryRedis(): RedisClient {
  const kv = new Map<string, string>();
  const lists = new Map<string, string[]>();
  return {
    get: async (k) => kv.get(k) ?? null,
    set: async (k, v) => {
      kv.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      return 'OK';
    },
    del: async (k) => (kv.delete(k) ? 1 : 0),
    lpush: async (k, ...values) => {
      const l = lists.get(k) ?? [];
      l.unshift(...values.reverse());
      lists.set(k, l);
      return l.length;
    },
    ltrim: async (k, start, stop) => {
      lists.set(k, (lists.get(k) ?? []).slice(start, stop + 1));
      return 'OK';
    },
    lrange: async (k, start, stop) => (lists.get(k) ?? []).slice(start, stop + 1),
    expire: async () => 1,
  };
}

const okText = 'You are a helpful coach. '.repeat(40); // comfortably above min

afterEach(() => {
  delete process.env.DYNAMIC_COACH_PROMPT;
});

describe('validatePromptText', () => {
  it('rejects text that is too short or too long', () => {
    expect(validatePromptText('too short')).toMatch(/at least/i);
    expect(validatePromptText('x'.repeat(PROMPT_MAX_CHARS + 1))).toMatch(/too long/i);
    expect(validatePromptText(okText)).toBeNull();
  });

  it('rejects empty and whitespace-only text', () => {
    expect(validatePromptText('')).not.toBeNull();
    expect(validatePromptText('   \n  ')).not.toBeNull();
  });
});

describe('assembleCoachPrompt — the safety guardrail', () => {
  it('appends the tag contract when the text lacks a crisis tag', () => {
    const assembled = assembleCoachPrompt(okText);
    expect(assembled).toContain('[CRISIS]');
    expect(assembled).toContain('[REFERRAL]');
    expect(assembled).toContain(REPLY_TAG_CONTRACT);
  });

  it('does not double-append when the text defines its own contract', () => {
    const withTags = `${okText}\nPrefix with [CRISIS] when unsafe. Use [REFERRAL] for handoff.`;
    const assembled = assembleCoachPrompt(withTags);
    expect(assembled).not.toContain(REPLY_TAG_CONTRACT);
  });
});

describe('save / load round-trip', () => {
  it('saves with incrementing versions and loads the assembled live prompt', async () => {
    const redis = memoryRedis();
    const v1 = await saveCoachPrompt(redis, { text: okText, label: 'first', editor: 'Alice' });
    expect(v1.version).toBe(1);
    const v2 = await saveCoachPrompt(redis, { text: okText + ' v2', label: 'second', editor: 'Bob' });
    expect(v2.version).toBe(2);

    const live = await loadLiveCoachPrompt(redis);
    expect(live).not.toBeNull();
    expect(live!.version).toBe(2);
    expect(live!.prompt).toContain('v2');
    // Guardrail applied at load time regardless of what was saved.
    expect(live!.prompt).toContain('[CRISIS]');
  });

  it('rejects invalid text with a helpful error and stores nothing', async () => {
    const redis = memoryRedis();
    await expect(saveCoachPrompt(redis, { text: 'nope', label: 'x', editor: 'y' })).rejects.toThrow(/at least/i);
    expect(await loadLiveCoachPrompt(redis)).toBeNull();
  });

  it('keeps history newest-first and capped', async () => {
    const redis = memoryRedis();
    for (let i = 1; i <= 25; i++) {
      await saveCoachPrompt(redis, { text: okText + i, label: `v${i}`, editor: 'A' });
    }
    const history = await listPromptHistory(redis);
    expect(history.length).toBeLessThanOrEqual(20);
    expect(history[0].version).toBe(25);
  });
});

describe('fallback behaviour — a bad store must never break the bot', () => {
  it('returns null when nothing is stored', async () => {
    expect(await loadLiveCoachPrompt(memoryRedis())).toBeNull();
  });

  it('returns null on corrupt JSON', async () => {
    const redis = memoryRedis();
    await redis.set('prompt:coach:live', 'not json {');
    expect(await loadLiveCoachPrompt(redis)).toBeNull();
  });

  it('returns null when the stored text fails validation', async () => {
    const redis = memoryRedis();
    await redis.set('prompt:coach:live', JSON.stringify({ text: 'tiny', version: 1 }));
    expect(await loadLiveCoachPrompt(redis)).toBeNull();
  });

  it('returns null when Redis throws', async () => {
    const broken = { ...memoryRedis(), get: async () => { throw new Error('down'); } };
    expect(await loadLiveCoachPrompt(broken as RedisClient)).toBeNull();
  });

  it('returns null when DYNAMIC_COACH_PROMPT=false (study endpoint forces this)', async () => {
    const redis = memoryRedis();
    await saveCoachPrompt(redis, { text: okText, label: 'x', editor: 'y' });
    process.env.DYNAMIC_COACH_PROMPT = 'false';
    expect(await loadLiveCoachPrompt(redis)).toBeNull();
  });
});
