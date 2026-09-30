import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import type { CoachKpiState, Question, Score, Tier, YesNo } from './contract';
import { eligibility } from './contract';

/** Appended to the actual selected/published prompt; no extra inference call. */
export const KPI_PROMPT_CONTRACT = `
[INTERNAL MEASUREMENT CONTRACT — carey-kpi-v1]
Continue normal supportive coaching. Never delay safety or human support for measurement.
End every social-coaching reply with exactly one hidden metadata block:
<carey-kpi>{"mode":"prepare|reflect|missing","tier":"1|2|3|4|missing","checkin":false,"scriptChosen":"yes|no|missing"}</carey-kpi>
Use literal allowed values, not the pipe-separated examples. These are observations, not diagnoses.
Mode: prepare = rehearsing/planning a future situation; reflect = reflecting on one that happened.
Tier (AI estimate only): 1 = ordinary social worry; 2 = substantial distress without self-harm signal;
3 = self-harm/suicidal thoughts or severe distress without stated immediate intent;
4 = stated immediate danger, plan or intent. Use missing if the available context is insufficient.
Keep existing [CRISIS] and [REFERRAL] routing rules; this block does not replace them.
scriptChosen: yes only if the USER explicitly chooses/adopts a concrete script; no only for explicit rejection.
Set checkin true only when a concrete plan, script or reflection is complete enough for the natural Step 4 readiness check-in.
The app will ask the optional 1–3 readiness question then; do not add a second closing question or other rating survey.
Do not fabricate user ratings or ask usefulness/clarity questions yourself. Never disclose this block to the user.
`;

export const READINESS_QUESTION = 'How ready do you feel to try this?\n1. Still nervous\n2. A bit more ready\n3. Ready to try it\n\n(Optional — reply 1, 2 or 3, or skip.)';
const CLARITY_ANCHORS = '\n1. Not clear\n2. Somewhat clear\n3. Very clear\n\n(Optional — reply 1, 2 or 3, or skip.)';
const QUESTIONS: Record<Question, string> = {
  readiness: READINESS_QUESTION,
  usefulness: 'One optional question: was this conversation useful to you?\nReply yes, no, or skip.',
  clarityBefore: 'Thinking back to BEFORE this conversation, how clear were you about this situation?' + CLARITY_ANCHORS,
  clarityAfter: 'And NOW, how clear are you about this situation?' + CLARITY_ANCHORS,
};

export interface Measurement {
  mode: CoachKpiState['mode']; tier: Tier; checkin: boolean; scriptChosen: YesNo;
}

/** Allowlisted metadata is separate from clinical routing tags. Malformed blocks
 * are removed as well: internal bookkeeping must never appear in a Telegram reply. */
export function parseMeasurement(raw: string): { reply: string; measurement: Measurement | null } {
  const blocks = [...raw.matchAll(/<carey-kpi\s*>([\s\S]*?)<\/carey-kpi\s*>/gi)];
  const reply = raw.replace(/<carey-kpi\b[\s\S]*?(?:<\/carey-kpi\s*>|$)/gi, '').trim();
  if (blocks.length !== 1 || blocks[0][1].length > 1024) return { reply, measurement: null };
  try {
    const data = JSON.parse(blocks[0][1]);
    if (!data || Array.isArray(data) || typeof data !== 'object' ||
        !['prepare', 'reflect', 'missing'].includes(data.mode) ||
        !['1', '2', '3', '4', 'missing'].includes(data.tier) ||
        typeof data.checkin !== 'boolean' || !['yes', 'no', 'missing'].includes(data.scriptChosen)) {
      return { reply, measurement: null };
    }
    return { reply, measurement: { mode: data.mode, tier: data.tier, checkin: data.checkin, scriptChosen: data.scriptChosen } };
  } catch {
    return { reply, measurement: null };
  }
}

