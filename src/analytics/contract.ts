import { createHash, createHmac, randomUUID } from 'crypto';
import type { CareyBotState, MenuOption } from '../types/state';
import type { NormalizedMessage } from '../types/platform';
import type { CoachMetadata } from '../services/resolveCoachConfig';

/** KPI records contain no transcript, username, Telegram ID or exact age. */
export const INSTRUMENT_VERSION = 'carey-kpi-v1';
export const POLICY_VERSION = 'sgt-13-30-6h-weekly-20pct-v1';
export const TIER_RUBRIC_VERSION = 'ai-estimate-v1-unvalidated';
export type Score = '1' | '2' | '3' | 'missing';
export type YesNo = 'yes' | 'no' | 'missing';
export type Tier = '1' | '2' | '3' | '4' | 'missing';
export type Question = 'readiness' | 'usefulness' | 'clarityBefore' | 'clarityAfter';
export type EventType = 'activity' | 'session_started' | 'scenario_started' |
  'checkin_reached' | 'response_recorded' | 'feedback_offered' | 'script_selected' |
  'tier_estimated' | 'referral_requested' | 'referral_delivered' | 'referral_clicked' |
  'turn_completed';

export interface KpiFact {
  eventType: EventType;
  requiresDelivery?: boolean;
  question?: Question;
  response?: Score | YesNo;
  feedbackId?: string | null;
  tier?: Tier;
}

/** Persisted in the existing encrypted six-hour session, not an extra chat engine. */
export interface CoachKpiState {
  sessionStartedAt: number;
  sessionStartObserved: boolean;
  scenarioRunId: string | null;
  scenarioStartedAt: number | null;
  scenarioTag: MenuOption | null;
  mode: 'prepare' | 'reflect' | 'missing';
  readiness: Score;
  usefulness: YesNo;
  clarityBefore: Score;
  clarityAfter: Score;
  scriptChosen: YesNo;
  checkinReached: boolean;
  pendingQuestion: Question | null;
  feedbackId: string | null;
  tier: Tier;
  maxTier: Tier;
  tierHistoryComplete: boolean;
  supportSource: 'user_requested' | 'bot_suggested' | 'missing';
  /** Cleared before every incoming turn, so old facts are never re-emitted. */
  facts: KpiFact[];
}

export interface KpiEvent {
  schemaVersion: 1;
  eventId: string;
  eventType: EventType;
  occurredAt: string;
  sourceMessageId: string | null;
  receivedAt: string;
  monthSGT: string;
  dateSGT: string;
  userKey: string;
  isTester: boolean;
  eligibility: 'eligible' | 'ineligible' | 'missing';
  sessionId: string | null;
  sessionStartedAt: string | null;
  sessionStartObserved: boolean;
  scenarioRunId: string | null;
  scenarioStartedAt: string | null;
  scenarioStartMonthSGT: string | null;
  scenarioTag: string | null;
  mode: 'prepare' | 'reflect' | 'missing';
  question: Question | 'missing';
  response: Score | YesNo;
  feedbackId: string | null;
  readiness: Score;
  usefulness: YesNo;
  clarityBefore: Score;
  clarityAfter: Score;
  scriptChosen: YesNo;
  tier: Tier;
  maxTierBeforeReferral: Tier;
  tierHistoryComplete: boolean;
  crisisDetected: boolean;
  state8Reached: boolean;
  referralId: string | null;
  referralTarget: 'insight' | 'crest' | 'missing';
  referralSource: 'user_requested' | 'bot_suggested' | 'missing';
  deliveryStatus: 'received' | 'sent' | 'maintenance' | 'failed';
  instrumentVersion: string;
  policyVersion: string;
  tierRubricVersion: string;
  model: string;
  promptVersion: string;
  promptHash: string | null;
  deploymentSha: string | null;
}

export function sgtDate(timestamp: number): string {
  return new Date(timestamp + 8 * 3600_000).toISOString().slice(0, 10);
}

export function newKpiState(timestamp: number, observed = true): CoachKpiState {
  return {
    sessionStartedAt: timestamp, sessionStartObserved: observed,
    scenarioRunId: null, scenarioStartedAt: null, scenarioTag: null, mode: 'missing',
    readiness: 'missing', usefulness: 'missing', clarityBefore: 'missing', clarityAfter: 'missing',
    scriptChosen: 'missing', checkinReached: false, pendingQuestion: null, feedbackId: null,
    tier: 'missing', maxTier: 'missing', tierHistoryComplete: observed, supportSource: 'missing', facts: [],
  };
}

