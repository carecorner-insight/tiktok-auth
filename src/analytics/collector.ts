import { randomInt, randomUUID } from 'crypto';
import type { RedisClient } from '../lib/redis';
import type { CareyBotState } from '../types/state';
import type { NormalizedMessage } from '../types/platform';
import type { CoachMetadata } from '../services/resolveCoachConfig';
import { KpiOutbox } from './outbox';
import { makeEvent, userKey, signReferral, eligibility, ageBand, type KpiEvent, type KpiFact } from './contract';
import { INSIGHT_URL, CREST_URL } from '../config/questionnaire';

const CONTACT = `-- kpi-contact-v1
local existing = redis.call('GET', KEYS[1])
if existing then redis.call('EXPIRE', KEYS[1], 21600); return existing end
redis.call('SET', KEYS[1], ARGV[1], 'EX', 21600)
return ARGV[1]`;

export function collectionEnabled(): boolean {
  return process.env.KPI_COLLECTION_ENABLED === 'true';
}

/** Main Telegram bot only. Study callers never construct this collector. */
export class KpiCollector {
  readonly outbox: KpiOutbox;
  readonly key: string;
  readonly tester: boolean;
  metadata?: CoachMetadata;
  private contactId: string | null = null;

  constructor(private readonly redis: RedisClient, private readonly msg: NormalizedMessage) {
    this.key = userKey(msg.userId, process.env.KPI_USER_KEY_SECRET ?? '');
    this.tester = (process.env.KPI_TESTER_USER_IDS ?? '').split(',').map(id => id.trim()).includes(msg.userId);
    this.outbox = new KpiOutbox(redis, process.env.KPI_POWER_AUTOMATE_WEBHOOK_URL);
  }

  /** Contacts count even when AI is unavailable. The separate contact clock
   * expires after six hours of inactivity, including maintenance traffic. */
  async activity(age: number | null, existing?: CareyBotState | null): Promise<{ sessionId: string; startedAt: number; observed: boolean; isNew: boolean }> {
    if (!this.redis.eval) throw new Error('KPI atomic storage is unavailable');
    const proposed = {
      sessionId: existing?.sessionId ?? randomUUID(),
      startedAt: existing?.kpi?.sessionStartedAt ?? this.msg.timestamp,
      observed: existing?.kpi?.sessionStartObserved ?? !existing,
    };
    const raw = await this.redis.eval(CONTACT, [`kpi:contact:${this.key}`], [JSON.stringify(proposed)]) as string;
    const contact = JSON.parse(raw) as typeof proposed;
    this.contactId = contact.sessionId;
    const base = makeEvent(this.msg, this.key, this.tester, null, 'activity', undefined, {
      // Activity is recorded before loading the graph's session. Use the stored
      // age here as well, including for returning adults and maintenance turns.
      eligibility: eligibility(age), ageBand: ageBand(age),
      sessionId: contact.sessionId, sessionStartedAt: new Date(contact.startedAt).toISOString(), sessionStartObserved: contact.observed,
    });
    await this.outbox.record(base);
    const isNew = contact.sessionId === proposed.sessionId;
    if (isNew && contact.observed) await this.outbox.record({ ...base, eventType: 'session_started', eventId: `${contact.sessionId}:start` });
    return { ...contact, isNew };
  }

  async claimFeedback(userId: string): Promise<'usefulness' | 'clarity' | null> {
    if (this.tester) return null;
    const key = userKey(userId, process.env.KPI_USER_KEY_SECRET ?? '');
    const claimed = await this.redis.set(`kpi:feedback-cooldown:${key}`, '1', { nx: true, ex: 7 * 86400 });
    if (!claimed) return null;
    // A failed send still reserves the cooldown: less burden is preferable to
    // repeatedly offering feedback after an ambiguous transport failure.
    return randomInt(5) === 0 ? 'clarity' : 'usefulness';
  }

  async scenarioStarted(state: CareyBotState): Promise<void> {
    await this.safely(() => this.outbox.record(makeEvent(this.msg, this.key, this.tester, state, 'scenario_started', this.metadata, { eventId: `${state.kpi!.scenarioRunId}:start` })));
  }

