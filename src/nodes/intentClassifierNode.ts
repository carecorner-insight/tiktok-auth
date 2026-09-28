diff --git a/api/sim.ts b/api/sim.ts
index cf187c1..f3c9e58 100644
--- a/api/sim.ts
+++ b/api/sim.ts
@@ -10,7 +10,7 @@ import { makeCareyAIClient } from '../src/services/makeCareyAIClient';
 import { makeSocialCoachClient } from '../src/services/makeSocialCoachClient';
 import { coachProvider, resolveCoachConfig } from '../src/services/resolveCoachConfig';
 import { DirectLLMClient } from '../src/services/directLLMClient';
-import { INTENT_CLASSIFIER_PROMPT } from '../src/nodes/intentClassifierNode';
+import { classifierSystemPrompt } from '../src/nodes/intentClassifierNode';
 import { getMenuMode } from '../src/lib/menuMode';
 import { getStoredAge, setStoredAge } from '../src/lib/ageStore';
 import type { NormalizedMessage } from '../src/types/platform';
@@ -98,7 +98,7 @@ export default async function handler(req: VercelRequest, res: VercelResponse) {
         apiKey: process.env.QWEN_API_KEY ?? '',
         baseURL: process.env.QWEN_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
         model: process.env.INTENT_LLM_MODEL ?? 'qwen-turbo',
-        systemPrompt: INTENT_CLASSIFIER_PROMPT,
+        systemPrompt: classifierSystemPrompt(),
       })),
       menuMode,
       typing: { sendTypingIndicator: async () => {} },
diff --git a/api/webhook.ts b/api/webhook.ts
index 3608ff5..f6f2cb8 100644
--- a/api/webhook.ts
+++ b/api/webhook.ts
@@ -15,7 +15,7 @@ import { DemographicsLogger } from '../src/services/demographicsLogger';
 import { makeSocialCoachClient } from '../src/services/makeSocialCoachClient';
 import { makeCareyAIClient, CareyAIClient } from '../src/services/makeCareyAIClient';
 import { DirectLLMClient } from '../src/services/directLLMClient';
-import { INTENT_CLASSIFIER_PROMPT } from '../src/nodes/intentClassifierNode';
+import { classifierSystemPrompt } from '../src/nodes/intentClassifierNode';
 import type { IPlatformAdapter } from '../src/types/platform';
 import type { Platform } from '../src/types/state';
 import { pushUatLog, providerFromChatId } from '../src/lib/uatLog';
@@ -189,7 +189,7 @@ export async function handleMessage(
         apiKey: process.env.QWEN_API_KEY ?? '',
         baseURL: process.env.QWEN_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
         model: process.env.INTENT_LLM_MODEL ?? 'qwen-turbo',
-        systemPrompt: INTENT_CLASSIFIER_PROMPT,
+        systemPrompt: classifierSystemPrompt(),
       })),
       typing: { sendTypingIndicator: async (userId: string) => {
         if (await active()) await adapter.sendTypingIndicator(userId);
diff --git a/src/__tests__/nodes/intentClassifierNode.test.ts b/src/__tests__/nodes/intentClassifierNode.test.ts
index 5cce50a..ab1061d 100644
--- a/src/__tests__/nodes/intentClassifierNode.test.ts
+++ b/src/__tests__/nodes/intentClassifierNode.test.ts
@@ -1,6 +1,9 @@
 import {
   makeIntentClassifierNode,
   parseIntentReply,
+  classifierSystemPrompt,
+  SAFETY_CLASSIFIER_PROMPT,
+  INTENT_CLASSIFIER_PROMPT,
 } from '@/nodes/intentClassifierNode';
 import { containsCrisisPhrase } from '@/lib/crisisDetection';
 import { makeState } from '@/__tests__/mocks';
@@ -216,3 +219,49 @@ describe('intentClassifierNode — re-evaluation (in-lane, intent mode)', () =>
     expect(Array.isArray(historyArg)).toBe(true);
   });
 });
