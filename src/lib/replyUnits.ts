import { redactPII } from './pii';

/**
 * Turns a stored record (an eval transcript today, a live conversation log
 * later) into "reply-in-context" units — the thing a human or the LLM judge
 * actually rates: ONE Carey reply, plus the turns that preceded it.
 */

export interface ContextTurn {
  role: 'youth' | 'carey';
  text: string;
}

export interface ReplyUnit {
  /** Stable identity, so a label always points at the same reply. */
  replyKey: string;
  source: 'eval' | 'conversation';
  reply: string;
  context: ContextTurn[];
  turnIndex: number;
  phase: string | null;
  // Provenance — carried through to SharePoint/Power BI for slicing.
  runId?: string;
  persona?: string;
  menuMode?: string;
  userType?: string;
  conversationId?: string;
}

/**
 * Phases whose Carey turn is AI-GENERATED and therefore worth judging.
 *
 * Everything else (age check, the C-SSRS screener, the safety check, the menu
 * text) is deterministic node output — fixed strings from config. Judging those
 * would flood the corpus with identical rows and teach the judge nothing.
 */
export const AI_GENERATED_PHASES = ['option', 'crisis'] as const;

/** How many preceding turns to carry as context. */
export const CONTEXT_WINDOW = 6;

interface EvalTranscriptTurn {
  role: 'youth' | 'carey';
  text: string;
  phase?: string;
}

interface EvalRecord {
  runId?: unknown;
  persona?: unknown;
  menuMode?: unknown;
  userType?: unknown;
  transcript?: unknown;
}

function isTurn(v: unknown): v is EvalTranscriptTurn {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return (t.role === 'youth' || t.role === 'carey') && typeof t.text === 'string';
}

/**
 * Extracts judgeable reply units from one eval result record.
 *
 * Eval transcripts are SYNTHETIC (roleplayed personas, no real users), which is
 * why this corpus is safe to review first. redactPII is still applied as
 * defence in depth, and because the same function will serve live logs later.
 */
export function unitsFromEvalRecord(
  record: unknown,
  opts: { phases?: readonly string[]; contextWindow?: number } = {},
): ReplyUnit[] {
  if (typeof record !== 'object' || record === null) return [];
  const r = record as EvalRecord;
  if (!Array.isArray(r.transcript)) return [];

  const phases = opts.phases ?? AI_GENERATED_PHASES;
  const window = opts.contextWindow ?? CONTEXT_WINDOW;

  const runId = typeof r.runId === 'string' ? r.runId : '';
  const persona = typeof r.persona === 'string' ? r.persona : '';
  const menuMode = typeof r.menuMode === 'string' ? r.menuMode : '';
  const userType = typeof r.userType === 'string' ? r.userType : undefined;

  const turns = r.transcript.filter(isTurn);
  const units: ReplyUnit[] = [];

  turns.forEach((turn, i) => {
    if (turn.role !== 'carey') return;
    const phase = typeof turn.phase === 'string' ? turn.phase : null;
    if (!phase || !phases.includes(phase)) return;
    const reply = turn.text.trim();
    if (!reply) return;

    const context = turns
      .slice(Math.max(0, i - window), i)
      .map(t => ({ role: t.role, text: redactPII(t.text) }));

    units.push({
      replyKey: `eval:${runId}#${persona}#${menuMode || '-'}#${i}`,
      source: 'eval',
      reply: redactPII(reply),
      context,
      turnIndex: i,
      phase,
      runId,
      persona,
      menuMode,
      userType,
    });
  });

  return units;
}

/** Renders a unit as the plain-text block shown to the judge. */
export function formatUnitForJudge(unit: ReplyUnit): string {
  const ctx = unit.context.length
    ? unit.context.map(t => `${t.role === 'youth' ? 'User' : 'Carey'}: ${t.text}`).join('\n')
    : '(no earlier turns — this is the start of the conversation)';

  return (
    `CONVERSATION SO FAR:\n${ctx}\n\n` +
    `CAREY'S REPLY TO JUDGE:\n${unit.reply}`
  );
}
