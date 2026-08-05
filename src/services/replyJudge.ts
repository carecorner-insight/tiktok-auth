import {
  buildJudgePrompt,
  JUDGE_VERSION,
  RUBRIC_DIMENSIONS,
  CRITICAL_KEYS,
  type JudgeVerdict,
  type DimensionVerdict,
  type OverallVerdict,
} from '../config/judgeRubric';
import { formatUnitForJudge, type ReplyUnit } from '../lib/replyUnits';

// Same chat() shape as AIBotsClient / DirectLLMClient, so the judge can run on
// whichever SG-hosted provider is configured.
//
// PDPA: the judge reads conversation content, so it MUST run on Singapore-
// approved infrastructure — AIBots via Directus, or Qwen via dashscope-intl.
// Never point this at a non-SG model, even for "just labelling".
//
// Bias note: prefer a judge model DIFFERENT from the one that generated the
// reply. Models systematically over-rate their own style, which would quietly
// inflate scores for whichever provider is live.
interface IChatClient {
  chat(
    chatId: string | null,
    text: string,
    primeMessage?: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<{ reply: string; chatId: string }>;
}

const DIM_VALUES: DimensionVerdict[] = ['pass', 'fail', 'na'];
const OVERALL_VALUES: OverallVerdict[] = ['good', 'borderline', 'bad'];

/** Strips code fences / prose and returns the first JSON object found. */
function extractJson(raw: string): unknown | null {
  const fenced = raw.replace(/```(?:json)?/gi, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Parses a judge reply into a verdict. Returns null when the model produced
 * something unusable — the caller records that as an un-judged unit rather than
 * inventing a score.
 */
export function parseJudgeReply(raw: string): JudgeVerdict | null {
  const obj = extractJson(raw);
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;

  const dims: Partial<Record<string, DimensionVerdict>> = {};
  for (const d of RUBRIC_DIMENSIONS) {
    const v = typeof o[d.key] === 'string' ? (o[d.key] as string).toLowerCase().trim() : '';
    if (!DIM_VALUES.includes(v as DimensionVerdict)) return null;
    dims[d.key] = v as DimensionVerdict;
  }

  const rawOverall =
    typeof o.overall === 'string' ? o.overall.toLowerCase().trim() : '';
  if (!OVERALL_VALUES.includes(rawOverall as OverallVerdict)) return null;

  // Enforce the rubric's hard rule locally rather than trusting the model to
  // have applied it: a critical failure is always 'bad'.
  const criticalFailed = CRITICAL_KEYS.some(k => dims[k] === 'fail');
  const overall: OverallVerdict = criticalFailed ? 'bad' : (rawOverall as OverallVerdict);

  return {
    safety: dims.safety as DimensionVerdict,
    shape: dims.shape as DimensionVerdict,
    tone: dims.tone as DimensionVerdict,
    referral: dims.referral as DimensionVerdict,
    boundaries: dims.boundaries as DimensionVerdict,
    overall,
    rationale: typeof o.rationale === 'string' ? o.rationale.trim().slice(0, 600) : '',
  };
}

export class ReplyJudge {
  constructor(
    private readonly llm: IChatClient,
    readonly version: string = JUDGE_VERSION,
  ) {}

  /** Judges one reply-in-context. Returns null if the model reply was unusable. */
  async judge(unit: ReplyUnit): Promise<JudgeVerdict | null> {
    const result = await this.llm.chat(null, formatUnitForJudge(unit), buildJudgePrompt());
    return parseJudgeReply(result.reply);
  }
}
