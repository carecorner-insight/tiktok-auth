# CareyBot

A mental-health triage & support chatbot for youths (13–25) in Singapore, operated by **INSIGHT Care Corner**. Runs on **Vercel serverless (TypeScript)** with **LangGraph** orchestration, delivered over **Telegram** and **TikTok**. PDPA-conscious throughout.

> **Authoritative docs:** [`SYS_PROMPT.md`](SYS_PROMPT.md) is the source of truth for Carey's conversational design. ⚠️ [`CLAUDE.md`](CLAUDE.md) is **stale** in places (it describes a PHQ-9 / 9-question design and older menu) — trust the code and `SYS_PROMPT.md` over it.

> **Two bots, one codebase.** The **NUS-study bot** (careytest, frozen until the study completes) and the **CareyChats pivot** (Growing We social coach) both run from this repo. Behaviour is selected per endpoint: `/api/webhook` serves the deployment's env-flag configuration (currently the pivot), while `/api/webhook-study` forces the study configuration ([`src/lib/studyMode.ts`](src/lib/studyMode.ts)) with its own bot token and a `study:`-prefixed Redis namespace ([`src/lib/prefixedRedis.ts`](src/lib/prefixedRedis.ts)). Flags live in [`src/lib/pivotFlags.ts`](src/lib/pivotFlags.ts) and default to study-safe values.

**Team documentation** (in [`docs/`](docs/)):

| Doc | For |
|---|---|
| [`EVALUATION_RUNBOOK.md`](docs/EVALUATION_RUNBOOK.md) | **Non-technical reviewers** — how to rate the bot's replies |
| [`EDITING_GUIDE.md`](docs/EDITING_GUIDE.md) | Non-technical team — where to change the bot's wording safely |
| [`ACCOUNTS.md`](docs/ACCOUNTS.md) | Accounts & credentials inventory (handover) |
| [`OUTCOME_METRICS_REVIEW.md`](docs/OUTCOME_METRICS_REVIEW.md) | Review of the outcome metrics' validity + collection design |
| [`OUTCOME_METRICS_IMPROVEMENTS.md`](docs/OUTCOME_METRICS_IMPROVEMENTS.md) | Concrete fix designs, effort & implementation order |
| [`PROMPT_EDITING_PROPOSAL.md`](docs/PROMPT_EDITING_PROPOSAL.md) | Proposal: let the team edit the coach prompt without a developer |

