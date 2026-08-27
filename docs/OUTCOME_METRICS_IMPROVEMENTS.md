# Outcome Metrics — Improvement Plan

How to wire up, fix, and extend the programme-outcome measurement layer
(`[DATA]` tag → validation → SharePoint outcome list). Covers the eight defects
found in review, with concrete file-level changes, schema impact, effort, risks,
and a proposed order.

**Scope guard:** everything here applies to the **CareyChats pivot bot only**.
The NUS-study bot is frozen; every change below must be inert when the pivot env
vars are unset (same pattern as `src/lib/pivotFlags.ts`). The simplest master
switch: the outcome logger only runs when `OUTCOME_WEBHOOK_URL` is set, and that
var is never set on the study Vercel project.

---

## 0. Prerequisite — wire the pipeline end-to-end

Everything below assumes outcome events actually flow. Today they don't, at
**both** ends:

- The coach prompt (`src/config/socialCoachPrompt.ts`, "Carey v9") asks the
  outcome questions (STEP 4 line 962, State 7 line 1124, State 9 line 1196) but
  contains **no `[DATA]` instruction anywhere** — the coach never reports
  answers.
- `src/nodes/socialCoachNode.ts` calls only `parseReplyTags()` (crisis/social/
  referral). `parseOutcomeTag()` from `src/lib/outcomeEvents.ts` is never
  called, and `OutcomeLogger` (`src/services/outcomeLogger.ts`) is never
  constructed.

**Worth noting:** if the prompt started emitting `[DATA {...}]` today, the tag
would leak to the user verbatim — `parseReplyTags` doesn't strip it. So the
prompt change and the parser wiring must land in the same deploy.

### What changes

| File | Change |
|---|---|
| `src/config/socialCoachPrompt.ts` | Add a `DATA` section to `REPLY_TAG_CONTRACT` (it is appended whenever the base prompt defines no tags — see `baseDefinesTagContract`): after each outcome question is answered, append `[DATA {"confidence_rating": N}]` etc. to the reply. One example per field. |
| `src/nodes/socialCoachNode.ts` | After `parseReplyTags(result.reply)`, run `parseOutcomeTag(reply)`. Return the stripped reply as `pendingResponse` and the validated fields in a new state key. Log `rejected` keys to console for monitoring. |
| `src/types/state.ts` | Add `outcomeFields: OutcomeFields \| null` (per-turn scratch, cleared after logging) and register it in the `GraphAnnotation` in `src/graph/graph.ts`. |
| `api/webhook.ts` (`handleMessage`) | Where `logger.log(...)` is awaited (line ~223), also: if `result.state.outcomeFields` is non-empty and `OUTCOME_WEBHOOK_URL` is set, build `OutcomeEventContext` and `await new OutcomeLogger(url).log(ctx, fields)`. Awaited for the same reason the chat log is — fire-and-forget POSTs get dropped when the function freezes after `waitUntil`; `OutcomeLogger.log` never throws, so the conversation is never blocked. |
| `src/graph/runner.ts` | On new session (`existing === null`), call `incrementSessionNumber` from `src/lib/outcomeStore.ts` (per the earlier decision: session number increments on the **first message** of a new session). Carry `sessionNumber` into state or return it alongside `RunResult` so the webhook can put it in the context. |
| `src/lib/outcomeStore.ts` | Already done — `getPreviousConfidence`/`setPreviousConfidence` get called around each `confidence_rating` event: read before logging (fills `previous_confidence_rating`), write after. |

### SharePoint / schema impact
None — the outcome list columns already exist; this is the wiring they were
built for.

**Effort:** M &nbsp; **Risks:** tag leakage if prompt/parser land separately
(deploy together); LLM emits malformed JSON (already handled — counted in
`rejected`, row dropped).
**Depends on:** nothing. **Blocks:** everything else in this doc.

---

## 1. Instrument drift + version stamping

The briefing defines confidence as a 4-point scale and `outcomeEvents.ts`
validates `confidence_rating` 1–4 (`INT_RANGES`, line 57). The live v9 prompt
(STEP 4, `socialCoachPrompt.ts:962`) offers **three** options:

