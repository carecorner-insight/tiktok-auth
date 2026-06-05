import { processMessage } from '@/graph/runner';
import { makeNormalizedMessage, makeState } from '@/__tests__/mocks';
import { PHQ9_QUESTIONS, EMERGENCY_MESSAGE, MENU_TEXT, COUNSELLING_URL, TOTAL_QUESTIONS } from '@/config/questionnaire';
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
    aiBots: { chat: jest.fn().mockResolvedValue({ reply: aiReply, chatId: 'mock-chat-id' }) },
  };
};

const msg = (text: string) => makeNormalizedMessage({ text });

// ── Flow 1: First message from new authorized user — age check ────────────────

describe('flow: new authorized user sends first message', () => {
  it('presents the age check message (not Q1) on very first message', async () => {
    const services = makeServices();
    const result = await processMessage(msg('hi'), services);
    expect(result.response).toContain('Carey');
    expect(result.response).toContain('Yes / No');
    expect(result.response).not.toContain(PHQ9_QUESTIONS[0].text);
  });

  it('does not call AIBots during age check', async () => {
    const services = makeServices();
    await processMessage(msg('hi'), services);
    expect(services.aiBots.chat).not.toHaveBeenCalled();
  });

  it('saves session with conversationPhase=ageCheck', async () => {
    const services = makeServices();
    await processMessage(msg('hi'), services);
    const savedState = services.session.save.mock.calls[0][0] as CareyBotState;
    expect(savedState.conversationPhase).toBe('ageCheck');
  });
});

// ── Flow 2: Age gate — user answers "yes" (in range) ─────────────────────────

describe('flow: age gate — user is in range (answers yes)', () => {
  it('presents Q1 after user answers yes to age check', async () => {
    const ageCheckSession = makeState({
      conversationPhase: 'ageCheck',
      messages: [
        { role: 'assistant', content: 'Are you between 13 and 25 years old?\n\nYes / No', timestamp: 0 },
      ],
    });
    const services = makeServices({ existingSession: ageCheckSession });
    const result = await processMessage(msg('yes'), services);
    expect(result.response).toContain(PHQ9_QUESTIONS[0].text);
    expect(result.response).toContain('Yes / No');
    expect(result.state.conversationPhase).toBe('questionnaire');
  });

  it('does not call AIBots when transitioning to questionnaire', async () => {
    const ageCheckSession = makeState({
      conversationPhase: 'ageCheck',
      messages: [
        { role: 'assistant', content: 'Are you between 13 and 25 years old?\n\nYes / No', timestamp: 0 },
      ],
    });
    const services = makeServices({ existingSession: ageCheckSession });
    await processMessage(msg('yes'), services);
    expect(services.aiBots.chat).not.toHaveBeenCalled();
  });
});

// ── Flow 3: Age gate — user answers "no" (out of range) ──────────────────────

describe('flow: age gate — user is out of range (answers no)', () => {
  it('returns out-of-scope message with support link', async () => {
    const ageCheckSession = makeState({
      conversationPhase: 'ageCheck',
      messages: [
        { role: 'assistant', content: 'Are you between 13 and 25 years old?\n\nYes / No', timestamp: 0 },
      ],
    });
    const services = makeServices({ existingSession: ageCheckSession });
    const result = await processMessage(msg('no'), services);
    expect(result.response).toContain('carecorner');
    expect(result.state.conversationPhase).toBe('option');
    expect(result.state.selectedOption).toBe(1);
  });
});

// ── Flow 4: Age gate — invalid answer re-prompts ──────────────────────────────

describe('flow: age gate — invalid answer re-prompts', () => {
  it('re-prompts when user answers neither yes nor no', async () => {
    const ageCheckSession = makeState({
      conversationPhase: 'ageCheck',
      messages: [
        { role: 'assistant', content: 'Are you between 13 and 25 years old?\n\nYes / No', timestamp: 0 },
      ],
    });
    const services = makeServices({ existingSession: ageCheckSession });
    const result = await processMessage(msg('maybe'), services);
    expect(result.response).toContain('Please reply with Yes or No');
    expect(result.state.conversationPhase).toBe('ageCheck');
  });
});

// ── Flow 5: Unauthorized user ─────────────────────────────────────────────────