+
+describe('intentClassifierNode — low-signal replies and safety prompt', () => {
+  const OLD = process.env.SCENARIO_MENU;
+  afterEach(() => { process.env.SCENARIO_MENU = OLD; });
+
+  it.each(['sigh', 'sighhh', 'haiz', 'idk', 'meh', 'ugh', 'nvm', 'sian', 'tired', '😔'])(
+    'does not send "%s" to the classifier during a re-eval — stays in lane',
+    async (text) => {
+      const llm = makeLLMMock('CRISIS');
+      const result = await makeIntentClassifierNode(llm)(inLaneState(text, 1));
+      expect(llm.chat).not.toHaveBeenCalled();
+      expect(result.crisisDetected).toBeUndefined();
+      expect(result.selectedOption).toBe(1);
+    },
+  );
+
+  it('still classifies a longer message that starts with a filler word', async () => {
+    const llm = makeLLMMock('CRISIS');
+    const result = await makeIntentClassifierNode(llm)(inLaneState('idk i just want to disappear', 1));
+    expect(llm.chat).toHaveBeenCalled();
+    expect(result.crisisDetected).toBe(true);
+  });
+
+  it('local crisis phrases still win over everything', async () => {
+    const llm = makeLLMMock('NONE');
+    const result = await makeIntentClassifierNode(llm)(inLaneState('sigh i want to die', 1));
+    expect(llm.chat).not.toHaveBeenCalled();
+    expect(result.crisisDetected).toBe(true);
+  });
+
+  it('parses NONE and treats it as stay in the scenario build', async () => {
+    process.env.SCENARIO_MENU = 'true';
+    expect(parseIntentReply('NONE')).toBe('NONE');
+    const llm = makeLLMMock('NONE');
+    const result = await makeIntentClassifierNode(llm)(inLaneState('it was a bit awkward at orientation', 1));
+    expect(result.crisisDetected).toBeUndefined();
+    expect(result.selectedOption).toBe(1);
+  });
+
+  it('uses the safety prompt only in the scenario build', () => {
+    process.env.SCENARIO_MENU = 'true';
+    expect(classifierSystemPrompt()).toBe(SAFETY_CLASSIFIER_PROMPT);
+    process.env.SCENARIO_MENU = 'false';
+    expect(classifierSystemPrompt()).toBe(INTENT_CLASSIFIER_PROMPT);
+  });
+});
diff --git a/src/nodes/intentClassifierNode.ts b/src/nodes/intentClassifierNode.ts
index fc9ad6d..3172c0b 100644
--- a/src/nodes/intentClassifierNode.ts
+++ b/src/nodes/intentClassifierNode.ts
@@ -24,8 +24,12 @@ import { scenarioMenuEnabled } from '../lib/pivotFlags';
 //                                  an in-conversation number is a local answer.
 //   2. Local crisis keyword check → emergency handler (fail-safe: never depends
 //                                    on the LLM being reachable).
-//   3. LLM classification         → TALK | SOCIAL | HUMAN | CRISIS | UNCLEAR.
-//   4. UNCLEAR / LLM failure      → initial: numbered menu; re-eval: stay put.
+//   3. Low-signal reply (re-eval) → stay in lane, skip the LLM. The coach sees
+//                                    the whole conversation and still tags
+//                                    [CRISIS] itself if the context warrants it.
+//   4. LLM classification         → legacy:   TALK | SOCIAL | HUMAN | CRISIS | UNCLEAR
+//                                    scenario: CRISIS | HUMAN | NONE
+//   5. UNCLEAR / NONE / failure   → initial: numbered menu; re-eval: stay put.
 //
 // On a lane SWITCH we reset aiBotChatId (each lane is a separate backend session)
 // and set justSwitchedLane so the target node bridges with prior context.
