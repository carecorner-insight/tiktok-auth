# CareyBot

A mental-health triage & support chatbot for youths (13–25) in Singapore, operated by **INSIGHT Care Corner**. Runs on **Vercel serverless (TypeScript)** with **LangGraph** orchestration, delivered over **Telegram** and **TikTok**. PDPA-conscious throughout.

> **Authoritative docs:** [`SYS_PROMPT.md`](SYS_PROMPT.md) is the source of truth for Carey's conversational design. ⚠️ [`CLAUDE.md`](CLAUDE.md) is **stale** in places (it describes a PHQ-9 / 9-question design and older menu) — trust the code and `SYS_PROMPT.md` over it.

---

## What it does

1. **RBAC / whitelist** — only approved users can chat; unknown users get a registration prompt with their user ID.
2. **Age collection** — asks the user's actual age; 13–25 continues in-scope, otherwise routed to out-of-scope support. Age is logged (once per user) for demographics.
3. **C-SSRS-informed screener** — 4 Yes/No questions run deterministically (no AI). Produces a risk tag.
4. **Risk routing** — `high` → crisis routing (hotline **1771**); `moderate` → safety check; `elevated`/`low` → menu.
5. **Menu (3 options)** — free chat, social-skills coach, or resources.
6. **Continuous crisis detection** — the AI can escalate mid-conversation via a `[CRISIS]` tag at any point.

---

## Conversation flow

```
START → authGuard ──unauthorized──► registration prompt → END
   │ authorized
   ▼
ageCheck ("how old are you?")
   │ 13–25                         │ <13 or >25
   ▼                               ▼
C-SSRS screener (Q1–Q4, Yes/No)   out-of-scope support (option 1 path)
   │
   ├─ Q3/Q4 = yes ─────────────► emergencyHandler (crisis, 1771)
   ├─ Q2 = yes ────────────────► safetyCheck → (unsafe) emergencyHandler / (safe) menu
   └─ else (elevated/low) ─────► menu
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                             ▼
  1. Free chat              2. Social coach                3. Resources
  (freeTextNode,            (socialCoachNode,              (resourceRedirectNode,
   Carey/AIBots;             a SEPARATE AIBots/Dify bot     static INSIGHT link +
   surfaces coping           — "Growing We")                AI support routing)
   skills when needed)
```

- The router ([`src/nodes/router.ts`](src/nodes/router.ts)) dispatches by `conversationPhase`; the graph is defined in [`src/graph/graph.ts`](src/graph/graph.ts).
- Crisis message is **AI-generated where possible with a static-hotline fallback** so `1771` is never lost.
- Menu options **2 (wellbeing self-check)** and **3 (stress management)** from the old design were **removed** — free chat now handles coping skills inline; the menu is 3 options.

---

## AI providers

All live AI goes through **AIBots (Singapore gov platform) via a Directus gateway** — required for PDPA (data stays on approved infra) and IP whitelisting. Each bot uses a `FallbackAIClient(AIBots → Dify)`:

| Client | Primary | Fallback | Notes |
|---|---|---|---|
| `aiBots` (Carey) | AIBots/Directus | Dify | The main assistant. |
| `socialCoach` (option 2) | AIBots/Directus | Dify | Separate seeded bot (Growing We syllabus). Dify fallback is **temporary** until its Directus flow is live. |

**Experimental — direct LLM:** `DirectLLMClient` ([`src/services/directLLMClient.ts`](src/services/directLLMClient.ts)) calls an OpenAI-compatible LLM (**Alibaba Qwen via DashScope**, SG region) directly, holding the system prompt itself. Enabled **only** when `USE_DIRECT_LLM=true` (off by default; Carey only), selected by [`makeCareyAIClient.ts`](src/services/makeCareyAIClient.ts). For efficacy testing vs AIBots.

---

## Project structure

```
api/
  webhook.ts          Live entry point (Telegram/TikTok). Fire-and-forget: 200 immediately, process in background.
  sim.ts              Synchronous sim endpoint — runs the real graph, returns the reply (for testing/eval). Token-gated.
  eval-results.ts     Eval results: POST (dual-write Redis+SharePoint), GET (read for dashboard).
  uat-logs.ts         UAT live-log: GET (read), POST (toggle capture).
  refresh-token.ts    Cron: refreshes the TikTok access token.
src/
  graph/              LangGraph graph + runner (phase-driven state machine).
  nodes/              One file per node (authGuard, ageCheck/ageGate, questionnaire, answerEvaluator,
                      safetyCheck/Gate, emergencyHandler, menuPresenter, optionRouter, freeText,
                      socialCoach, resourceRedirect, restart, sessionPersister).
  services/           whitelistService, sessionManager, sharePointLogger, demographicsLogger,
                      aiBotsClient, difyClient, fallbackAIClient, directLLMClient, makeCareyAIClient.
  lib/                redis, crisisDetection, buildPrime, encryption, uatLog, pii, evalResults, evalAssertions.
  config/             questionnaire (C-SSRS + static strings), evalPersonas, careySystemPrompt (generated).
  scripts/            simulate-conversation.ts, run-eval.ts.
scripts/
  gen-carey-prompt.js Generates src/config/careySystemPrompt.ts from SYS_PROMPT.md (npm run gen:prompt).
public/
  uat-logs.html       UAT live-log viewer.
  eval-dashboard.html Eval metrics dashboard.
.github/workflows/
  eval.yml            Scheduled eval harness (every 2 days + manual trigger).
```

