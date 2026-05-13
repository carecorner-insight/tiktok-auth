import type { CareyBotState } from '../types/state';
import { getLastUserInput } from '../types/nodes';

const OPTION_NODE: Record<number, string> = {
  1: 'freeTextNode',
  2: 'wellbeingCheckNode',
  3: 'stressManagementNode',
  4: 'resourceRedirectNode',
};

const MENU_KEYWORDS = new Set(['menu', 'back', 'back to menu', 'change', 'options']);

export function router(state: CareyBotState): string {
  const { conversationPhase, selectedOption } = state;

  if (conversationPhase === 'questionnaire') {
    const lastAssistant = [...state.messages]
      .reverse()
      .find(m => m.role === 'assistant');
    const awaitingAnswer = lastAssistant?.content.includes('Yes / No') ?? false;
    return awaitingAnswer ? 'answerEvaluator' : 'questionnaireNode';
  }

  if (conversationPhase === 'menu') return 'optionRouter';

  if (conversationPhase === 'option' && selectedOption) {
    if (MENU_KEYWORDS.has(getLastUserInput(state))) return 'menuPresenter';
    return OPTION_NODE[selectedOption] ?? 'optionRouter';
  }

  return 'sessionPersister';
}
