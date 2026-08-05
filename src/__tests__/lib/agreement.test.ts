import {
  cohensKappa,
  agreementRate,
  confusionMatrix,
  computeAgreement,
  OVERALL_CATEGORIES,
  type JoinedLabel,
  type Pair,
} from '@/lib/agreement';
import type { JudgeVerdict } from '@/config/judgeRubric';

const V = (overall: string, over: Partial<JudgeVerdict> = {}): JudgeVerdict => ({
  safety: 'pass', shape: 'pass', tone: 'pass', referral: 'na', boundaries: 'pass',
  overall: overall as JudgeVerdict['overall'], rationale: '', ...over,
});

const L = (
  replyKey: string,
  labelerId: string,
  humanOverall: string,
  llm: JudgeVerdict | null,
  extra: Partial<JoinedLabel> = {},
): JoinedLabel => ({
  replyKey, labelerId, labelerName: labelerId, judgeVersion: 'v1', ts: 1,
  human: { safety: 'pass', shape: 'pass', tone: 'pass', referral: 'na', boundaries: 'pass', overall: humanOverall },
  llm,
  ...extra,
});

describe('agreementRate', () => {
  it('is the fraction of matching pairs', () => {
    expect(agreementRate([['a', 'a'], ['a', 'b'], ['b', 'b'], ['c', 'c']])).toBe(0.75);
  });
  it('is null with no data', () => {
    expect(agreementRate([])).toBeNull();
  });
});

describe("cohen's kappa", () => {
  it('is 1 for perfect agreement across multiple categories', () => {
    const pairs: Pair[] = [['good', 'good'], ['bad', 'bad'], ['borderline', 'borderline']];
    expect(cohensKappa(pairs, OVERALL_CATEGORIES)).toBeCloseTo(1, 10);
  });

  it('is ~0 for a judge that always says "good" despite 80% raw agreement', () => {
    // The exact trap raw agreement hides: 8 goods + 2 bads, judge says good every time.
    const pairs: Pair[] = [
      ...Array(8).fill(['good', 'good']),
      ...Array(2).fill(['bad', 'good']),
    ] as Pair[];
    expect(agreementRate(pairs)).toBeCloseTo(0.8, 10); // looks great...
    expect(cohensKappa(pairs, OVERALL_CATEGORIES)).toBeCloseTo(0, 10); // ...but is worthless
  });

  it('matches a hand-computed value', () => {
    // human: 3 good, 3 bad | judge: 4 good, 2 bad | agree on 2 good + 1 bad = 3/6
    const pairs: Pair[] = [
      ['good', 'good'], ['good', 'good'], ['good', 'bad'],
      ['bad', 'bad'], ['bad', 'good'], ['bad', 'good'],
    ];
    // po = 3/6 = 0.5; pe = (3/6)(4/6) + 0 + (3/6)(2/6) = 0.3333 + 0.1667 = 0.5
    // k = (0.5 - 0.5) / (1 - 0.5) = 0
    expect(cohensKappa(pairs, OVERALL_CATEGORIES)).toBeCloseTo(0, 10);
  });

  it('is negative when agreement is worse than chance', () => {
    const pairs: Pair[] = [['good', 'bad'], ['bad', 'good'], ['good', 'bad'], ['bad', 'good']];
    expect(cohensKappa(pairs, OVERALL_CATEGORIES)!).toBeLessThan(0);
  });

  it('is null when undefined (no data, or everything in one category)', () => {
    expect(cohensKappa([], OVERALL_CATEGORIES)).toBeNull();
    // Both raters always "good" → expected agreement is already 1.
    expect(cohensKappa([['good', 'good'], ['good', 'good']], OVERALL_CATEGORIES)).toBeNull();
  });
});

describe('confusionMatrix', () => {
  it('puts human on rows and judge on columns', () => {
    const m = confusionMatrix([['good', 'bad'], ['good', 'bad'], ['bad', 'bad']], OVERALL_CATEGORIES);
    // rows: good, borderline, bad ; cols: good, borderline, bad
    expect(m[0][2]).toBe(2); // human good, judge bad
    expect(m[2][2]).toBe(1); // both bad
    expect(m[0][0]).toBe(0);
  });
});

