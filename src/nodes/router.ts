import type { CareyBotState } from '@/types/state';

const OPTION_ROUTES: Record<number, string> = {
  1: 'freeText',
  2: 'wellbeingCheck',
  3: 'stressManagement',
  4: 'resourceRedirect',
};

export function router(state: CareyBotState): string {
  if (state.conversationPhase === 'option' && state.selectedOption) {
    return OPTION_ROUTES[state.selectedOption] ?? 'menu';
  }
  return state.conversationPhase;
}
