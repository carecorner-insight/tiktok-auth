# Carey KPI Data Spec - Event-based Computation

**Historical collection/report review (22 October 2026).** This snapshot predates
the Metrics tab and additional derived monthly measures. For the current monthly
report format, Microsoft summary flow and Power BI setup, use
[Monthly KPI reports and Power BI](KPI_POWERBI_SETUP.md). Statements below about
the absence of those reporting features describe the earlier reviewed revision.

Updated 22 October 2026 | Social coach on Telegram only | Code baseline: `c5f682c`

This is the implementation-aligned revision of **Carey KPI Data Spec - Chatlog Computation**. It replaces the original field names and ambiguous "Ready" labels for technical mapping. It describes the current code, not proof that every production event reached Microsoft Lists. Funder targets are retained from the original specification; changes to measurement definitions still require agreement.

## 1. Field-name crosswalk

These are exact, case-sensitive names. Event values describe what happened; they are not extra columns. Report outputs are calculated results, not webhook fields.

| Original wording | Current field or event | Interpretation |
|---|---|---|
| usefulRating | `usefulness` | Snapshot: `yes`, `no`, `missing`. For K1, use `response_recorded` events with `question=usefulness` and a valid `response`, not every repeated snapshot. |
| readinessRating | `readiness` | Snapshot: `1`, `2`, `3`, `missing`. Read recorded answers from `question=readiness` and `response`. |
| step / Step 4 | `eventType=checkin_reached` | Completion also requires `deliveryStatus=sent`. There is no generic numbered `step` field or full Step 1-4 trace. |
| step = script_chosen | `eventType=script_selected`, `response=yes` | The current snapshot is `scriptChosen`. Adoption is inferred from explicit user selection by the model, not proof of real-world use. |
| scenarioTag + sessionId | `scenarioTag`, `sessionId`, `scenarioRunId` | Category, conversation session and individual scenario attempt are different units. Count attempts using `scenarioRunId`. |
| timestamp | `occurredAt` | ISO timestamp based on the originating message; `receivedAt` is collection time. `monthSGT` and `dateSGT` provide Singapore-time grouping. |
| session start date | `sessionStartedAt`, `sessionStartObserved` | Use observed `session_started` events and the Singapore date of the start time, not dates of later messages. |
| age answer / Yes to age check | `eligibility`, `ageBand` | Derived from self-reported numerical age. Exact age is not exported in KPI events. This is not a Yes/No age-check field. |
| first active month | Separate first-active index keyed by `userKey` | Supports any-prior-collected-month returners. No `firstActiveMonth` webhook field exists. |
| distressTier | `tier` | AI estimate: `1`, `2`, `3`, `4`, `missing`. Not interchangeable with `crisisDetected` or `scenarioTag`. |
| max distressTier before link | `maxTierBeforeReferral`, `tierHistoryComplete` | Referral-time snapshot. Missing or incomplete history cannot establish low distress. |
| linkSent / pathSelected = connect | `referral_delivered`, `referral_clicked`, `referralSource`, `referralTarget` | These events are not a renamed `pathSelected` field. Delivered referrals, requests, clicks and service conversion are different measures. |

### Common counting rules

- Calendar months use Singapore time (UTC+8). Deduplicate by `eventId`; exclude registered testers. `userKey` is a stable pseudonymous identifier, not a Telegram username.
- An active user has an `activity` event in the month and recorded `eligibility=eligible` in that month. Eligibility means numerical age 13-30 inclusive. Learning age later in the same month qualifies that month's activity, not earlier unknown-age months.
- All supported ages can generate raw events. `ageBand` enables separate filtering; it does not expand the built-in reporting cohort. Unknown-age contacts are reported separately.
- New sessions follow six hours of inactivity or explicit `/restart`. Missing responses use exactly `missing`; real `no` answers stay `no`. Optional IDs and unselected `scenarioTag` may be null. A zero denominator returns a null percentage, not 0%.

## 2. Core KPI definitions

K1-K5 are implemented calculations. Production completeness and Microsoft mappings still require reconciliation. Each ratio returns `numerator`, `denominator` and `percent`; K4 returns a count. All apply the common rules above.

