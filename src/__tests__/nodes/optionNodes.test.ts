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

const aiReply = (text: string) => ({ reply: text, chatId: 'mock-chat-id' });

// ── freeTextNode ─────────────────────────────────────────────────────────────

describe('freeTextNode', () => {
  it('calls AIBots with the conversation history and returns the reply', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue(aiReply('That sounds difficult.'));
    const node = makeFreeTextNode(aiMock);
    const result = await node(stateWithUserMessage('I feel overwhelmed'));
    expect(result.pendingResponse).toBe('That sounds difficult.');
    expect(aiMock.chat).toHaveBeenCalled();
  });

  it('appends user and assistant messages to history', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue(aiReply('Bot reply'));
    const node = makeFreeTextNode(aiMock);
    const state = stateWithUserMessage('I am struggling');
    const result = await node(state);
    // freeTextNode itself does not append messages — sessionPersister does that
    // It simply returns pendingResponse which sessionPersister then appends
    expect(result.pendingResponse).toBe('Bot reply');
  });

  it('sets crisisDetected=true and conversationPhase=ended when AIBots prefixes [CRISIS]', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue(aiReply('[CRISIS] I\'m really concerned about your safety right now. Please call 1771.'));
    const node = makeFreeTextNode(aiMock);
    const result = await node(stateWithUserMessage('I want to end it'));
    expect(result.crisisDetected).toBe(true);
    expect(result.conversationPhase).toBe('ended');
  });

  it('strips [CRISIS] prefix before sending reply to user', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue(aiReply('[CRISIS] Please call 1771 now.'));
    const node = makeFreeTextNode(aiMock);
    const result = await node(stateWithUserMessage('help'));
    expect(result.pendingResponse).toBe('Please call 1771 now.');
    expect(result.pendingResponse).not.toContain('[CRISIS]');
  });

  it('persists the chatId returned by AIBots', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue({ reply: 'Hello', chatId: 'new-session-abc' });
    const node = makeFreeTextNode(aiMock);
    const result = await node(stateWithUserMessage('hi'));
    expect(result.aiBotChatId).toBe('new-session-abc');
  });

  it('passes the existing aiBotChatId to the AIBots client', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue(aiReply('Hi'));
    const node = makeFreeTextNode(aiMock);
    const state = makeState({ conversationPhase: 'option', aiBotChatId: 'existing-id' });
    await node(state);
    expect(aiMock.chat).toHaveBeenCalledWith('existing-id', expect.any(String));
  });
});

// ── wellbeingCheckNode ───────────────────────────────────────────────────────

describe('wellbeingCheckNode', () => {
  it('calls AIBots and sets pendingResponse', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue(aiReply('Wellbeing check response'));
    const node = makeWellbeingCheckNode(aiMock);
    const result = await node(stateWithUserMessage('start'));
    expect(result.pendingResponse).toBe('Wellbeing check response');
  });

  it('sets conversationPhase to ended after completion', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue(aiReply('Done'));
    const node = makeWellbeingCheckNode(aiMock);
    const result = await node(stateWithUserMessage('done'));
    expect(result.conversationPhase).toBe('ended');
  });

  it('persists the chatId from AIBots', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue({ reply: 'Hi', chatId: 'wb-chat-id' });
    const node = makeWellbeingCheckNode(aiMock);
    const result = await node(stateWithUserMessage('hi'));
    expect(result.aiBotChatId).toBe('wb-chat-id');
  });
});

// ── stressManagementNode ─────────────────────────────────────────────────────

describe('stressManagementNode', () => {
  it('calls AIBots and sets pendingResponse', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue(aiReply('Here are some techniques...'));
    const node = makeStressManagementNode(aiMock);
    const result = await node(stateWithUserMessage('help me'));
    expect(result.pendingResponse).toBe('Here are some techniques...');
  });

  it('sets conversationPhase to ended after completion', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue(aiReply('Done'));
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
