import { parseMeasurement, applyMeasurement, parseAnswer, makeFeedbackNode, KPI_PROMPT_CONTRACT } from '../../analytics/coachMeasurement';
import { newKpiState, startScenario, userKey, makeEvent, eligibility, sgtDate } from '../../analytics/contract';
import { makeState, makeNormalizedMessage } from '../mocks';
import { buildGraph } from '../../graph/graph';
import { EMERGENCY_MESSAGE } from '../../config/questionnaire';
import { resolveCoachConfig } from '../../services/resolveCoachConfig';
import { memoryRedis } from '../mocks/controlRedis';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const original = { ...process.env };
beforeEach(() => { process.env.SCENARIO_MENU = 'true'; process.env.AUTH_ENABLED = 'false'; process.env.CRISIS_STATIC_FIRST = 'true'; });
afterEach(() => { process.env = { ...original }; });

const metadata = { mode: 'prepare', tier: '1', checkin: true, scriptChosen: 'yes' };
const reply = (data: unknown) => `Try saying hello. <carey-kpi>${JSON.stringify(data)}</carey-kpi>`;

it('allows only declared metadata and strips the hidden block', () => {
  expect(parseMeasurement(reply(metadata))).toEqual({ reply: 'Try saying hello.', measurement: metadata });
});
it.each([null, [], { ...metadata, tier: '0' }, { ...metadata, checkin: 'true' }, { ...metadata, mode: 'future' }, { ...metadata, scriptChosen: true }])('rejects invalid metadata %j without exposing it', data => {
  expect(parseMeasurement(reply(data))).toEqual({ reply: 'Try saying hello.', measurement: null });
});
it.each(['Hi <carey-kpi>not json</carey-kpi>', 'Hi <carey-kpi>{"unfinished":true', 'Hi <carey-kpi>' + 'x'.repeat(1200) + '</carey-kpi>'])('removes malformed metadata %s', raw => {
  expect(parseMeasurement(raw)).toEqual({ reply: 'Hi', measurement: null });
});
it('rejects multiple blocks and strips all of them', () => {
  expect(parseMeasurement(reply(metadata) + reply(metadata)).measurement).toBeNull();
  expect(parseMeasurement(reply(metadata) + reply(metadata)).reply).not.toContain('carey-kpi');
});
it('preserves crisis tags outside measurement metadata', () => {
  expect(parseMeasurement('[CRISIS]' + reply(metadata)).reply).toContain('[CRISIS]');
});
it('missing tier remains unknown and invalidates a complete early-support history', () => {
  const state = applyMeasurement(newKpiState(1), null, true);
  expect(state.tierHistoryComplete).toBe(false);
  expect(state.maxTier).toBe('missing');
});
it('emits one check-in and observes script adoption, never an inferred rating', () => {
  const first = applyMeasurement(newKpiState(1), metadata as any, true);
  const second = applyMeasurement({ ...first, facts: [] }, metadata as any, true);
  expect(first.readiness).toBe('missing');
  expect(first.pendingQuestion).toBe('readiness');
  expect(first.facts.filter(f => f.eventType === 'checkin_reached')).toHaveLength(1);
  expect(second.facts.filter(f => f.eventType === 'checkin_reached')).toHaveLength(0);
});
it('retains the maximum tier across scenarios, but resets outcome answers', () => {
  const state = startScenario({ ...newKpiState(1), maxTier: '3', readiness: '2' }, 2, 2);
  expect(state.maxTier).toBe('3');
  expect(state.readiness).toBe('missing');
});
it.each(['2/3', '0', '4', '-1', '2 because I want to die', 'yes', 'sounds good'])('does not coerce ambiguous readiness %s', text => {
  expect(parseAnswer('readiness', text)).toBeNull();
});
it.each(['skip', 'missing', 'prefer not to say'])('uses missing for an explicit skip %s', text => {
  expect(parseAnswer('readiness', text)).toBe('missing');
});
it.each([['1', '1'], ['2.', '2'], ['3', '3']])('parses a bound scale answer %s', (input, expected) => {
  expect(parseAnswer('readiness', input)).toBe(expected);
});
it('records a legitimate no separately from missing', () => expect(parseAnswer('usefulness', 'no')).toBe('no'));
it('the numerical age cohort is 13–30 inclusive and unknown remains missing', () => {
  expect([null, 12, 13, 25, 30, 31].map(eligibility)).toEqual(['missing', 'ineligible', 'eligible', 'eligible', 'eligible', 'ineligible']);
});
it('uses SGT dates at the UTC month boundary', () => expect(sgtDate(Date.parse('2026-09-30T16:00:00Z'))).toBe('2026-10-01'));
it('event envelopes contain no direct ID, age, username or transcript', () => {
  const msg = makeNormalizedMessage({ messageId: '123', userId: '123456789', username: 'PRIVATE_NAME', text: 'PRIVATE_MESSAGE' });
  const key = userKey(msg.userId, 'a'.repeat(64));
  const event = makeEvent(msg, key, false, makeState({ age: 20 }), 'activity');
  const json = JSON.stringify(event);
  expect(json).not.toMatch(/123456789|PRIVATE_NAME|PRIVATE_MESSAGE|"age"/);
  expect(key).toHaveLength(64);
  expect(makeEvent(msg, key, false, null, 'activity').eventId).toBe(event.eventId);
});
it('identity keys are domain-separated, stable and require a real secret', () => {
  expect(userKey('123', 'a'.repeat(32))).not.toBe(userKey('123', 'b'.repeat(32)));
  expect(() => userKey('123', 'short')).toThrow();
});
it('the delivered event and Power Automate schema have exactly matching fields and choices', () => {
  const schema = JSON.parse(readFileSync(resolve(__dirname, '../../../docs/kpi-trigger.schema.json'), 'utf8'));
  const event = makeEvent(makeNormalizedMessage({ messageId: '100' }), userKey('123', 'a'.repeat(64)), true, makeState(), 'activity');
  expect(Object.keys(event).sort()).toEqual([...schema.required].sort());
  expect(Object.keys(event).sort()).toEqual(Object.keys(schema.properties).sort());
  for (const [key, value] of Object.entries(event)) {
    const property = schema.properties[key];
    if (property.enum) expect(property.enum).toContain(value);
    if (property.pattern && typeof value === 'string') expect(value).toMatch(new RegExp(property.pattern));
    if (property.maxLength && typeof value === 'string') expect(value.length).toBeLessThanOrEqual(property.maxLength);
  }
});
it.each(['usefulness', 'clarity'] as const)('offers only one sampled feedback instrument: %s', async offer => {
  const scheduler = { claimFeedback: jest.fn(async () => offer) };
  const kpi = { ...newKpiState(1), pendingQuestion: 'readiness' as const };
  const result = await makeFeedbackNode(scheduler)(makeState({ age: 20, sessionId: 'session', kpi, messages: [{ role: 'user', content: '2', timestamp: 2 }] }));
  expect(result.kpi!.pendingQuestion).toBe(offer === 'clarity' ? 'clarityBefore' : 'usefulness');
  expect(scheduler.claimFeedback).toHaveBeenCalledTimes(1);
  expect(result.kpi!.facts[0].response).toBe('2');
});
it('a skipped readiness answer does not stack a new survey', async () => {
  const scheduler = { claimFeedback: jest.fn(async () => 'usefulness' as const) };
  const result = await makeFeedbackNode(scheduler)(makeState({ age: 20, kpi: { ...newKpiState(1), pendingQuestion: 'readiness' }, messages: [{ role: 'user', content: 'skip', timestamp: 2 }] }));
  expect(result.kpi!.readiness).toBe('missing');
  expect(scheduler.claimFeedback).not.toHaveBeenCalled();
});
it('clarity uses identical before/after anchors and a paired instrument ID', async () => {
  const result = await makeFeedbackNode({ claimFeedback: async () => null })(makeState({ kpi: { ...newKpiState(1), pendingQuestion: 'clarityBefore', feedbackId: 'pair' }, messages: [{ role: 'user', content: '1', timestamp: 2 }] }));
  expect(result.kpi!.pendingQuestion).toBe('clarityAfter');
  expect(result.pendingResponse).toContain('1. Not clear\n2. Somewhat clear\n3. Very clear');
  expect(result.kpi!.feedbackId).toBe('pair');
});

