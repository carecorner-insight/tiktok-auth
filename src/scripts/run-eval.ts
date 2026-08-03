/**
 * Scheduled evaluation harness for CareyBot.
 *
 * For each eval persona, drives the live deployment's /api/sim for a fixed
 * number of turns — feeding SCRIPTED answers while the conversation is in the
 * deterministic screener (age gate / questionnaire / safety check) and switching
 * to LLM ROLEPLAY once it reaches the open-ended menu/option/crisis phases.
 * Then runs deterministic referral assertions and POSTs the result to
 * /api/eval-results (which dual-writes: summary → Redis, full record → SharePoint).
 *
 * Intended to run from a GitHub Actions scheduled workflow (no Vercel time limit).
 *
 * Env:
 *   SIM_BASE_URL       - deployment base URL
 *   SIM_TOKEN          - token for /api/sim AND /api/eval-results POST
 *   QWEN_API_KEY       - DashScope key for the roleplay "youth" (cheaper than OpenAI)
 *   QWEN_BASE_URL      - optional; defaults to the Singapore DashScope endpoint
 *   EVAL_ROLEPLAY_MODEL- optional; defaults to qwen-plus
 */

import OpenAI from 'openai';
import type { Platform } from '../types/state';
import type { MenuMode } from '../lib/menuMode';
import { EVAL_PERSONAS, type EvalPersona } from '../config/evalPersonas';
import { runAssertions } from '../lib/evalAssertions';

const SIM_BASE_URL = (process.env.SIM_BASE_URL ?? '').replace(/\/$/, '');
const SIM_TOKEN = process.env.SIM_TOKEN ?? '';
const SIM_PLATFORM: Platform = 'telegram';
const MAX_TURNS = 20;

// The roleplay "youth" runs on Qwen via DashScope's OpenAI-compatible endpoint —
// same wiring as DirectLLMClient, and materially cheaper than gpt-4o-mini.
// Use `||` (not `??`): an unset GitHub secret/var arrives as an empty string,
// which must fall through to the default rather than becoming a blank URL/model.
const QWEN_API_KEY = process.env.QWEN_API_KEY ?? '';
const QWEN_BASE_URL =
  process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const ROLEPLAY_MODEL = process.env.EVAL_ROLEPLAY_MODEL || 'qwen-plus';

// Which entry UX(es) to evaluate. Defaults to BOTH so every cycle produces a
// direct intent-vs-numbered comparison; set EVAL_MENU_MODES=intent to run one.
const MENU_MODES: MenuMode[] = (process.env.EVAL_MENU_MODES || 'intent,numbered')
  .split(',')
  .map(s => s.trim())
  .filter((s): s is MenuMode => s === 'intent' || s === 'numbered');

interface SimReply {
  response: string;
  state: {
    conversationPhase: string;
    questionIndex: number;
    tag: string | null;
    crisisDetected: boolean;
    selectedOption: number | null;
    isAuthorized: boolean;
  };
}

interface TranscriptTurn {
  role: 'youth' | 'carey';
  text: string;
  phase?: string;
}