describe('computeAgreement', () => {
  it('reports totals and ignores unjudged labels in agreement stats', () => {
    const r = computeAgreement([
      L('k1', 'alice', 'good', V('good')),
      L('k2', 'alice', 'bad', null), // no judge proposal
    ]);
    expect(r.totals.labels).toBe(2);
    expect(r.totals.withJudge).toBe(1);
    expect(r.totals.uniqueReplies).toBe(2);
    expect(r.overall.n).toBe(1);
  });

  it('classifies judge bias direction', () => {
    const r = computeAgreement([
      L('k1', 'a', 'bad', V('good')),        // judge too lenient
      L('k2', 'a', 'good', V('bad')),        // judge too strict
      L('k3', 'a', 'good', V('good')),       // exact
    ]);
    expect(r.bias).toEqual({ tooLenient: 1, tooStrict: 1, exact: 1 });
  });

  it('flags critical misses — judge passed a critical dimension a human failed', () => {
    const missedSafety = L('k1', 'a', 'bad', V('bad'), {
      human: { safety: 'fail', shape: 'pass', tone: 'pass', referral: 'na', boundaries: 'pass', overall: 'bad' },
    });
    const agreedSafety = L('k2', 'a', 'bad', V('bad', { safety: 'fail' }), {
      human: { safety: 'fail', shape: 'pass', tone: 'pass', referral: 'na', boundaries: 'pass', overall: 'bad' },
    });
    const r = computeAgreement([missedSafety, agreedSafety]);
    expect(r.criticalMisses.map(m => m.replyKey)).toEqual(['k1']);
  });

  it('computes inter-rater agreement only across replies with 2+ labelers', () => {
    const r = computeAgreement([
      L('k1', 'alice', 'good', V('good')),
      L('k1', 'bob', 'good', V('good')),   // overlap, agree
      L('k2', 'alice', 'bad', V('bad')),   // single labeler → excluded
    ]);
    expect(r.interRater.overlappingReplies).toBe(1);
    expect(r.interRater.comparisons).toBe(1);
    expect(r.interRater.agreementPct).toBe(100);
  });

  it('uses only a labeler\'s latest label for a reply they labelled twice', () => {
    const r = computeAgreement([
      L('k1', 'alice', 'good', V('good'), { ts: 1 }),
      L('k1', 'alice', 'bad', V('good'), { ts: 2 }), // correction
    ]);
    // One labeler only → no inter-rater comparison, no double counting.
    expect(r.interRater.comparisons).toBe(0);
  });

  it('breaks accuracy down per judge version', () => {
    const r = computeAgreement([
      L('k1', 'a', 'good', V('good'), { judgeVersion: 'v1' }),
      L('k2', 'a', 'bad', V('good'), { judgeVersion: 'v1' }),
      L('k3', 'a', 'good', V('good'), { judgeVersion: 'v2' }),
    ]);
    const v1 = r.byVersion.find(v => v.version === 'v1')!;
    const v2 = r.byVersion.find(v => v.version === 'v2')!;
    expect(v1.n).toBe(2);
    expect(v1.agreementPct).toBe(50);
    expect(v2.agreementPct).toBe(100);
  });

  it('lists disagreements newest-first for drill-down', () => {
    const r = computeAgreement([
      L('k1', 'a', 'bad', V('good'), { ts: 10 }),
      L('k2', 'a', 'good', V('good'), { ts: 20 }), // agrees — excluded
      L('k3', 'a', 'good', V('bad'), { ts: 30 }),
    ]);
    expect(r.disagreements.map(d => d.replyKey)).toEqual(['k3', 'k1']);
  });

  it('handles an empty label set without throwing', () => {
    const r = computeAgreement([]);
    expect(r.totals.labels).toBe(0);
    expect(r.overall.kappa).toBeNull();
    expect(r.overall.agreementPct).toBeNull();
    expect(r.dimensions).toHaveLength(5);
  });
});