**Contents:** [What it does](#what-it-does) · [Conversation flow](#conversation-flow) · [AI providers](#ai-providers) · [Project structure](#project-structure) · [Ops & testing](#ops--testing-tooling) · [**Access control & authentication**](#access-control--authentication) · [Privacy (PDPA)](#data-storage--privacy-pdpa) · [Env vars](#environment-variables) · [Scripts](#scripts) · [**Change log**](#change-log) · [Caveats / TODO](#known-caveats--todo)

---

## What it does

1. **RBAC / whitelist** — only approved users can chat; unknown users get a registration prompt with their user ID.
2. **Age collection** — asks the user's actual age; 13–25 continues in-scope, otherwise routed to out-of-scope support. Age is logged (once per user) for demographics.
3. **C-SSRS-informed screener** — 4 Yes/No questions run deterministically (no AI). Produces a risk tag.
4. **Risk routing** — `high` → crisis routing (hotline **1771**); `moderate` → safety check; `elevated`/`low` → menu.
5. **Entry UX (A/B toggleable)** — either an **intent classifier** (default: an open question, free text routed by a cheap LLM) or a **numbered menu** (tap 1/2/3). Both lead to the same 3 lanes: free chat, social-skills coach, resources.
6. **Seamless lane switching** (intent mode) — every in-lane turn is re-classified, so someone talking to Carey who starts describing a social situation is moved to the coach mid-conversation, with prior context carried across.
7. **Continuous crisis detection** — three independent layers (see below). Any one of them routes to the emergency handler.

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
- Menu options **2 (wellbeing self-check)** and **3 (stress management)** from the old design were **removed** — free chat now handles coping skills inline; the menu is 3 options.

### Entry UX: intent vs numbered

A global Redis flag (`menu:mode`, toggled from the UAT log page) selects the post-screener experience. Both modes are evaluated side by side (see the eval harness).

| | `intent` (default) | `numbered` |
|---|---|---|
| Prompt | Open — "What brings you here today?" | Numbered list (1/2/3) |
| Routing | [`intentClassifierNode`](src/nodes/intentClassifierNode.ts) → cheap LLM (`qwen-turbo`) → TALK / SOCIAL / HUMAN / CRISIS / UNCLEAR | Digit → lane |
| In-lane turns | **Re-classified every turn** → can switch lanes seamlessly | Stay in the chosen lane |
| Fallback | Unparseable/LLM down → numbered menu (initial pick) or **stay in lane** (mid-conversation) | — |

On a mid-conversation switch the target lane starts a **fresh backend session** (each lane is a different bot) and receives the transcript as context plus a bridging instruction, so the handover reads naturally. Numbered mode keeps the older confirm-based social-coach offer (`[SOCIAL]` tag → "want to try?" → yes); intent mode switches without asking.

### Crisis detection — three independent layers

1. **Deterministic phrase backstop** ([`crisisDetection.ts`](src/lib/crisisDetection.ts)) — runs in the router on **every** user turn, in every phase, before any other routing. No LLM dependency, so it works even if every provider is down. High-precision phrase list; screener Yes/No answers and menu digits never match.
2. **Intent classifier** — a `CRISIS` label routes to the emergency handler.
3. **`[CRISIS]` reply tag** — the AI can escalate mid-conversation from any lane (including the social coach).

The emergency handler is **AI-generated with a guaranteed static fallback**: if AIBots is unreachable it returns the static hotline text, so **1771 is never lost** regardless of entry path or provider state.

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
api/                  ⚠️ every file here is one Vercel serverless function — Hobby plan caps the deployment at 12
  webhook.ts          Live entry point (Telegram/TikTok). Fire-and-forget: 200 immediately, process in background.
  webhook-study.ts    Same handler forced into the NUS-study configuration (study flags, own bot token, study: Redis prefix).
  sim.ts              Synchronous sim endpoint — runs the real graph, returns the reply. Token-gated.
  eval-results.ts     Eval results: POST (dual-write Redis+SharePoint), GET (read for dashboard).
  uat-logs.ts         UAT live-log: GET (read), POST (toggle capture / switch menu mode).
  label-queue.ts      Labelling: GET review queue (labeler token), POST ingest units (SIM_TOKEN).
  labels.ts           Labelling: POST a human label (labeler token), GET export JSON/CSV (UAT token).
  label-stats.ts      Human-vs-judge agreement report (UAT token).
  refresh-token.js    Cron: refreshes the TikTok access token.
src/
  graph/              LangGraph graph + runner (phase-driven state machine).
  nodes/              authGuard, ageCheck/ageGate, questionnaire, answerEvaluator, safetyCheck/Gate,
                      emergencyHandler, menuPresenter, intentClassifierNode, freeText, socialCoach,
                      resourceRedirect, restart, sessionPersister.
  services/           whitelistService, sessionManager, sharePointLogger, demographicsLogger,
                      aiBotsClient, difyClient, fallbackAIClient, directLLMClient, makeCareyAIClient,
                      replyJudge.
  lib/                redis, crisisDetection, replyTags, menuMode, buildPrime, encryption, uatLog, pii,
                      evalResults, evalAssertions, replyUnits, labelStore, labelers, agreement.
  config/             questionnaire (C-SSRS + static strings), evalPersonas, judgeRubric,
                      careySystemPrompt (generated).
  scripts/            simulate-conversation.ts, run-eval.ts, run-judge.ts.
scripts/
  gen-carey-prompt.js Generates src/config/careySystemPrompt.ts from SYS_PROMPT.md (npm run gen:prompt).
public/
  uat-logs.html       UAT live-log viewer + Capture / menu-mode toggles.
  eval-dashboard.html Eval metrics dashboard (intent vs numbered).
  label.html          Reply review UI (per-reviewer token).
  label-dashboard.html Human-vs-judge agreement dashboard.
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

The roleplay "youth" runs on **Qwen** via DashScope (cheaper than OpenAI) — set `QWEN_API_KEY` (and `QWEN_BASE_URL` only if not using the default Singapore endpoint). Model defaults to `qwen-plus`; override with `EVAL_ROLEPLAY_MODEL` (this only changes the *simulated user*, not Carey).

**Menu-mode A/B:** each persona runs under **both** entry UXes — `intent` (classifier routes free text) and `numbered` (tap a digit) — so the dashboard compares them side by side. Control via `EVAL_MENU_MODES` (default `intent,numbered`; set to one mode to halve the run). The sim pins the mode per-request via a `menuMode` body field, independent of the global `menu:mode` flag the webhook/UAT use.

### Reply labelling platform (LLM-as-judge groundwork)
Rates individual Carey replies so we can build a **gold set**, then calibrate an LLM judge against it.

- **Rubric** — [`src/config/judgeRubric.ts`](src/config/judgeRubric.ts) is the single source of truth for both the human UI and the judge prompt: 5 pass/fail dimensions (safety, shape, tone, referral, boundaries) + a good/borderline/bad overall. A fail on a **critical** dimension (safety, boundaries) forces `bad` — enforced in code, not left to the model. **Not yet clinically signed off**; bump `JUDGE_VERSION` on any wording change so labels stay comparable.
- **Pre-labelling** — `npm run judge` ([`run-judge.ts`](src/scripts/run-judge.ts)) pulls eval transcripts, splits them into reply-in-context units (only AI-generated turns — deterministic screener output is skipped), scores each with the judge, and ingests them.
- **Human review** — `public/label.html`: one reply at a time with its context, rubric pre-filled with the judge's proposal to confirm or override. **Blind mode** hides the proposal for anchor-free gold-set labelling. Per-reviewer tokens (`LABELER_TOKENS`) attribute every label, enabling inter-rater agreement. **Reviewer instructions:** [`docs/EVALUATION_RUNBOOK.md`](docs/EVALUATION_RUNBOOK.md).
- **Storage** — Redis working store + SharePoint archive via `LABELS_WEBHOOK_URL`. `GET /api/labels?format=csv` exports human vs judge verdicts for **Power BI**. Power BI is read-only — it charts labels, it cannot collect them. Agreement is stored as **two plain booleans** — `hasJudgeProposal` (was there anything to compare against?) and `agreedWithLlm` (did the human match it exactly?) — so no field is ever three-state. **Filter on `hasJudgeProposal = true` before computing any agreement rate.**
- **Agreement dashboard** — `public/label-dashboard.html` (`/api/label-stats`) answers "can the judge be trusted yet?": **Cohen's κ** (human vs judge) with a Landis & Koch reading, a confusion matrix, per-dimension κ, **accuracy per judge version**, inter-rater κ between reviewers, judge **bias direction** (too lenient vs too strict), and a **critical-misses** list — replies where the judge passed a safety/boundaries check a human failed. Stats live in [`src/lib/agreement.ts`](src/lib/agreement.ts) (pure + unit-tested).

> **Read κ, not raw agreement.** If most replies are "good", a judge that always says "good" scores ~80% agreement while being worthless — κ corrects for that chance agreement. Don't let the judge label unreviewed data below κ ≈ 0.6, and never on the **safety** dimension.

**PDPA:** the judge reads conversation content, so it must run on SG-approved infra (Qwen via `dashscope-intl`, or AIBots). Phase 1 deliberately covers the **synthetic eval corpus only** — zero real-user exposure while the rubric is validated. Live-log sampling is Phase 2. Prefer a judge model *different* from the one that generated the reply (models over-rate their own style).

### Demographics
Actual age is logged once per user (Redis NX dedup, ~1yr) to a SharePoint list via `DEMOGRAPHICS_WEBHOOK_URL`.

---

## Access control & authentication

There are **two completely separate worlds** here, and they share no mechanism:

- **A. End users** chatting with the bot → the RBAC whitelist.
- **B. Staff and machines** using internal tools → shared-secret tokens.

### A. End users — the whitelist (RBAC)

```
message arrives → adapter normalises → authGuard (FIRST node in the graph)
                                          │
                    ┌─────────────────────┴─────────────────────┐
             authorized                                   unauthorized
                    ▼                                            ▼
              continue the flow                    registration prompt + the user's
                                                   own user ID (sent as a 2nd message
                                                   so they can long-press to copy it)
```

**Identity comes from the platform, not the user.** The Telegram/TikTok webhook payload carries the sender's platform user ID; the adapter reads it from there, never from message text. So a user cannot claim to be someone else *through the chat* — only by forging the webhook itself (see the gap below).

**The check** — [`authGuard`](src/nodes/authGuard.ts) → [`WhitelistService`](src/services/whitelistService.ts):
1. Look up `whitelist:{platform}:{userId}` in Redis.
2. On a miss, call SharePoint via Power Automate (`SHAREPOINT_WHITELIST_WEBHOOK_URL`), then cache the status.
3. Authorized only when the status is exactly `approved` (`pending` and `unknown` are denied). If SharePoint returns nothing, the user is **denied** — it fails closed.

**Onboarding** is deliberately non-technical: an unknown user gets their ID + the registration link → they submit the form → Power Automate writes a `Pending` row → an admin flips it to `Approved` in the SharePoint UI → their next message is let through once the cache entry expires. No deploy, no code.

**`BYPASS_AUTH=true`** skips the whitelist entirely and logs a warning. Load tests only — **never production**.

### B. Internal tools — three token types

All three are compared with **`timingSafeEqual`** (constant-time, so a token can't be recovered by measuring response times), and every endpoint **fails closed**: if its env var is unset the route returns `503`, not open access.

| Token | Who holds it | Grants | Used by |
|---|---|---|---|
| `UAT_LOG_TOKEN` | Staff (shared) | **Read** review surfaces | UAT log, eval dashboard, `GET /api/labels` (JSON/CSV), `GET /api/label-stats` |
| `SIM_TOKEN` | Machines (CI/scripts) | **Drive the bot + write results** | `POST /api/sim`, `POST /api/eval-results`, `POST /api/label-queue` (ingest) |
| Reviewer token | Each reviewer (personal) | **Label replies, attributed** | `GET /api/label-queue`, `POST /api/labels` |

- **Transport:** an `x-uat-token` / `x-sim-token` / `x-labeler-token` header, or `?token=…` for the static pages (which have no other way to carry it).
- **`SIM_TOKEN` is the powerful one.** `/api/sim` force-authorizes the caller and drives the AI as *any* user ID, bypassing the whitelist. Treat it as a production secret and unset it when not running UAT.
- **Reviewer tokens are the only ones that carry identity** — that's what makes per-reviewer attribution and inter-rater agreement possible; a single shared token would make both impossible. Every configured token is checked with no early exit, keeping timing uniform.

#### Adding a reviewer (no deploy, no developer)

Reviewer access is managed the same way as the user whitelist: **a SharePoint list, edited by a non-technical admin.**

```
reviewer opens label.html, pastes token
        │
        ▼
LabelerService.resolve(token)
        │  Redis `labeler:list` (fresh < 5 min?) ──yes──► compare locally
        │                                    no
        ▼
Power Automate → SharePoint "Reviewers" list → cache → compare locally
```

**SharePoint list — `Reviewers`** (column names are matched case-insensitively; `Title` works in place of `Name`):

| Column | Notes |
|---|---|
| `Name` | Display name, shown in the UI and on labels |
| `Email` | **Becomes the permanent label id — never change it for an existing reviewer**, or their past labels detach from their new identity |
| `Token` | The credential. Have Power Automate fill it with `guid()` on create so admins never invent one |
| `Status` | `Approved` grants access; anything else (`Pending`, `Revoked`) denies. A missing Status column is treated as approved |

**To add someone:** add a row with Status `Approved`, then send them the generated token privately. Access starts within 5 minutes (cache refresh). **To remove someone:** set Status to anything else — same 5-minute window.

**Why fetch the whole list instead of looking a token up?** The presented token is never sent to Power Automate. We pull the reviewer list, cache it, and compare locally with `timingSafeEqual` — the secret stays on our infrastructure and the comparison stays constant-time.

**Resilience:** the cached list is kept for 24h but treated as fresh for 5 minutes. If Power Automate is unreachable at refresh time the service **serves the stale list** rather than locking every reviewer out over a transient outage. With no cache and no source, it denies (fails closed). `LABELER_TOKENS` still works alongside the list as a **break-glass** path — useful for local dev and for getting in when Power Automate is down.

### Outbound (how we authenticate *to* other systems)

| Target | Mechanism |
|---|---|
| AIBots via Directus | Directus URL + token, **plus IP whitelisting** (why all AI must route through Directus) |
| Dify | API key per bot |
| Power Automate (SharePoint writes) | The webhook URL itself is the secret — unguessable, no additional auth |
| Telegram | Bot token in the API URL |
| TikTok | OAuth client key/secret; access token refreshed by the `refresh-token.ts` cron |

### ⚠️ Known authentication gaps

1. **No inbound webhook signature verification.** `/api/webhook` does not verify that a request actually came from Telegram or TikTok. Anyone who learns the URL could POST a forged update impersonating any user ID. The whitelist limits the blast radius (the forged ID must already be approved), but that is *authorization standing in for authentication*. **Fix:** Telegram supports a `secret_token` on `setWebhook`, echoed back as the `X-Telegram-Bot-Api-Secret-Token` header — verify it and reject mismatches. TikTok has an equivalent signature scheme.
2. **Whitelist cache TTL is 30 seconds, not 5 minutes.** [`whitelistService.ts`](src/services/whitelistService.ts) sets `CACHE_TTL_SECONDS = 30` while the comment (and older docs) claim 5 minutes — roughly **10× more SharePoint calls than intended**. Decide which is right and align the code and the comment.
3. **Tokens in query strings** land in browser history, proxy logs, and `Referer` headers. Acceptable for internal dashboards; don't paste those URLs into tickets or chats.
4. **`UAT_LOG_TOKEN` and `SIM_TOKEN` are shared secrets** — they identify a *role*, not a person, so their actions aren't attributable. Rotate them when someone leaves.
5. **Holding `UAT_LOG_TOKEN` means reading real (PII-redacted) conversation content.** Treat it as access to sensitive data, not just a dashboard login.

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
| `TELEGRAM_BOT_TOKEN` | Telegram (the bot served by `/api/webhook`) |
| `TELEGRAM_BOT_TOKEN_STUDY` | Telegram token for the study bot on `/api/webhook-study` (falls back to `TELEGRAM_BOT_TOKEN`) |
| `STUDY_POWER_AUTOMATE_WEBHOOK_URL` | Separate conversation-log list for the study bot (falls back to the shared one) |
| `STUDY_MENU_MODE` | Study endpoint entry UX (`numbered` default / `intent`) |
| `STUDY_SCREENER_ENABLED` etc. | Per-flag overrides of the forced study configuration (see `src/lib/studyMode.ts`) |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | TikTok token cron |
| `SHAREPOINT_WHITELIST_WEBHOOK_URL` | RBAC whitelist lookup (Power Automate) |
| `POWER_AUTOMATE_WEBHOOK_URL` | Conversation log |
| `DEMOGRAPHICS_WEBHOOK_URL` | Demographics list |
| `EVAL_RESULTS_WEBHOOK_URL` | Eval results archive |
| `REGISTRATION_URL`, `COUNSELLING_BOOKING_URL` | Links |
| `UAT_LOG_TOKEN` | Human read access — UAT log + eval dashboard |
| `SIM_TOKEN` | Machine access — `/api/sim` + eval result writes |
| `BYPASS_AUTH` | `true` skips the whitelist check (**load-test only**, never prod) |
| `USE_DIRECT_LLM`, `QWEN_API_KEY`, `QWEN_MODEL`, `QWEN_BASE_URL` | Direct-LLM (Qwen) experiment for Carey; `QWEN_API_KEY`/`QWEN_BASE_URL` also drive the eval "youth" roleplay (add as a GitHub Actions secret for the scheduled run) |
| `EVAL_ROLEPLAY_MODEL` | Eval "youth" roleplay model (default `qwen-plus`) |
| `EVAL_MENU_MODES` | Which entry UX(es) the eval runs — `intent`, `numbered`, or both (default) |
| `SHAREPOINT_LABELERS_WEBHOOK_URL` | Reviewer list lookup (Power Automate) — the source of truth for labelling access |
| `LABELER_TOKENS` | Break-glass / local-dev reviewer tokens — `token:Name:email,…` (secrets). Optional once the SharePoint list is live |
| `LABELS_WEBHOOK_URL` | Power Automate → SharePoint "Labels" list (permanent archive / Power BI source) |
| `JUDGE_MODEL`, `JUDGE_LIMIT` | LLM-judge model (default `qwen-max`) and eval records per batch (default 20) |
| `OPENAI_API_KEY` | Local `npm run simulate` roleplay only (the scheduled eval now uses Qwen) |
| `SIM_BASE_URL` | Deployment URL for the sim/eval scripts |

---

## Scripts

```bash
npm run build         # tsc --noEmit (type-check)
npm test              # jest
npm run simulate      # drive /api/sim with a roleplayed youth
npm run judge         # batch pre-label eval replies with the LLM judge
npm run gen:prompt    # regenerate careySystemPrompt.ts from SYS_PROMPT.md
```
The scheduled eval runs from GitHub Actions (`.github/workflows/eval.yml`), not npm — trigger it manually via *Run workflow*, optionally choosing which menu mode(s) to evaluate.
Node isn't required in prod (Vercel builds it); local dev needs Node ≥ 20.

---

## Change log

Newest first. Anything marked **uncommitted** exists in the working tree but is not yet in git.

### Outcome measurement (Developer Briefing) — *in progress, uncommitted*
Structured outcome events reported by the coach via a `[DATA {...}]` tag: parser/validator (`src/lib/outcomeEvents.ts`), persistent confidence + session-count store (`src/lib/outcomeStore.ts`), dedicated SharePoint writer (`src/services/outcomeLogger.ts`), plus KPI fields in the conversation log. **Built and unit-tested but not yet wired** — see `docs/OUTCOME_METRICS_REVIEW.md` and `docs/OUTCOME_METRICS_IMPROVEMENTS.md` for the plan (schema fixes land before wiring).

### Study webhook, prompt repair, UI redesign, docs — *committed (Aug 26)*
- **`/api/webhook-study`** — serves the frozen NUS-study configuration from the shared deployment (forced study flags, own bot token, `study:` Redis namespace), after the pivot's env-flag flip had silently turned the careytest bot into the pivot.
- **`socialCoachPrompt.ts` repaired** — three GitHub-web edits had pasted raw v9 prompt text over the module, breaking every deploy since; re-wrapped with the `[CRISIS]`/`[REFERRAL]` tag contract restored (v9 defines no tags itself).
- **Function-cap cleanup** — removed dead `webhook-new.js`, `daily-risk-report.js`, `cron/tiktokToken.ts`; deployment now 10/12 functions.
- **Staff pages redesigned** — shared calm light theme, cross-navigation, mobile-friendly `label.html`, friendly token/empty states. JS behaviour byte-identical except a nav link.
- **`docs/`** — metrics review + improvement plan, prompt-editing proposal, reviewer runbook, accounts inventory, editing guide.

### Reviewer access via SharePoint — *committed*
Removed the developer from the loop for labelling access, matching how the user whitelist already works.
- `src/services/labelerService.ts` — reviewer list from a SharePoint "Reviewers" list via Power Automate, cached in Redis (fresh 5 min, retained 24h, **stale-on-failure** so an outage doesn't lock reviewers out); falls back to `LABELER_TOKENS` as break-glass/local dev.
- Fetches the whole list and compares locally with `timingSafeEqual` — the token is never sent to Power Automate.
- `labelers.ts` refactored to expose `matchToken`; endpoints now resolve reviewers asynchronously.
- 18 new tests (column-name/status parsing, cache freshness, stale-serving, fail-closed, break-glass).

### Reply labelling platform + judge agreement — *committed*
Groundwork for LLM-as-judge: build a human gold set, then measure whether a judge can be trusted to label at scale.
- `src/config/judgeRubric.ts` — versioned rubric (5 pass/fail dimensions + overall); single source of truth for the UI *and* the judge prompt. Critical-dimension failure forces `bad`, enforced in code.
- `src/lib/replyUnits.ts` — splits transcripts into reply-in-context units; skips deterministic screener turns.
- `src/services/replyJudge.ts` — tolerant JSON parsing; returns `null` rather than inventing a score.
- `src/lib/labelStore.ts`, `src/lib/labelers.ts` — Redis store + per-reviewer token identity.
- `src/lib/agreement.ts` — Cohen's κ, confusion matrix, per-dimension/per-version stats, inter-rater κ, bias direction, critical misses.
- `api/label-queue.ts`, `api/labels.ts`, `api/label-stats.ts`; `public/label.html`, `public/label-dashboard.html`; `npm run judge`.
- Agreement stored as two plain booleans (`hasJudgeProposal` + `agreedWithLlm`) rather than one three-state field, so SharePoint and Power BI stay simple.
- 41 new unit tests (κ verified against hand-computed values).

### Eval harness upgrades — *committed*
- **Menu-mode A/B** — every persona now runs under both `intent` and `numbered`; results tagged with `menuMode`, dashboard compares them side by side (KPIs, scorecard column, per-mode trend rows).
- **Roleplay "youth" moved from OpenAI `gpt-4o-mini` → Qwen** (`qwen-plus`) for cost. `run-eval.ts` only; the local `npm run simulate` still uses OpenAI.
- **6 new social-coach personas** (conflict repair, confession, left out, boundaries, deepening friendship) + `social_then_crisis`, which starts as coaching and escalates — exercising crisis routing *inside* the coach.
- `/api/sim` accepts a per-request `menuMode` override, independent of the global flag.

### Crisis-safety hardening — *committed*
- Universal deterministic phrase backstop in the router — runs on **every** turn in **every** phase, no LLM dependency.
- `emergencyHandler` rewritten to AI-generated **with a guaranteed static hotline fallback**, so `1771` survives any provider outage or entry path.
- Shared `containsCrisisPhrase` in `crisisDetection.ts` (was duplicated in the classifier).

### Seamless lane switching — *committed*
- In `intent` mode the router re-runs the classifier on **every** in-lane turn, so lanes can change mid-conversation. Default is to stay put; switching requires a confident, different intent. Never dumps to the menu mid-conversation.
- On a switch: fresh backend session + transcript as context + a bridging instruction (`justSwitchedLane` state flag).

### Intent classifier + toggle — *committed*
- `intentClassifierNode` replaced the numeric-only `optionRouter`; `menu:mode` Redis flag with a toggle on the UAT log page.

### Earlier — *committed*
- PII redaction before SharePoint/UAT sinks; `DirectLLMClient` (Qwen) experiment; social coach as its own bot with Dify fallback; demographics logging; scheduled eval harness + dashboard; UAT live log.

---

## Known caveats / TODO

- **Stale unit tests** — as of the last full run: **18 of 28 suites pass (194 tests pass, 4 fail)**. The 10 failing suites mostly fail to *compile* (0 tests run) because they reference the old PHQ-9 design, removed menu options (`wellbeingCheckNode`, `stressManagementNode`), and renamed exports: `whitelistService`, `sessionManager`, `ageCheckNode`, `ageGateNode`, `restartNode`, `questionnaireNode`, `answerEvaluator`, `responseNodes`, `optionNodes`, `integration/flows`. Production code is unaffected (`tsc --noEmit` is clean). Needs a cleanup pass.
- **Whitelist cache TTL mismatch** — code says 30s, comment says 5 min. See the authentication gaps above.
- **No inbound webhook signature verification** — see the authentication gaps above. Highest-value security fix.
- **`CLAUDE.md` is out of date** — see note at top.
- **AIBots occasionally re-runs the screener** — the seeded AIBots prompt still contains the (now deterministic) screener states; very rare, but the definitive fix is to trim States 0/1 from the seeded prompt on the AIBots/Directus side.
- **Dify & PDPA** — the Dify fallback can route conversation data off SG-approved infra on AIBots failure. Flagged for a compliance decision; the social-coach Dify fallback is explicitly temporary.
- **DirectLLMClient has no RAG** — unlike AIBots/Dify it has no knowledge-base retrieval; only relevant if the Qwen experiment is pursued.
```