async function sendToBot(
  userId: string,
  text: string,
  menuMode: MenuMode,
  reset = false,
): Promise<SimReply> {
  const res = await fetch(`${SIM_BASE_URL}/api/sim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sim-token': SIM_TOKEN },
    body: JSON.stringify({ platform: SIM_PLATFORM, userId, text, reset, menuMode }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`/api/sim ${res.status} ${res.statusText}: ${detail}`);
  }
  return (await res.json()) as SimReply;
}

// Decide the youth's next message: scripted during the deterministic phases,
// roleplay (OpenAI) once the conversation opens up.
//
// The menu phase is mode-dependent: in NUMBERED mode the youth taps a digit
// (menuDefault); in INTENT mode there is no menu to tap, so the youth states
// their intent in natural language (roleplay) and lets the classifier route it —
// which is exactly the behaviour we're trying to measure.
async function nextYouthMessage(
  persona: EvalPersona,
  openai: OpenAI,
  last: SimReply,
  history: OpenAI.Chat.ChatCompletionMessageParam[],
  menuMode: MenuMode,
): Promise<string> {
  const phase = last.state.conversationPhase;
  if (phase === 'ageCheck') return persona.ageAnswer;
  if (phase === 'questionnaire') {
    return persona.screenerAnswers[last.state.questionIndex] ?? 'no';
  }
  if (phase === 'safetyCheck') return persona.safetyAnswer ?? 'yes';
  if (phase === 'menu' && menuMode === 'numbered') return persona.menuDefault ?? '1';

  // intent-mode menu / option / crisis / anything open-ended → roleplay
  const completion = await openai.chat.completions.create({
    model: ROLEPLAY_MODEL,
    messages: history,
  });
  return completion.choices[0].message.content ?? '...';
}

async function runPersona(
  persona: EvalPersona,
  runId: string,
  openai: OpenAI,
  menuMode: MenuMode,
) {
  const userId = `eval-${persona.key}-${menuMode}-${Date.now()}`;
  const transcript: TranscriptTurn[] = [];
  const history: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: persona.rolePrompt },
  ];

  let status: 'completed' | 'error' = 'completed';
  let errorDetail: string | undefined;
  let last: SimReply | undefined;

  try {
    last = await sendToBot(userId, 'hi', menuMode, true);
    transcript.push({ role: 'carey', text: last.response, phase: last.state.conversationPhase });
    history.push({ role: 'user', content: last.response });

    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      const youth = await nextYouthMessage(persona, openai, last, history, menuMode);
      transcript.push({ role: 'youth', text: youth });
      history.push({ role: 'assistant', content: youth });

      last = await sendToBot(userId, youth, menuMode);
      transcript.push({ role: 'carey', text: last.response, phase: last.state.conversationPhase });
      history.push({ role: 'user', content: last.response });
    }
  } catch (err) {
    status = 'error';
    errorDetail = String(err);
    console.error(`[eval] ${persona.key} errored:`, errorDetail);
  }

  const careyText = transcript.filter(t => t.role === 'carey').map(t => t.text).join('\n');
  const assertions = runAssertions(persona, careyText);

  const result = {
    runId,
    ts: Date.now(),
    persona: persona.key,
    userType: persona.userType,
    menuMode,
    outcomeLabel: persona.outcomeLabel,
    status,
    errorDetail,
    ...(status === 'completed'
      ? assertions
      : {
          referralPresentPct: null,
          referralAbsentCount: 0,
          requiredReferrals: [],
          forbiddenReferrals: [],
          wellbeingCheckReached: null,
          passed: false,
        }),
    finalTag: last?.state.tag ?? null,
    finalPhase: last?.state.conversationPhase ?? null,
    crisisDetected: last?.state.crisisDetected ?? false,
    selectedOption: last?.state.selectedOption ?? null,
    transcript,
  };

  // Dual-write via the deployment endpoint (Redis summary + SharePoint archive).
  try {
    const res = await fetch(`${SIM_BASE_URL}/api/eval-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sim-token': SIM_TOKEN },
      body: JSON.stringify(result),
    });
    if (!res.ok) {
      console.error(`[eval] result POST failed for ${persona.key}: ${res.status}`);
    }
  } catch (err) {
    console.error(`[eval] result POST error for ${persona.key}:`, err);
  }

  console.log(
    `[eval] ${persona.key} [${menuMode}]: status=${status} passed=${result.passed} ` +
      `present%=${result.referralPresentPct} absent=${result.referralAbsentCount} ` +
      `wellbeing=${result.wellbeingCheckReached} tag=${result.finalTag}`,
  );

  return result;
}

async function main() {
  if (!SIM_BASE_URL || !SIM_TOKEN || !QWEN_API_KEY) {
    console.error('Set SIM_BASE_URL, SIM_TOKEN and QWEN_API_KEY.');
    process.exit(1);
  }

  if (MENU_MODES.length === 0) {
    console.error('EVAL_MENU_MODES must include at least one of: intent, numbered');
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey: QWEN_API_KEY, baseURL: QWEN_BASE_URL });
  const runId = `run-${Date.now()}`;
  console.log(
    `\n=== CareyBot eval ${runId} — ${EVAL_PERSONAS.length} personas ` +
      `× ${MENU_MODES.length} mode(s) [${MENU_MODES.join(', ')}] (sequential) ===`,
  );

  // Sequential — gentle on the gov AIBots platform. Each persona runs once per
  // mode so the same runId carries a side-by-side intent-vs-numbered comparison.
  for (const menuMode of MENU_MODES) {
    console.log(`\n--- mode: ${menuMode} ---`);
    for (const persona of EVAL_PERSONAS) {
      await runPersona(persona, runId, openai, menuMode);
    }
  }

  console.log(`=== eval ${runId} complete ===`);
}

main().catch(err => {
  console.error('Eval run failed:', err);
  process.exit(1);
});
