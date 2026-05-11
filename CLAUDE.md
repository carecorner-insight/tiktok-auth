# CareyBot — Claude Code Context

This file is the source of truth for any Claude Code session on this project.
Read it fully before doing anything. All design decisions are final unless the user explicitly changes them.

---

## What is CareyBot

A mental health triage chatbot deployed on Vercel serverless. Platforms: TikTok and Telegram.
Operator: INSIGHT Care Corner Singapore. PDPA compliance required. No third-party data access.

---

## Locked Design Decisions

### Conversation Flow

1. **RBAC check** — every message. Unauthorized users get a registration prompt with their user ID.
2. **PHQ-9 Questionnaire** — runs every new session (6hr Redis TTL). 9 questions, sequential, Yes/No plain text answers.
   - **Q1 = PHQ-9 Q9 (suicidal ideation), asked first** for early triage.
   - Any answer to Q1 = "yes" → immediate `emergencyHandler`, questionnaire terminates.
   - Q2–Q9 are tabulated after all 9 questions answered.
3. **Risk scoring** (pure local logic in `answerEvaluator`, no AI call):
   - Q1 yes → `high` (immediate)
   - Q2–Q9 score ≥ 6 → `high` (after all questions)
   - Q2–Q9 score 3–5 → `medium`
   - Q2–Q9 score 0–2 → `low`
   - Both `high` paths route to `emergencyHandler`.
4. **Post-questionnaire menu** (low and medium — same user experience):
   ```
   1. Talk about something that's been bothering me  → freeTextNode (calls AIBots)
   2. Do a quick wellbeing self-check                → wellbeingCheckNode (AIBots, vector DB)
   3. Learn ways to manage stress                    → stressManagementNode (AIBots + vector DB)
   4. Find support / resources                       → resourceRedirectNode (static URL)
   ```
5. **Option 1 crisis detection** — if crisis signals appear mid free-text, re-trigger `emergencyHandler`.
6. **Conversation ends** after any option completes.
7. **Session resume** — mid-questionnaire dropout resumes at correct `questionIndex` on next message.

### Risk Tiers (admin side)
- `low` vs `medium` have identical user experience. Difference is logged to SharePoint for human agent review.
- `high` always triggers emergency message + SharePoint log for human agent intervention.

### Emergency Message
Static text with Singapore crisis hotlines (IMH 6389 2222, SOS 1800 221 4444, 995 for immediate danger).

### Whitelist / RBAC
- Whitelist stored in SharePoint list (non-tech admin manages via SharePoint UI).
- Cached in Redis with 5-minute TTL.
- **Onboarding flow:**
  1. Unknown user messages bot → bot replies with their user ID + registration URL.
  2. Registration page (Vercel endpoint): Name, Email, Platform (pre-filled), User ID (pre-filled, read-only).
  3. Submission → Power Automate → SharePoint "Whitelist" list (columns: UserID, Platform, Name, Email, Status [Pending/Approved], RegisteredAt).
  4. Admin approves in SharePoint (no code needed).
  5. Next message: user is authorized (Redis cache refreshes within 5 min).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Vercel serverless, TypeScript |
| Orchestration | LangGraph (TS SDK) |
| AI brain | Singapore gov AIBots platform (all user-facing responses) |
| AI gateway | Directus (IP whitelist requirement for AIBots) |
| Batch tagger | Microsoft Copilot Studio (async, SharePoint only, NOT in real-time flow) |
| Session state | Upstash Redis (`@upstash/redis`), 6hr TTL |
| Conversation logs | SharePoint via Power Automate (permanent, non-tech team) |
| Whitelist cache | Redis, 5min TTL |
| Platforms | TikTok + Telegram |

**Critical:** Copilot Studio is ONLY for batch tagging on SharePoint. It is never called in the real-time message flow. AIBots (via Directus) handles all live AI responses.

---

## LangGraph State Shape

```typescript
interface CareyBotState {
  platform: 'tiktok' | 'telegram';
  userId: string;
  sessionId: string;
  isAuthorized: boolean;
  questionIndex: number;       // 0–8 active; 9 = all answered
  answers: string[];           // plain text 'yes'/'no'
  riskLevel: 'low' | 'medium' | 'high' | null;
  conversationPhase: 'questionnaire' | 'menu' | 'option' | 'ended';
  selectedOption: 1 | 2 | 3 | 4 | null;
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>;
  pendingResponse: string | null;
  crisisDetected: boolean;
}
```

## LangGraph Graph Edges

```
START → authGuard
authGuard ──[unauthorized]──► unauthorizedResponse → END
authGuard ──[authorized]────► sessionLoader → router

router ──[phase=questionnaire]──► questionnaireNode → answerEvaluator
router ──[phase=menu]───────────► menuPresenter → END (await next msg)
router ──[phase=option, opt=1]──► freeTextNode
router ──[phase=option, opt=2]──► wellbeingCheckNode
router ──[phase=option, opt=3]──► stressManagementNode
router ──[phase=option, opt=4]──► resourceRedirectNode

answerEvaluator ──[high risk]──────────────► emergencyHandler
answerEvaluator ──[questions remain]───────► questionnaireNode
answerEvaluator ──[all done, not high risk]─► menuPresenter

freeTextNode ──[crisis detected]──► emergencyHandler
freeTextNode ──[normal]───────────► sessionPersister

emergencyHandler → sessionPersister → END (async: sharePointLogger)
wellbeingCheckNode → sessionPersister → END
stressManagementNode → sessionPersister → END
resourceRedirectNode → sessionPersister → END
```

---

## Project Structure

