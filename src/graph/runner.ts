import type { CareyBotState } from '../types/state';
import type { NormalizedMessage } from '../types/platform';
import { initialState } from '../types/state';
import { buildGraph, type GraphServices } from './graph';

interface RunnerServices extends GraphServices {
  session: GraphServices['session'] & {
    load(platform: CareyBotState['platform'], userId: string): Promise<CareyBotState | null>;
  };
  /** Persistent per-user age (F2). Optional — omit and age is session-only. */
  ageStore?: {
    get(platform: CareyBotState['platform'], userId: string): Promise<number | null>;
    set(platform: CareyBotState['platform'], userId: string, age: number): Promise<void>;
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

  let base: CareyBotState = existing ?? initialState(
    msg.platform,
    msg.userId,
    msg.conversationId ?? '',
  );

  // A new SESSION is not a new USER. Age is persisted outside the 6-hour session
  // (F2), so hydrate it here — that is what lets a returning user skip the age
  // question and still get the right referral link.
  if (base.age === null && services.ageStore) {
    const stored = await services.ageStore.get(msg.platform, msg.userId);
    if (stored !== null) base = { ...base, age: stored };
  }

  console.log('[debug] incoming msg:', JSON.stringify(msg.text));
  console.log('[debug] state BEFORE graph:', JSON.stringify({
    conversationPhase: base.conversationPhase,
    questionIndex:     base.questionIndex,
    selectedOption:    base.selectedOption,
    tag:               base.tag,
    crisisDetected:    base.crisisDetected,
    aiBotChatId:       base.aiBotChatId,
    messageCount:      base.messages.length,
  }));

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

  console.log('[debug] state AFTER graph:', JSON.stringify({
    conversationPhase: final.conversationPhase,
    questionIndex:     final.questionIndex,
    selectedOption:    final.selectedOption,
    tag:               final.tag,
    crisisDetected:    final.crisisDetected,
    pendingResponse:   final.pendingResponse?.slice(0, 80),
  }));

  // Persist a newly captured age so the next session (and the referral triage)
  // has it. Only on transition, so we don't rewrite the key every turn.
  if (services.ageStore && final.age !== null && base.age === null) {
    await services.ageStore.set(msg.platform, msg.userId, final.age);
  }

  console.log(`[perf] processMessage total: ${Date.now() - t0}ms`);

  return {
    response: final.pendingResponse ?? '',
    state: final,
  };
}
