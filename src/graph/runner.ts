import type { CareyBotState } from '../types/state';
import type { NormalizedMessage } from '../types/platform';
import { initialState } from '../types/state';
import { buildGraph, type GraphServices } from './graph';

interface RunnerServices extends GraphServices {
  session: GraphServices['session'] & {
    load(platform: CareyBotState['platform'], userId: string): Promise<CareyBotState | null>;
  };
}

export interface RunResult {
  response: string;
  state: CareyBotState;
}

export async function processMessage(
  msg: NormalizedMessage,
  services: RunnerServices,
): Promise<RunResult> {
  // Load existing session or start fresh
  const existing = await services.session.load(msg.platform, msg.userId);
  const base: CareyBotState = existing ?? initialState(
    msg.platform,
    msg.userId,
    msg.conversationId ?? '',
  );

  // Append the incoming user message to history
  const stateWithMsg: CareyBotState = {
    ...base,
    messages: [
      ...base.messages,
      { role: 'user', content: msg.text, timestamp: msg.timestamp },
    ],
  };

  const graph = buildGraph(services);
  const final = await graph.invoke(stateWithMsg) as CareyBotState;

  return {
    response: final.pendingResponse ?? '',
    state: final,
  };
}