/** Explicit participant request only; discussing "my team" is not opting in. */
export function explicitlyRequestsSupport(text: string): boolean {
  return /\b(?:(?:speak|talk|connect)(?:\s+\w+){0,4}\s+(?:person|counsell?or|therapist|human|staff|team)|(?:want|need) (?:a )?(?:real person|human|counsell?or|therapist))\b/i.test(text);
}

export function startScenario(kpi: CoachKpiState, scenario: MenuOption, timestamp: number): CoachKpiState {
  return {
    ...newKpiState(kpi.sessionStartedAt, kpi.sessionStartObserved),
    // Early-support history belongs to the session, not only the newest scenario.
    tier: kpi.tier, maxTier: kpi.maxTier, tierHistoryComplete: kpi.tierHistoryComplete,
    scenarioRunId: randomUUID(), scenarioStartedAt: timestamp, scenarioTag: scenario,
    facts: [...kpi.facts, { eventType: 'scenario_started' }],
  };
}

export function eligibility(age: number | null): KpiEvent['eligibility'] {
  if (age === null || !Number.isInteger(age)) return 'missing';
  return age >= 13 && age <= 30 ? 'eligible' : 'ineligible';
}

/** A keyed hash prevents enumerating Telegram's small numeric identifier space. */
export function userKey(userId: string, secret: string): string {
  if (secret.length < 32) throw new Error('KPI identity secret must have at least 32 characters');
  return createHmac('sha256', secret).update(`social-coach:telegram:${userId}`).digest('hex');
}

/** Signed, server-owned target lets human-support links work even if Redis fails. */
export function signReferral(id: string, target: 'insight' | 'crest', secret: string): string {
  return createHmac('sha256', secret).update(`carey-referral:v1:${id}:${target}`).digest('hex');
}

export function eventId(messageId: string, user: string, kind: string): string {
  return createHash('sha256').update(`social-coach:v1:${user}:${messageId}:${kind}`).digest('hex');
}

export function makeEvent(
  msg: NormalizedMessage, key: string, tester: boolean, state: CareyBotState | null,
  kind: EventType, metadata?: CoachMetadata, extras: Partial<KpiEvent> = {},
): KpiEvent {
  const kpi = state?.kpi;
  const now = Date.now();
  const timestamp = Number.isFinite(msg.timestamp) ? msg.timestamp : now;
  return {
    schemaVersion: 1, eventId: eventId(msg.messageId ?? randomUUID(), key, kind), eventType: kind,
    occurredAt: new Date(timestamp).toISOString(), sourceMessageId: msg.messageId ?? null, receivedAt: new Date(now).toISOString(),
    monthSGT: sgtDate(timestamp).slice(0, 7), dateSGT: sgtDate(timestamp), userKey: key,
    isTester: tester, eligibility: eligibility(state?.age ?? null), sessionId: state?.sessionId ?? null,
    sessionStartedAt: kpi ? new Date(kpi.sessionStartedAt).toISOString() : null,
    sessionStartObserved: kpi?.sessionStartObserved ?? false,
    scenarioRunId: kpi?.scenarioRunId ?? null,
    scenarioStartedAt: kpi?.scenarioStartedAt ? new Date(kpi.scenarioStartedAt).toISOString() : null,
    scenarioStartMonthSGT: kpi?.scenarioStartedAt ? sgtDate(kpi.scenarioStartedAt).slice(0, 7) : null,
    scenarioTag: kpi?.scenarioTag ? String(kpi.scenarioTag) : null, mode: kpi?.mode ?? 'missing',
    question: 'missing', response: 'missing', feedbackId: kpi?.feedbackId ?? null,
    readiness: kpi?.readiness ?? 'missing', usefulness: kpi?.usefulness ?? 'missing',
    clarityBefore: kpi?.clarityBefore ?? 'missing', clarityAfter: kpi?.clarityAfter ?? 'missing',
    scriptChosen: kpi?.scriptChosen ?? 'missing', tier: kpi?.tier ?? 'missing',
    maxTierBeforeReferral: kpi?.maxTier ?? 'missing', tierHistoryComplete: kpi?.tierHistoryComplete ?? false,
    crisisDetected: state?.crisisDetected === true, state8Reached: state?.conversationPhase === 'crisis',
    referralId: null, referralTarget: 'missing', referralSource: 'missing', deliveryStatus: 'received',
    instrumentVersion: INSTRUMENT_VERSION, policyVersion: POLICY_VERSION, tierRubricVersion: TIER_RUBRIC_VERSION,
    model: metadata?.model ?? 'missing', promptVersion: String(metadata?.promptVersion ?? 'missing'),
    promptHash: metadata?.promptHash ?? null, deploymentSha: metadata?.deploymentSha ?? null,
    ...extras,
  };
}