| KPI and original target | Current calculation | Exact source fields and event selection |
|---|---|---|
| **K1: Usefulness**; at least 70% | Numerator: active users whose latest valid usefulness answer in the month is `yes`. Denominator: active users with at least one valid `yes`/`no` answer. A later `missing` does not replace an earlier valid answer. | `eventType=response_recorded`, `question=usefulness`, `response`, `userKey`, `monthSGT`, `occurredAt`; `sourceMessageId` and `receivedAt` resolve ordering. `usefulness` snapshots alone are insufficient. |
| **K2a: Scenario completion**; target not set | Numerator: distinct started scenario runs that have a delivered check-in. Denominator: distinct eligible-user runs started in the selected month. A reply to the check-in is not required. Later completion revises the scenario's start month. | `scenario_started` joined to `checkin_reached` by `scenarioRunId`; completion requires `deliveryStatus=sent`. Use `scenarioStartMonthSGT`; `scenarioTag` is the category, not an attempt ID. |
| **K2b: Scenario participation**; target not set | Numerator: active users who started at least one scenario run in the selected month. Denominator: active users. Count each user once. | `scenario_started`, `scenarioStartMonthSGT`, `scenarioRunId`, `userKey`; the active cohort comes from `activity`, `eligibility`, `monthSGT`. |
| **K3: Repeat use within month**; target not set | Numerator: active users with observed session starts on at least two distinct Singapore dates in the month. Denominator: active users. A conversation crossing midnight alone does not qualify. | `eventType=session_started`, `sessionStartObserved=true`, `sessionStartedAt`, `userKey`, `monthSGT`; `sessionId` identifies the session. |
| **K4: Monthly active users**; 70-120 | Count distinct active users. No percentage denominator. Greetings, commands and maintenance-mode text activity can qualify; activity does not imply successful coaching. | `eventType=activity`, `userKey`, `monthSGT`, `eligibility`, `isTester`; `occurredAt` supplies event timing. |
| **K5: Returners across months**; 25-35% | Numerator: active users with eligible, non-test activity in any earlier collected month. Denominator: active users. Not restricted to the immediately preceding month and not proof of activity before collection began. | Current `activity` cohort and the first-active index keyed by `userKey`. Historical event data can also establish earlier eligible activity. |
| **K6: Salesforce conversion**; 10-15% | **Deferred.** Original target: unique offered users becoming Salesforce clients within 60 days / active users sent an INSIGHT link. Only the offered-user count is implemented; there is no conversion numerator or rate. | `referral_delivered`, `deliveryStatus=sent`, `referralTarget=insight`, distinct `userKey`. Salesforce identity matching and 60-day attribution remain unimplemented. Clicks are not conversions. |

### Exact report output keys

| KPI | Report output |
|---|---|
| K1 / K2a / K2b | `K1_usefulness` / `K2a_scenarioCompletion` / `K2b_scenarioParticipation` |
| K3 / K4 / K5 | `K3_twoSessionStartDays` / `K4_monthlyActiveUsers` / `K5_anyPriorMonthReturners` |
| K6 | `K6_conversion.status=deferred_salesforce_matching`; `K6_conversion.insightOfferedUsers` is a count, not a conversion rate |

## 3. Outcome proxies and definition differences

The following are the **current implemented proxies**, not evidence of clinical improvement. No outcome target is invented here. Differences from the original document are deliberately visible; documenting them does not approve them as funder definitions.

