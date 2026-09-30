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

    let analytics = state.kpi;
    if (analytics && state.conversationPhase === 'crisis') {
      // Static safety routing is an observed State 8, not an AI tier estimate.
      // Do not reuse a previous low estimate as this crisis turn's tier.
      analytics = { ...analytics, tier: 'missing', tierHistoryComplete: false };
    }
    if (analytics?.pendingQuestion && !analytics.facts.some(fact => fact.eventType === 'checkin_reached' || fact.eventType === 'feedback_offered')) {
      // A menu, referral or crisis reply replaced the previous question. Clear
      // its binding so a later number cannot silently answer an obsolete ask.
      analytics = { ...analytics, pendingQuestion: null };
    }
    const stateToSave = { ...state, ...(analytics ? { kpi: analytics } : {}), messages: updatedMessages };

    if (stateToSave.conversationPhase === 'ended') {
      await sessionManager.clear(stateToSave.platform, stateToSave.userId);
    } else {
      await sessionManager.save(stateToSave);
    }

    return { messages: updatedMessages, ...(analytics ? { kpi: analytics } : {}) };
  };
}
