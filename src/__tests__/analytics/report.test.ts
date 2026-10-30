import { computeMonthlyReport } from '../../analytics/report';
import { monthlyListItem, monthlyMetrics } from '../../analytics/monthlyMetrics';
import { makeEvent, newKpiState, type KpiEvent } from '../../analytics/contract';
import { makeState, makeNormalizedMessage } from '../mocks';

let sequence = 0;
function event(type: KpiEvent['eventType'], key: string, at = '2026-09-01T01:00:00Z', extras: Partial<KpiEvent> = {}): KpiEvent {
  const timestamp = Date.parse(at);
  return makeEvent(makeNormalizedMessage({ timestamp, messageId: String(sequence++) }), key, false,
    makeState({ age: 20, sessionId: 's-' + key, kpi: newKpiState(timestamp) }), type, undefined,
    { receivedAt: at, ...extras });
}
const asOf = Date.parse('2026-10-10T00:00:00Z');

it('uses unique eligible contacts, latest VALID rating per user, and excludes testers', () => {
  const events = [event('activity', 'a'), event('activity', 'a'), event('activity', 'b'), event('activity', 'unknown', undefined, { eligibility: 'missing' }),
    event('activity', 'tester', undefined, { isTester: true }),
    event('response_recorded', 'a', '2026-09-01T02:00:00Z', { question: 'usefulness', response: 'no' }),
    event('response_recorded', 'a', '2026-09-02T02:00:00Z', { question: 'usefulness', response: 'yes' }),
    event('response_recorded', 'a', '2026-09-03T02:00:00Z', { question: 'usefulness', response: 'missing' }),
    event('response_recorded', 'tester', undefined, { question: 'usefulness', response: 'yes', isTester: true })];
  const report = computeMonthlyReport(events, '2026-09', asOf);
  expect(report.K4_monthlyActiveUsers).toBe(2);
  expect(report.K1_usefulness).toEqual({ numerator: 1, denominator: 1, percent: 100 });
  expect(report.dataQuality.unknownAgeContacts).toBe(1);
});
it('a missing-age greeting becomes eligible only when age is supplied in the same month', () => {
  const events = [event('activity', 'a', undefined, { eligibility: 'missing' }), event('turn_completed', 'a')];
  expect(computeMonthlyReport(events, '2026-09', asOf).K4_monthlyActiveUsers).toBe(1);
});
it('age bands retain other cohorts without expanding the default 13–30 report', () => {
  const events = [
    event('activity', 'youth', undefined, { ageBand: '18-25' }),
    event('activity', 'younger', undefined, { ageBand: 'under-13', eligibility: 'ineligible' }),
    event('activity', 'adult', undefined, { ageBand: '41-50', eligibility: 'ineligible' }),
    event('activity', 'unknown', undefined, { ageBand: 'missing', eligibility: 'missing' }),
  ];

  const report = computeMonthlyReport(events, '2026-09', asOf);

  expect(report.K4_monthlyActiveUsers).toBe(1);
  expect(report.dataQuality.unknownAgeContacts).toBe(1);
  expect(report.dataQuality.retainedEvents).toBe(4);
});
it('duplicate delivery IDs and repeated snapshots cannot inflate ratings', () => {
  const rating = event('response_recorded', 'a', undefined, { question: 'usefulness', response: 'yes' });
  const report = computeMonthlyReport([event('activity', 'a'), rating, rating, event('turn_completed', 'a', undefined, { usefulness: 'yes' })], '2026-09', asOf);
  expect(report.K1_usefulness.denominator).toBe(1);
});
it('same-second ratings use Telegram update order, not random event hash order', () => {
  const events = [event('activity', 'a'),
    event('response_recorded', 'a', undefined, { eventId: 'z', sourceMessageId: '100', question: 'usefulness', response: 'no' }),
    event('response_recorded', 'a', undefined, { eventId: 'a', sourceMessageId: '101', question: 'usefulness', response: 'yes' })];
  expect(computeMonthlyReport(events, '2026-09', asOf).K1_usefulness.percent).toBe(100);
});
it('late completion revises the START month; readiness answer is not required for completion', () => {
  const run = { scenarioRunId: 'run', scenarioStartedAt: '2026-09-30T15:00:00Z', scenarioStartMonthSGT: '2026-09', scenarioTag: '2' };
  const start = event('scenario_started', 'a', '2026-09-30T15:00:00Z', run);
  const completed = event('checkin_reached', 'a', '2026-09-30T16:00:00Z', { ...run, deliveryStatus: 'sent' });
  const events = [event('activity', 'a', '2026-09-30T15:00:00Z'), start, completed];
  const before = computeMonthlyReport(events, '2026-09', Date.parse('2026-09-30T15:30:00Z'));
  const after = computeMonthlyReport(events, '2026-09', asOf);
  expect(before.K2a_scenarioCompletion.numerator).toBe(0);
  expect(after.K2a_scenarioCompletion).toEqual({ numerator: 1, denominator: 1, percent: 100 });
  expect(after.readinessCoverage.percent).toBe(0);
  expect(after.revision).not.toBe(before.revision);
  expect(computeMonthlyReport(events, '2026-10', asOf).K2a_scenarioCompletion.denominator).toBe(0);
});
it('an undelivered check-in is not completed', () => {
  const run = { scenarioRunId: 'run', scenarioStartMonthSGT: '2026-09' };
  const report = computeMonthlyReport([event('activity', 'a'), event('scenario_started', 'a', undefined, run), event('checkin_reached', 'a', undefined, { ...run, deliveryStatus: 'failed' })], '2026-09', asOf);
  expect(report.K2a_scenarioCompletion.numerator).toBe(0);
});
it('K3 uses distinct SGT SESSION START dates, not messages spanning midnight', () => {
  const events = [event('activity', 'a'), event('activity', 'b'),
    event('session_started', 'a', '2026-09-01T15:00:00Z', { sessionStartedAt: '2026-09-01T15:00:00Z' }),
    event('session_started', 'a', '2026-09-02T15:00:00Z', { sessionStartedAt: '2026-09-02T15:00:00Z' }),
    event('session_started', 'b', '2026-09-01T15:00:00Z', { sessionStartedAt: '2026-09-01T15:00:00Z' }),
    event('activity', 'b', '2026-09-01T16:01:00Z')];
  expect(computeMonthlyReport(events, '2026-09', asOf).K3_twoSessionStartDays).toEqual({ numerator: 1, denominator: 2, percent: 50 });
});
it('K5 includes ANY prior collected month, including expired event history through the identity index', () => {
  const events = [event('activity', 'a'), event('activity', 'b')];
  expect(computeMonthlyReport(events, '2026-09', asOf, new Set(['a'])).K5_anyPriorMonthReturners.percent).toBe(50);
});
it('retrospective clarity pairs cannot be assembled across different offers', () => {
  const events = [event('activity', 'a'),
    event('response_recorded', 'a', undefined, { question: 'clarityBefore', response: '1', feedbackId: 'x' }),
    event('response_recorded', 'a', undefined, { question: 'clarityAfter', response: '3', feedbackId: 'y' })];
  expect(computeMonthlyReport(events, '2026-09', asOf).retrospectiveClarity.denominator).toBe(0);
});
it('matching clarity pairs report a valid increase without calling it causal', () => {
  const events = [event('activity', 'a'),
    event('response_recorded', 'a', undefined, { question: 'clarityBefore', response: '1', feedbackId: 'x' }),
    event('response_recorded', 'a', undefined, { question: 'clarityAfter', response: '2', feedbackId: 'x' })];
  expect(computeMonthlyReport(events, '2026-09', asOf).retrospectiveClarity.percent).toBe(100);
});
it('later escalation cannot retroactively change early-support classification', () => {
  const events = [event('activity', 'a'), event('referral_delivered', 'a', undefined, { deliveryStatus: 'sent', maxTierBeforeReferral: '2', tierHistoryComplete: true }),
    event('tier_estimated', 'a', '2026-09-02T00:00:00Z', { tier: '4' })];
  expect(computeMonthlyReport(events, '2026-09', asOf).earlySupport.percent).toBe(100);
});
it('missing or incomplete prior tier history never means low risk', () => {
  const events = [event('activity', 'a'), event('referral_delivered', 'a', undefined, { deliveryStatus: 'sent', maxTierBeforeReferral: '1', tierHistoryComplete: false })];
  const report = computeMonthlyReport(events, '2026-09', asOf);
  expect(report.earlySupport.percent).toBeNull(); expect(report.support.missingTierHistory).toBe(1);
});
it('crisis flag, tier 3/4 estimates and State 8 are separate counts', () => {
  const events = [event('activity', 'a'), event('tier_estimated', 'a', undefined, { tier: '3', crisisDetected: false }), event('turn_completed', 'a', undefined, { crisisDetected: true, state8Reached: true, deliveryStatus: 'sent' })];
  expect(computeMonthlyReport(events, '2026-09', asOf).distress).toMatchObject({ tier3Sessions: 1, tier4Sessions: 0, state8Sessions: 1 });
});
it('zero denominators remain not available, not misleading zero percent', () => {
  expect(computeMonthlyReport([], '2026-09', asOf).K1_usefulness.percent).toBeNull();
});
it('does not invent Salesforce conversions from link offers or clicks', () => {
  expect(computeMonthlyReport([], '2026-09', asOf).K6_conversion.status).toBe('deferred_salesforce_matching');
});
it('validates the requested month', () => expect(() => computeMonthlyReport([], '2026-13')).toThrow());

