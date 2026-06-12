import { makeFreeTextNode } from '@/nodes/freeTextNode';
import { makeWellbeingCheckNode } from '@/nodes/wellbeingCheckNode';
import { makeStressManagementNode } from '@/nodes/stressManagementNode';
import { makeResourceRedirectNode } from '@/nodes/resourceRedirectNode';
import { makeState, makeAIBotsClientMock } from '@/__tests__/mocks';
import { COUNSELLING_URL } from '@/config/questionnaire';

const stateWithUserMessage = (text: string) =>
  makeState({
    conversationPhase: 'option',
    messages: [{ role: 'user', content: text, timestamp: Date.now() }],
  });

const aiReply = (text: string) => ({ reply: text, chatId: 'mock-chat-id' });

// ── priming helpers ───────────────────────────────────────────────────────────

const stateNoSession = (text: string) =>
  makeState({
    conversationPhase: 'option',
    aiBotChatId: null,
    tag: 'low',
    messages: [{ role: 'user', content: text, timestamp: Date.now() }],
  });

const stateExistingSession = (text: string) =>
  makeState({
    conversationPhase: 'option',
    aiBotChatId: 'existing-session-id',
    tag: 'low',
    messages: [{ role: 'user', content: text, timestamp: Date.now() }],
  });

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
    expect(aiMock.chat).toHaveBeenCalledWith('existing-id', expect.any(String), undefined);
  });

  it('passes a primeMessage when aiBotChatId is null (new session)', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue(aiReply('Hi'));
    const node = makeFreeTextNode(aiMock);
    await node(stateNoSession('hello'));
    const [, , primeMessage] = aiMock.chat.mock.calls[0];
    expect(primeMessage).toBeTruthy();
    expect(primeMessage).toContain('State 2B');
  });

  it('does NOT pass a primeMessage when aiBotChatId already exists', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue(aiReply('Hi'));
    const node = makeFreeTextNode(aiMock);
    await node(stateExistingSession('follow-up'));
    const [, , primeMessage] = aiMock.chat.mock.calls[0];
    expect(primeMessage).toBeUndefined();
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

  it('stays in option phase so the multi-turn quiz is not cut short', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue(aiReply('How have you been sleeping?'));
    const node = makeWellbeingCheckNode(aiMock);
    const result = await node(stateWithUserMessage('start'));
    expect(result.conversationPhase).toBe('option');
    expect(result.selectedOption).toBe(2);
  });

  it('persists the chatId from AIBots', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue({ reply: 'Hi', chatId: 'wb-chat-id' });
    const node = makeWellbeingCheckNode(aiMock);
    const result = await node(stateWithUserMessage('hi'));
    expect(result.aiBotChatId).toBe('wb-chat-id');
  });

  it('passes a primeMessage referencing State 2A when aiBotChatId is null', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue(aiReply('Hi'));
    const node = makeWellbeingCheckNode(aiMock);
    await node(stateNoSession('start'));
    const [, , primeMessage] = aiMock.chat.mock.calls[0];
    expect(primeMessage).toContain('State 2A');
  });

  it('does NOT pass a primeMessage when aiBotChatId already exists', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue(aiReply('Hi'));
    const node = makeWellbeingCheckNode(aiMock);
    await node(stateExistingSession('more'));
    const [, , primeMessage] = aiMock.chat.mock.calls[0];
    expect(primeMessage).toBeUndefined();
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

  it('stays in option phase to allow multi-turn stress management conversation', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue(aiReply('Try box breathing.'));
    const node = makeStressManagementNode(aiMock);
    const result = await node(stateWithUserMessage('ok'));
    expect(result.conversationPhase).toBe('option');
    expect(result.selectedOption).toBe(3);
  });

  it('passes a primeMessage referencing State 4 when aiBotChatId is null', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue(aiReply('Hi'));
    const node = makeStressManagementNode(aiMock);
    await node(stateNoSession('help me'));
    const [, , primeMessage] = aiMock.chat.mock.calls[0];
    expect(primeMessage).toContain('State 4');
  });

  it('does NOT pass a primeMessage when aiBotChatId already exists', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue(aiReply('Hi'));
    const node = makeStressManagementNode(aiMock);
    await node(stateExistingSession('more'));
    const [, , primeMessage] = aiMock.chat.mock.calls[0];
    expect(primeMessage).toBeUndefined();
  });
});

// ── resourceRedirectNode ─────────────────────────────────────────────────────

describe('resourceRedirectNode', () => {
  const initialSelectionState = (text = '4') =>
    makeState({
      conversationPhase: 'option',
      selectedOption: 4,
      aiBotChatId: null,
      messages: [{ role: 'user', content: text, timestamp: Date.now() }],
    });

  it('returns the counselling booking URL on the initial selection without calling AIBots', async () => {
    const aiMock = makeAIBotsClientMock();
    const node = makeResourceRedirectNode(aiMock);
    const result = await node(initialSelectionState('4'));
    expect(result.pendingResponse).toContain(COUNSELLING_URL);
    expect(aiMock.chat).not.toHaveBeenCalled();
  });

  it('stays in option phase on initial selection', async () => {
    const aiMock = makeAIBotsClientMock();
    const node = makeResourceRedirectNode(aiMock);
    const result = await node(initialSelectionState('4'));
    expect(result.conversationPhase).toBe('option');
    expect(result.selectedOption).toBe(4);
  });

  it('calls AIBots with a State 7 prime on the first follow-up (new session)', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue({ reply: 'How can I help?', chatId: 'res-chat-id' });
    const node = makeResourceRedirectNode(aiMock);
    const state = makeState({
      conversationPhase: 'option',
      selectedOption: 4,
      aiBotChatId: null,
      messages: [{ role: 'user', content: 'I need help finding a counsellor', timestamp: Date.now() }],
    });
    const result = await node(state);
    const [, , primeMessage] = aiMock.chat.mock.calls[0];
    expect(primeMessage).toBeTruthy();
    expect(primeMessage).toContain('State 7');
    expect(result.aiBotChatId).toBe('res-chat-id');
    expect(result.conversationPhase).toBe('option');
  });

  it('does NOT pass a primeMessage on subsequent turns (existing session)', async () => {
    const aiMock = makeAIBotsClientMock();
    aiMock.chat.mockResolvedValue({ reply: 'Sure, here is more info.', chatId: 'res-chat-id' });
    const node = makeResourceRedirectNode(aiMock);
    const state = makeState({
      conversationPhase: 'option',
      selectedOption: 4,
      aiBotChatId: 'res-chat-id',
      messages: [{ role: 'user', content: 'tell me more', timestamp: Date.now() }],
    });
    await node(state);
    const [, , primeMessage] = aiMock.chat.mock.calls[0];
    expect(primeMessage).toBeUndefined();
  });
});
