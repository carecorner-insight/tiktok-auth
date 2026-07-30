import { containsCrisisPhrase, parseCrisisReply } from '@/lib/crisisDetection';

describe('containsCrisisPhrase (deterministic backstop)', () => {
  it('detects crisis phrases in normalized user input', () => {
    expect(containsCrisisPhrase('i want to die')).toBe(true);
    expect(containsCrisisPhrase('sometimes i think about suicide')).toBe(true);
    expect(containsCrisisPhrase('i want to kill myself')).toBe(true);
    expect(containsCrisisPhrase('i wish i was dead')).toBe(true);
    expect(containsCrisisPhrase('i dont want to live anymore')).toBe(true);
  });

  it('does not match ordinary messages, screener answers, or menu digits', () => {
    expect(containsCrisisPhrase('no')).toBe(false);
    expect(containsCrisisPhrase('yes')).toBe(false);
    expect(containsCrisisPhrase('im stressed about exams')).toBe(false);
    expect(containsCrisisPhrase('15')).toBe(false);
    expect(containsCrisisPhrase('1')).toBe(false);
    expect(containsCrisisPhrase('')).toBe(false);
  });
});

describe('parseCrisisReply', () => {
  it('strips the [CRISIS] tag and flags it', () => {
    const { reply, isCrisis } = parseCrisisReply('[CRISIS] please call 1771');
    expect(isCrisis).toBe(true);
    expect(reply).toBe('please call 1771');
  });
});