it('derives answered-only readiness without changing completion or the existing denominator', () => {
  const events = [event('activity', 'a')];
  for (const id of ['a', 'b', 'c']) {
    const run = { scenarioRunId: id, scenarioStartMonthSGT: '2026-09' };
    events.push(event('scenario_started', 'a', undefined, run), event('checkin_reached', 'a', undefined, { ...run, deliveryStatus: 'sent' }));
  }
  events.push(event('response_recorded', 'a', undefined, { scenarioRunId: 'a', question: 'readiness', response: '3' }),
    event('response_recorded', 'a', undefined, { scenarioRunId: 'b', question: 'readiness', response: '1' }),
    event('response_recorded', 'a', '2026-10-01T00:00:00Z', { scenarioRunId: 'a', question: 'readiness', response: 'missing' }));
  const report = computeMonthlyReport(events, '2026-09', asOf);
  expect(report.derived.readinessAmongRespondents).toEqual({ numerator: 1, denominator: 2, percent: 50 });
  expect(report.readiness.denominator).toBe(3);
  expect(report.readinessCoverage.percent).toBe(66.67);
});

it('uses each user’s latest complete clarity pair and never joins different users', () => {
  const events = [event('activity', 'a'), event('activity', 'b')];
  const addPair = (user: string, feedbackId: string, before: '1' | '3', after: '1' | '3', at: string) => events.push(
    event('response_recorded', user, at, { feedbackId, question: 'clarityBefore', response: before }),
    event('response_recorded', user, at, { feedbackId, question: 'clarityAfter', response: after }));
  addPair('a', 'first', '1', '3', '2026-09-01T01:00:00Z');
  addPair('a', 'latest', '3', '1', '2026-09-02T01:00:00Z');
  addPair('b', 'other', '1', '3', '2026-09-03T01:00:00Z');
  events.push(event('response_recorded', 'a', undefined, { feedbackId: 'bad-reused-id', question: 'clarityBefore', response: '1' }),
    event('response_recorded', 'b', undefined, { feedbackId: 'bad-reused-id', question: 'clarityAfter', response: '3' }));
  const report = computeMonthlyReport(events, '2026-09', asOf);
  expect(report.retrospectiveClarity).toEqual({ numerator: 2, denominator: 3, percent: 66.67 });
  expect(report.derived.clarityByUser).toEqual({ numerator: 1, denominator: 2, percent: 50 });
});

