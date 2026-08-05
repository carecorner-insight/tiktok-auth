import { RUBRIC_DIMENSIONS, type JudgeVerdict } from '../config/judgeRubric';

/**
 * Agreement statistics for the labelling platform.
 *
 * Answers the question the whole platform exists to answer: **can the LLM judge
 * be trusted to label at scale?** Raw agreement % alone is misleading — if 90%
 * of replies are "good", a judge that always says "good" scores 90% while being
 * useless. Cohen's κ corrects for that chance agreement, so it is the headline
 * number.
 *
 * Rule of thumb for κ: <0.20 poor, 0.21–0.40 fair, 0.41–0.60 moderate,
 * 0.61–0.80 substantial, >0.80 near-perfect. Do not let the judge label
 * unreviewed data below ~0.6, and never on the safety dimension.
 */

export const OVERALL_CATEGORIES = ['good', 'borderline', 'bad'] as const;
export const DIMENSION_CATEGORIES = ['pass', 'fail', 'na'] as const;

/** Severity rank for the overall verdict — used to detect judge leniency bias. */
const SEVERITY: Record<string, number> = { good: 0, borderline: 1, bad: 2 };

export interface HumanVerdicts {
  safety: string;
  shape: string;
  tone: string;
  referral: string;
  boundaries: string;
  overall: string;
}

export interface JoinedLabel {
  replyKey: string;
  labelerId: string;
  labelerName: string;
  judgeVersion: string;
  ts: number;
  human: HumanVerdicts;
  llm: JudgeVerdict | null;
  rationale?: string;
  persona?: string;
  menuMode?: string;
  phase?: string;
  replyText?: string;
}

export type Pair = [string, string];

/** Observed agreement: the fraction of pairs where both raters chose the same. */
export function agreementRate(pairs: Pair[]): number | null {
  if (!pairs.length) return null;
  const same = pairs.filter(([a, b]) => a === b).length;
  return same / pairs.length;
}

/**
 * Cohen's κ. Returns null when undefined — no pairs, or every rating sits in a
 * single category (expected agreement 1, so κ is 0/0 rather than "perfect").
 */
export function cohensKappa(pairs: Pair[], categories: readonly string[]): number | null {
  const n = pairs.length;
  if (!n) return null;

  const po = agreementRate(pairs) as number;

  // Expected agreement from the two raters' marginal distributions.
  let pe = 0;
  for (const c of categories) {
    const pa = pairs.filter(([a]) => a === c).length / n;
    const pb = pairs.filter(([, b]) => b === c).length / n;
    pe += pa * pb;
  }

  if (pe >= 1) return null; // degenerate: no room above chance
  return (po - pe) / (1 - pe);
}

/** rows = human category, cols = judge category. */
export function confusionMatrix(pairs: Pair[], categories: readonly string[]): number[][] {
  const idx = new Map(categories.map((c, i) => [c, i]));
  const m = categories.map(() => categories.map(() => 0));
  for (const [a, b] of pairs) {
    const r = idx.get(a);
    const c = idx.get(b);
    if (r === undefined || c === undefined) continue;
    m[r][c] += 1;
  }
  return m;
}

export interface DimensionStat {
  key: string;
  label: string;
  n: number;
  agreementPct: number | null;
  kappa: number | null;
  critical: boolean;
}

export interface VersionStat {
  version: string;
  n: number;
  agreementPct: number | null;
  kappa: number | null;
}

export interface InterRaterStat {
  /** Replies labelled by 2+ humans. */
  overlappingReplies: number;
  comparisons: number;
  agreementPct: number | null;
  kappa: number | null;
}

export interface AgreementReport {
  totals: {
    labels: number;
    uniqueReplies: number;
    labelers: number;
    withJudge: number;
  };
  overall: {
    n: number;
    agreementPct: number | null;
    kappa: number | null;
    categories: readonly string[];
    matrix: number[][];
  };
  dimensions: DimensionStat[];
  byVersion: VersionStat[];
  interRater: InterRaterStat;
  /** Direction of judge error on the overall verdict. */
  bias: { tooLenient: number; tooStrict: number; exact: number };
  /** Judge said the reply was safe/in-bounds; a human disagreed. Highest priority. */
  criticalMisses: JoinedLabel[];
  /** All human/judge mismatches, newest first, for drill-down. */
  disagreements: JoinedLabel[];
}

const pct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);
const round = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000);

