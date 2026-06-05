import { ageCheckNode } from '@/nodes/ageCheckNode';
import { makeState } from '@/__tests__/mocks';

describe('ageCheckNode', () => {
  it('returns a pendingResponse with the age range question', () => {
    const result = ageCheckNode(makeState({ conversationPhase: 'ageCheck' }));
    expect(result.pendingResponse).toContain('13');
    expect(result.pendingResponse).toContain('25');
  });

  it('includes Yes / No prompt in the response', () => {
    const result = ageCheckNode(makeState({ conversationPhase: 'ageCheck' }));
    expect(result.pendingResponse).toContain('Yes / No');
  });

  it('introduces Carey by name', () => {
    const result = ageCheckNode(makeState({ conversationPhase: 'ageCheck' }));
    expect(result.pendingResponse).toContain('Carey');
  });

  it('does not change conversationPhase', () => {
    const result = ageCheckNode(makeState({ conversationPhase: 'ageCheck' }));
    expect(result.conversationPhase).toBeUndefined();
  });

  it('does not change questionIndex', () => {
    const result = ageCheckNode(makeState({ questionIndex: 0 }));
    expect(result.questionIndex).toBeUndefined();
  });
});
