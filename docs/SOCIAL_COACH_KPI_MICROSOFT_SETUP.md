# Social coach: KPI collection rollout

This is a separate, content-free event pipeline. Leave the existing chat-log,
Teams crisis-alert and study flows unchanged. Salesforce matching is not implemented.
A passing build, a successful deployment, and a flow HTTP 202 are **not** proof
that Microsoft Lists has saved a KPI event.

## 1. Create the Microsoft List

Create **CareyKPIEvents** on the existing approved staff-only SharePoint site.
Use these exact column names when creating them, avoiding spaces so internal
names match. Do not create a new public sharing link or widen existing access.

| Column | Type / settings |
|---|---|
| Title | Existing Single line of text; map eventType |
| eventId | Single line of text; **required, enforce unique values**, indexed |
| eventType | Single line of text; indexed |
| occurredAt | Date and time; include time |
| monthSGT | Single line of text; indexed |
| userKey | Single line of text; indexed; pseudonymous, still restricted data |
| sessionId, scenarioRunId, feedbackId, referralId | Four Single line of text columns; optional |
| scenarioTag | Choice: `1`, `2`, `3`, `4`, `5`, `6`; optional (this is the scenario, NOT risk) |
| eligibility | Choice: `eligible`, `ineligible`, `missing` |
| mode | Choice: `prepare`, `reflect`, `missing` |
| question | Choice: `readiness`, `usefulness`, `clarityBefore`, `clarityAfter`, `missing` |
| response | Choice: `1`, `2`, `3`, `yes`, `no`, `missing` |
| readiness, clarityBefore, clarityAfter | Three Choice columns: `1`, `2`, `3`, `missing` |
| usefulness, scriptChosen | Two Choice columns: `yes`, `no`, `missing` |
| tier, maxTierBeforeReferral | Two Choice columns: `1`, `2`, `3`, `4`, `missing`; explicitly label as AI-estimated |
| isTester, crisisDetected, state8Reached, tierHistoryComplete | Four Yes/No columns; pass the actual JSON booleans, not quoted text |
| referralTarget | Choice: `insight`, `crest`, `missing` |
| referralSource | Choice: `user_requested`, `bot_suggested`, `missing` |
| deliveryStatus | Choice: `received`, `sent`, `maintenance`, `failed` |
| eventJson | **Multiple lines of text**, plain text, append changes OFF; stores the complete payload |

Choice columns are single-select, with fill-in choices OFF. Default unanswered
response/tier columns to lowercase `missing`. Do not use Number columns for these
responses: they cannot represent `missing`. Empty IDs are allowed and are not ratings.
The complete JSON retains session/scenario start times, version stamps and model
provenance without needing dozens of extra list columns. Never put eventJson or
existing aiResponse/userMessage in 255-character Single line of text columns.

## 2. Create the dedicated Power Automate receiver

1. Create a flow with **When an HTTP request is received**. Paste
   [kpi-trigger.schema.json](./kpi-trigger.schema.json) as its request body schema.
   Use the tenant-approved service authentication configuration. The sender uses
   the signed trigger URL stored privately in Vercel; do not publish it or paste it
   into GitHub. If your trigger requires OAuth rather than a signed URL, that needs
   a service identity integration before this sender can call it.
2. Turn on trigger concurrency control, degree **1**, for the initial pilot.
3. Add SharePoint **Get items**, select CareyKPIEvents, Top Count `1`.
   Enable pagination in this action's settings; this avoids the documented
   filtered-lookup limitation once the list grows beyond 5,000 rows.
   Filter Query (insert the eventId dynamic content at the indicated position):
   `eventId eq '@{triggerBody()?['eventId']}'`.
4. Condition expression: `equals(length(body('Get_items')?['value']), 0)`.
   The `value` property is the array of matches; its **length** is zero when no
   item exists. Replace `Get_items` with the actual action name if different.
5. If yes, **Create item**. Map every named column from the same-named trigger
   field, Title from eventType, and eventJson from expression `string(triggerBody())`.
   For optional ID/selection columns, leave them empty when the input is null;
   do not replace them with a fake `missing` ID. Keep real booleans for Yes/No.
6. If no, do not create another row: the stable eventId already exists.
7. **Response**, outside the condition and configured to run only after the
   condition succeeds: status `200`, Content-Type `application/json`, body:

```json
{
  "accepted": true,
  "eventId": "@{triggerBody()?['eventId']}"
}
```

If Get items/Create item fails, do not send accepted:true. Return a failure or
allow a timeout; the app retains the event and retries. Unique eventId is the last
line of defence against duplicates. If a concurrent unique-value conflict occurs,
acknowledge only after a second lookup proves that exact eventId is already stored.
Do not acknowledge from a parallel branch before storage finishes.

There are multiple event rows per conversation. Filter `eventType` for calculations;
do not count repeated snapshot ratings in turn_completed as new responses.
This flow must NOT send Teams alerts; those stay in the existing safety flow.

## 3. Production settings and sender verification

Use **Production** variables on the social-coach Vercel project:

| Variable | Value / purpose |
|---|---|
| KPI_COLLECTION_ENABLED | `true` after the prerequisites below are configured |
| KPI_POWER_AUTOMATE_WEBHOOK_URL | Signed URL for the NEW receiver, not POWER_AUTOMATE_WEBHOOK_URL |
| KPI_USER_KEY_SECRET | Fresh random secret, at least 32 characters; keep stable for longitudinal identity |
| KPI_TESTER_USER_IDS | Comma-separated Telegram numeric IDs for all staff/testers; no spaces needed |
| KPI_PUBLIC_BASE_URL | `https://tiktok-auth-topaz.vercel.app` (or the actual production origin) |
| TELEGRAM_WEBHOOK_SECRET | Fresh random Telegram-compatible secret (letters/digits/underscore/hyphen) |
| CRON_SECRET | Strong secret for Vercel's authenticated daily retry cron |
| BOT_CONTROL_TOKEN | Existing Bot Control password; protects KPI status/export/reports too |

