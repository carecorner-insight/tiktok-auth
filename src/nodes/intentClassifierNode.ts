import type { CareyBotState, MenuOption } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';
import { MENU_TEXT } from '../config/questionnaire';
import type { MenuMode } from '../lib/menuMode';
import { containsCrisisPhrase } from '../lib/crisisDetection';

// ── Intent classifier — replaces the numeric-only optionRouter ───────────────
//
// The post-screener prompt is now open-ended ("What brings you here today?"),
// so this node routes free text as well as the legacy 1/2/3 replies:
//
//   1. Numeric reply 1/2/3        → mapped directly (backward compatible; also
//                                    used by the re-engagement nudge menu).
//   2. Local crisis keyword check → phase 'crisis' (fail-safe: never depends
//                                    on the LLM being reachable).
//   3. LLM classification         → TALK | SOCIAL | HUMAN | CRISIS | UNCLEAR.
//   4. UNCLEAR or LLM failure     → fall back to the numbered menu.
//
// The LLM client is any object with the shared chat() signature; in production
// this is a DirectLLMClient constructed with INTENT_CLASSIFIER_PROMPT as its
// system prompt (cheap, single-token output, no AIBots session needed).

export const INTENT_CLASSIFIER_PROMPT =
  `You are an intent classifier for CareyBot, a mental-health support chatbot ` +
  `for young people aged 13-25 in Singapore. The user was just asked: ` +
  `"What brings you here today?" and you must classify their reply.\n\n` +
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

    // 1 ── Numeric selection — works in BOTH modes (the numbered menu, and the
    //      legacy/nudge menu in intent mode).
    const parsed = parseInt(normalized.replace(/[.\s]/g, ''), 10);
    if (VALID_OPTIONS.has(parsed)) {
      return {
        selectedOption: parsed as MenuOption,
        conversationPhase: 'option',
      };
    }

    // 2 ── Local crisis pre-check — runs in BOTH modes so a disclosure typed
    //      instead of a menu number is never missed. Never depends on the LLM.
    if (containsCrisisPhrase(normalized)) {
      console.log('[intent] local crisis phrase matched → crisis');
      return {
        crisisDetected: true,
        conversationPhase: 'crisis',
        selectedOption: null,
      };
    }

    // 3 ── NUMBERED mode: no LLM classification — anything that isn't a valid
    //      number (or a crisis disclosure) just re-presents the numbered menu.
    if (mode === 'numbered') {
      return { selectedOption: null, pendingResponse: FALLBACK_TEXT, conversationPhase: 'menu' };
    }

    // Nothing classifiable (empty after normalisation) → re-present menu.
    if (!normalized) {
      return { selectedOption: null, pendingResponse: FALLBACK_TEXT, conversationPhase: 'menu' };
    }

    // 3 ── LLM classification of the RAW user text (normalisation strips
    //      signal the model can use, e.g. "???", emoji, casing).
    const rawText =
      [...state.messages].reverse().find(m => m.role === 'user')?.content ?? normalized;

    let intent: Intent | null = null;
    try {
      const result = await intentLLM.chat(null, rawText);
      intent = parseIntentReply(result.reply);
      console.log(`[intent] llm reply="${result.reply.slice(0, 40)}" → ${intent}`);
    } catch (err) {
      console.error('[intent] classifier LLM failed — falling back to menu', err);
    }

    if (intent === 'CRISIS') {
      return {
        crisisDetected: true,
        conversationPhase: 'crisis',
        selectedOption: null,
      };
    }

    if (intent && intent !== 'UNCLEAR') {
      return {
        selectedOption: INTENT_TO_OPTION[intent],
        conversationPhase: 'option',
      };
    }

    // 4 ── UNCLEAR or LLM failure → numbered menu as the safety net.
    return {
      selectedOption: null,
      pendingResponse: FALLBACK_TEXT,
      conversationPhase: 'menu',
    };
  };
}
