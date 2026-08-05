import { LabelerService, parseLabelerRows } from '@/services/labelerService';
import type { LabelerEntry } from '@/lib/labelers';

function makeRedisMock() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: unknown) => {
      store.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      return 'OK' as const;
    }),
    del: jest.fn(async () => 1),
    lpush: jest.fn(async () => 1),
    ltrim: jest.fn(async () => 'OK'),
    lrange: jest.fn(async () => []),
    expire: jest.fn(async () => 1),
  };
}

const ENTRY: LabelerEntry = { token: 'tokA', name: 'Alice', email: 'alice@care.org', id: 'alice@care.org' };

describe('parseLabelerRows (Power Automate → entries)', () => {
  it('reads a bare array with SharePoint-style column names', () => {
    const rows = parseLabelerRows([
      { Token: 'abc', Title: 'Alice Tan', Email: 'alice@care.org', Status: 'Approved' },
    ]);
    expect(rows).toEqual([
      { token: 'abc', name: 'Alice Tan', email: 'alice@care.org', id: 'alice@care.org' },
    ]);
  });

  it('reads the { value: [...] } shape', () => {
    const rows = parseLabelerRows({ value: [{ token: 'abc', name: 'Bob', status: 'approved' }] });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Bob');
  });

  it('is case-insensitive about column names and status', () => {
    expect(parseLabelerRows([{ TOKEN: 'a', NAME: 'N', STATUS: 'ACTIVE' }])).toHaveLength(1);
  });

  it('excludes rows that are not approved', () => {
    const rows = parseLabelerRows([
      { token: 'a', name: 'Pending Person', status: 'Pending' },
      { token: 'b', name: 'Removed Person', status: 'Revoked' },
      { token: 'c', name: 'Good Person', status: 'Approved' },
    ]);
    expect(rows.map(r => r.name)).toEqual(['Good Person']);
  });

  it('admits rows with no status column at all (list without a Status field)', () => {
    expect(parseLabelerRows([{ token: 'a', name: 'N' }])).toHaveLength(1);
  });

  it('skips rows missing a token or a name — they cannot authenticate anyone', () => {
    expect(parseLabelerRows([{ name: 'No Token' }, { token: 'x' }, {}])).toEqual([]);
  });

  it('falls back to the name as id when no email is given', () => {
    expect(parseLabelerRows([{ token: 'a', name: 'Solo' }])[0].id).toBe('Solo');
  });

  it('returns [] for junk payloads instead of throwing', () => {
    expect(parseLabelerRows(null)).toEqual([]);
    expect(parseLabelerRows('nope')).toEqual([]);
    expect(parseLabelerRows([1, 'x', null])).toEqual([]);
  });
});

describe('LabelerService', () => {
  it('resolves a token from the SharePoint list and caches it', async () => {
    const redis = makeRedisMock();
    const fetchList = jest.fn(async () => [ENTRY]);
    const svc = new LabelerService(redis as never, fetchList, undefined);

    expect(await svc.resolve('tokA')).toMatchObject({ name: 'Alice', id: 'alice@care.org' });
    expect(fetchList).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalled();

    // Second call within the freshness window uses the cache.
    expect(await svc.resolve('tokA')).not.toBeNull();
    expect(fetchList).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown token', async () => {
    const svc = new LabelerService(makeRedisMock() as never, async () => [ENTRY], undefined);
    expect(await svc.resolve('wrong')).toBeNull();
    expect(await svc.resolve('')).toBeNull();
  });

  it('refetches once the cached list is stale', async () => {
    const redis = makeRedisMock();
    redis.store.set(
      'labeler:list',
      JSON.stringify({ fetchedAt: Date.now() - 10 * 60 * 1000, entries: [] }),
    );
    const fetchList = jest.fn(async () => [ENTRY]);
    const svc = new LabelerService(redis as never, fetchList, undefined);

    expect(await svc.resolve('tokA')).not.toBeNull();
    expect(fetchList).toHaveBeenCalledTimes(1);
  });

  it('serves the STALE list when the refresh fails — an outage must not lock reviewers out', async () => {
    const redis = makeRedisMock();
    redis.store.set(
      'labeler:list',
      JSON.stringify({ fetchedAt: Date.now() - 10 * 60 * 1000, entries: [ENTRY] }),
    );
    const fetchList = jest.fn(async () => { throw new Error('power automate down'); });
    const svc = new LabelerService(redis as never, fetchList, undefined);

    expect(await svc.resolve('tokA')).toMatchObject({ name: 'Alice' });
  });

  it('denies when the source is unreachable and nothing is cached (fails closed)', async () => {
    const svc = new LabelerService(
      makeRedisMock() as never,
      async () => { throw new Error('down'); },
      undefined,
    );
    expect(await svc.resolve('tokA')).toBeNull();
  });

  it('falls back to LABELER_TOKENS when SharePoint is not configured', async () => {
    const svc = new LabelerService(makeRedisMock() as never, null, 'envTok:Env User:env@care.org');
    expect(await svc.resolve('envTok')).toMatchObject({ name: 'Env User' });
  });

  it('keeps env tokens working as break-glass alongside the SharePoint list', async () => {
    const svc = new LabelerService(
      makeRedisMock() as never,
      async () => [ENTRY],
      'breakGlass:Admin:admin@care.org',
    );
    expect(await svc.resolve('tokA')).toMatchObject({ name: 'Alice' });
    expect(await svc.resolve('breakGlass')).toMatchObject({ name: 'Admin' });
  });

  it('still authenticates via env tokens when SharePoint is down', async () => {
    const svc = new LabelerService(
      makeRedisMock() as never,
      async () => { throw new Error('down'); },
      'breakGlass:Admin:admin@care.org',
    );
    expect(await svc.resolve('breakGlass')).toMatchObject({ name: 'Admin' });
  });
});
