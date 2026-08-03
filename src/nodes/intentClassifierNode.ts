import type { CareyBotState, MenuOption } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';
import { MENU_TEXT } from '../config/questionnaire';
import type { MenuMode } from '../lib/menuMode';
import { containsCrisisPhrase } from '../lib/crisisDetection';

// ── Intent classifier — replaces the numeric-only optionRouter ───────────────
//
// Runs in two situations:
//
//  A. INITIAL SELECTION (conversationPhase === 'menu') — the user has just been
//     asked the open-ended entry question and we pick their lane.
//  B. RE-EVALUATION (conversationPhase === 'option', intent mode only) — the
//     router sends EVERY in-lane turn back here so the bot can seamlessly switch
//     lanes mid-conversation (e.g. Talk → Social Coach). Here the default is to
//     STAY in the current lane; we only switch on a confident, different intent,
//     and we NEVER fall back to the menu (that would derail a live conversation).
//
// Routing outcomes (both situations):
//   1. Numeric reply 1/2/3        → mapped directly (backward compatible; also
//                                    used by the re-engagement nudge menu).
//   2. Local crisis keyword check → phase 'crisis' (fail-safe: never depends
//                                    on the LLM being reachable).
//   3. LLM classification         → TALK | SOCIAL | HUMAN | CRISIS | UNCLEAR.
//   4. UNCLEAR / LLM failure      → initial: numbered menu; re-eval: stay put.
//
// On a lane SWITCH we reset aiBotChatId (each lane is a separate backend session)
// and set justSwitchedLane so the target node bridges with prior context.

export const INTENT_CLASSIFIER_PROMPT =
  `You are an intent classifier for CareyBot, a mental-health support chatbot ` +
  `for young people aged 13-25 in Singapore. Based on the user's latest message ` +
  `(and any prior conversation context provided), classify what the user needs ` +
  `RIGHT NOW.\n\n` +
  `Labels:\n` +
  `CRISIS - any mention of suicide, self-harm, wanting to die, disappear or not ` +
  `wake up, feeling unsafe, or intent to hurt themselves or someone else. ` +
  `When in doubt between CRISIS and any other label, choose CRISIS.\n` +
  `SOCIAL - wants help with, or to practise or prepare for, a social situation: ` +
  `conflict with friends or family, being left out, speaking up, confessing, ` +
  `apologising, presentations, interviews, meeting new people.\n` +
  `HUMAN - asks to speak with a real person, counsellor, therapist, or staff.\n` +
  `TALK - wants to talk through feelings, stress, school, or anything on their ` +
  `mind that is not primarily a social-situation rehearsal.\n` +
  `UNCLEAR - a bare greeting, gibberish, spam, or you genuinely cannot tell.\n\n` +
  `Reply with exactly ONE word: CRISIS, SOCIAL, HUMAN, TALK, or UNCLEAR. ` +
  `No punctuation, no explanation.`;

export type Intent = 'CRISIS' | 'SOCIAL' | 'HUMAN' | 'TALK' | 'UNCLEAR';

const INTENT_TO_OPTION: Record<Exclude<Intent, 'CRISIS' | 'UNCLEAR'>, MenuOption> = {
  TALK: 1,
  SOCIAL: 2,
  HUMAN: 3,
};

const VALID_OPTIONS = new Set([1, 2, 3]);

// Short acknowledgements / continuers carry no lane-switch signal. During a
// re-evaluation we keep the user in their current lane instead of classifying
// them (prevents a neutral "ok thanks" from flip-flopping the conversation).
const ACK_WORDS = new Set([
  'ok', 'okay', 'k', 'kk', 'thanks', 'thank you', 'thx', 'ty', 'yeah', 'yea', 'yes',
  'yep', 'yup', 'sure', 'cool', 'alright', 'right', 'got it', 'mm', 'mmm', 'mhm',
  'hmm', 'nice', 'great', 'i see', 'ic', 'oh', 'ah', 'haha', 'lol',
]);

// containsCrisisPhrase + the phrase list now live in ../lib/crisisDetection so
// the router can share the same deterministic backstop on every turn.

const FALLBACK_TEXT =
  `I want to make sure I point you to the right kind of support.\n\n` + MENU_TEXT;

