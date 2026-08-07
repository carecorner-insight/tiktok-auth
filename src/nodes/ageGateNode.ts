import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';
import {
  CSSRS_QUESTIONS,
  SCENARIO_MENU_TEXT,
  AGE_REPROMPT_TEXT,
} from '../config/questionnaire';
import { screenerEnabled } from '../lib/pivotFlags';

const OUT_OF_SCOPE_MESSAGE =
  "Thanks for letting me know.\n\n" +
  "This space is mainly designed for young people aged 13–25, but I still want to make sure you're supported.\n\n" +
  "If you'd like, you can still tell me what's been going on, and I'll do my best to support you here.\n\n" +
  "And if you'd like extra support, you can also reach the Care Corner team here:\nhttps://carecorner-ist.my.site.com/insight/";

const QUESTIONNAIRE_PREAMBLE =
  "Thanks! I'd like to ask you 4 short questions about how you've been feeling over the past 2 weeks. " +
  "Please answer Yes or No to each one.";

export function ageGateNode(state: CareyBotState): NodeResult {
  const input = getLastUserInput(state);
  const match = input.match(/\d{1,3}/);
  const age = match ? parseInt(match[0], 10) : null;
  const plausible = age !== null && age >= 5 && age <= 120;

  // ── Growing We build (F2): a question, never a gate ──────────────────────
  // Every outcome reaches the menu. No answer excludes anyone, and no age is
  // "out of scope" — the age is captured for KPI reporting and to auto-select
  // the referral link (25 & under → INSIGHT, 26+ → CREST).
  if (!screenerEnabled()) {
    if (plausible) {
      return { age, conversationPhase: 'menu', pendingResponse: SCENARIO_MENU_TEXT };
    }
    // First non-answer → one re-prompt (stay in ageCheck; the copy still
    // contains "how old are you" so the router routes back here).
    if (!state.ageAsked) {
      return { ageAsked: true, pendingResponse: AGE_REPROMPT_TEXT };
    }
    // Second non-answer → proceed with age unknown.
    return { age: null, conversationPhase: 'menu', pendingResponse: SCENARIO_MENU_TEXT };
  }

  // Couldn't read a plausible age → re-prompt. Keep the "how old are you"
  // marker so the router keeps routing back here.
  if (!plausible) {
    return {
      pendingResponse:
        "Sorry, I didn't quite catch that — how old are you? " +
        "Please reply with just a number (for example, 15).",
    };
  }

  // In scope (13–25) → record age and move to the screener.
  if (age >= 13 && age <= 25) {
    return {
      age,
      conversationPhase: 'questionnaire',
      pendingResponse: `${QUESTIONNAIRE_PREAMBLE}\n\n${CSSRS_QUESTIONS[0].text}\n\nYes / No`,
    };
  }

  // Out of scope (too young / too old) → still record age, route to support.
  return {
    age,
    conversationPhase: 'option',
    selectedOption: 1,
    pendingResponse: OUT_OF_SCOPE_MESSAGE,
  };
}
