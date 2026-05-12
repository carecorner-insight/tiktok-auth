import type { CareyBotState, Platform } from '../types/state';
import type { NodeResult } from '../types/nodes';

interface ISessionManager {
  save(state: CareyBotState): Promise<void>;
  clear(platform: Platform, userId: string): Promise<void>;
}

export function makeSessionPersister(sessionManager: ISessionManager) {
  return async function sessionPersister(state: CareyBotState): Promise<NodeResult> {
    const updatedMessages: CareyBotState['messages'] = state.pendingResponse
      ? [...state.messages, { role: 'assistant', content: state.pendingResponse, timestamp: Date.now() }]
      : state.messages;

    const stateToSave = { ...state, messages: updatedMessages };

    if (stateToSave.conversationPhase === 'ended') {
      await sessionManager.clear(stateToSave.platform, stateToSave.userId);
    } else {
      await sessionManager.save(stateToSave);
    }

    return { messages: updatedMessages };
  };
}
