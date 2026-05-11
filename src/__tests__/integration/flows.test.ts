import { processMessage } from '@/graph/runner';
import { makeNormalizedMessage, makeState } from '@/__tests__/mocks';
import { PHQ9_QUESTIONS, EMERGENCY_MESSAGE, MENU_TEXT, COUNSELLING_URL } from '@/config/questionnaire';
import type { CareyBotState } from '@/types/state';

// ── Service mocks ─────────────────────────────────────────────────────────────

const makeServices = (overrides: Partial<{
  isAuthorized: boolean;
  existingSession: CareyBotState | null;
  aiReply: string;
}> = {}) => {
  const { isAuthorized = true, existingSession = null, aiReply = 'I hear you.' } = overrides;

  return {
    whitelist: { isAuthorized: jest.fn().mockResolvedValue(isAuthorized) },
    session: {
      load: jest.fn().mockResolvedValue(existingSession),
      save: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
    },
    aiBots: { chat: jest.fn().mockResolvedValue(aiReply) },
  };
};

const msg = (text: string) => makeNormalizedMessage({ text });

// ── Flow 1: First message from new authorized user ────────────────────────────

describe('flow: new authorized user sends first message', () => {
  it('presents Q1 (suicidal ideation) regardless of message content', async () => {
    const services = makeServices();
    const result = await processMessage(msg('hi'), services);
    expect(result.response).toContain(PHQ9_QUESTIONS[0].text);
    expect(result.response).toContain('Yes / No');
  });

  it('does not call AIBots for the questionnaire', async () => {
    const services = makeServices();
    await processMessage(msg('hi'), services);
    expect(services.aiBots.chat).not.toHaveBeenCalled();
  });

  it('saves session with questionIndex=0', async () => {
    const services = makeServices();
    await processMessage(msg('hi'), services);
    const savedState = services.session.save.mock.calls[0][0] as CareyBotState;
    expect(savedState.questionIndex).toBe(0);
    expect(savedState.conversationPhase).toBe('questionnaire');
  });
});

// ── Flow 2: Unauthorized user ─────────────────────────────────────────────────

describe('flow: unauthorized user', () => {
  it('returns registration message containing the user ID', async () => {
    const services = makeServices({ isAuthorized: false });
    const result = await processMessage(
      makeNormalizedMessage({ text: 'hello', userId: 'stranger-999' }),
      services,
    );
    expect(result.response).toContain('stranger-999');
  });

  it('does not present Q1 or call AIBots', async () => {
    const services = makeServices({ isAuthorized: false });
    await processMessage(msg('hi'), services);
    expect(services.aiBots.chat).not.toHaveBeenCalled();
  });

  it('does not save session for unauthorized users', async () => {
    const services = makeServices({ isAuthorized: false });
    await processMessage(msg('hi'), services);
    expect(services.session.save).not.toHaveBeenCalled();
  });
});

// ── Flow 3: High risk at Q1 ───────────────────────────────────────────────────

describe('flow: high risk at Q1 (suicidal ideation)', () => {
  it('returns emergency message when Q1 answer is yes', async () => {
    const sessionWithQ1Presented = makeState({
      questionIndex: 0,
      answers: [],
      conversationPhase: 'questionnaire',
      messages: [{ role: 'assistant', content: `${PHQ9_QUESTIONS[0].text}\n\nYes / No`, timestamp: 0 }],
    });
    const services = makeServices({ existingSession: sessionWithQ1Presented });
    const result = await processMessage(msg('yes'), services);
    expect(result.response).toBe(EMERGENCY_MESSAGE);
  });

  it('clears the session after emergency', async () => {
    const sessionWithQ1Presented = makeState({
      questionIndex: 0,
      answers: [],
      conversationPhase: 'questionnaire',
      messages: [{ role: 'assistant', content: `${PHQ9_QUESTIONS[0].text}\n\nYes / No`, timestamp: 0 }],
    });
    const services = makeServices({ existingSession: sessionWithQ1Presented });
    await processMessage(msg('yes'), services);
    expect(services.session.clear).toHaveBeenCalled();
    expect(services.session.save).not.toHaveBeenCalled();
  });
});

// ── Flow 4: Session resume mid-questionnaire ──────────────────────────────────

describe('flow: session resume mid-questionnaire', () => {
  it('presents Q4 when resuming at questionIndex=3', async () => {
    const midSession = makeState({
      questionIndex: 3,
      answers: ['no', 'no', 'no'],
      conversationPhase: 'questionnaire',
      messages: [{ role: 'assistant', content: `${PHQ9_QUESTIONS[3].text}\n\nYes / No`, timestamp: 0 }],
    });
    const services = makeServices({ existingSession: midSession });
    // User answers Q4 with 'no', system should present Q5
    const result = await processMessage(msg('no'), services);
    expect(result.response).toContain(PHQ9_QUESTIONS[4].text);
  });
});

