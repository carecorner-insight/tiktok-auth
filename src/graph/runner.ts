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
  const t0 = Date.now();

  const t1 = Date.now();
  const existing = await services.session.load(msg.platform, msg.userId);
  console.log(`[perf] session.load: ${Date.now() - t1}ms`);

  const base: CareyBotState = existing ?? initialState(
    msg.platform,
    msg.userId,
    msg.conversationId ?? '',
  );

  const stateWithMsg: CareyBotState = {
    ...base,
    messages: [
      ...base.messages,
      { role: 'user', content: msg.text, timestamp: msg.timestamp },
    ],
  };

  const t2 = Date.now();
  const graph = buildGraph(services);
  console.log(`[perf] buildGraph+compile: ${Date.now() - t2}ms`);

  const t3 = Date.now();
  const final = await graph.invoke(stateWithMsg) as CareyBotState;
  console.log(`[perf] graph.invoke: ${Date.now() - t3}ms`);

  console.log(`[perf] processMessage total: ${Date.now() - t0}ms`);

  return {
    response: final.pendingResponse ?? '',
    state: final,
  };
}
