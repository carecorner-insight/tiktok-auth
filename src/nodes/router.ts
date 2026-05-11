import type { CareyBotState } from '@/types/state';

const OPTION_NODE: Record<number, string> = {
  1: 'freeTextNode',
  2: 'wellbeingCheckNode',
  3: 'stressManagementNode',
  4: 'resourceRedirectNode',
};

export function router(state: CareyBotState): string {
  const { conversationPhase, selectedOption } = state;

  if (conversationPhase === 'questionnaire') {
    // If the last assistant message was a Yes/No question, the user's
    // current message is an answer to it — evaluate it.
    // Otherwise, present the next question.
    const lastAssistant = [...state.messages]
      .reverse()
      .find(m => m.role === 'assistant');
    const awaitingAnswer = lastAssistant?.content.includes('Yes / No') ?? false;
    return awaitingAnswer ? 'answerEvaluator' : 'questionnaireNode';
  }

  if (conversationPhase === 'menu') return 'optionRouter';

  if (conversationPhase === 'option' && selectedOption) {
    return OPTION_NODE[selectedOption] ?? 'optionRouter';
  }

  return 'sessionPersister';
}
