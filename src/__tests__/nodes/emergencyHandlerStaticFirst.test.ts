import { makeEmergencyHandler } from '@/nodes/emergencyHandler';
import { EMERGENCY_MESSAGE } from '@/config/questionnaire';
import { makeState } from '@/__tests__/mocks';

// F3 — on the pivot build the FIRST crisis turn must be the exact,
// clinically-approved wording with no generative model involved. Follow-up
// turns inside the crisis phase may be AI so the bot stays with the user.

const typing = { sendTypingIndicator: jest.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.CRISIS_STATIC_FIRST; // defaults to static-first
});

describe('emergencyHandler — static-first crisis (default)', () => {
  it('sends the exact approved wording on the first crisis turn, with NO AI call', async () => {
    const aiBots = { chat: jest.fn() };
    const res = await makeEmergencyHandler(aiBots as never, typing as never)(
      makeState({ conversationPhase: 'menu' }),
    );

    expect(res.pendingResponse).toBe(EMERGENCY_MESSAGE);
    expect(res.conversationPhase).toBe('crisis');
    expect(res.crisisDetected).toBe(true);
    expect(aiBots.chat).not.toHaveBeenCalled(); // the whole point of F3
  });

  it('is deterministic from every entry phase', async () => {
    const aiBots = { chat: jest.fn() };
    const handler = makeEmergencyHandler(aiBots as never, typing as never);
    for (const phase of ['ageCheck', 'questionnaire', 'safetyCheck', 'menu', 'option'] as const) {
      const res = await handler(makeState({ conversationPhase: phase }));
      expect(res.pendingResponse).toBe(EMERGENCY_MESSAGE);
    }
    expect(aiBots.chat).not.toHaveBeenCalled();
  });

  it('does not depend on any AI provider being reachable', async () => {
    const aiBots = { chat: jest.fn().mockRejectedValue(new Error('provider down')) };
    const res = await makeEmergencyHandler(aiBots as never, typing as never)(
      makeState({ conversationPhase: 'option', selectedOption: 3 }),
    );
    expect(res.pendingResponse).toBe(EMERGENCY_MESSAGE);
  });

  it('lets the AI take over on FOLLOW-UP turns already inside the crisis phase', async () => {
    const aiBots = {
      chat: jest.fn().mockResolvedValue({ reply: 'Who could you reach out to?', chatId: 'c1' }),
    };
    const res = await makeEmergencyHandler(aiBots as never, typing as never)(
      makeState({ conversationPhase: 'crisis', aiBotChatId: 'c1' }),
    );

    expect(aiBots.chat).toHaveBeenCalled();
    expect(res.pendingResponse).toBe('Who could you reach out to?');
    expect(res.conversationPhase).toBe('crisis');
  });

  it('still falls back to the approved wording if a follow-up AI turn fails', async () => {
    const aiBots = { chat: jest.fn().mockRejectedValue(new Error('down')) };
    const res = await makeEmergencyHandler(aiBots as never, typing as never)(
      makeState({ conversationPhase: 'crisis', aiBotChatId: 'c1' }),
    );
    expect(res.pendingResponse).toBe(EMERGENCY_MESSAGE);
    expect(res.crisisDetected).toBe(true);
  });

  it('opting out restores the AI-generated first turn (NUS study build)', async () => {
    process.env.CRISIS_STATIC_FIRST = 'false';
    const aiBots = { chat: jest.fn().mockResolvedValue({ reply: 'AI crisis reply', chatId: 'c1' }) };
    const res = await makeEmergencyHandler(aiBots as never, typing as never)(
      makeState({ conversationPhase: 'menu' }),
    );
    expect(aiBots.chat).toHaveBeenCalled();
    expect(res.pendingResponse).toBe('AI crisis reply');
  });
});