describe('flow: unauthorized user', () => {
  it('returns registration message containing the user ID', async () => {
    const services = makeServices({ isAuthorized: false });
    const result = await processMessage(
      makeNormalizedMessage({ text: 'hello', userId: 'stranger-999' }),
      services,
    );
    expect(result.response).toContain('stranger-999');
  });

  it('does not call AIBots for unauthorized users', async () => {
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

// ── Flow 6: High risk at Q1 ───────────────────────────────────────────────────

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

// ── Flow 7: Session resume mid-questionnaire ──────────────────────────────────

describe('flow: session resume mid-questionnaire', () => {
  it('presents Q3 when resuming at questionIndex=2 (Q2 answered)', async () => {
    const midSession = makeState({
      questionIndex: 2,
      answers: ['no', 'no'],
      conversationPhase: 'questionnaire',
      messages: [{ role: 'assistant', content: `${PHQ9_QUESTIONS[2].text}\n\nYes / No`, timestamp: 0 }],
    });
    const services = makeServices({ existingSession: midSession });
    // User answers Q3 with 'no', system should present Q4
    const result = await processMessage(msg('no'), services);
    expect(result.response).toContain(PHQ9_QUESTIONS[3].text);
  });
});

// ── Flow 8: Complete questionnaire — low risk → menu ─────────────────────────

describe('flow: all-no answers → low risk → menu', () => {
  it(`presents the 4-item menu after all ${TOTAL_QUESTIONS} no answers`, async () => {
    // Simulate session after 3 no answers, Q4 presented
    const nearEnd = makeState({
      questionIndex: TOTAL_QUESTIONS - 1,
      answers: Array(TOTAL_QUESTIONS - 1).fill('no'),
      conversationPhase: 'questionnaire',
      messages: [{
        role: 'assistant',
        content: `${PHQ9_QUESTIONS[TOTAL_QUESTIONS - 1].text}\n\nYes / No`,
        timestamp: 0,
      }],
    });
    const services = makeServices({ existingSession: nearEnd });
    const result = await processMessage(msg('no'), services);
    expect(result.response).toBe(MENU_TEXT);
    expect(result.state.tag).toBe('low');
  });
});

// ── Flow 9: High risk via tabulation ─────────────────────────────────────────

describe('flow: high risk via tabulation (2+ yes in Q2–Q4)', () => {
  it('returns emergency message when tabulation score reaches high threshold', async () => {
    // Q1=no, Q2=yes, Q3=yes — score already 2; answer Q4 with 'no' → still high
    const nearEnd = makeState({
      questionIndex: TOTAL_QUESTIONS - 1,
      answers: ['no', 'yes', 'yes'],
      conversationPhase: 'questionnaire',
      messages: [{
        role: 'assistant',
        content: `${PHQ9_QUESTIONS[TOTAL_QUESTIONS - 1].text}\n\nYes / No`,
        timestamp: 0,
      }],
    });
    const services = makeServices({ existingSession: nearEnd });
    const result = await processMessage(msg('no'), services);
    expect(result.response).toBe(EMERGENCY_MESSAGE);
    expect(result.state.tag).toBe('high');
  });
});

// ── Flow 10: Menu → option 4 (resources) ──────────────────────────────────────

describe('flow: menu selection → option 4 (resources)', () => {
  it('returns counselling URL', async () => {
    const menuSession = makeState({
      conversationPhase: 'menu',
      tag: 'low',
      answers: Array(TOTAL_QUESTIONS).fill('no'),
      questionIndex: TOTAL_QUESTIONS,
    });
    const services = makeServices({ existingSession: menuSession });
    const result = await processMessage(msg('4'), services);
    expect(result.response).toContain(COUNSELLING_URL);
    expect(result.state.conversationPhase).toBe('ended');
  });
});

// ── Flow 11: Menu → option 1 (free text) ─────────────────────────────────────

describe('flow: menu selection → option 1 (free text)', () => {
  it('calls AIBots and returns reply during free-text conversation', async () => {
    const optionSession = makeState({
      conversationPhase: 'option',
      selectedOption: 1,
      tag: 'medium',
    });
    const services = makeServices({ existingSession: optionSession, aiReply: 'That sounds hard.' });
    const result = await processMessage(msg('I feel overwhelmed'), services);
    expect(services.aiBots.chat).toHaveBeenCalled();
    expect(result.response).toBe('That sounds hard.');
  });
});

// ── Flow 12: Mid-conversation crisis detection ────────────────────────────────

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

// ── Flow 13: Invalid menu selection re-presents menu ─────────────────────────

describe('flow: invalid menu selection re-presents menu', () => {
  it('re-presents the menu on gibberish input', async () => {
    const menuSession = makeState({ conversationPhase: 'menu', tag: 'low' });
    const services = makeServices({ existingSession: menuSession });
    const result = await processMessage(msg('banana'), services);
    expect(result.response).toBe(MENU_TEXT);
    expect(result.state.conversationPhase).toBe('menu');
  });
});

// ── Flow 14: /restart command ─────────────────────────────────────────────────

describe('flow: /restart command', () => {
  it('resets state and presents age check from any phase', async () => {
    const midSession = makeState({
      conversationPhase: 'questionnaire',
      questionIndex: 2,
      answers: ['no', 'yes'],
    });
    const services = makeServices({ existingSession: midSession });
    const result = await processMessage(msg('/restart'), services);
    expect(result.response).toContain('Carey');
    expect(result.response).toContain('Yes / No');
    expect(result.state.conversationPhase).toBe('ageCheck');
    expect(result.state.questionIndex).toBe(0);
    expect(result.state.answers).toEqual([]);
  });

  it('works from menu phase too', async () => {
    const menuSession = makeState({ conversationPhase: 'menu', tag: 'low' });
    const services = makeServices({ existingSession: menuSession });
    const result = await processMessage(msg('/restart'), services);
    expect(result.state.conversationPhase).toBe('ageCheck');
    expect(result.state.tag).toBeNull();
  });
});

// ── Flow 15: Menu keyword returns user to menu ────────────────────────────────

describe('flow: menu keywords during option phase', () => {
  it('routes back to menu when user types "menu"', async () => {
    const optionSession = makeState({
      conversationPhase: 'option',
      selectedOption: 1,
      tag: 'low',
    });
    const services = makeServices({ existingSession: optionSession });
    const result = await processMessage(msg('menu'), services);
    expect(result.response).toBe(MENU_TEXT);
    expect(result.state.conversationPhase).toBe('menu');
  });

  it('routes back to menu when user types "back"', async () => {
    const optionSession = makeState({
      conversationPhase: 'option',
      selectedOption: 2,
      tag: 'medium',
    });
    const services = makeServices({ existingSession: optionSession });
    const result = await processMessage(msg('back'), services);
    expect(result.response).toBe(MENU_TEXT);
  });
});