  async responseRecorded(state: CareyBotState, fact: KpiFact): Promise<void> {
    await this.safely(() => this.outbox.record(makeEvent(this.msg, this.key, this.tester, state, 'response_recorded', this.metadata, {
      eventId: `${makeEvent(this.msg, this.key, this.tester, state, 'response_recorded').eventId}:0`,
      question: fact.question ?? 'missing', response: fact.response ?? 'missing', feedbackId: fact.feedbackId ?? null,
    })));
  }

  async completed(state: CareyBotState, delivery: KpiEvent['deliveryStatus'], metadata?: CoachMetadata): Promise<void> {
    if (state.sessionId && this.contactId && state.sessionId !== this.contactId && state.kpi?.sessionStartObserved) {
      // An explicit /restart creates a new session even within six hours.
      await this.outbox.record(makeEvent(this.msg, this.key, this.tester, state, 'session_started', metadata, { eventId: `${state.sessionId}:start`, deliveryStatus: delivery }));
      await this.redis.set(`kpi:contact:${this.key}`, JSON.stringify({ sessionId: state.sessionId, startedAt: state.kpi.sessionStartedAt, observed: true }), { ex: 21600 });
      this.contactId = state.sessionId;
    }
    await this.outbox.record(makeEvent(this.msg, this.key, this.tester, state, 'turn_completed', metadata, { deliveryStatus: delivery }));
    for (const [index, fact] of (state.kpi?.facts ?? []).entries()) {
      if (fact.requiresDelivery && delivery !== 'sent') continue;
      await this.outbox.record(makeEvent(this.msg, this.key, this.tester, state, fact.eventType, metadata, {
        eventId: fact.eventType === 'scenario_started' ? `${state.kpi!.scenarioRunId}:start` : `${makeEvent(this.msg, this.key, this.tester, state, fact.eventType).eventId}:${index}`,
        question: fact.question ?? 'missing', response: fact.response ?? 'missing',
        feedbackId: fact.feedbackId !== undefined ? fact.feedbackId : state.kpi?.feedbackId ?? null,
        tier: fact.tier ?? state.kpi?.tier ?? 'missing', deliveryStatus: delivery,
      }));
    }
  }

  /** Only server-owned referral destinations are wrapped; never an arbitrary
   * URL from the model or request. A link click is not a Salesforce conversion. */
  async referral(state: CareyBotState, reply: string): Promise<{ reply: string; event: KpiEvent } | null> {
    const target = reply.includes(INSIGHT_URL) ? 'insight' : reply.includes(CREST_URL) ? 'crest' : null;
    if (!target) return null;
    const destination = target === 'insight' ? INSIGHT_URL : CREST_URL;
    const id = randomUUID().replace(/-/g, '');
    const source = state.kpi?.supportSource ?? 'missing';
    const event = makeEvent(this.msg, this.key, this.tester, state, 'referral_delivered', this.metadata, {
      referralId: id, referralTarget: target, referralSource: source, deliveryStatus: 'sent',
    });
    const base = process.env.KPI_PUBLIC_BASE_URL;
    if (!base || !/^https:\/\/[a-z0-9.-]+\/?$/i.test(base)) return { reply, event };
    await this.redis.set(`kpi:referral:${id}`, JSON.stringify({ destination, event }), { ex: 90 * 86400 });
    const signature = signReferral(id, target, process.env.KPI_USER_KEY_SECRET ?? '');
    return { reply: reply.replace(destination, `${base.replace(/\/$/, '')}/api/bot-control?ref=${id}&target=${target}&sig=${signature}`), event };
  }

  /** Analytics loss is visible but does not turn an otherwise working coach off. */
  async safely<T>(action: () => Promise<T>): Promise<T | undefined> {
    try { return await action(); }
    catch {
      console.error('[kpi] durable collection failed; this turn may have a data gap');
      try { await this.redis.set('kpi:last-failure', JSON.stringify({ at: new Date().toISOString(), code: 'durable_collection_failed' }), { ex: 7 * 86400 }); } catch { /* storage itself is unavailable */ }
    }
  }
}
