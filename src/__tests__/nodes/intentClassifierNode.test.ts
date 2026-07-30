import {
  makeIntentClassifierNode,
  parseIntentReply,
} from '@/nodes/intentClassifierNode';
import { containsCrisisPhrase } from '@/lib/crisisDetection';
import { makeState } from '@/__tests__/mocks';
import { MENU_TEXT } from '@/config/questionnaire';

const stateWithInput = (text: string) =>
  makeState({
    conversationPhase: 'menu',
    messages: [{ role: 'user', content: text, timestamp: Date.now() }],
  });

const makeLLMMock = (reply: string) => ({
  chat: jest.fn().mockResolvedValue({ reply, chatId: 'intent-1' }),
});

describe('parseIntentReply', () => {
  it('parses exact labels', () => {
    expect(parseIntentReply('TALK')).toBe('TALK');
    expect(parseIntentReply(' social ')).toBe('SOCIAL');
  });

  it('tolerates trailing punctuation and explanations', () => {
    expect(parseIntentReply('CRISIS.')).toBe('CRISIS');
    expect(parseIntentReply('HUMAN - they asked for a counsellor')).toBe('HUMAN');
  });

  it('returns null for garbage', () => {
    expect(parseIntentReply('I think they want to chat')).toBeNull();
    expect(parseIntentReply('')).toBeNull();
  });
});

describe('containsCrisisPhrase', () => {
  it('matches high-precision phrases on normalised input', () => {
    expect(containsCrisisPhrase('i want to die')).toBe(true);
    expect(containsCrisisPhrase('ive been thinking about self harm')).toBe(true);
    expect(containsCrisisPhrase('i dont want to live anymore')).toBe(true);
  });

  it('does not match everyday language', () => {
    expect(containsCrisisPhrase('my phone battery died')).toBe(false);
    expect(containsCrisisPhrase('this homework is killing me not really')).toBe(false);
    expect(containsCrisisPhrase('i want to talk about school')).toBe(false);
  });
});

describe('intentClassifierNode', () => {
  it('maps numeric replies 1/2/3 without calling the LLM', async () => {
    const llm = makeLLMMock('TALK');
    const node = makeIntentClassifierNode(llm);

    const r1 = await node(stateWithInput('1'));
    expect(r1).toEqual({ selectedOption: 1, conversationPhase: 'option' });

    const r2 = await node(stateWithInput(' 2. '));
    expect(r2.selectedOption).toBe(2);

    const r3 = await node(stateWithInput('3'));
    expect(r3.selectedOption).toBe(3);

    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('routes to crisis on a local phrase match without calling the LLM', async () => {
    const llm = makeLLMMock('TALK');
    const node = makeIntentClassifierNode(llm);
    const result = await node(stateWithInput('honestly I just want to die'));
    expect(result.crisisDetected).toBe(true);
    expect(result.conversationPhase).toBe('crisis');
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('classifies TALK via the LLM and selects option 1', async () => {
    const llm = makeLLMMock('TALK');
    const node = makeIntentClassifierNode(llm);
    const result = await node(stateWithInput('school has been stressing me out'));
    expect(result).toEqual({ selectedOption: 1, conversationPhase: 'option' });
    expect(llm.chat).toHaveBeenCalledWith(null, 'school has been stressing me out');
  });

  it('classifies SOCIAL via the LLM and selects option 2', async () => {
    const node = makeIntentClassifierNode(makeLLMMock('SOCIAL'));
    const result = await node(stateWithInput('I need to apologise to my friend but idk how'));
    expect(result.selectedOption).toBe(2);
  });

  it('classifies HUMAN via the LLM and selects option 3', async () => {
    const node = makeIntentClassifierNode(makeLLMMock('HUMAN'));
    const result = await node(stateWithInput('can I talk to a real counsellor'));
    expect(result.selectedOption).toBe(3);
  });

  it('routes to crisis when the LLM says CRISIS even without a phrase match', async () => {
    const node = makeIntentClassifierNode(makeLLMMock('CRISIS'));
    const result = await node(stateWithInput('everyone would be happier without me around'));
    expect(result.crisisDetected).toBe(true);
    expect(result.conversationPhase).toBe('crisis');
  });

  it('falls back to the numbered menu on UNCLEAR', async () => {
    const node = makeIntentClassifierNode(makeLLMMock('UNCLEAR'));
    const result = await node(stateWithInput('hi'));
    expect(result.selectedOption).toBeNull();
    expect(result.conversationPhase).toBe('menu');
    expect(result.pendingResponse).toContain(MENU_TEXT);
  });

  it('falls back to the numbered menu when the LLM reply is unparseable', async () => {
    const node = makeIntentClassifierNode(makeLLMMock('sure, they probably want to chat!'));
    const result = await node(stateWithInput('hmm'));
    expect(result.conversationPhase).toBe('menu');
    expect(result.pendingResponse).toContain(MENU_TEXT);
  });

  it('falls back to the numbered menu when the LLM throws (fail-safe)', async () => {
    const llm = { chat: jest.fn().mockRejectedValue(new Error('directus down')) };
    const node = makeIntentClassifierNode(llm);
    const result = await node(stateWithInput('I had a fight with my mum'));
    expect(result.conversationPhase).toBe('menu');
    expect(result.pendingResponse).toContain(MENU_TEXT);
  });

  it('crisis phrases beat LLM availability: phrase match works while LLM is down', async () => {
    const llm = { chat: jest.fn().mockRejectedValue(new Error('directus down')) };
    const node = makeIntentClassifierNode(llm);
    const result = await node(stateWithInput('I keep thinking about ending my life'));
    expect(result.crisisDetected).toBe(true);
    expect(result.conversationPhase).toBe('crisis');
    expect(llm.chat).not.toHaveBeenCalled();
  });
});