export function applyMeasurement(kpi: CoachKpiState, measurement: Measurement | null, canAsk: boolean): CoachKpiState {
  const next = { ...kpi, facts: [...kpi.facts], tier: measurement?.tier ?? 'missing' as Tier };
  if (!measurement || measurement.tier === 'missing') next.tierHistoryComplete = false;
  if (measurement) {
    if (measurement.mode !== 'missing') next.mode = measurement.mode;
    if (measurement.tier !== 'missing') {
      next.maxTier = String(Math.max(Number(next.maxTier === 'missing' ? 0 : next.maxTier), Number(measurement.tier))) as Tier;
      next.facts.push({ eventType: 'tier_estimated', tier: measurement.tier });
    }
    if (measurement.scriptChosen !== 'missing' && measurement.scriptChosen !== next.scriptChosen) {
      next.scriptChosen = measurement.scriptChosen;
      next.facts.push({ eventType: 'script_selected', response: measurement.scriptChosen });
    }
    if (canAsk && measurement.checkin && !next.checkinReached) {
      next.checkinReached = true;
      next.pendingQuestion = 'readiness';
      next.facts.push({ eventType: 'checkin_reached', question: 'readiness', requiresDelivery: true });
    }
  }
  return next;
}

/** Only an answer to an outstanding question is a score. "2" elsewhere is not. */
export function parseAnswer(question: Question, raw: string): Score | YesNo | null {
  const text = raw.trim().toLowerCase();
  if (/^(skip|missing|prefer not to say)$/.test(text)) return 'missing';
  if (question === 'usefulness') {
    if (/^(yes|y)$/.test(text)) return 'yes';
    if (/^(no|n)$/.test(text)) return 'no';
    return null;
  }
  const match = text.match(/^([123])\.?$/);
  return match ? match[1] as Score : null;
}

export interface CoachMeasurementServices {
  claimFeedback(userId: string): Promise<'usefulness' | 'clarity' | null>;
  scenarioStarted?(state: CareyBotState): Promise<void>;
  responseRecorded?(state: CareyBotState, fact: import('./contract').KpiFact): Promise<void>;
}

/** Feedback answers are handled without invoking AI. All other text returns to
 * ordinary coaching; the router checks crisis/restart/menu before this node. */
export function makeFeedbackNode(scheduler: CoachMeasurementServices) {
  return async (state: CareyBotState): Promise<NodeResult> => {
    const current = state.kpi!;
    const question = current.pendingQuestion!;
    const raw = state.messages[state.messages.length - 1]?.content ?? '';
    const answer = parseAnswer(question, raw);
    if (answer === null) throw new Error('Feedback node requires a bound answer');
    const next: CoachKpiState = {
      ...current, [question]: answer, pendingQuestion: null,
      facts: [...current.facts, { eventType: 'response_recorded', question, response: answer, feedbackId: current.feedbackId }],
    };
    // This participant answer is already observed. Save it before a later
    // reply/session-persistence failure can erase an otherwise valid rating.
    if (scheduler.responseRecorded) await scheduler.responseRecorded({ ...state, kpi: next }, next.facts[next.facts.length - 1]);
    let response = 'Thanks for sharing. We can keep going, or type menu to work on something else.';
    if (question === 'clarityBefore' && answer !== 'missing') {
      next.pendingQuestion = 'clarityAfter';
      response = QUESTIONS.clarityAfter;
      next.facts.push({ eventType: 'feedback_offered', question: 'clarityAfter', requiresDelivery: true });
    } else if (question === 'readiness' && answer !== 'missing' && eligibility(state.age) === 'eligible') {
      // Cooldown/storage failure means no survey, never a blocked conversation.
      let offer: 'usefulness' | 'clarity' | null = null;
      try { offer = await scheduler.claimFeedback(state.userId); } catch { /* analytics is optional */ }
      if (offer) {
        next.feedbackId = `${state.sessionId}:${next.scenarioRunId}:feedback`;
        next.pendingQuestion = offer === 'clarity' ? 'clarityBefore' : 'usefulness';
        response = QUESTIONS[next.pendingQuestion];
        next.facts.push({ eventType: 'feedback_offered', question: next.pendingQuestion, requiresDelivery: true });
      }
    }
    return { kpi: next, pendingResponse: response };
  };
}