// ── Flow 5: Complete questionnaire — low risk → menu ─────────────────────────

describe('flow: all-no answers → low risk → menu', () => {
  it('presents the 4-item menu after all 9 no answers', async () => {
    // Simulate session after 8 no answers, Q9 presented
    const nearEnd = makeState({
      questionIndex: 8,
      answers: Array(8).fill('no'),
      conversationPhase: 'questionnaire',
      messages: [{ role: 'assistant', content: `${PHQ9_QUESTIONS[8].text}\n\nYes / No`, timestamp: 0 }],
    });
    const services = makeServices({ existingSession: nearEnd });
    const result = await processMessage(msg('no'), services);
    expect(result.response).toBe(MENU_TEXT);
    expect(result.state.tag).toBe('low');
  });
});

// ── Flow 6: High risk via tabulation ─────────────────────────────────────────

describe('flow: high risk via tabulation (6+ yes in Q2–Q9)', () => {
  it('returns emergency message when tabulation score reaches high', async () => {
    const nearEnd = makeState({
      questionIndex: 8,
      answers: ['no', ...Array(6).fill('yes'), 'no'], // score=6 after adding last 'yes'
      conversationPhase: 'questionnaire',
      messages: [{ role: 'assistant', content: `${PHQ9_QUESTIONS[8].text}\n\nYes / No`, timestamp: 0 }],
    });
    const services = makeServices({ existingSession: nearEnd });
    const result = await processMessage(msg('yes'), services);
    expect(result.response).toBe(EMERGENCY_MESSAGE);
    expect(result.state.tag).toBe('high');
  });
});

// ── Flow 7: Menu → option 4 (resources) ──────────────────────────────────────

describe('flow: menu selection → option 4 (resources)', () => {
  it('returns counselling URL', async () => {
    const menuSession = makeState({
      conversationPhase: 'menu',
      tag: 'low',
      answers: Array(9).fill('no'),
      questionIndex: 9,
    });
    const services = makeServices({ existingSession: menuSession });
    const result = await processMessage(msg('4'), services);
    expect(result.response).toContain(COUNSELLING_URL);
    expect(result.state.conversationPhase).toBe('ended');
  });
});

// ── Flow 8: Menu → option 1 (free text) ──────────────────────────────────────

describe('flow: menu selection → option 1 (free text)', () => {
  it('calls AIBots and returns reply', async () => {
    const menuSession = makeState({ conversationPhase: 'menu', tag: 'medium' });
    const services = makeServices({ existingSession: menuSession, aiReply: 'That sounds hard.' });
    // First message: select option 1
    await processMessage(msg('1'), services);
    // Second message: free text conversation
    const optionSession = makeState({
      conversationPhase: 'option',
      selectedOption: 1,
      tag: 'medium',
    });
    const services2 = makeServices({ existingSession: optionSession, aiReply: 'That sounds hard.' });
    const result = await processMessage(msg('I feel overwhelmed'), services2);
    expect(services2.aiBots.chat).toHaveBeenCalled();
    expect(result.response).toBe('That sounds hard.');
  });
});

// ── Flow 9: Mid-conversation crisis detection ─────────────────────────────────

describe('flow: crisis detected mid free-text', () => {
  it('strips [CRISIS] prefix and marks session as ended', async () => {
    const optionSession = makeState({
      conversationPhase: 'option',
      selectedOption: 1,
      tag: 'low',
    });
    const services = makeServices({
      existingSession: optionSession,
      aiReply: '[CRISIS] Please call 1771 now.',
    });
    const result = await processMessage(msg('I want to disappear'), services);
    expect(result.state.crisisDetected).toBe(true);
    expect(result.state.conversationPhase).toBe('ended');
    expect(result.response).not.toContain('[CRISIS]');
    expect(result.response).toContain('1771');
  });
});

// ── Flow 10: Invalid menu selection ──────────────────────────────────────────

describe('flow: invalid menu selection re-presents menu', () => {
  it('re-presents the menu on gibberish input', async () => {
    const menuSession = makeState({ conversationPhase: 'menu', tag: 'low' });
    const services = makeServices({ existingSession: menuSession });
    const result = await processMessage(msg('banana'), services);
    expect(result.response).toBe(MENU_TEXT);
    expect(result.state.conversationPhase).toBe('menu');
  });
});