---

## Ops & testing tooling

### UAT live log
Watch real conversations live during testing. `public/uat-logs.html` polls `/api/uat-logs`; each turn is pushed to a capped Redis ring buffer (`uat:logs`, ~200 entries, 24h TTL). Capture is **off by default** — flip it on with the in-page **Capture** toggle (sets `uat:enabled`, auto-expires 24h). Token-gated by `UAT_LOG_TOKEN`. Only live webhook traffic appears (sim/eval bypass it).

### Simulator
`src/scripts/simulate-conversation.ts` — drives `/api/sim` with an OpenAI-roleplayed "youth" so you can watch a full conversation end-to-end. `npm run simulate [persona]`.

### Scheduled eval harness
`src/scripts/run-eval.ts` (GitHub Actions, every 2 days) runs a roster of personas ([`src/config/evalPersonas.ts`](src/config/evalPersonas.ts)) through `/api/sim` — **scripted answers during the screener, LLM roleplay after** — then runs deterministic assertions (correct referral present %, forbidden referral count, no false crisis, prompt-leak for trolls). Results dual-write: summary → Redis, full record → SharePoint. Viewed in `public/eval-dashboard.html`.

### Demographics
Actual age is logged once per user (Redis NX dedup, ~1yr) to a SharePoint list via `DEMOGRAPHICS_WEBHOOK_URL`.

---

## Data storage & privacy (PDPA)

| Store | Contents | Retention |
|---|---|---|
| Redis session | Full conversation state (**AES-256-GCM encrypted**) | 6h TTL |
| Redis `uat:logs` | Recent turns for the UAT viewer | 24h TTL, off unless enabled |
| Redis `eval:results` | Eval summaries (synthetic) | 90d |
| SharePoint conversation log | Per-turn log for human review | permanent (via Power Automate) |
| SharePoint demographics / eval | Age; eval archive (synthetic) | permanent |

- **PII redaction** ([`src/lib/pii.ts`](src/lib/pii.ts)) strips structured PII (NRIC/FIN, email, SG phone, payment cards) from free text **before** it reaches the SharePoint conversation log and the UAT log. Names/addresses are **not** caught (would need NER).
- Session store and AI calls keep raw text (needed to function); only the review sinks are redacted.

---

## Environment variables

| Var | Purpose |
|---|---|
| `REDIS_URL` | Redis (ioredis) |
| `SESSION_ENCRYPTION_KEY` | 64-hex key for session encryption |
| `DIRECTUS_CREATE_CHAT_URL`, `DIRECTUS_SEND_MESSAGE_URL` | AIBots (Carey) |
| `DIRECTUS_SOCIALCOACH_CREATE_CHAT_URL` | AIBots (social coach); shares the send URL |
| `DIFY_API_URL`, `DIFY_API_KEY`, `DIFY_SOCIALCOACH_API_KEY` | Dify fallbacks |
| `TELEGRAM_BOT_TOKEN` | Telegram |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | TikTok token cron |
| `SHAREPOINT_WHITELIST_WEBHOOK_URL` | RBAC whitelist lookup (Power Automate) |
| `POWER_AUTOMATE_WEBHOOK_URL` | Conversation log |
| `DEMOGRAPHICS_WEBHOOK_URL` | Demographics list |
| `EVAL_RESULTS_WEBHOOK_URL` | Eval results archive |
| `REGISTRATION_URL`, `COUNSELLING_BOOKING_URL` | Links |
| `UAT_LOG_TOKEN` | Human read access — UAT log + eval dashboard |
| `SIM_TOKEN` | Machine access — `/api/sim` + eval result writes |
| `BYPASS_AUTH` | `true` skips the whitelist check (**load-test only**, never prod) |
| `USE_DIRECT_LLM`, `QWEN_API_KEY`, `QWEN_MODEL`, `QWEN_BASE_URL` | Direct-LLM (Qwen) experiment for Carey |
| `OPENAI_API_KEY` | Eval/sim "youth" roleplay (local + GitHub Actions only) |
| `SIM_BASE_URL` | Deployment URL for the sim/eval scripts |

---

## Scripts

```bash
npm run build         # tsc --noEmit (type-check)
npm test              # jest
npm run simulate      # drive /api/sim with a roleplayed youth
npm run gen:prompt    # regenerate careySystemPrompt.ts from SYS_PROMPT.md
```
Node isn't required in prod (Vercel builds it); local dev needs Node ≥ 20.

---

## Known caveats / TODO

- **Stale unit tests** — several suites in `src/__tests__` still reference the old PHQ-9 design, removed menu options, and renamed exports. They fail to compile under jest; production code is unaffected. Needs a cleanup pass.
- **`CLAUDE.md` is out of date** — see note at top.
- **AIBots occasionally re-runs the screener** — the seeded AIBots prompt still contains the (now deterministic) screener states; very rare, but the definitive fix is to trim States 0/1 from the seeded prompt on the AIBots/Directus side.
- **Dify & PDPA** — the Dify fallback can route conversation data off SG-approved infra on AIBots failure. Flagged for a compliance decision; the social-coach Dify fallback is explicitly temporary.
- **DirectLLMClient has no RAG** — unlike AIBots/Dify it has no knowledge-base retrieval; only relevant if the Qwen experiment is pursued.
```
