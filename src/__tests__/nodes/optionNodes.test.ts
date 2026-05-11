import { makeFreeTextNode } from '@/nodes/freeTextNode';
import { makeWellbeingCheckNode } from '@/nodes/wellbeingCheckNode';
import { makeStressManagementNode } from '@/nodes/stressManagementNode';
import { resourceRedirectNode } from '@/nodes/resourceRedirectNode';
import { makeState, makeAIBotsClientMock } from '@/__tests__/mocks';
import { COUNSELLING_URL } from '@/config/questionnaire';

const stateWithUserMessage = (text: string) =>
  makeState({
    conversationPhase: 'option',
    messages: [{ role: 'user', content: text, timestamp: Date.now() }],
  });

// ── freeTextNode ─────────────────────────────────────────────────────────────

describe('freeTextNode', () => {
  it('calls AIBots with the conversation history and returns the reply', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue('That sounds difficult.');
    const node = makeFreeTextNode(aiMock);
    const result = await node(stateWithUserMessage('I feel overwhelmed'));
    expect(result.pendingResponse).toBe('That sounds difficult.');
    expect(aiMock.chat).toHaveBeenCalled();
  });

  it('appends user and assistant messages to history', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue('Bot reply');
    const node = makeFreeTextNode(aiMock);
    const state = stateWithUserMessage('I am struggling');
    const result = await node(state);
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'I am struggling' }),
        expect.objectContaining({ role: 'assistant', content: 'Bot reply' }),
      ]),
    );
  });

  it('sets crisisDetected=true and conversationPhase=ended when AI detects crisis', async () => {
    const aiMock = makeAIBotsClientMock();
    // Crisis signal injected via AIBots response flag
    aiMock.chat.mockResolvedValue('__CRISIS__');
    const node = makeFreeTextNode(aiMock);
    const result = await node(stateWithUserMessage('I want to end it'));
    expect(result.crisisDetected).toBe(true);
    expect(result.conversationPhase).toBe('ended');
  });
});

// ── wellbeingCheckNode ───────────────────────────────────────────────────────

describe('wellbeingCheckNode', () => {
  it('calls AIBots and sets pendingResponse', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue('Wellbeing check response');
    const node = makeWellbeingCheckNode(aiMock);
    const result = await node(stateWithUserMessage('start'));
    expect(result.pendingResponse).toBe('Wellbeing check response');
  });

  it('sets conversationPhase to ended after completion', async () => {
    const aiMock = makeAIBotsClientMock();
    const node = makeWellbeingCheckNode(aiMock);
    const result = await node(stateWithUserMessage('done'));
    expect(result.conversationPhase).toBe('ended');
  });
});

// ── stressManagementNode ─────────────────────────────────────────────────────

describe('stressManagementNode', () => {
  it('calls AIBots and sets pendingResponse', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue('Here are some techniques...');
    const node = makeStressManagementNode(aiMock);
    const result = await node(stateWithUserMessage('help me'));
    expect(result.pendingResponse).toBe('Here are some techniques...');
  });

  it('sets conversationPhase to ended after completion', async () => {
    const aiMock = makeAIBotsClientMock();
    const node = makeStressManagementNode(aiMock);
    const result = await node(stateWithUserMessage('ok'));
    expect(result.conversationPhase).toBe('ended');
  });
});

// ── resourceRedirectNode ─────────────────────────────────────────────────────

describe('resourceRedirectNode', () => {
  it('returns the counselling booking URL in the response', () => {
    const result = resourceRedirectNode(makeState());
    expect(result.pendingResponse).toContain(COUNSELLING_URL);
  });

  it('sets conversationPhase to ended', () => {
    const result = resourceRedirectNode(makeState());
    expect(result.conversationPhase).toBe('ended');
  });
});
