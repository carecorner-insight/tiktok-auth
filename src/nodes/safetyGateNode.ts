import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';

// Evaluates the user's answer to the safety check question.
// Only an explicit "yes" is treated as safe — per C-SSRS guidance,
// "not sure" or "no" both escalate to HIGH risk.
//
// Graph routing after this node (routeFromSafetyGate in graph.ts):
//   crisisDetected = false → menuPresenter
//   crisisDetected = true  → emergencyHandler
export function safetyGateNode(state: CareyBotState): NodeResult {
  const input = getLastUserInput(state).toLowerCase().trim();

  if (input === 'yes') {
    return { crisisDetected: false };
  }

  // "no", "not sure", or anything ambiguous → escalate
  return {
    tag: 'high',
    crisisDetected: true,
    conversationPhase: 'crisis',
  };
}
