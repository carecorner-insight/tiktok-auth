import { computeMonthlyReport } from '../../analytics/report';
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
