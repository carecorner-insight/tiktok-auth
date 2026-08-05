import type { RedisClient } from '../lib/redis';
import { matchToken, parseLabelerTokens, type Labeler, type LabelerEntry } from '../lib/labelers';

/**
 * Reviewer access, managed by a NON-TECHNICAL admin in SharePoint.
 *
 * Mirrors WhitelistService: a SharePoint list is the source of truth, read via
 * Power Automate and cached in Redis. Adding or removing a reviewer is a row
 * edit in the SharePoint UI — no env var change, no redeploy, no developer.
 *
 * Design note — we fetch the WHOLE list and compare locally rather than sending
 * the presented token to Power Automate as a lookup key. That keeps the secret
 * on our own infrastructure and lets us keep the constant-time comparison.
 *
 * Fallback: when SHAREPOINT_LABELERS_WEBHOOK_URL is not configured, the service
 * falls back to the LABELER_TOKENS env var, so local dev and existing
 * deployments keep working, and there is a break-glass path if Power Automate
 * is down.
 */

const CACHE_KEY = 'labeler:list';
/** How long a fetched list is considered current. */
const FRESH_SECONDS = 5 * 60;
/** How long the cached copy survives — long, so we can serve it stale. */
const CACHE_TTL_SECONDS = 24 * 60 * 60;

const APPROVED = new Set(['approved', 'active', 'yes', 'true']);

interface CachedList {
  fetchedAt: number;
  entries: LabelerEntry[];
}

export type FetchLabelersFn = () => Promise<LabelerEntry[]>;

/** Reads a field case-insensitively — SharePoint column names vary. */
function field(row: Record<string, unknown>, ...names: string[]): string {
  for (const n of names) {
    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === n.toLowerCase()) {
        const v = row[key];
        if (typeof v === 'string') return v.trim();
        if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      }
    }
  }
  return '';
}

/**
 * Normalises a Power Automate response into approved labeler entries.
 * Accepts a bare array or `{ value: [...] }` (the Graph/SharePoint shape).
 */
export function parseLabelerRows(payload: unknown): LabelerEntry[] {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { value?: unknown })?.value)
    ? ((payload as { value: unknown[] }).value)
    : [];

  const out: LabelerEntry[] = [];
  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;

    const token = field(row, 'token', 'accesstoken', 'reviewertoken');
    const name = field(row, 'name', 'title', 'displayname', 'fullname');
    const email = field(row, 'email', 'mail', 'upn');
    const status = field(row, 'status', 'approved', 'state').toLowerCase();

    // A row without a token or name cannot authenticate anyone.
    if (!token || !name) continue;
    // Only approved reviewers — a Pending row must not grant access.
    if (status && !APPROVED.has(status)) continue;

    out.push({ token, name, email, id: email || name });
  }
  return out;
}

/** Default fetcher: POSTs to the Power Automate HTTP trigger. */
export function makeSharePointLabelerFetcher(url: string): FetchLabelersFn {
  return async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`labeler list fetch failed: ${res.status}`);
    return parseLabelerRows(await res.json());
  };
}

export class LabelerService {
  constructor(
    private readonly redis: RedisClient,
    private readonly fetchList: FetchLabelersFn | null,
    /** Break-glass / local-dev source. */
    private readonly envTokens: string | undefined = process.env.LABELER_TOKENS,
  ) {}

  private async readCache(): Promise<CachedList | null> {
    try {
      const raw = await this.redis.get(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedList;
      return Array.isArray(parsed.entries) ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Current approved reviewers. Refreshes when the cache is older than
   * FRESH_SECONDS; on a fetch failure it serves the stale copy rather than
   * locking every reviewer out over a transient Power Automate outage.
   */
  async list(): Promise<LabelerEntry[]> {
    const envEntries = parseLabelerTokens(this.envTokens);

    if (!this.fetchList) return envEntries; // not configured → env only

    const cached = await this.readCache();
    const ageMs = cached ? Date.now() - cached.fetchedAt : Infinity;
    if (cached && ageMs < FRESH_SECONDS * 1000) {
      return [...cached.entries, ...envEntries];
    }

    try {
      const entries = await this.fetchList();
      const payload: CachedList = { fetchedAt: Date.now(), entries };
      await this.redis.set(CACHE_KEY, JSON.stringify(payload), { ex: CACHE_TTL_SECONDS });
      return [...entries, ...envEntries];
    } catch (err) {
      if (cached) {
        console.warn('[labelers] refresh failed — serving stale reviewer list:', err);
        return [...cached.entries, ...envEntries];
      }
      // Nothing cached and the source is unreachable → env only (fail closed
      // when that is empty too).
      console.error('[labelers] fetch failed and no cache — denying:', err);
      return envEntries;
    }
  }

  /** Resolves a presented token to a reviewer identity, or null. */
  async resolve(token: string): Promise<Labeler | null> {
    if (!token) return null;
    return matchToken(token, await this.list());
  }
}

/**
 * Builds the service from env: the SharePoint list when
 * SHAREPOINT_LABELERS_WEBHOOK_URL is set, otherwise LABELER_TOKENS only.
 */
export function makeLabelerService(redis: RedisClient): LabelerService {
  const url = process.env.SHAREPOINT_LABELERS_WEBHOOK_URL;
  return new LabelerService(redis, url ? makeSharePointLabelerFetcher(url) : null);
}