| Outcome and report output | Current calculation and source | Difference or limitation |
|---|---|---|
| Confidence: `readiness`, `readinessCoverage` | For scenario runs started in the selected month: completed runs with latest valid readiness answer `2` or `3` / completed runs. Coverage is completed runs with any valid `1`-`3` readiness answer / completed runs. Use `response_recorded`, `question=readiness`, `response`, `scenarioRunId` and delivered `checkin_reached`. | Replaces `readinessRating`. Unanswered completed runs stay in the denominator. 1 = still nervous; 2 = a bit more ready; 3 = ready to try it. A later answer may revise the start-month result. |
| Choosing responses: `scriptChoice` | Started runs observed in `mode=prepare` with at least one `script_selected` event having `response=yes` / started runs observed in prepare mode. Join by `scenarioRunId`. | No `step=script_chosen`. Counts an observed adoption, not necessarily the final choice after a later rejection. Model-derived proxy, not demonstrated real-world skill. |
| Reduced uncertainty: `retrospectiveClarity`, `clarityCoverage` | Complete same-month answer pairs whose after score exceeds before / complete pairs. Pair `response_recorded` answers for `clarityBefore` and `clarityAfter` by `feedbackId`; valid scores are 1-3. Coverage compares complete pairs with `feedback_offered` events for `question=clarityBefore` and `deliveryStatus=sent`. | Unit is a feedback pair, not unique people. Both questions use 1 = not clear, 2 = somewhat clear, 3 = very clear. Retrospective self-report is not causal evidence. |
| Help-seeking: `support` | Counts delivered referral events by `referralSource` (`user_requested`, `bot_suggested`, `missing`) and observed `referral_clicked` events, for active users in the selected month. | **Original active-user percentage choosing Connect is not implemented.** Current outputs are event counts, not unique-user rates. Link clicks do not establish service uptake. |
| Transition engagement | Output: `startingSomethingNewReturners`. Numerator: distinct users who started a `scenarioTag=1` run in the month and have prior eligible activity. Denominator: distinct users who started such a run in the month. | **Different denominator from the original.** Current: returners among transition-scenario users. Original: transition-scenario users among all K5 returners. These are not interchangeable. |
| Early support: `earlySupport` | Delivered referral events for active users with `maxTierBeforeReferral` of `1` or `2` / delivered referral events with `tierHistoryComplete=true` and known maximum tier. Uses the snapshot at referral delivery. | **Event-based, not unique-user-based** as in the original. Repeated delivered referrals can count more than once. Missing/incomplete history is excluded and counted in `support.missingTierHistory`; later escalation does not change the snapshot. |

### Escalation audit

`distress.tier3Sessions` and `distress.tier4Sessions` count distinct `sessionId` values on `tier_estimated` events for active users in the month. `distress.state8Sessions` counts distinct sessions with `state8Reached=true` and `deliveryStatus=sent`. A session can appear in more than one count; do not sum these as distinct people or a progression funnel.

`crisisDetected` is a separate boolean safety-routing flag. Compare it with `tier` only for authorised audit; the API does not provide a ready-made crisis-by-tier audit table. The tier rubric is AI-estimated and unvalidated, not a diagnosis. Current tier meanings are 1: ordinary social worry; 2: substantial distress without a self-harm signal; 3: self-harm/suicidal thoughts or severe distress without stated immediate intent; 4: stated immediate danger, plan or intent. Keep the actual exported values `1`-`4`; do not assume a separate word-valued risk field exists in this KPI payload.

## 4. Storage, reporting and verification

### Payload versus Microsoft columns

`CareyKPIEvents` stores one measurement event per row, not one conversation. The documented setup has 30 new columns plus the existing `Title` column. `Title` receives `eventType`; `eventJson` stores the complete payload as plain multiline text. It is a receiver-created column, not a field sent by the bot.

| Stored as named List columns | Kept inside eventJson under the documented mapping |
|---|---|
| `eventId`, `eventType`, `occurredAt`, `monthSGT`, `userKey`, `sessionId`, `scenarioRunId`, `feedbackId`, `referralId` | `schemaVersion`, `sourceMessageId`, `receivedAt`, `dateSGT`, `sessionStartedAt`, `sessionStartObserved`, `scenarioStartedAt`, `scenarioStartMonthSGT` |
| `scenarioTag`, `eligibility`, `ageBand`, `mode`, `question`, `response`, `readiness`, `usefulness`, `clarityBefore`, `clarityAfter`, `scriptChosen` | `instrumentVersion`, `policyVersion`, `tierRubricVersion`, `model`, `promptVersion`, `promptHash`, `deploymentSha` |
| `tier`, `maxTierBeforeReferral`, `isTester`, `crisisDetected`, `state8Reached`, `tierHistoryComplete`, `referralTarget`, `referralSource`, `deliveryStatus` | The full payload also retains every named source field on the left. No general `step`, `usefulRating`, `readinessRating`, `pathSelected`, `linkSent` or `firstActiveMonth` field is sent. |

