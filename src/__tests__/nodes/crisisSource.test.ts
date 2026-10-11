import { containsCrisisPhrase } from '@/lib/crisisDetection';
import { INTENT_CLASSIFIER_PROMPT, makeIntentClassifierNode } from '@/nodes/intentClassifierNode';
import { makeSocialCoachNode } from '@/nodes/socialCoachNode';
import { makeEmergencyHandler } from '@/nodes/emergencyHandler';
import { restartNode } from '@/nodes/restartNode';
import { SharePointLogger } from '@/services/sharePointLogger';
import { makeState } from '@/__tests__/mocks';

// Staff were getting "Review Requested" Teams alerts for harmless turns such as
// "bfr". The alert flow already de-duplicates per session, so each alert was a
// fresh crisis flag — most plausibly the intent classifier's old "when in doubt,
// choose CRISIS" tie-break applied to short, ambiguous messages. These tests pin
// the narrower classifier contract, the shorthand backstop, and the new
// crisisSource field that tells staff which detector raised the flag.

const typing = { sendTypingIndicator: jest.fn().mockResolvedValue(undefined) };
const userMsg = (text: string, overrides = {}) =>
  makeState({ messages: [{ role: 'user', content: text, timestamp: Date.now() }], ...overrides });
const llm = (reply: string) => ({ chat: jest.fn().mockResolvedValue({ reply, chatId: 'x1' }) });

beforeEach(() => jest.clearAllMocks());

describe('crisis phrase backstop — shorthand', () => {
  it('matches "kms" as a whole word', () => {
    expect(containsCrisisPhrase('kms')).toBe(true);
    expect(containsCrisisPhrase('honestly i just wanna kms')).toBe(true);
  });

  it('does not match jokes or unrelated abbreviations', () => {
    expect(containsCrisisPhrase('kmsl that was so funny')).toBe(false);
    expect(containsCrisisPhrase('bfr')).toBe(false);
    expect(containsCrisisPhrase('brb')).toBe(false);
    expect(containsCrisisPhrase('idk lol')).toBe(false);
  });
});

describe('intent classifier prompt — no blanket "when in doubt, CRISIS"', () => {
  it('drops the tie-break that turned ambiguous turns into crises', () => {
    expect(INTENT_CLASSIFIER_PROMPT).not.toMatch(/when in doubt between CRISIS and any other label, choose CRISIS/i);
  });

  it('sends short or ambiguous messages with no risk signal away from CRISIS', () => {
    expect(INTENT_CLASSIFIER_PROMPT).toContain(
      'Do not choose CRISIS for a short, ambiguous or unrelated message',
    );
  });

  it('still escalates an ambiguous message when the recent conversation shows risk', () => {
    expect(INTENT_CLASSIFIER_PROMPT).toContain(
      'If the latest message is ambiguous but the recent conversation contains a risk signal, choose CRISIS.',
    );
  });

  it('keeps the explicit crisis criteria', () => {
    for (const term of ['suicide', 'self-harm', 'wanting to die', 'feeling unsafe']) {
      expect(INTENT_CLASSIFIER_PROMPT).toContain(term);
    }
  });
});

describe('crisisSource — which detector raised the flag', () => {
  it('is "phrase" for the local backstop, without calling the LLM', async () => {
    const intent = llm('TALK');
    const res = await makeIntentClassifierNode(intent)(userMsg('i want to die', { conversationPhase: 'menu' }));
    expect(res.crisisDetected).toBe(true);
    expect(res.crisisSource).toBe('phrase');
    expect(intent.chat).not.toHaveBeenCalled();
  });

  it('is "classifier" when the intent LLM labels CRISIS', async () => {
    const res = await makeIntentClassifierNode(llm('CRISIS'))(
      userMsg('everyone would be happier without me around', { conversationPhase: 'menu' }),
    );
    expect(res.crisisDetected).toBe(true);
    expect(res.crisisSource).toBe('classifier');
  });

  it('keeps the first source when a later detector fires again', async () => {
    const res = await makeIntentClassifierNode(llm('CRISIS'))(
      userMsg('still here', { conversationPhase: 'menu', crisisSource: 'coach' }),
    );
    expect(res.crisisSource).toBe('coach');
  });

  it('is "coach" when the coach reply carries [CRISIS]', async () => {
    process.env.SCREENER_ENABLED = 'false';
    try {
      const coach = { chat: jest.fn().mockResolvedValue({ reply: '[CRISIS] please reach out', chatId: 'c1' }) };
      const res = await makeSocialCoachNode(coach as never, typing as never)(
        userMsg('...', { conversationPhase: 'option', selectedOption: 3, aiBotChatId: 'c1' }),
      );
      expect(res.crisisDetected).toBe(true);
      expect(res.crisisSource).toBe('coach');
    } finally {
      delete process.env.SCREENER_ENABLED;
    }
  });

  it('is "phrase" when the router backstop sends a phrase straight to the emergency handler', async () => {
    const res = await makeEmergencyHandler({ chat: jest.fn() } as never, typing as never)(
      userMsg('i want to kill myself', { conversationPhase: 'option' }),
    );
    expect(res.crisisDetected).toBe(true);
    expect(res.crisisSource).toBe('phrase');
  });

  it('preserves an existing source in the emergency handler', async () => {
    const res = await makeEmergencyHandler({ chat: jest.fn() } as never, typing as never)(
      userMsg('bfr', { conversationPhase: 'option', crisisSource: 'classifier' }),
    );
    expect(res.crisisSource).toBe('classifier');
  });

  it('is cleared by /restart', () => {
    expect(restartNode(makeState({ crisisDetected: true, crisisSource: 'coach' })).crisisSource).toBeNull();
  });
});

describe('conversation log — crisisSource field', () => {
  const post = () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    return { fetchMock, logger: new SharePointLogger('https://power-automate.example.com/hook', fetchMock as never) };
  };

  it('sends the detector that raised the flag', async () => {
    const { fetchMock, logger } = post();
    await logger.log(makeState({ crisisDetected: true, crisisSource: 'classifier' }), 'm', 'r');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ crisisDetected: true, crisisSource: 'classifier' });
  });

  it('sends null when no crisis was detected (including older sessions without the field)', async () => {
    const { fetchMock, logger } = post();
    await logger.log(makeState(), 'm', 'r');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).crisisSource).toBeNull();
  });
});
