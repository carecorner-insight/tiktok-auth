import { getStoredAge, setStoredAge, parseAge, AGE_TTL_SECONDS } from '@/lib/ageStore';
import { screenerEnabled, authEnabled } from '@/lib/pivotFlags';

function makeRedisMock() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: unknown) => {
      store.set(k, String(v));
      return 'OK' as const;
    }),
    del: jest.fn(async () => 1),
    lpush: jest.fn(async () => 1),
    ltrim: jest.fn(async () => 'OK'),
    lrange: jest.fn(async () => []),
    expire: jest.fn(async () => 1),
  };
}

describe('parseAge — a question, not a gate', () => {
  it('accepts a plausible age', () => {
    expect(parseAge('17')).toBe(17);
    expect(parseAge('  25 ')).toBe(25);
    expect(parseAge('5')).toBe(5);
    expect(parseAge('120')).toBe(120);
  });

  it('pulls a number out of a short sentence', () => {
    expect(parseAge('im 19')).toBe(19);
    expect(parseAge('19 years old')).toBe(19);
  });

  it('rejects implausible numbers rather than storing nonsense', () => {
    expect(parseAge('0')).toBeNull();
    expect(parseAge('4')).toBeNull();
    expect(parseAge('121')).toBeNull();
    expect(parseAge('1999')).toBeNull();
  });

  it('rejects non-answers', () => {
    expect(parseAge('abc')).toBeNull();
    expect(parseAge('')).toBeNull();
    expect(parseAge('skip')).toBeNull();
  });
});

describe('age store — persists beyond the 6h session', () => {
  it('returns null when the user has no stored age', async () => {
    const redis = makeRedisMock();
    expect(await getStoredAge(redis as never, 'telegram', 'u1')).toBeNull();
  });

  it('round-trips an age under a per-user key', async () => {
    const redis = makeRedisMock();
    await setStoredAge(redis as never, 'telegram', 'u1', 19);
    expect(redis.store.has('age:telegram:u1')).toBe(true);
    expect(await getStoredAge(redis as never, 'telegram', 'u1')).toBe(19);
  });

  it('keeps ages separate per platform and per user', async () => {
    const redis = makeRedisMock();
    await setStoredAge(redis as never, 'telegram', 'u1', 19);
    expect(await getStoredAge(redis as never, 'tiktok', 'u1')).toBeNull();
    expect(await getStoredAge(redis as never, 'telegram', 'u2')).toBeNull();
  });

  it('sets a long TTL so the age outlives the conversation session', async () => {
    const redis = makeRedisMock();
    await setStoredAge(redis as never, 'telegram', 'u1', 19);
    expect(redis.set).toHaveBeenCalledWith('age:telegram:u1', '19', { ex: AGE_TTL_SECONDS });
    expect(AGE_TTL_SECONDS).toBeGreaterThan(30 * 24 * 60 * 60); // far beyond the 6h session
  });

  it('returns null for corrupt stored values instead of throwing', async () => {
    const redis = makeRedisMock();
    redis.store.set('age:telegram:u1', 'not-a-number');
    expect(await getStoredAge(redis as never, 'telegram', 'u1')).toBeNull();
  });
});

describe('pivot feature flags', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env.SCREENER_ENABLED = original.SCREENER_ENABLED;
    process.env.AUTH_ENABLED = original.AUTH_ENABLED;
  });

  it('defaults to ON so the NUS study build is unchanged when unset', () => {
    delete process.env.SCREENER_ENABLED;
    delete process.env.AUTH_ENABLED;
    expect(screenerEnabled()).toBe(true);
    expect(authEnabled()).toBe(true);
  });

  it('only turns off on an explicit "false"', () => {
    process.env.SCREENER_ENABLED = 'false';
    process.env.AUTH_ENABLED = 'false';
    expect(screenerEnabled()).toBe(false);
    expect(authEnabled()).toBe(false);

    process.env.SCREENER_ENABLED = 'no';
    expect(screenerEnabled()).toBe(true); // anything else stays safe-side ON
  });
});