@@ -49,9 +53,51 @@ export const INTENT_CLASSIFIER_PROMPT =
   `Reply with exactly ONE word: CRISIS, SOCIAL, HUMAN, TALK, or UNCLEAR. ` +
   `No punctuation, no explanation.`;
 
-export type Intent = 'CRISIS' | 'SOCIAL' | 'HUMAN' | 'TALK' | 'UNCLEAR';
+// Growing We (scenario) build. Every menu option is a coaching scenario, so the
+// classifier's only jobs are safety and "wants a human". The legacy prompt's
+// "when in doubt, choose CRISIS" was applied to ANY ambiguous message, so
+// low-information replies ("sigh" after "What happened?") were sent the static
+// crisis message. Here the tie-break toward CRISIS is kept, but only for
+// harm-related content, and ordinary non-signals are listed explicitly.
+export const SAFETY_CLASSIFIER_PROMPT =
+  `You check messages in a social-skills coaching chat for young people aged 13-30 ` +
+  `in Singapore. Most messages are ordinary. Decide whether the LATEST user message, ` +
+  `read together with any recent context provided, needs a safety response.\n\n` +
+  `Labels:\n` +
+  `CRISIS - the user expresses, directly or indirectly: suicide, wanting to die or ` +
+  `not wake up, self-harm, wanting to disappear, being a burden or others being ` +
+  `better off without them, not feeling safe, running away to see if anyone cares, ` +
+  `or intent to hurt someone else. This applies even if it sounds like a joke. If a ` +
+  `message touches any of these and you are unsure, choose CRISIS.\n` +
+  `HUMAN - asks to talk to a real person, counsellor, therapist or staff.\n` +
+  `NONE - everything else.\n\n` +
+  `These are NONE on their own: sighs, "idk", "meh", "sian", "tired", "stressed", ` +
+  `"lonely" said once in an ordinary sentence, emoji, short or unclear replies, ` +
+  `everyday exaggeration ("this project is killing me", "I'm dead" after something ` +
+  `embarrassing), and practical or in-character questions during role-play.\n\n` +
+  `Examples:\n` +
+  `"sigh" -> NONE\n` +
+  `"idk it was bad" -> NONE\n` +
+  `"i feel lonely at poly sometimes" -> NONE\n` +
+  `"where's the toilet" -> NONE\n` +
+  `"everyone would be better off without me" -> CRISIS\n` +
+  `"i just want to disappear" -> CRISIS\n` +
+  `"no one would notice if i was gone" -> CRISIS\n` +
+  `"can i talk to a real person" -> HUMAN\n\n` +
+  `Reply with exactly ONE word: CRISIS, HUMAN, or NONE. No punctuation, no explanation.`;
+
+/**
+ * The system prompt the intent LLM client should be constructed with. Callers
+ * (api/webhook.ts, api/sim.ts) use this instead of INTENT_CLASSIFIER_PROMPT so
+ * the scenario build gets the narrower safety prompt.
+ */
+export function classifierSystemPrompt(): string {
+  return scenarioMenuEnabled() ? SAFETY_CLASSIFIER_PROMPT : INTENT_CLASSIFIER_PROMPT;
+}
 