```
1. 😬 Still nervous
2. 🙂 A bit more ready
3. 💪 Ready to try it
```

So "2" means different things depending on which prompt version was live. No
version is stamped into rows, so drift like this is invisible after the fact.

### What changes

1. **Pick one scale** (team decision — see end of doc). Since no production
   data exists yet, this is free to fix now. Either restore the 4th option in
   the prompt, or narrow `INT_RANGES.confidence_rating` /
   `previous_confidence_rating` to `[1, 3]` and update the briefing.
2. **Version constants**, following the existing `JUDGE_VERSION` precedent in
   `src/config/judgeRubric.ts`:
   - `export const COACH_PROMPT_VERSION = 'v9'` in `socialCoachPrompt.ts`
     (the footer at line 1335 already says v9 — make it machine-readable, and
     bump it on any wording change to an outcome question).
   - `export const OUTCOME_SCHEMA_VERSION = '1'` in `outcomeEvents.ts`, bumped
     on any enum/range change.
3. `OutcomeLogger.log` adds `instrument_version:
   \`${COACH_PROMPT_VERSION}/${OUTCOME_SCHEMA_VERSION}\`` to every payload.
   Power BI filters/segments on it; cross-version comparisons become an
   explicit analyst choice instead of a silent error.

### SharePoint / schema impact
**One new column** on the outcome list: `instrument_version` (text). Ops step:
add the column and map it in the Power Automate flow before deploying.

**Effort:** S &nbsp; **Risks:** forgetting to bump the constant on a prompt
edit — mitigate with a test asserting the constant changes when the outcome
question blocks change (hash the three question strings).
**Depends on:** 0.

---

## 2. Replace `confidence_change` with a computed delta

`ConfidenceChange` (`same | more | much_more`, `outcomeEvents.ts:23`) cannot
record decline, and it duplicates information we already store: both
`previous_confidence_rating` (from `outcomeStore`) and `confidence_rating` are
in the row. Asking the model to also *judge* the change invites a second,
inconsistent source of truth.

### What changes