interface IIntentLLM {
  chat(
    chatId: string | null,
    text: string,
    primeMessage?: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<{ reply: string; chatId: string }>;
}

/** Extracts the intent label from the LLM reply, tolerating minor noise. */
export function parseIntentReply(raw: string): Intent | null {
  const cleaned = raw.trim().toUpperCase();
  // Exact match first, then "first word" match ("TALK." / "TALK - because...").
  const candidates: Intent[] = ['CRISIS', 'SOCIAL', 'HUMAN', 'TALK', 'UNCLEAR'];
  const exact = candidates.find(c => cleaned === c);
  if (exact) return exact;
  const firstWord = cleaned.replace(/[^A-Z\s]/g, ' ').trim().split(/\s+/)[0];
  return candidates.find(c => firstWord === c) ?? null;
}

export function makeIntentClassifierNode(intentLLM: IIntentLLM, mode: MenuMode = 'intent') {
  return async function intentClassifierNode(state: CareyBotState): Promise<NodeResult> {
    const normalized = getLastUserInput(state);
    const current = state.selectedOption;
    // Re-evaluation of an in-lane turn (intent mode) vs. the initial menu pick.
    const isReeval = state.conversationPhase === 'option' && current != null;

    // Route into a lane, distinguishing "stay" (keep the backend session) from a
    // "switch" (fresh session + bridge with prior context).
    const goToLane = (target: MenuOption): NodeResult => {
      if (isReeval && target === current) {
        return { selectedOption: target, conversationPhase: 'option', justSwitchedLane: false };
      }
      if (isReeval) {
        // Mid-conversation switch to a different lane.
        console.log(`[intent] switching lane ${current} → ${target}`);
        return {
          selectedOption: target,
          conversationPhase: 'option',
          aiBotChatId: null,
          justSwitchedLane: true,
          pendingHandoff: null,
        };
      }
      // Initial selection from the menu.
      return { selectedOption: target, conversationPhase: 'option', justSwitchedLane: false };
    };

    const stay = (): NodeResult => goToLane(current as MenuOption);

    const toCrisis = (): NodeResult => ({
      crisisDetected: true,
      conversationPhase: 'crisis',
      selectedOption: null,
    });

    const toMenu = (): NodeResult => ({
      selectedOption: null,
      pendingResponse: FALLBACK_TEXT,
      conversationPhase: 'menu',
      justSwitchedLane: false,
    });

    // 1 ── Whole-message numeric selection (exactly "1"/"2"/"3"). A message that
    //      merely *starts* with a digit ("3 times this week") is NOT a selection.
    const digits = normalized.replace(/[.\s]/g, '');
    if (/^[123]$/.test(digits)) {
      return goToLane(Number(digits) as MenuOption);
    }

    // 2 ── Local crisis pre-check — runs in ALL modes/situations. Never the LLM.
    if (containsCrisisPhrase(normalized)) {
      console.log('[intent] local crisis phrase matched → crisis');
      return toCrisis();
    }

    // 3 ── NUMBERED mode: no LLM classification. (In numbered mode the router
    //      never sends in-lane turns here, so this is only the initial menu pick;
    //      anything that isn't a valid number re-presents the numbered menu.)
    if (mode === 'numbered') {
      return isReeval ? stay() : toMenu();
    }

    // 4 ── Nothing to classify.
    if (!normalized) {
      return isReeval ? stay() : toMenu();
    }

    // 5 ── Bare acknowledgement during a re-eval → keep the lane, skip the LLM.
    if (isReeval && ACK_WORDS.has(normalized)) {
      return stay();
    }

    // 6 ── LLM classification of the RAW user text (normalisation strips signal
    //      the model can use, e.g. "???", emoji, casing). During a re-eval we
    //      also give it recent context so it judges the conversation, not one line.
    const rawText =
      [...state.messages].reverse().find(m => m.role === 'user')?.content ?? normalized;
    const historyForClassify = isReeval
      ? state.messages.slice(Math.max(0, state.messages.length - 7), state.messages.length - 1)
      : undefined;

    let intent: Intent | null = null;
    try {
      const result = await intentLLM.chat(null, rawText, undefined, historyForClassify);
      intent = parseIntentReply(result.reply);
      console.log(`[intent] llm reply="${result.reply.slice(0, 40)}" → ${intent} (reeval=${isReeval})`);
    } catch (err) {
      console.error('[intent] classifier LLM failed', err);
    }

    if (intent === 'CRISIS') return toCrisis();

    if (intent && intent !== 'UNCLEAR') {
      return goToLane(INTENT_TO_OPTION[intent]);
    }

    // 7 ── UNCLEAR or LLM failure → initial: numbered menu; re-eval: stay put.
    return isReeval ? stay() : toMenu();
  };
}
