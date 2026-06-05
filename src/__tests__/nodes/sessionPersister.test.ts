import { makeSessionPersister } from '@/nodes/sessionPersister';
import { makeState, makeSessionManagerMock } from '@/__tests__/mocks';

describe('sessionPersister — save behaviour', () => {
  it('saves state to the session manager', async () => {
    const sessionMock = makeSessionManagerMock();
    const node = makeSessionPersister(sessionMock);
    const state = makeState({ conversationPhase: 'menu' });
    await node(state);
    expect(sessionMock.save).toHaveBeenCalledTimes(1);
  });

  it('passes the full state to save', async () => {
    const sessionMock = makeSessionManagerMock();
    const node = makeSessionPersister(sessionMock);
    const state = makeState({ conversationPhase: 'questionnaire', questionIndex: 2 });
    await node(state);
    const saved = sessionMock.save.mock.calls[0][0];
    expect(saved.questionIndex).toBe(2);
    expect(saved.conversationPhase).toBe('questionnaire');
  });
});

describe('sessionPersister — message appending', () => {
  it('appends pendingResponse as an assistant message before saving', async () => {
    const sessionMock = makeSessionManagerMock();
    const node = makeSessionPersister(sessionMock);
    const state = makeState({
      conversationPhase: 'questionnaire',
      pendingResponse: 'How are you feeling?',
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
    });
    await node(state);
    const saved = sessionMock.save.mock.calls[0][0];
    const lastMsg = saved.messages[saved.messages.length - 1];
    expect(lastMsg.role).toBe('assistant');
    expect(lastMsg.content).toBe('How are you feeling?');
  });

  it('does not append when pendingResponse is null', async () => {
    const sessionMock = makeSessionManagerMock();
    const node = makeSessionPersister(sessionMock);
    const state = makeState({
      conversationPhase: 'questionnaire',
      pendingResponse: null,
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
    });
    await node(state);
    const saved = sessionMock.save.mock.calls[0][0];
    expect(saved.messages).toHaveLength(1);
    expect(saved.messages[0].role).toBe('user');
  });

  it('returns updated messages so graph state reflects the append', async () => {
    const sessionMock = makeSessionManagerMock();
    const node = makeSessionPersister(sessionMock);
    const state = makeState({
      conversationPhase: 'menu',
      pendingResponse: 'What would you like to do?',
      messages: [],
    });
    const result = await node(state);
    expect(result.messages).toHaveLength(1);
    expect(result.messages![0].role).toBe('assistant');
    expect(result.messages![0].content).toBe('What would you like to do?');
  });

  it('preserves existing messages when appending', async () => {
    const sessionMock = makeSessionManagerMock();
    const node = makeSessionPersister(sessionMock);
    const existingMessages = [
      { role: 'assistant' as const, content: 'Hello', timestamp: 1 },
      { role: 'user' as const, content: 'hi back', timestamp: 2 },
    ];
    const state = makeState({
      conversationPhase: 'questionnaire',
      pendingResponse: 'Next question',
      messages: existingMessages,
    });
    const result = await node(state);
    expect(result.messages).toHaveLength(3);
    expect(result.messages![0].content).toBe('Hello');
    expect(result.messages![1].content).toBe('hi back');
    expect(result.messages![2].content).toBe('Next question');
  });
});

describe('sessionPersister — ended phase', () => {
  it('clears session when conversationPhase is ended', async () => {
    const sessionMock = makeSessionManagerMock();
    const node = makeSessionPersister(sessionMock);
    const state = makeState({ conversationPhase: 'ended' });
    await node(state);
    expect(sessionMock.clear).toHaveBeenCalledWith(state.platform, state.userId);
    expect(sessionMock.save).not.toHaveBeenCalled();
  });

  it('returns updated messages even when clearing', async () => {
    const sessionMock = makeSessionManagerMock();
    const node = makeSessionPersister(sessionMock);
    const state = makeState({
      conversationPhase: 'ended',
      pendingResponse: 'Goodbye',
      messages: [],
    });
    const result = await node(state);
    expect(result.messages).toHaveLength(1);
    expect(result.messages![0].content).toBe('Goodbye');
  });
});
