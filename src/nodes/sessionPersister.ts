import type { CareyBotState } from '@/types/state';
import type { NodeResult } from '@/types/nodes';
import type { SessionManager } from '@/services/sessionManager';

export function makeSessionPersister(sessionManager: SessionManager) {
  return async function sessionPersister(state: CareyBotState): Promise<NodeResult> {
    if (state.conversationPhase === 'ended') {
      await sessionManager.clear(state.platform, state.userId);
    } else {
      await sessionManager.save(state);
    }
    return {};
  };
}
