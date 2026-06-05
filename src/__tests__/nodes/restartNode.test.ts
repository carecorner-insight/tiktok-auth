import { restartNode } from '@/nodes/restartNode';
import { makeState } from '@/__tests__/mocks';

describe('restartNode — state reset', () => {
  it('resets conversationPhase to ageCheck', () => {
    const result = restartNode(makeState({ conversationPhase: 'menu' }));
    expect(result.conversationPhase).toBe('ageCheck');
  });

  it('resets questionIndex to 0', () => {
    const result = restartNode(makeState({ questionIndex: 4 }));
    expect(result.questionIndex).toBe(0);
  });

  it('clears all recorded answers', () => {
    const result = restartNode(makeState({ answers: ['no', 'yes', 'no', 'no'] }));
    expect(result.answers).toEqual([]);
  });

  it('clears message history', () => {
    const result = restartNode(makeState({
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
    }));
    expect(result.messages).toEqual([]);
  });

  it('clears selectedOption', () => {
    const result = restartNode(makeState({ selectedOption: 2 }));
    expect(result.selectedOption).toBeNull();
  });

  it('resets crisisDetected to false', () => {
    const result = restartNode(makeState({ crisisDetected: true }));
    expect(result.crisisDetected).toBe(false);
  });

  it('clears tag', () => {
    const result = restartNode(makeState({ tag: 'high' }));
    expect(result.tag).toBeNull();
  });

  it('clears aiBotChatId', () => {
    const result = restartNode(makeState({ aiBotChatId: 'some-chat-id-123' }));
    expect(result.aiBotChatId).toBeNull();
  });
});

describe('restartNode — response', () => {
  it('returns the age check greeting as pendingResponse', () => {
    const result = restartNode(makeState());
    expect(result.pendingResponse).toContain('Carey');
    expect(result.pendingResponse).toContain('13');
    expect(result.pendingResponse).toContain('Yes / No');
  });

  it('works regardless of the current phase', () => {
    for (const phase of ['questionnaire', 'menu', 'option', 'ended'] as const) {
      const result = restartNode(makeState({ conversationPhase: phase }));
      expect(result.conversationPhase).toBe('ageCheck');
    }
  });
});
