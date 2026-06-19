import type { CareyBotState } from './state';

export type NodeResult = Partial<CareyBotState>;
export type NodeFn = (state: CareyBotState) => Promise<NodeResult> | NodeResult;

// Helper: extract the most recent user message from state
export const getLastUserInput = (state: CareyBotState): string => {
  const last = [...state.messages].reverse().find(m => m.role === 'user');
  return last?.content.replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").trim().toLowerCase() ?? '';
};
