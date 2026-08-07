import { parseReplyTags } from '@/lib/replyTags';

describe('parseReplyTags', () => {
  it('returns the reply unchanged when no tags are present', () => {
    const r = parseReplyTags('That sounds really tough.');
    expect(r).toEqual({
      reply: 'That sounds really tough.',
      isCrisis: false,
      suggestsSocialCoach: false,
      suggestsReferral: false,
    });
  });

  it('detects and strips a [CRISIS] prefix', () => {
    const r = parseReplyTags("[CRISIS] I'm really concerned about your safety.");
    expect(r.isCrisis).toBe(true);
    expect(r.reply).toBe("I'm really concerned about your safety.");
  });

  it('detects [CRISIS] case-insensitively, with internal spaces and markdown wrapping', () => {
    for (const raw of ['[ Crisis ] hey', '*[crisis]* hey', '_[CRISIS]_ hey']) {
      const r = parseReplyTags(raw);
      expect(r.isCrisis).toBe(true);
      expect(r.reply).toBe('hey');
    }
  });

  it('detects a tag anywhere in the reply, not only as a prefix', () => {
    const r = parseReplyTags('Let me pause here. [CRISIS] Please reach out now.');
    expect(r.isCrisis).toBe(true);
    expect(r.reply).toBe('Let me pause here. Please reach out now.');
  });

  it('detects and strips a [SOCIAL] tag', () => {
    const r = parseReplyTags('[SOCIAL] It sounds like that talk with your friend was hard.');
    expect(r.suggestsSocialCoach).toBe(true);
    expect(r.isCrisis).toBe(false);
    expect(r.reply).toBe('It sounds like that talk with your friend was hard.');
  });

  it('gives crisis precedence: both tags present → crisis only, both stripped', () => {
    const r = parseReplyTags('[SOCIAL][CRISIS] Please stay with me here.');
    expect(r.isCrisis).toBe(true);
    expect(r.suggestsSocialCoach).toBe(false);
    expect(r.reply).toBe('Please stay with me here.');
  });

  it('strips every known tag even when only one is honoured', () => {
    const r = parseReplyTags('[social] some reply [Social]');
    expect(r.reply).toBe('some reply');
  });
});