it('uses K5 returners as the transition denominator and requires monthly activity', () => {
  const events = [event('activity', 'a'), event('activity', 'b'), event('activity', 'c')];
  for (const key of ['a', 'c', 'no-activity']) events.push(event('scenario_started', key, undefined,
    { scenarioRunId: key, scenarioTag: '1', scenarioStartMonthSGT: '2026-09' }));
  const report = computeMonthlyReport(events, '2026-09', asOf, new Set(['a', 'b', 'no-activity']));
  expect(report.derived.transitionAmongReturners).toEqual({ numerator: 1, denominator: 2, percent: 50 });
});

it('counts referral users once, excluding failed sends, suggestions and users outside the active cohort', () => {
  const referral = { deliveryStatus: 'sent' as const, referralSource: 'user_requested' as const };
  const events = [event('activity', 'a'), event('activity', 'b'), event('activity', 'c'),
    event('referral_delivered', 'a', undefined, referral), event('referral_delivered', 'a', undefined, referral),
    event('referral_delivered', 'b', undefined, { ...referral, referralSource: 'bot_suggested' }),
    event('referral_delivered', 'c', undefined, { ...referral, deliveryStatus: 'failed' }),
    event('referral_clicked', 'a'), event('referral_clicked', 'a'), event('referral_clicked', 'outside')];
  const report = computeMonthlyReport(events, '2026-09', asOf);
  expect(report.derived.requestedReferralUserRate).toEqual({ numerator: 1, denominator: 3, percent: 33.33 });
  expect(report.derived.observedReferralAccessUserRate).toEqual({ numerator: 1, denominator: 3, percent: 33.33 });
});

