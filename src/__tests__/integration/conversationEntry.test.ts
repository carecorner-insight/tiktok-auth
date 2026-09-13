import { DirectLLMClient } from '@/services/directLLMClient';
import { makeSocialCoachNode } from '@/nodes/socialCoachNode';
import { makeFreeTextNode } from '@/nodes/freeTextNode';
import { makeState } from '@/__tests__/mocks';
import { restartNode } from '@/nodes/restartNode';

const typing = { sendTypingIndicator: async () => {} };
const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });

it.each([null, 'direct:existing'])('assembles real direct requests without losing/duplicating answers (%s)', async chatId => {
  process.env.SCENARIO_MENU = 'true';
  const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
  const client = new DirectLLMClient({ apiKey: 'synthetic', baseURL: 'https://example.invalid', model: 'fake', systemPrompt: 'Coach' },
    { chat: { completions: { create } } });
  const state = makeState({ conversationPhase: 'option', selectedOption: 2, aiBotChatId: chatId,
    messages: [{ role: 'assistant', content: 'Which approach?', timestamp: 1 },
      { role: 'user', content: '3', timestamp: 2 }],
  });
  delete state.menuSelection; // a pre-deployment Redis session
  await makeSocialCoachNode(client, typing)(state);
  const messages = create.mock.calls[0][0].messages;
  expect(messages.slice(1)).toEqual([{ role: 'assistant', content: 'Which approach?' }, { role: 'user', content: '3' }]);
  expect(messages[0].content).not.toMatch(/start of a new|open directly/);
});

it('consumes the explicit selection marker once', async () => {
  process.env.SCENARIO_MENU = 'true';
  const chat = jest.fn().mockResolvedValue({ reply: 'ok', chatId: 'c1' });
  const node = makeSocialCoachNode({ chat }, typing);
  const state = makeState({ selectedOption: 4, menuSelection: true,
    messages: [{ role: 'user', content: '4', timestamp: 1 }] });
  const result = await node(state);
  expect(result.menuSelection).toBe(false);
  await node({ ...state, ...result, messages: [...state.messages, { role: 'user', content: '1', timestamp: 2 }] });
  expect(chat.mock.calls[0][2]).toContain('Relationships');
  expect(chat.mock.calls[1][2]).toBeUndefined();
});

it('uses handoff context without reopening a scenario', async () => {
  process.env.SCENARIO_MENU = 'false';
  const chat = jest.fn().mockResolvedValue({ reply: 'ok', chatId: 'c1' });
  const result = await makeSocialCoachNode({ chat }, typing)(makeState({ selectedOption: 1,
    aiBotChatId: 'aibots:talk', pendingHandoff: 'socialCoach',
    messages: [{ role: 'assistant', content: 'We discussed the group project.', timestamp: 1 },
      { role: 'user', content: 'yes', timestamp: 2 }],
  }));
  expect(chat.mock.calls[0][0]).toBeNull();
  expect(chat.mock.calls[0][1]).toBe('yes');
  expect(chat.mock.calls[0][2]).toContain('continue');
  expect(chat.mock.calls[0][3]).toHaveLength(1);
  expect(result.pendingHandoff).toBeNull();
  expect(result.selectedOption).toBe(2);
});

it('also preserves a local digit in the legacy talk client during recovery', async () => {
  const chat = jest.fn().mockResolvedValue({ reply: 'ok', chatId: 'c1' });
  await makeFreeTextNode({ chat }, typing, 'numbered')(makeState({ selectedOption: 1,
    messages: [{ role: 'assistant', content: 'Pick 1 or 2', timestamp: 1 }, { role: 'user', content: '2', timestamp: 2 }],
  }));
  expect(chat.mock.calls[0][1]).toBe('2');
  expect(chat.mock.calls[0][2]).toContain('Continue');
});

it('restart clears all transient entry/referral markers', () => {
  const result = restartNode(makeState({ menuSelection: true, justSwitchedLane: true,
    pendingHandoff: 'socialCoach', referralRequested: true, awaitingReferralAge: true, ageAsked: true }));
  expect(result).toMatchObject({ menuSelection: false, justSwitchedLane: false, pendingHandoff: null,
    referralRequested: false, awaitingReferralAge: false, ageAsked: false });
});