Register TELEGRAM_WEBHOOK_SECRET as Telegram's **secret_token** in setWebhook
for the **main** bot's existing webhook URL. Keep the study bot webhook untouched.
Preserve allowed_updates/settings and do not drop pending updates. The app rejects
unauthenticated main Telegram POSTs when the secret is configured. When collection
is enabled without that secret it returns 503 rather than accepting forged data.

Order: create receiver/list → configure secrets and tester registry → deploy the
release with collection still disabled → register Telegram's header secret → enable
collection/redeploy → perform the synthetic acceptance checks below. Take care to
coordinate registration and deployment so real Telegram updates are not rejected
by a mismatched secret during the transition.

An absent receiver URL does not discard collected events: they stay queued. It does
mean **Microsoft collection is NOT live**. Use the status endpoint to verify this.
The daily retry cron drains up to 12 due events; every message drains up to 4 more.
After a substantial outage, an administrator must repeatedly flush the backlog;
do not assume the daily sweep alone can clear a large queue promptly.

## 4. Verify before saying "live"

Authenticated requests use header `x-bot-control-token` with the existing password;
do not put passwords in URLs, screenshots or shell command history.

- `GET /api/bot-control?kpi=true`: enabled=true, verification and identity secret configured,
  receiverConfigured=true. Inspect pending and lastFailure.
- `POST /api/bot-control?kpi=true&action=flush`: matching storage acknowledgements, pending drains.
- `GET /api/bot-control?kpi=true&action=export&offset=0`: paged content-free source records.
- `GET /api/bot-control?kpi=true&action=report&month=2026-09`: provisional monthly report with
  numerator/denominator, response coverage, revision and asOf. Zero denominator
  returns null percent, not a fabricated 0%.
- Missing/wrong Telegram header → 401; correct Telegram header → accepted.
- In a tester-only conversation: age → scenario → completed coaching check-in →
  readiness answer. Check unique events in CareyKPIEvents, all isTester=true.
- Send/replay the same synthetic event twice: one Microsoft row, two valid acks.
- Temporarily test a failed receiver against a TEST environment: event remains
  pending, then arrives once after receiver recovery. Do not disrupt the live flow.
- Verify study flow/list receives no new KPI rows and the study prompt is unchanged.
- Test maintenance in a TEST environment: static notice, no AI call, activity and
  maintenance status recorded. Do not switch off the real bot just for a test.

Synthetic crisis tests must use a test destination so they do not page real staff.
Bot-side code/tests alone cannot verify your flow mapping or actual Microsoft rows.

KPI operations reuse the existing Bot Control function, keeping the app at its
current 12 API functions. Existing controls are unchanged unless kpi=true, a
signed referral, or the authenticated cron route is requested. The downstream
KPI receiver is still separate from transcript logging and Teams alerts.

## Measurement boundaries and operations

- Six-hour inactivity sessions; explicit /restart begins another session. K3 uses
  observed session-start days in SGT, not message days. Old sessions are not
  fabricated as freshly observed starts during rollout.
- Eligibility 13–30 inclusive; age remains non-gating. A same-month age answer
  establishes that month's cohort, not earlier unknown-age months.
- Completion is a **delivered readiness check-in**, whether answered or missing.
  It belongs to scenario start month, including late completions.
- Optional feedback: at most one offer per user per seven days; 20% clarity
  before/after with identical anchors, otherwise usefulness. A failed delivery still
  reserves cooldown to avoid repeated survey offers. Skips don't trigger more questions.
- Ratings are participant-entered. The model estimates only mode, script adoption,
  progression and distress tier. These labels need staff validation; not diagnoses.
- The measurement contract is appended to the actual selected/published direct
  coach prompt. Published prompt content is otherwise preserved. External AIBots
  seeded prompts do not receive this contract; use the direct coach for this pilot.
- Early-support classification requires complete known tier history up to delivery.
  Later escalation does not rewrite a referral's snapshot. Missing is not low risk.
- Referral links use opaque random IDs. Automated previews are excluded where
  identifiable; observed GET clicks are imperfect proxies, not Salesforce conversions.
- Redis event retention/retry window: 400 days. The pseudonymous first-active index
  is kept separately for any-prior-month returners. Restrict access, approve retention
  and implement the organisation's subject-deletion process before wider reporting.
- Reports are provisional pending clinical review/data reconciliation. A receiver
  outage queues retries; a Redis outage can lose events and is logged as a data gap.
- Set KPI_COLLECTION_ENABLED=false to stop new collection/surveys without turning
  coaching off. Keep the identity secret stable and retain already collected records.

References: [Microsoft Request/Response actions](https://learn.microsoft.com/en-us/azure/connectors/connectors-native-reqres),
[SharePoint Get items and pagination](https://learn.microsoft.com/en-us/sharepoint/dev/business-apps/power-automate/guidance/working-with-get-items-and-get-files),
[SharePoint connector](https://learn.microsoft.com/en-us/connectors/sharepointonline/),
[Telegram setWebhook](https://core.telegram.org/bots/api#setwebhook).