it('separates observed early recipients from unresolved users, without treating known high tiers as unresolved', () => {
  const events = ['a', 'b', 'c', 'd'].map(key => event('activity', key));
  const low = { deliveryStatus: 'sent' as const, tierHistoryComplete: true, maxTierBeforeReferral: '2' as const };
  events.push(event('referral_delivered', 'a', undefined, low),
    event('referral_delivered', 'a', undefined, { ...low, tierHistoryComplete: false }),
    event('referral_delivered', 'b', undefined, { ...low, tierHistoryComplete: false }),
    event('referral_delivered', 'c', undefined, { ...low, tierHistoryComplete: false, maxTierBeforeReferral: '3' }),
    event('referral_delivered', 'd', undefined, low), event('tier_estimated', 'd', '2026-09-03T01:00:00Z', { tier: '4' }));
  const report = computeMonthlyReport(events, '2026-09', asOf);
  expect(report.derived.earlyReferralUserRate).toEqual({ numerator: 2, denominator: 4, percent: 50 });
  expect(report.derived.earlyReferralUnresolvedUsers).toBe(1);
});

it('revises historical-user results when the first-active index changes', () => {
  const events = [event('activity', 'a')];
  const before = computeMonthlyReport(events, '2026-09', asOf);
  const after = computeMonthlyReport(events, '2026-09', asOf, new Set(['a']));
  expect(after.revision).not.toBe(before.revision);
});

it('publishes one stable monthly List item with aggregate metrics, explicit unavailable values and no user keys', () => {
  const report = computeMonthlyReport([event('activity', 'private-participant-key')], '2026-09', asOf);
  const metrics = monthlyMetrics(report);
  const health = { collectionEnabled: true, pendingEvents: 2, receiverConfigured: true };
  const item = monthlyListItem(report, metrics, health);
  expect(item).toMatchObject({ eventId: 'kpi-report:2026-09', eventType: 'monthly_report', monthSGT: '2026-09' });
  expect(JSON.parse(item.eventJson).metrics).toEqual(metrics);
  expect(JSON.parse(item.eventJson)).toMatchObject(health);
  expect(metrics.find(row => row.metricCode === 'K1_usefulness')).toMatchObject({ value: null, status: 'no_denominator' });
  expect(metrics.find(row => row.metricCode === 'K6_conversion')).toMatchObject({ value: null, numerator: null, status: 'not_available' });
  expect(metrics.find(row => row.metricCode === 'K4_monthlyActiveUsers')).toMatchObject({ value: 1, unit: 'count' });
  expect(new Set(metrics.map(row => row.metricCode)).size).toBe(metrics.length);
  expect(item.eventJson).not.toContain('private-participant-key');
  expect(item.eventJson).not.toContain('userKey');
  expect(item.eventJson.length).toBeLessThan(63000);
  const later = computeMonthlyReport([], '2026-09', asOf + 1000);
  expect(monthlyListItem(later, monthlyMetrics(later), health).eventId).toBe(item.eventId);
});