export function computeAgreement(labels: JoinedLabel[]): AgreementReport {
  const judged = labels.filter(l => l.llm !== null);

  // ── Overall verdict: human vs judge ──
  const overallPairs: Pair[] = judged.map(l => [l.human.overall, l.llm!.overall]);

  // ── Per-dimension ──
  const dimensions: DimensionStat[] = RUBRIC_DIMENSIONS.map(d => {
    const pairs: Pair[] = judged.map(l => [
      l.human[d.key] as string,
      (l.llm as unknown as Record<string, string>)[d.key],
    ]);
    return {
      key: d.key,
      label: d.label,
      n: pairs.length,
      agreementPct: pct(agreementRate(pairs)),
      kappa: round(cohensKappa(pairs, DIMENSION_CATEGORIES)),
      critical: Boolean(d.critical),
    };
  });

  // ── Per judge-prompt version: is v2 actually better than v1? ──
  const versions = Array.from(new Set(judged.map(l => l.judgeVersion || '—'))).sort();
  const byVersion: VersionStat[] = versions.map(version => {
    const subset = judged.filter(l => (l.judgeVersion || '—') === version);
    const pairs: Pair[] = subset.map(l => [l.human.overall, l.llm!.overall]);
    return {
      version,
      n: pairs.length,
      agreementPct: pct(agreementRate(pairs)),
      kappa: round(cohensKappa(pairs, OVERALL_CATEGORIES)),
    };
  });

  // ── Inter-rater: humans vs each other on replies both labelled ──
  const byReply = new Map<string, JoinedLabel[]>();
  for (const l of labels) {
    const arr = byReply.get(l.replyKey) ?? [];
    arr.push(l);
    byReply.set(l.replyKey, arr);
  }
  const humanPairs: Pair[] = [];
  let overlapping = 0;
  for (const group of byReply.values()) {
    // One label per labeler (keep their latest), then compare distinct labelers.
    const latest = new Map<string, JoinedLabel>();
    for (const l of group) {
      const prev = latest.get(l.labelerId);
      if (!prev || l.ts > prev.ts) latest.set(l.labelerId, l);
    }
    const raters = [...latest.values()];
    if (raters.length < 2) continue;
    overlapping++;
    for (let i = 0; i < raters.length; i++) {
      for (let j = i + 1; j < raters.length; j++) {
        humanPairs.push([raters[i].human.overall, raters[j].human.overall]);
      }
    }
  }

  // ── Judge bias direction on overall ──
  let tooLenient = 0;
  let tooStrict = 0;
  let exact = 0;
  for (const l of judged) {
    const h = SEVERITY[l.human.overall] ?? 0;
    const m = SEVERITY[l.llm!.overall] ?? 0;
    if (m === h) exact++;
    else if (m < h) tooLenient++; // judge rated it better than the human did
    else tooStrict++;
  }

  const mismatches = judged
    .filter(l => l.human.overall !== l.llm!.overall)
    .sort((a, b) => b.ts - a.ts);

  // Judge passed a critical dimension that a human failed — the errors that
  // matter most in a mental-health context.
  const criticalKeys = RUBRIC_DIMENSIONS.filter(d => d.critical).map(d => d.key);
  const criticalMisses = judged
    .filter(l =>
      criticalKeys.some(
        k =>
          (l.human as unknown as Record<string, string>)[k] === 'fail' &&
          (l.llm as unknown as Record<string, string>)[k] !== 'fail',
      ),
    )
    .sort((a, b) => b.ts - a.ts);

  return {
    totals: {
      labels: labels.length,
      uniqueReplies: byReply.size,
      labelers: new Set(labels.map(l => l.labelerId)).size,
      withJudge: judged.length,
    },
    overall: {
      n: overallPairs.length,
      agreementPct: pct(agreementRate(overallPairs)),
      kappa: round(cohensKappa(overallPairs, OVERALL_CATEGORIES)),
      categories: OVERALL_CATEGORIES,
      matrix: confusionMatrix(overallPairs, OVERALL_CATEGORIES),
    },
    dimensions,
    byVersion,
    interRater: {
      overlappingReplies: overlapping,
      comparisons: humanPairs.length,
      agreementPct: pct(agreementRate(humanPairs)),
      kappa: round(cohensKappa(humanPairs, OVERALL_CATEGORIES)),
    },
    bias: { tooLenient, tooStrict, exact },
    criticalMisses,
    disagreements: mismatches,
  };
}