| File | Change |
|---|---|
| `src/lib/outcomeEvents.ts` | Remove `confidence_change` from `OutcomeFields` and `ENUMS`. (Keep accepting-and-discarding it for one prompt generation so an old cached prompt doesn't spam `rejected`.) |
| `src/services/outcomeLogger.ts` | Replace the `confidence_change` payload field with `confidence_delta`: `current − previous` when both exist (range −3…+3 on a 4-pt scale, negatives = decline), `''` otherwise. Computed in `log()`, never asked. |
| `src/config/socialCoachPrompt.ts` | Ensure the prompt never asks a "more/less confident than last time" question — only the plain rating. Returning-user context (previous rating) can still be *shown* to the coach via the prime for warmth, but it reports only the new rating. |

### SharePoint / schema impact
Rename/replace column `confidence_change` → `confidence_delta` (number,
signed). Ops step: column change + Power Automate mapping. Alternative that
avoids touching the flow: keep the column name and write the signed number into
it — cheaper, slightly confusing name. Flag for the team.

**Effort:** S &nbsp; **Risks:** minimal — no data exists yet.
**Depends on:** 0 (and settle scale in 1 first, so the delta range is defined).

---

## 3. Behavioral outcome — the 2-week Telegram check-in

Pivot brief F5 groundwork exists only as a comment
(`socialCoachNode.ts:54` — "lastTopic: null — not persisted yet"). Nothing
persists first/last-seen, no cron exists (`vercel.json` currently has one cron:
`/api/refresh-token`). The check-in is the only *behavioral* outcome we can
get: "did you actually try the thing you practised?"

### Design

**Storage** — `src/lib/checkinStore.ts` (new lib file, no function-slot cost),
same pattern as `ageStore`/`outcomeStore`:

- `checkin:{platform}:{userId}` → JSON `{ dueAt, scenarioType, sessionId,
  status: 'scheduled' | 'sent' | 'answered' | 'opted_out' }`, ~60-day TTL.
- A Redis **sorted set** `checkin:due` scored by `dueAt`, so the cron does one
  `ZRANGEBYSCORE` instead of a keyspace scan.
- `firstSeenAt`/`lastSeenAt` per user (one small hash), updated in
  `runner.processMessage` — cheap, and gives the programme team tenure data.

**Scheduling** — in `api/webhook.ts` after a successful coach turn: if platform
is Telegram, `CHECKIN_ENABLED=true`, the session ran the social coach
(`selectedOption` set / scenario menu build), and **no key exists yet** (one
check-in per user, ever), schedule `dueAt = now + 14d` with the session's
scenario slug.

**Sending** — new `api/cron/checkin.ts` (uses a function slot — see §5 budget):
Vercel cron daily; pops due entries; sends via `TelegramAdapter` directly (the
bot may message any user who has messaged it). Message is static, matching the
coach's enum-question style:

```
Hey, it's Carey 🙂 Two weeks ago we practised for a social situation.
Did you get a chance to try it?

1. Tried it — went okay
2. Tried it — was hard
3. Not yet
4. Please don't check in again
```

Marks status `sent`.

**Reply capture** — in `runner.processMessage`, *before* the graph runs: if the
user's check-in status is `sent` and the message is a bare `1–4`, log an
outcome event (`behavior_attempted`: `tried_ok | tried_hard | not_yet`, or mark
`opted_out` for 4), send a one-line static acknowledgement (offer the coach
again for 2), set status `answered`, and stop. Anything else falls through to
the normal graph — the check-in must never trap a user who comes back with
something real (including a crisis disclosure, which the normal flow's
detection handles).

### SharePoint / schema impact
New columns on the outcome list: `event_type` (see §4 — this rides on it,
value `checkin`), `behavior_attempted` (choice), `days_since_session`
(number). Ops step: columns + Power Automate mapping.

**Effort:** L &nbsp; **Risks:** unsolicited messaging — the coach's close
should set expectations ("Mind if I check in in a couple of weeks?"; consent
wording is a team decision); user blocked the bot (Telegram 403 → mark
`opted_out`, never retry); cron and study bot — the study project simply never
sets `CHECKIN_ENABLED`, and `vercel.json` crons only fire where the path
exists, but verify the study project's cron config explicitly.
**Depends on:** 0, 4 (`event_type` column), and the function-slot budget in 5.

---

## 4. Denominators — per-session rows with nulls preserved

Today a row would exist **only** when the coach emits `[DATA]`. "Asked but not
answered", "session died before STEP 4", and "coach never asked" are all the
same absence. Response rates and survivorship bias are unmeasurable.

### Design

Add an `event_type` column and write **two kinds of rows**:

1. **`session_start`** — one row per session, written from `handleMessage` on
   the turn `runner` created a fresh session (the same trigger as the
   session-number increment). All outcome fields empty. This is the
   denominator: every session appears exactly once regardless of how it ends
   (we cannot observe "session end" — sessions die by 6-hour Redis expiry).
2. **`outcome`** — the existing per-`[DATA]` rows (and `checkin` from §3,
   `link_click` from §5).

Plus an **asked-signal**: the prompt's `[DATA]` instruction includes, *in the
same message as the question*, `[DATA {"asked": "confidence"}]` (enum:
`confidence | clarity | helpseeking`). Add `asked` to `OutcomeFields`/`ENUMS`
in `outcomeEvents.ts` and an `asked` column. Then in Power BI, per
`session_id`:

| Measure | Formula |
|---|---|
| Ask rate | sessions with `asked=confidence` ÷ `session_start` rows |
| Response rate | sessions with `confidence_rating` ÷ sessions with `asked=confidence` |
| Early-exit | `session_start` with no subsequent rows |

No upserts, no session-end detection, joins by `session_id` — Power Automate
stays a dumb append-only writer.

### SharePoint / schema impact
Two new columns: `event_type` (choice), `asked` (choice). Ops step: columns +
flow mapping. Row volume roughly doubles (one extra row per session) — trivial
for a SharePoint list at this scale.

**Effort:** M &nbsp; **Risks:** the asked-signal depends on the LLM
remembering to emit it (mildly lossy — ask rate is a floor, not exact); noted
as an instrument caveat.
**Depends on:** 0, 1 (version stamp should be on session rows too).

---

## 5. `insight_link_clicks` — redirect endpoint with UTM

`outcomeLogger.ts:81` hardcodes `insight_link_clicks: ''` with a comment that
it needs a redirect service. The INSIGHT URL currently reaches users from two
places: `src/nodes/resourceRedirectNode.ts` (built via `referralUrlForAge` /
`COUNSELLING_URL` from `src/config/questionnaire.ts`) and hardcoded inside the
coach prompt text (States 6/7 and the turn-13 nudge —
`socialCoachPrompt.ts:1115, 1136, 1149, 1218`), i.e. sometimes emitted by the
LLM itself.

### Function budget — verified

`api/` currently contains **10** serverless functions: `eval-results.ts`,
`label-queue.ts`, `label-stats.ts`, `labels.ts`, `refresh-token.js`,
`register.ts`, `sim.ts`, `uat-logs.ts`, `webhook-study.ts`, `webhook.ts`.
Vercel Hobby caps a deployment at **12**. This plan adds `api/go.ts` (here) and
`api/cron/checkin.ts` (§3) → **exactly 12, zero headroom**. Before or
immediately after, consolidate the three labelling endpoints (`labels.ts`,
`label-stats.ts`, `label-queue.ts`) into one function routed by query param —
frees 2 slots and touches only the labelling platform (update fetch URLs in
`public/label.html` / `public/label-dashboard.html`). Recommended as a
prerequisite so the deploy never hard-fails at the cap.

### Design

- **`api/go.ts`** — `GET /api/go?to=insight&sid=<sessionId>`. Server-side
  allow-map `{ insight: <INSIGHT url>, crest: ..., counselling:
  COUNSELLING_URL }` — never an open redirect. Appends
  `utm_source=careychats&utm_medium=telegram&utm_campaign=<to>` and 302s.
  Fire-and-forget before redirecting: outcome row `event_type=link_click` with
  `session_id`, `link_destination`; plus a Redis counter for a cheap live
  number. **PDPA:** `sid` is the opaque session id — no userId, no content in
  the URL, and the redirect must never delay the 302 on logger failure.
- **Deterministic rewrite, not prompt-emitted URLs:** in
  `socialCoachNode.ts`, after `parseReplyTags`, string-replace any occurrence
  of the known INSIGHT URL in the reply with
  `https://<deployment>/api/go?to=insight&sid=${state.conversationId}`. Same in
  `resourceRedirectNode.ts` when building `RESOURCE_BLOCK` / the referral
  message. This avoids asking the LLM to reproduce a query-string URL (it will
  mangle it) and leaves the prompt untouched.

### SharePoint / schema impact
Rides on `event_type` (§4) plus one column `link_destination` (choice). The
existing `insight_link_clicks` column becomes unused at row level — clicks are
counted as rows, joined by `session_id` (a click can happen days later; a
per-session count column can't capture that).

**Effort:** M (S for the endpoint, the rest is the rewrite + consolidation)
**Risks:** function cap (mitigated above); redirect URL looks less trustworthy
than the bare domain — mitigate with a clean path via a `vercel.json` rewrite
(`/go/insight` → `/api/go?to=insight`); study bot unaffected (rewrite only
runs where the pivot flags/env are set).
**Depends on:** 4 (`event_type`). Endpoint itself has no dependency — can ship
early.

---

## 6. Enum-mapping audit via the labelling platform

The coach maps free-text answers ("i guess a bit better?") onto enums, and raw
answers are deliberately kept out of the outcome list (PDPA separation, per the
header comment in `outcomeLogger.ts`). So mapping error is invisible. But the
raw turn **does** exist, PII-redacted, in the conversation log
(`sharePointLogger.ts`) — and the labelling platform
(`src/lib/labelStore.ts`, `api/label-queue.ts`, `public/label.html`) already
handles conversation content in Redis with a 180-day TTL and human reviewers.

### Design

- **Sampler script** (`scripts/`, not a serverless function): monthly, sample
  N sessions that have outcome rows; join each outcome event to the
  surrounding conversation turns (coach question + user answer, by
  `session_id`/timestamp from the chat log); build audit units.
- **Ingest** through the existing machine-ingest path —
  `POST api/label-queue.ts` (gated by `SIM_TOKEN`, dedup by `replyKey`) — as a
  new unit kind: context = the Q/A exchange, "judge proposal" = the enum the
  coach emitted, stamped with `instrument_version` (the direct analog of
  `judgeVersion` on `HumanLabel`).
- **Review UI** — `public/label.html` gets one extra rubric mode: a single
  dimension, `mapping`: `correct | incorrect | not_inferable`, with the correct
  enum selectable on `incorrect`. `labelStore.ts` types get a discriminated
  union or a parallel `MAPPING_LABELS_KEY` list (cleaner — keeps the existing
  reply-quality stats untouched, and `api/label-stats.ts` untouched).
- **Output:** mapping error rate ± CI per field per instrument version — an
  error bar to attach to every outcome chart. ~30–50 units/month is enough.

### SharePoint / schema impact
None on the outcome list. If audit results should be archived beyond Redis,
reuse the existing labels → SharePoint flow (ops decision, not required for
v1).

**Effort:** M &nbsp; **Risks:** reviewers see conversation content — but that
is already the labelling platform's job and access model; the audit stores
nothing new in the outcome list.
**Depends on:** 0 and 1 (needs real events + version stamps). Fully parallel
to 3/4/5.

---

## 7. Scenario slug mapping at the logger boundary

Code slugs (`Scenario['slug']` in `src/config/questionnaire.ts:132`):
`new_start | work_adulting | friends | relationships | awkward | online`.
Briefing analytics enums: `starting_new`, `online_texting`, etc. The slugs are
a **parse contract with the coach prompt** (see the warning comment above
`scenarioPrime`, `questionnaire.ts:190`) — renaming them silently degrades the
coach. So translate at the edge instead.

### What changes

`src/services/outcomeLogger.ts` — module-level map, applied in `log()`:

```ts
const SCENARIO_ANALYTICS: Record<string, string> = {
  new_start: 'starting_new',
  work_adulting: 'work_adulting',
  friends: 'friends',
  relationships: 'relationships',
  awkward: 'awkward',
  online: 'online_texting',
};
// scenario_type: SCENARIO_ANALYTICS[ctx.scenarioType] ?? ctx.scenarioType
```

Unknown slugs pass through unmapped (visible in the data, not dropped). A unit
test asserts every `SCENARIOS` slug has a mapping, so adding a menu option
without one fails CI.

### SharePoint / schema impact
None — `scenario_type` column already exists; this fixes the values before
first real write.

**Effort:** S &nbsp; **Risks:** none meaningful. **Depends on:** 0. Quick win.

---

## 8. `path_selected` — give it a producer in state

`OutcomeEventContext.pathSelected` (`outcomeLogger.ts:18`) has no source: no
state field records which path the user took. The knowledge exists in two
places:

- **Intent build:** `src/nodes/intentClassifierNode.ts` — `INTENT_TO_OPTION`
  maps `TALK→1, SOCIAL→2, HUMAN→3`, and `goToLane()` is the single funnel for
  both numeric picks and LLM classification.
- **Scenario-menu build:** every option routes to the coach
  (`graph.ts:128–129`), so the path is always `social_coach`; a referral only
  happens later via the `[REFERRAL]` tag (`referralShown` already tracks it).

### What changes

| File | Change |
|---|---|
| `src/types/state.ts` | Add `pathSelected: 'social_coach' \| 'just_talk' \| 'connect_worker' \| null` to `CareyBotState` + `initialState`; register in `GraphAnnotation` (`graph.ts`). |
| `src/nodes/intentClassifierNode.ts` | In `goToLane(target)`, set `pathSelected` from `{1: 'just_talk', 2: 'social_coach', 3: 'connect_worker'}[target]`. A mid-conversation lane switch overwrites it — last path wins within the session, which matches "what did this session end up being". |
| `src/nodes/menuPresenter.ts` / scenario-menu route | When `scenarioMenuEnabled()`, the node handling the scenario pick sets `pathSelected: 'social_coach'`. `resourceRedirectNode.ts` referral branch sets `'connect_worker'` if the team wants referral to count as the path (decision below — recommendation: keep `referralShown` separate and let `pathSelected` mean the user's *choice*). |
| `api/webhook.ts` | Pass `result.state.pathSelected` into `OutcomeEventContext`. |

### SharePoint / schema impact
None — `path_selected` column exists.

**Effort:** S &nbsp; **Risks:** semantics of lane-switching sessions (noted
above; pick one and document it in the column description).
**Depends on:** 0.

---

## Implementation order

Quick wins first, respecting dependencies:

| # | Item | Effort | Why here |
|---|---|---|---|
| 1 | §0 Wire the pipeline (prompt `[DATA]` + parse + logger + session number) | M | Prerequisite for all data |
| 2 | §1 Version stamping + settle the confidence scale | S | Must be in place before row #1 is ever written |
| 3 | §7 Slug mapping | S | One map + one test; before first real write |
| 4 | §2 `confidence_delta` (drop the asked enum) | S | Prompt + schema tweak while touching both anyway |
| 5 | §8 `pathSelected` state field | S | Small, unblocks routing analysis |
| 6 | §4 `event_type` + session_start rows + asked-signal | M | Denominators; needed before check-in and clicks reuse `event_type` |
| 7 | Consolidate label endpoints into one function | S | Frees 2 function slots before adding 2 |
| 8 | §5 `api/go.ts` redirect + URL rewrite | M | Independent, high analytical value |
| 9 | §3 Two-week check-in (`checkinStore` + cron + reply capture) | L | Largest piece; needs 6's schema and 7's slots |
| 10 | §6 Mapping audit sampler + label UI mode | M | Needs a few weeks of real events to sample |

Items 1–5 are one coherent PR-sized effort and one Power Automate/ops session
(columns: `instrument_version`; rename/redefine `confidence_change`). Items
6–8 are the second wave (columns: `event_type`, `asked`,
`link_destination`). Item 9 is its own project (columns:
`behavior_attempted`, `days_since_session`).

## Ops steps (SharePoint / Power Automate) — consolidated

1. Wave 1: add `instrument_version` column; repoint `confidence_change` →
   `confidence_delta` (or reuse the column, renamed in Power BI); map both in
   the outcome flow.
2. Wave 2: add `event_type`, `asked`, `link_destination` columns + mappings.
3. Wave 3: add `behavior_attempted`, `days_since_session` + mappings.
4. Set `OUTCOME_WEBHOOK_URL` (and later `CHECKIN_ENABLED`) **only** on the
   CareyChats Vercel project. Confirm both stay unset on the study project.

## Decisions needed from the team

1. **Confidence scale: 3-point or 4-point?** The prompt shows 3, the briefing
   says 4. No data exists yet, so either is free — but it must be settled
   before the first production row (blocks §1, §2).
2. **`confidence_change` column:** rename to `confidence_delta` (flow change)
   or reuse the existing column for the signed number (no flow change, odd
   name)?
3. **Check-in consent wording:** does the coach ask permission at session
   close ("mind if I check in in two weeks?"), or is the single check-in +
   opt-out option considered enough? Affects §3 scheduling condition.
4. **`path_selected` semantics** when a user switches lanes mid-session: last
   lane wins (recommended) or first choice sticks?
5. **Redirect domain cosmetics:** is `/go/insight` on the bot's domain
   acceptable in user-facing messages, or does the team want a nicer alias?
6. **Audit archive:** do mapping-audit labels need to reach SharePoint/Power
   BI, or is the Redis-backed label dashboard enough?