function graphHarness() {
  const coach = { chat: jest.fn(async () => ({ reply: reply(metadata), chatId: 'direct:test' })) };
  const classifier = { chat: jest.fn(async () => ({ reply: 'HUMAN', chatId: 'test' })) };
  const ai = { chat: jest.fn(async () => ({ reply: 'unused', chatId: 'test' })) };
  const graph = buildGraph({ whitelist: { isAuthorized: async () => true }, session: { save: async () => {}, clear: async () => {} }, typing: { sendTypingIndicator: async () => {} }, socialCoach: coach, intentLLM: classifier, aiBots: ai, menuMode: 'intent', kpi: { claimFeedback: async () => null } });
  const turn = (text: string, overrides = {}) => graph.invoke(makeState({ age: 20, conversationPhase: 'option', selectedOption: 2, kpi: { ...newKpiState(1), pendingQuestion: 'readiness' }, ...overrides, messages: [{ role: 'user', content: text, timestamp: 2 }] }));
  return { turn, coach, classifier, ai };
}
it('a bound readiness number does not call any model or select a new scenario', async () => {
  const h = graphHarness(); const result = await h.turn('2');
  expect(result.kpi!.readiness).toBe('2'); expect(result.selectedOption).toBe(2);
  expect(h.coach.chat).not.toHaveBeenCalled(); expect(h.classifier.chat).not.toHaveBeenCalled();
});
it('crisis interrupts a pending question without a survey or model call', async () => {
  const h = graphHarness(); const result = await h.turn('I want to kill myself');
  expect(result.pendingResponse).toBe(EMERGENCY_MESSAGE); expect(result.kpi!.readiness).toBe('missing');
  expect(h.coach.chat).not.toHaveBeenCalled(); expect(h.ai.chat).not.toHaveBeenCalled();
});
it('asking for a counsellor interrupts pending feedback', async () => {
  const h = graphHarness(); const result = await h.turn('I want to talk to a counsellor');
  expect(result.pendingResponse).toContain('reach them here'); expect(h.coach.chat).not.toHaveBeenCalled();
});
it('legacy/study calls keep the original prompt; main collection adds its own contract', async () => {
  process.env.DYNAMIC_COACH_PROMPT = 'false'; process.env.COACH_PROVIDER = 'direct';
  const store = memoryRedis();
  const legacy = await resolveCoachConfig(store.client);
  const main = await resolveCoachConfig(store.client, undefined, true);
  expect(legacy.systemPrompt).not.toContain('INTERNAL MEASUREMENT');
  expect(main.systemPrompt).toBe(legacy.systemPrompt + KPI_PROMPT_CONTRACT);
  expect(main.metadata.promptHash).not.toBe(legacy.metadata.promptHash);
});
