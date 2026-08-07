import type { CareyBotState } from '../types/state';
import { getLastUserInput } from '../types/nodes';
import { TOTAL_QUESTIONS } from '../config/questionnaire';
import { containsCrisisPhrase } from '../lib/crisisDetection';
import { scenarioMenuEnabled } from '../lib/pivotFlags';
import type { MenuMode } from '../lib/menuMode';

// Triage build: three distinct lanes.
const TRIAGE_OPTION_NODE: Record<number, string> = {
  1: 'freeTextNode',
  2: 'socialCoachNode',
  3: 'resourceRedirectNode',
};

// Growing We build: all six menu options are SCENARIOS, so every one of them
// feeds the social coach — the scenario just changes the prime it opens with.
const SCENARIO_OPTION_NODE: Record<number, string> = {
  1: 'socialCoachNode',
  2: 'socialCoachNode',
  3: 'socialCoachNode',
  4: 'socialCoachNode',
  5: 'socialCoachNode',
  6: 'socialCoachNode',
};

const optionNodeMap = (): Record<number, string> =>
  scenarioMenuEnabled() ? SCENARIO_OPTION_NODE : TRIAGE_OPTION_NODE;

const MENU_KEYWORDS = new Set(['menu', 'back', 'back to menu', 'change', 'options']);
const YES_WORDS = new Set(['yes', 'y', 'yeah', 'yah', 'ya', 'yup', 'sure', 'ok', 'okay', 'yes please', 'sure lah', 'can']);

/**
 * The router decides the next node purely from state.
 *
 * The only mode-dependent branch is the `option` phase:
 *  - intent   → re-run intentClassifierNode EVERY turn so the bot can seamlessly
 *               switch lanes mid-conversation (e.g. Talk → Social Coach).
 *  - numbered → go straight to the selected lane node (no re-classification).
 *
 * Everything before that (restart, the universal crisis backstop, age check,
 * questionnaire, safety check, crisis, menu) is identical in both modes.
 */
export function makeRouter(mode: MenuMode = 'intent') {
  return function router(state: CareyBotState): string {
    const { conversationPhase, selectedOption } = state;

    // getLastUserInput normalises punctuation, so "/restart" arrives as "restart"
    if (getLastUserInput(state) === 'restart') return 'restartNode';

    // Universal crisis backstop: a crisis phrase in the latest user message routes
    // straight to the emergency handler from ANY phase, with no LLM dependency.
    // (Screener Yes/No answers and menu digits never match these phrases.)
    if (containsCrisisPhrase(getLastUserInput(state))) return 'emergencyHandler';

    if (conversationPhase === 'ageCheck') {
      const lastAssistant = [...state.messages].reverse().find(m => m.role === 'assistant');
      // The triage prompt (and its re-prompt) both contain "how old are you".
      // The Growing We re-prompt deliberately does not ("just a number is fine…"),
      // so ageAsked is what tells us we're still waiting on an answer there.
      const awaitingAnswer =
        state.ageAsked ||
        (lastAssistant?.content.toLowerCase().includes('how old are you') ?? false);
      return awaitingAnswer ? 'ageGateNode' : 'ageCheckNode';
    }

    if (conversationPhase === 'questionnaire') {
      // Stale session guard: if all questions already answered, go straight to menu
      if (state.questionIndex >= TOTAL_QUESTIONS) return 'menuPresenter';
      const lastAssistant = [...state.messages]
        .reverse()
        .find(m => m.role === 'assistant');
      const awaitingAnswer = lastAssistant?.content.includes('Yes / No') ?? false;
      return awaitingAnswer ? 'answerEvaluator' : 'questionnaireNode';
    }

    if (conversationPhase === 'safetyCheck') {
      const lastAssistant = [...state.messages].reverse().find(m => m.role === 'assistant');
      const awaitingAnswer = lastAssistant?.content.includes('Yes / No') ?? false;
      return awaitingAnswer ? 'safetyGateNode' : 'safetyCheckNode';
    }

    if (conversationPhase === 'crisis') return 'emergencyHandler';

    if (conversationPhase === 'menu') return 'intentClassifierNode';

    if (conversationPhase === 'option' && selectedOption) {
      const input = getLastUserInput(state);
      if (MENU_KEYWORDS.has(input)) return 'menuPresenter';
      // Accepted social-coach handoff (NUMBERED mode's confirm offer): Carey
      // offered the coach last turn and the user said yes — switch to the coach.
      if (state.pendingHandoff === 'socialCoach' && YES_WORDS.has(input)) {
        return 'socialCoachNode';
      }
      // Intent mode: re-classify every turn so the lane can adapt mid-conversation.
      // Numbered mode: stay in the chosen lane.
      if (mode === 'intent') return 'intentClassifierNode';
      return optionNodeMap()[selectedOption] ?? 'intentClassifierNode';
    }

    return 'sessionPersister';
  };
}

/** Default router (intent mode) — kept for callers/tests that don't need the toggle. */
export const router = makeRouter('intent');
