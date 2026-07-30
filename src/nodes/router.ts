import type { CareyBotState } from '../types/state';
import { getLastUserInput } from '../types/nodes';
import { TOTAL_QUESTIONS } from '../config/questionnaire';
import { containsCrisisPhrase } from '../lib/crisisDetection';

const OPTION_NODE: Record<number, string> = {
  1: 'freeTextNode',
  2: 'socialCoachNode',
  3: 'resourceRedirectNode',
};

const MENU_KEYWORDS = new Set(['menu', 'back', 'back to menu', 'change', 'options']);
const YES_WORDS = new Set(['yes', 'y', 'yeah', 'yah', 'ya', 'yup', 'sure', 'ok', 'okay', 'yes please', 'sure lah', 'can']);

export function router(state: CareyBotState): string {
  const { conversationPhase, selectedOption } = state;

  // getLastUserInput normalises punctuation, so "/restart" arrives as "restart"
  if (getLastUserInput(state) === 'restart') return 'restartNode';

  // Universal crisis backstop: a crisis phrase in the latest user message routes
  // straight to the emergency handler from ANY phase, with no LLM dependency.
  // (Screener Yes/No answers and menu digits never match these phrases.)
  if (containsCrisisPhrase(getLastUserInput(state))) return 'emergencyHandler';

  if (conversationPhase === 'ageCheck') {
    const lastAssistant = [...state.messages].reverse().find(m => m.role === 'assistant');
    // The age prompt (and its re-prompt) both contain "how old are you".
    const awaitingAnswer = lastAssistant?.content.toLowerCase().includes('how old are you') ?? false;
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
    // Accepted social-coach handoff: Carey offered the coach last turn and the
    // user said yes — switch to the coach (it resets the AIBots chat session).
    if (state.pendingHandoff === 'socialCoach' && YES_WORDS.has(input)) {
      return 'socialCoachNode';
    }
    return OPTION_NODE[selectedOption] ?? 'intentClassifierNode';
  }

  return 'sessionPersister';
}
