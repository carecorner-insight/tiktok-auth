import { queueFor, verdictsAgree, type StoredUnit, type HumanLabel } from '@/lib/labelStore';
import { resolveLabeler, parseLabelerTokens } from '@/lib/labelers';
import type { JudgeVerdict } from '@/config/judgeRubric';

const unit = (key: string, ingestedAt: number): StoredUnit => ({
  replyKey: key, source: 'eval', reply: 'r', context: [], turnIndex: 0,
  phase: 'option', llm: null, judgeVersion: 'v1', ingestedAt,
});

const label = (key: string, labelerId: string): HumanLabel => ({
  replyKey: key, labelerId, labelerName: 'X',
  safety: 'pass', shape: 'pass', tone: 'pass', referral: 'na', boundaries: 'pass',
  overall: 'good', rationale: '', judgeVersion: 'v1',
  hasJudgeProposal: false, agreedWithLlm: false, ts: 1,
});

describe('queueFor', () => {
  const units = [unit('a', 3), unit('b', 1), unit('c', 2)];

  it('returns oldest-ingested first', () => {
    expect(queueFor(units, [], 'alice', 10).map(u => u.replyKey)).toEqual(['b', 'c', 'a']);
  });

  it('skips units this labeler already labelled', () => {
    const q = queueFor(units, [label('b', 'alice')], 'alice', 10);
    expect(q.map(u => u.replyKey)).toEqual(['c', 'a']);
  });

  it("does NOT skip units labelled by someone else (overlap enables agreement stats)", () => {
    const q = queueFor(units, [label('b', 'bob')], 'alice', 10);
    expect(q.map(u => u.replyKey)).toContain('b');
  });

  it('respects the limit', () => {
    expect(queueFor(units, [], 'alice', 2)).toHaveLength(2);
  });
});

describe('verdictsAgree', () => {
  const llm: JudgeVerdict = {
    safety: 'pass', shape: 'pass', tone: 'pass', referral: 'na', boundaries: 'pass',
    overall: 'good', rationale: 'x',
  };
  const human = { safety: 'pass', shape: 'pass', tone: 'pass', referral: 'na', boundaries: 'pass', overall: 'good' } as const;

  it('is true on an exact match', () => {
    expect(verdictsAgree(human, llm)).toBe(true);
  });

  it('is false when any dimension differs', () => {
    expect(verdictsAgree({ ...human, tone: 'fail' }, llm)).toBe(false);
    expect(verdictsAgree({ ...human, overall: 'bad' }, llm)).toBe(false);
  });

  it('is null when there was no judge proposal to compare against', () => {
    expect(verdictsAgree(human, null)).toBeNull();
  });
});

describe('labeler tokens', () => {
  const raw = 'tokA:Alice Tan:alice@care.org, tokB:Bob:bob@care.org';

  it('parses name and email per token', () => {
    expect(parseLabelerTokens(raw)).toHaveLength(2);
    expect(parseLabelerTokens(raw)[0]).toMatchObject({ name: 'Alice Tan', email: 'alice@care.org' });
  });

  it('resolves a valid token to that labeler', () => {
    expect(resolveLabeler('tokB', raw)).toMatchObject({ name: 'Bob', id: 'bob@care.org' });
  });

  it('rejects unknown, empty, or partial tokens', () => {
    expect(resolveLabeler('nope', raw)).toBeNull();
    expect(resolveLabeler('', raw)).toBeNull();
    expect(resolveLabeler('tok', raw)).toBeNull();
    expect(resolveLabeler('tokA', undefined)).toBeNull();
  });
});
