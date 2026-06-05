import { ageGateNode } from '@/nodes/ageGateNode';
import { makeState } from '@/__tests__/mocks';
import { PHQ9_QUESTIONS } from '@/config/questionnaire';

const stateWithInput = (input: string) =>
  makeState({
    conversationPhase: 'ageCheck',
    messages: [{ role: 'user', content: input, timestamp: Date.now() }],
  });

// ── "yes" answer ──────────────────────────────────────────────────────────────

describe('ageGateNode — "yes" answer (in-range user)', () => {
  it('advances conversationPhase to questionnaire', () => {
    const result = ageGateNode(stateWithInput('yes'));
    expect(result.conversationPhase).toBe('questionnaire');
  });

  it('presents Q1 text in pendingResponse', () => {
    const result = ageGateNode(stateWithInput('yes'));
    expect(result.pendingResponse).toContain(PHQ9_QUESTIONS[0].text);
  });

  it('includes Yes / No prompt after Q1', () => {
    const result = ageGateNode(stateWithInput('yes'));
    expect(result.pendingResponse).toContain('Yes / No');
  });

  it('is case-insensitive — "YES" is treated as yes', () => {
    const result = ageGateNode(stateWithInput('YES'));
    expect(result.conversationPhase).toBe('questionnaire');
  });

  it('is case-insensitive — "Yes" is treated as yes', () => {
    const result = ageGateNode(stateWithInput('Yes'));
    expect(result.conversationPhase).toBe('questionnaire');
  });

  it('does not set selectedOption', () => {
    const result = ageGateNode(stateWithInput('yes'));
    expect(result.selectedOption).toBeUndefined();
  });
});

// ── "no" answer ───────────────────────────────────────────────────────────────

describe('ageGateNode — "no" answer (out-of-range user)', () => {
  it('sets conversationPhase to option', () => {
    const result = ageGateNode(stateWithInput('no'));
    expect(result.conversationPhase).toBe('option');
  });

  it('sets selectedOption to 1 (free-text / support mode)', () => {
    const result = ageGateNode(stateWithInput('no'));
    expect(result.selectedOption).toBe(1);
  });

  it('returns the out-of-scope message', () => {
    const result = ageGateNode(stateWithInput('no'));
    expect(result.pendingResponse).toBeTruthy();
    // Should acknowledge age range and still offer support
    expect(result.pendingResponse).toContain('13');
  });

  it('includes a support link in the out-of-scope message', () => {
    const result = ageGateNode(stateWithInput('no'));
    expect(result.pendingResponse).toContain('carecorner');
  });

  it('is case-insensitive — "NO" is treated as no', () => {
    const result = ageGateNode(stateWithInput('NO'));
    expect(result.conversationPhase).toBe('option');
    expect(result.selectedOption).toBe(1);
  });
});

// ── Invalid answer ────────────────────────────────────────────────────────────

describe('ageGateNode — invalid answer', () => {
  it('returns a re-prompt message for unexpected input', () => {
    const result = ageGateNode(stateWithInput('maybe'));
    expect(result.pendingResponse).toContain('Please reply with Yes or No');
  });

  it('includes Yes / No in the re-prompt', () => {
    const result = ageGateNode(stateWithInput('sure'));
    expect(result.pendingResponse).toContain('Yes / No');
  });

  it('does not change conversationPhase on invalid input', () => {
    const result = ageGateNode(stateWithInput('blah'));
    expect(result.conversationPhase).toBeUndefined();
  });

  it('does not set selectedOption on invalid input', () => {
    const result = ageGateNode(stateWithInput('dunno'));
    expect(result.selectedOption).toBeUndefined();
  });

  it('handles empty input as invalid', () => {
    const result = ageGateNode(stateWithInput(''));
    expect(result.pendingResponse).toContain('Please reply with Yes or No');
  });
});
