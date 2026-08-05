import type { RedisClient } from './redis';
import type { ReplyUnit } from './replyUnits';
import type { JudgeVerdict, DimensionVerdict, OverallVerdict } from '../config/judgeRubric';

/**
 * Working store for the labelling platform.
 *
 * Redis holds the review corpus and a mirror of the labels so the UI and the
 * export endpoint are fast. SharePoint (via Power Automate) is the PERMANENT
 * archive and the source Power BI reads — same split as the eval results.
 */

const UNITS_KEY = 'label:units';
const LABELS_KEY = 'label:human';
const MAX_UNITS = 2000;
const MAX_LABELS = 5000;
const TTL_SECONDS = 180 * 24 * 60 * 60; // 180 days

export interface StoredUnit extends ReplyUnit {
  /** The judge's proposal, shown pre-filled in the review UI. Null if unusable. */
  llm: JudgeVerdict | null;
  judgeVersion: string;
  ingestedAt: number;
}

export interface HumanLabel {
  replyKey: string;
  labelerId: string;
  labelerName: string;
  safety: DimensionVerdict;
  shape: DimensionVerdict;
  tone: DimensionVerdict;
  referral: DimensionVerdict;
  boundaries: DimensionVerdict;
  overall: OverallVerdict;
  rationale: string;
  /** Judge version the reviewer was shown — pins accuracy stats to a prompt. */
  judgeVersion: string;
  /**
   * Whether there was a judge proposal to compare against at all. Split out from
   * agreedWithLlm so both are plain booleans: a three-state field (agree /
   * disagree / nothing-to-compare) is awkward in SharePoint and Power BI.
   * Filter on hasJudgeProposal = true before reading agreement rates.
   */
  hasJudgeProposal: boolean;
  /** True only when the human's verdicts matched the judge's exactly. */
  agreedWithLlm: boolean;
  ts: number;
}

function parseList<T>(raw: string[]): T[] {
  const out: T[] = [];
  for (const item of raw) {
    try {
      out.push(JSON.parse(item) as T);
    } catch {
      // skip malformed
    }
  }
  return out;
}

export async function readUnits(redis: RedisClient): Promise<StoredUnit[]> {
  return parseList<StoredUnit>(await redis.lrange(UNITS_KEY, 0, MAX_UNITS - 1));
}

/**
 * Appends units, skipping any replyKey already present so re-running the judge
 * never duplicates the queue. Returns how many were actually added.
 */
export async function pushUnits(redis: RedisClient, units: StoredUnit[]): Promise<number> {
  const existing = new Set((await readUnits(redis)).map(u => u.replyKey));
  const fresh = units.filter(u => !existing.has(u.replyKey));
  if (!fresh.length) return 0;

  await redis.lpush(UNITS_KEY, ...fresh.map(u => JSON.stringify(u)));
  await redis.ltrim(UNITS_KEY, 0, MAX_UNITS - 1);
  await redis.expire(UNITS_KEY, TTL_SECONDS);
  return fresh.length;
}

export async function readHumanLabels(redis: RedisClient): Promise<HumanLabel[]> {
  return parseList<HumanLabel>(await redis.lrange(LABELS_KEY, 0, MAX_LABELS - 1));
}

export async function pushHumanLabel(redis: RedisClient, label: HumanLabel): Promise<void> {
  await redis.lpush(LABELS_KEY, JSON.stringify(label));
  await redis.ltrim(LABELS_KEY, 0, MAX_LABELS - 1);
  await redis.expire(LABELS_KEY, TTL_SECONDS);
}

/** True when every rubric field of the human label matches the judge's proposal. */
export function verdictsAgree(
  human: Pick<HumanLabel, 'safety' | 'shape' | 'tone' | 'referral' | 'boundaries' | 'overall'>,
  llm: JudgeVerdict | null,
): boolean | null {
  if (!llm) return null;
  return (
    human.safety === llm.safety &&
    human.shape === llm.shape &&
    human.tone === llm.tone &&
    human.referral === llm.referral &&
    human.boundaries === llm.boundaries &&
    human.overall === llm.overall
  );
}

/**
 * The next units for a given labeler: those they have not personally labelled
 * yet, oldest-ingested first so the corpus is worked through in order.
 *
 * Not filtered by OTHER labelers' work — overlapping labels are what make
 * inter-rater agreement measurable.
 */
export function queueFor(
  units: StoredUnit[],
  labels: HumanLabel[],
  labelerId: string,
  limit: number,
): StoredUnit[] {
  const done = new Set(
    labels.filter(l => l.labelerId === labelerId).map(l => l.replyKey),
  );
  return units
    .filter(u => !done.has(u.replyKey))
    .sort((a, b) => a.ingestedAt - b.ingestedAt)
    .slice(0, limit);
}
