import type { CareyBotState, Platform } from '@/types/state';
import type { NodeResult } from '@/types/nodes';

interface ISessionManager {
  save(state: CareyBotState): Promise<void>;
  clear(platform: Platform, userId: string): Promise<void>;
}

export function makeSessionPersister(sessionManager: ISessionManager) {
  return async function sessionPersister(state: CareyBotState): Promise<NodeResult> {
    if (state.conversationPhase === 'ended') {
      await sessionManager.clear(state.platform, state.userId);
    } else {
      await sessionManager.save(state);
    }
    return {};
  };
}