```
src/
├── types/
│   ├── state.ts          ✅ done
│   └── platform.ts       ✅ done
├── config/
│   └── questionnaire.ts  ✅ done — PHQ-9 questions, thresholds, static strings
├── adapters/
│   ├── telegram.ts
│   └── tiktok.ts
├── services/
│   ├── whitelistService.ts
│   ├── sessionManager.ts
│   ├── sharePointLogger.ts
│   └── aiBotsClient.ts
├── nodes/
│   ├── authGuard.ts
│   ├── router.ts
│   ├── questionnaireNode.ts
│   ├── answerEvaluator.ts
│   ├── emergencyHandler.ts
│   ├── menuPresenter.ts
│   ├── optionRouter.ts
│   ├── freeTextNode.ts
│   ├── wellbeingCheckNode.ts
│   ├── stressManagementNode.ts
│   ├── resourceRedirectNode.ts
│   └── sessionPersister.ts
├── graph/
│   ├── graph.ts
│   └── runner.ts
├── api/
│   ├── webhook.ts
│   ├── register.ts
│   └── cron/
│       └── tiktokToken.ts
└── __tests__/
    ├── mocks/
    │   └── index.ts      ✅ done — state/service mock factories, answer fixtures
    ├── services/
    ├── adapters/
    ├── nodes/
    └── integration/
```

---

## Build Phases

### Phase 0 — Foundation ✅ COMPLETE
- `package.json` — TypeScript + Jest devDeps, trimmed prod deps
- `tsconfig.json` — strict, CommonJS, path aliases (`@/types/*`, `@/nodes/*`, etc.)
- `jest.config.ts` — ts-jest, 80% coverage threshold
- `src/types/state.ts` — all state types + `initialState` factory
- `src/types/platform.ts` — `IPlatformAdapter` interface
- `src/config/questionnaire.ts` — PHQ-9 questions + risk thresholds + static messages
- `src/__tests__/mocks/index.ts` — mock factories + answer fixtures

**User must run `npm install` on a machine with Node.js before proceeding.**

---

### Phase 1 — Services (NEXT) 🔲
Write failing tests first, then implement. Each service is a pure unit — no LangGraph dependency.

#### 1a. `WhitelistService`
File: `src/services/whitelistService.ts`
Test: `src/__tests__/services/whitelistService.test.ts`
- Reads approved user IDs from SharePoint list
- Caches in Redis with 5-minute TTL
- Returns `boolean` for `isAuthorized(platform, userId)`

Tests to write first:
```
it('returns true for an approved userId cached in Redis')
it('fetches from SharePoint on cache miss and caches the result')
it('returns false for a pending userId')
it('returns false for an unknown userId')
it('serves cached result within 5min TTL without calling SharePoint')
```

#### 1b. `SessionManager`
File: `src/services/sessionManager.ts`
Test: `src/__tests__/services/sessionManager.test.ts`
- Loads/saves `CareyBotState` in Redis keyed by `{platform}:{userId}`
- 6-hour TTL, reset on every save

Tests to write first:
```
it('returns null when no session exists')
it('loads existing state within 6hr TTL')
it('returns null and clears state after 6hr expiry')
it('saves state and resets TTL')
```

#### 1c. `SharePointLogger`
File: `src/services/sharePointLogger.ts`
Test: `src/__tests__/services/sharePointLogger.test.ts`
- Posts conversation log to SharePoint via Power Automate webhook (fire-and-forget)
- Must not throw or block if SharePoint is unreachable

Tests to write first:
```
it('posts message log without blocking')
it('does not throw if SharePoint webhook is unreachable')
```

#### 1d. `AIBotsClient`
File: `src/services/aiBotsClient.ts`
Test: `src/__tests__/services/aiBotsClient.test.ts`
- Sends message history to AIBots via Directus
- On empty/error response, retries with full history (crash recovery)
- Throws after max retries

Tests to write first:
```
it('sends conversation history to Directus and returns AI response')
it('retries with full history on empty response (AIBots crash recovery)')
it('throws after max retries exceeded')
```

---

### Phase 2 — Platform Adapters 🔲
`IPlatformAdapter` interface already defined in `src/types/platform.ts`.
Both adapters must pass the same test suite.

### Phase 3 — LangGraph Nodes 🔲
Each node tested in isolation with mock state from `src/__tests__/mocks/index.ts`.
Key node: `answerEvaluator` — pure function, no mocks needed.

### Phase 4 — Graph Integration Tests 🔲
Full flows with all services mocked.

### Phase 5 — Webhook + Registration Endpoint 🔲

---

## Environment Variables Required

```
# Redis (Upstash)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# AIBots via Directus
DIRECTUS_URL=
DIRECTUS_TOKEN=

# SharePoint logging (Power Automate webhook)
POWER_AUTOMATE_WEBHOOK_URL=

# SharePoint whitelist (Graph API or Power Automate)
SHAREPOINT_WHITELIST_WEBHOOK_URL=

# Telegram
TELEGRAM_BOT_TOKEN=

# TikTok
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=

# Registration page
REGISTRATION_URL=
COUNSELLING_BOOKING_URL=
```

---

## Key Constraints (never violate these)

1. **PDPA** — no conversation data leaves Singapore-approved infrastructure. No Dify, no third-party AI.
2. **AIBots via Directus only** — Directus is required for IP whitelisting. Never call AIBots directly.
3. **Copilot Studio = batch tagging only** — never call it in the real-time message path.
4. **Vercel serverless** — no persistent connections. Use `@upstash/redis` (HTTP-based), not `ioredis`.
5. **TDD** — write the failing test before implementing any function.
6. **No dependency on CareyBot** — system prompt instructs AIBots not to act as a human and to redirect users to real support.