-const INTENT_TO_OPTION: Record<Exclude<Intent, 'CRISIS' | 'UNCLEAR'>, MenuOption> = {
+export type Intent = 'CRISIS' | 'SOCIAL' | 'HUMAN' | 'TALK' | 'UNCLEAR' | 'NONE';
+
+const INTENT_TO_OPTION: Record<Exclude<Intent, 'CRISIS' | 'UNCLEAR' | 'NONE'>, MenuOption> = {
   TALK: 1,
   SOCIAL: 2,
   HUMAN: 3,
@@ -66,6 +112,32 @@ const ACK_WORDS = new Set([
   'hmm', 'nice', 'great', 'i see', 'ic', 'oh', 'ah', 'haha', 'lol',
 ]);
 
+// Low-information replies: sighs, fillers and one-word moods. During a re-eval
+// they carry too little for a one-shot classifier to judge, and "when in doubt"
+// rules turn that doubt into false crisis alarms. They skip the LLM and go to
+// the coach, which reads the full conversation and tags [CRISIS] itself if the
+// context calls for it. The local crisis-phrase check still runs first, and
+// only EXACT whole-message matches are skipped ("idk" skips, "idk i give up"
+// does not).
+const LOW_SIGNAL_WORDS = new Set([
+  'sigh', 'sighs', 'haiz', 'hais', 'aiya', 'aiyo', 'walao', 'idk', 'dunno',
+  'i dont know', 'meh', 'ugh', 'urgh', 'nvm', 'never mind', 'sian', 'tired',
+  'bored', 'stressed', 'no', 'nope', 'nah', 'not really', 'maybe', 'whatever',
+  'same', 'hm', 'erm', 'uh', 'um', 'hmm ok', 'ok la', 'ok lah',
+]);
+
+/** Collapses stretched letters so "sighhh", "haizzz", "ughhh" match. */
+const collapseRepeats = (s: string): string => s.replace(/(.)\1{2,}/g, '$1');
+
+function isLowSignal(normalized: string): boolean {
+  return (
+    ACK_WORDS.has(normalized) ||
+    LOW_SIGNAL_WORDS.has(normalized) ||
+    LOW_SIGNAL_WORDS.has(collapseRepeats(normalized)) ||
+    ACK_WORDS.has(collapseRepeats(normalized))
+  );
+}
+
 // containsCrisisPhrase + the phrase list now live in ../lib/crisisDetection so
 // the router can share the same deterministic backstop on every turn.
 
@@ -85,7 +157,7 @@ interface IIntentLLM {
 export function parseIntentReply(raw: string): Intent | null {
   const cleaned = raw.trim().toUpperCase();
   // Exact match first, then "first word" match ("TALK." / "TALK - because...").
-  const candidates: Intent[] = ['CRISIS', 'SOCIAL', 'HUMAN', 'TALK', 'UNCLEAR'];
+  const candidates: Intent[] = ['CRISIS', 'SOCIAL', 'HUMAN', 'TALK', 'UNCLEAR', 'NONE'];
   const exact = candidates.find(c => cleaned === c);
   if (exact) return exact;
   const firstWord = cleaned.replace(/[^A-Z\s]/g, ' ').trim().split(/\s+/)[0];
@@ -167,8 +239,10 @@ export function makeIntentClassifierNode(intentLLM: IIntentLLM, mode: MenuMode =
       return isReeval ? stay() : toMenu();
     }
 
-    // 5 ── Bare acknowledgement during a re-eval → keep the lane, skip the LLM.
-    if (isReeval && ACK_WORDS.has(normalized)) {
+    // 5 ── Acknowledgement or low-signal reply during a re-eval → keep the lane,
+    //      skip the LLM. The coach judges it with full context.
+    if (isReeval && isLowSignal(normalized)) {
+      console.log(`[intent] low-signal reply "${normalized}" → stay (no classifier call)`);
       return stay();
     }
 
@@ -191,12 +265,13 @@ export function makeIntentClassifierNode(intentLLM: IIntentLLM, mode: MenuMode =
     if (intent === 'CRISIS') return toCrisis();
 
     // Service intent is not a scenario ID. HUMAN is a separate graph outcome.
+    // NONE (and any stray legacy label) means no safety action: stay in lane.
     if (scenarios) {
       if (intent === 'HUMAN') return { referralRequested: true, menuSelection: false };
       return isReeval ? stay() : toMenu();
     }
 
-    if (intent && intent !== 'UNCLEAR') {
+    if (intent && intent !== 'UNCLEAR' && intent !== 'NONE') {
       return goToLane(INTENT_TO_OPTION[intent]);
     }
