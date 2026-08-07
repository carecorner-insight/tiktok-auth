import { parseReplyTags } from '@/lib/replyTags';
import { SOCIAL_COACH_PROMPT, SOCIAL_COACH_BASE_PROMPT } from '@/config/socialCoachPrompt';
import { coachProvider } from '@/services/makeSocialCoachClient';

describe('[REFERRAL] tag — the pivot\'s only route to a human', () => {
  it('detects the tag and strips it from the user-visible reply', () => {
    const r = parseReplyTags('[REFERRAL] It might help to talk to someone on our team.');
    expect(r.suggestsReferral).toBe(true);
    expect(r.reply).toBe('It might help to talk to someone on our team.');
    expect(r.reply).not.toMatch(/referral/i);
  });

  it('is tolerant of casing, spacing and markdown emphasis', () => {
    expect(parseReplyTags('*[ Referral ]* text').suggestsReferral).toBe(true);
    expect(parseReplyTags('text [referral]').suggestsReferral).toBe(true);
  });

  it('is false when absent', () => {
    expect(parseReplyTags('Just ordinary coaching.').suggestsReferral).toBe(false);
  });

  it('is suppressed by [CRISIS] — safety never shares a turn with a support link', () => {
    const r = parseReplyTags('[CRISIS][REFERRAL] please call 1771');
    expect(r.isCrisis).toBe(true);
    expect(r.suggestsReferral).toBe(false);
    expect(r.reply).toBe('please call 1771');
  });

  it('does not disturb the existing [SOCIAL] behaviour', () => {
    const r = parseReplyTags('[SOCIAL] want to practise that?');
    expect(r.suggestsSocialCoach).toBe(true);
    expect(r.suggestsReferral).toBe(false);
  });
});

describe('social coach prompt', () => {
  it('always carries the tag contract, whatever the base prompt says', () => {
    expect(SOCIAL_COACH_PROMPT).toContain('[CRISIS]');
    expect(SOCIAL_COACH_PROMPT).toContain('[REFERRAL]');
  });

  it('appends the contract rather than relying on the editable base prompt', () => {
    // The base prompt is owned by the team and will be rewritten; the safety
    // contract must survive that rewrite.
    expect(SOCIAL_COACH_BASE_PROMPT).not.toContain('[CRISIS]');
    expect(SOCIAL_COACH_PROMPT.startsWith(SOCIAL_COACH_BASE_PROMPT)).toBe(true);
  });

  it('tells the coach to prefer a false positive over a missed crisis', () => {
    expect(SOCIAL_COACH_PROMPT).toMatch(/unsure.*USE THE TAG|USE THE TAG.*unsure/is);
  });

  it('keeps the coach out of therapy territory', () => {
    expect(SOCIAL_COACH_PROMPT).toMatch(/not.*therapy|do NOT provide/i);
  });
});

describe('coachProvider', () => {
  const original = process.env.COACH_PROVIDER;
  afterEach(() => {
    if (original === undefined) delete process.env.COACH_PROVIDER;
    else process.env.COACH_PROVIDER = original;
  });

  it('defaults to the direct Qwen client', () => {
    delete process.env.COACH_PROVIDER;
    expect(coachProvider()).toBe('direct');
  });

  it('switches to AIBots only on an exact "aibots"', () => {
    process.env.COACH_PROVIDER = 'aibots';
    expect(coachProvider()).toBe('aibots');
    process.env.COACH_PROVIDER = 'AIBOTS';
    expect(coachProvider()).toBe('direct'); // no fuzzy matching
  });
});
