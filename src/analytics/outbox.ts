import type { RedisClient } from '../lib/redis';
import type { KpiEvent } from './contract';

// Event payloads expire after 400 days. This supports prior-month returners for
// the first annual reporting cycle; it is NOT unlimited all-time history.
export const RETENTION_SECONDS = 400 * 86400;
const EVENT_PREFIX = 'kpi:event:';
const PENDING = 'kpi:pending';
const ARCHIVE = 'kpi:archive';
const ATTEMPTS = 'kpi:attempts';

const ENQUEUE = `-- kpi-enqueue-v1
if redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3], 'NX') then
  redis.call('ZADD', KEYS[2], 0, ARGV[2])
  redis.call('ZADD', KEYS[3], ARGV[4], ARGV[2])
  if ARGV[5] == 'eligible' and ARGV[6] == 'false' then
    redis.call('ZADD', KEYS[4], 'LT', ARGV[4], ARGV[7])
  end
  return 1
end
return 0`;
const CLAIM = `-- kpi-claim-v1
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[3])
for _, id in ipairs(ids) do redis.call('ZADD', KEYS[1], ARGV[2], id) end
return ids`;
const ACK = `-- kpi-ack-v1
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('HDEL', KEYS[2], ARGV[1])
return 1`;
const RETRY = `-- kpi-retry-v1
local attempt = redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
local delay = math.min(3600000, 30000 * (2 ^ math.min(attempt - 1, 7)))
redis.call('ZADD', KEYS[1], ARGV[2] + delay, ARGV[1])
redis.call('SET', KEYS[3], ARGV[3], 'EX', 604800)
return attempt`;
const READ = `-- kpi-read-v1
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], ARGV[1], ARGV[2], 'LIMIT', ARGV[3], ARGV[4])
local rows = {}
for _, id in ipairs(ids) do
  local row = redis.call('GET', ARGV[5] .. id)
  if row then table.insert(rows, row) end
end
return rows`;
const STATUS = `-- kpi-status-v1
return {redis.call('ZCARD', KEYS[1]), redis.call('ZCARD', KEYS[2]), redis.call('GET', KEYS[3]) or ''}`;
const PRUNE = `-- kpi-prune-v1
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 500)
for _, id in ipairs(ids) do
 redis.call('ZREM', KEYS[1], id)
 redis.call('ZREM', KEYS[2], id)
 redis.call('HDEL', KEYS[3], id)
end
return #ids`;

export function validReceiverUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      /\.(logic\.azure\.com|api\.powerplatform\.com)$/i.test(url.hostname);
  } catch { return false; }
}

/** One durable, atomic record before an HTTP attempt. Delivery is at-least-once:
 * the receiver must enforce unique eventId and acknowledge AFTER list storage.
 * Only the worker lease is temporary; queued records survive worker crashes. */
export class KpiOutbox {
  constructor(private readonly redis: RedisClient, private readonly receiverUrl?: string) {}

  private atomic(script: string, keys: string[], args: string[]): Promise<unknown> {
    if (!this.redis.eval) throw new Error('KPI atomic storage is unavailable');
    return this.redis.eval(script, keys, args);
  }

  async record(event: KpiEvent): Promise<void> {
    await this.atomic(ENQUEUE, [EVENT_PREFIX + event.eventId, PENDING, ARCHIVE, 'kpi:first-active'], [
      JSON.stringify(event), event.eventId, String(RETENTION_SECONDS), String(Date.parse(event.occurredAt)),
      event.eligibility, String(event.isTester), event.userKey,
    ]);
  }

  async flush(limit = 4): Promise<{ delivered: number; failed: number; configured: boolean }> {
    if (!this.receiverUrl) return { delivered: 0, failed: 0, configured: false };
    if (!validReceiverUrl(this.receiverUrl)) throw new Error('KPI receiver must be an HTTPS Power Automate trigger');
    const receiverUrl = this.receiverUrl;
    const now = Date.now();
    const ids = await this.atomic(CLAIM, [PENDING], [String(now), String(now + 120000), String(Math.min(limit, 20))]) as string[];
    let delivered = 0;
    let failed = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        try {
          const payload = await this.redis.get(EVENT_PREFIX + id);
          if (!payload) throw new Error('expired_payload');
          const response = await fetch(receiverUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
            signal: AbortSignal.timeout(8000), redirect: 'error',
          });
          // HTTP 202 only says a flow was scheduled. Do not discard our only
          // durable copy before Create item (or duplicate lookup) actually succeeds.
          if (response.status !== 200) throw new Error(`receiver_http_${response.status}`);
          const ack = await response.json() as { accepted?: boolean; eventId?: string };
          if (ack.accepted !== true || ack.eventId !== id) throw new Error('receiver_ack_invalid');
          await this.atomic(ACK, [PENDING, ATTEMPTS], [id]);
          delivered++;
        } catch {
          failed++;
          // Never log a signed trigger URL, receiver body, user key or transcript.
          await this.atomic(RETRY, [PENDING, ATTEMPTS, 'kpi:last-failure'], [id, String(Date.now()), JSON.stringify({ at: new Date().toISOString(), code: 'receiver_delivery_failed' })]);
        }
      }
    };
    // Two bounded workers allow Microsoft enough time to commit while keeping
    // the daily 12-event sweep below the function's 60-second budget.
    await Promise.all([worker(), worker()]);
    return { delivered, failed, configured: true };
  }

  async status(): Promise<{ pending: number; retained: number; lastFailure: unknown; receiverConfigured: boolean }> {
    const values = await this.atomic(STATUS, [PENDING, ARCHIVE, 'kpi:last-failure'], []) as [number, number, string];
    return { pending: Number(values[0]), retained: Number(values[1]), lastFailure: values[2] ? JSON.parse(values[2]) : null, receiverConfigured: !!this.receiverUrl && validReceiverUrl(this.receiverUrl) };
  }

  /** Bounded export pages; callers must paginate instead of silently truncating. */
  async read(from: number, to: number, offset = 0, limit = 1000): Promise<KpiEvent[]> {
    const rows = await this.atomic(READ, [ARCHIVE], [String(from), String(to), String(offset), String(Math.min(limit, 1000)), EVENT_PREFIX]) as string[];
    return rows.map(row => JSON.parse(row) as KpiEvent);
  }

  async prune(): Promise<void> {
    await this.atomic(PRUNE, [ARCHIVE, PENDING, ATTEMPTS], [String(Date.now() - RETENTION_SECONDS * 1000)]);
  }

  /** Small identity-only index survives event retention so K5 can use ANY prior
   * collected month, not just the preceding month or the last 400 days. */
  async priorUsers(before: number): Promise<Set<string>> {
    const keys = await this.atomic('-- kpi-prior-v1\nreturn redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])', ['kpi:first-active'], [String(before - 1)]) as string[];
    return new Set(keys);
  }
}
