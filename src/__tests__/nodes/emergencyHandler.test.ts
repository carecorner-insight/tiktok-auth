import { makeEmergencyHandler } from '@/nodes/emergencyHandler';
import { EMERGENCY_MESSAGE } from '@/config/questionnaire';
import { makeState } from '@/__tests__/mocks';

const typing = { sendTypingIndicator: jest.fn().mockResolvedValue(undefined) };

beforeEach(() => jest.clearAllMocks());

// The pivot's F3 behaviour is the default; these existing suites cover the
// opt-out (today's AI-generated crisis reply, kept for the NUS study build).
beforeAll(() => { process.env.CRISIS_STATIC_FIRST = 'false'; });
afterAll(() => { delete process.env.CRISIS_STATIC_FIRST; });

describe('emergencyHandler — AI reply with a GUARANTEED static hotline fallback', () => {
  it('returns the AI reply and flags crisis when AIBots succeeds', async () => {
    const aiBots = {
      chat: jest.fn().mockResolvedValue({ reply: 'I hear you. Please call 1771.', chatId: 'c1' }),
    };
    const res = await makeEmergencyHandler(aiBots as any, typing as any)(
      makeState({ conversationPhase: 'menu' }),
    );
    expect(res.pendingResponse).toBe('I hear you. Please call 1771.');
    expect(res.conversationPhase).toBe('crisis');
    expect(res.crisisDetected).toBe(true);
    expect(res.aiBotChatId).toBe('c1');
  });

  it('falls back to the static hotline message when AIBots throws', async () => {
    const aiBots = { chat: jest.fn().mockRejectedValue(new Error('provider down')) };
    const res = await makeEmergencyHandler(aiBots as any, typing as any)(
      makeState({ conversationPhase: 'crisis', aiBotChatId: 'existing' }),
    );
    expect(res.pendingResponse).toBe(EMERGENCY_MESSAGE);
    expect(res.conversationPhase).toBe('crisis');
    expect(res.crisisDetected).toBe(true);
  });

  it('primes a fresh crisis session with the 1771 hotline', async () => {
    const aiBots = { chat: jest.fn().mockResolvedValue({ reply: 'ok', chatId: 'c1' }) };
    await makeEmergencyHandler(aiBots as any, typing as any)(
      makeState({ aiBotChatId: null, conversationPhase: 'menu' }),
    );
    const primeArg = aiBots.chat.mock.calls[0][2];
    expect(primeArg).toContain('1771');
  });

  it('strips a [CRISIS] tag from the AI reply', async () => {
    const aiBots = {
      chat: jest.fn().mockResolvedValue({ reply: '[CRISIS] Stay with me, you are not alone.', chatId: 'c1' }),
    };
    const res = await makeEmergencyHandler(aiBots as any, typing as any)(
      makeState({ conversationPhase: 'crisis', aiBotChatId: 'existing' }),
    );
    expect(res.pendingResponse).toBe('Stay with me, you are not alone.');
  });
});