`ageBand` values are `under-13`, `13-17`, `18-25`, `26-30`, `31-40`, `41-50`, `51-plus`, `missing`. New events include it; older events may omit it and should map to `missing`. Keep `scenarioTag` (category), `tier` (AI estimate) and `crisisDetected` (boolean) distinct. KPI events omit transcripts, exact ages, Telegram usernames and raw Telegram user IDs, but remain restricted pseudonymous data.

The supported `eventType` values are `activity`, `session_started`, `scenario_started`, `checkin_reached`, `response_recorded`, `feedback_offered`, `script_selected`, `tier_estimated`, `referral_requested`, `referral_delivered`, `referral_clicked` and `turn_completed`.

### Accessing the report

- Request `GET /api/bot-control?kpi=true&action=report&month=YYYY-MM` with the existing Bot Control password in the `x-bot-control-token` header. Never put the password in a URL. The endpoint returns JSON and saves a report revision; it is not a dashboard or a Microsoft List calculated column.
- Reports read the bot's retained Redis events, **not Microsoft List rows**. Events awaiting Microsoft delivery can already be counted. `delivery.pending`, `delivery.lastFailure` and `delivery.receiverConfigured` describe delivery health, not proof that every field was mapped correctly. Event-level `deliveryStatus=sent` means the bot reply was sent, not that Microsoft stored the row.
- Reports include `monthSGT`, `asOf`, `revision`, `policyVersion`, `provisional=true`, response coverage and data-quality counts. Current online retention is 400 days; an out-of-coverage month or a request spanning more than 50,000 source events is rejected rather than silently producing a partial report. Older history needs the Microsoft archive. The separate first-active index supports K5 beyond event retention.
- The daily job retries pending delivery and prunes expired records; it does **not** generate monthly reports. A visual dashboard, automatic monthly report schedule and durable long-term aggregate archive are not implemented.

### Feedback and missing data

Activity logging is not randomly sampled. Optional usefulness/clarity offers are limited to eligible, non-test users after a valid readiness answer and at most once per seven days. Of those offers, 20% are assigned clarity instead of usefulness. Failed delivery still reserves the cooldown. Record response counts and missingness alongside percentages; a `turn_completed` row repeating an old rating is not a new answer. Do not backfill unavailable historical answers or progress.

### Status and decisions still required

- **Implemented in the inspected code:** event collection, payload fields above, retry/acknowledgement handling, K1-K5 and the listed outcome proxies. This document changes no runtime behaviour or webhook schema.
- **Not verified by this revision:** current production settings, every Microsoft field mapping or complete live delivery. The previously reported missing-person/raw-List issue remains unresolved. Do not restate the old September "collection disabled" snapshot as current fact.
- **Deferred/not implemented:** K6 Salesforce matching and 60-day conversion, the dashboard and automated report generation. There is no generic numbered-step log.
- **Requires definition agreement before external reporting:** K2b and K5 funder interpretation; help-seeking percentage versus event counts; the transition-returner denominator; early-support event versus user counting; validity of AI-estimated labels. This revision records differences, not approval to change the original funder requirements.

### Source of truth

Reviewed at commit `c5f682c0f0cc1b0e809490629bc1ee3b7c424654` against the original two-page PDF. Use [contract.ts](../src/analytics/contract.ts) and [kpi-trigger.schema.json](./kpi-trigger.schema.json) for payload names, [report.ts](../src/analytics/report.ts) for calculations, [coachMeasurement.ts](../src/analytics/coachMeasurement.ts) for feedback and tier wording, and [http.ts](../src/analytics/http.ts) / [outbox.ts](../src/analytics/outbox.ts) for report access and retention. See [Microsoft setup](./SOCIAL_COACH_KPI_MICROSOFT_SETUP.md) for column types and mappings and [decision history](./SOCIAL_COACH_KPI_DECISIONS.md) for prior approvals. This is a documentation-only reconciliation; no push or deployment is included.
