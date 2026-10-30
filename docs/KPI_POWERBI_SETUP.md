# Monthly metrics in the KPI List and Power BI

This setup writes **calculated metrics** to the existing `CareyKPIEvents` List.
One item per month contains the whole report in `eventJson`. Power BI expands
that JSON into one row per month and metric; it does not calculate the KPIs again.
The separate Bot Control Metrics tab reads the same calculations directly.

The application changes must be deployed before configuring the new flow. This
guide is a handoff for the computer signed into `insight@carecorner.org.sg`.
The Microsoft flow, actual saved rows and Power BI refresh have not been verified
from the development computer.

## What changes in Microsoft Lists

No new columns are required if the existing List follows
[the event setup guide](SOCIAL_COACH_KPI_MICROSOFT_SETUP.md). Reuse these columns:

| List column | Monthly-summary content |
|---|---|
| Title | `Carey monthly KPIs 2026-10` |
| eventId | `kpi-report:2026-10` — unique, stable across refreshes |
| eventType | `monthly_report` |
| monthSGT | `2026-10` |
| occurredAt | Time the report was calculated, updated on refresh |
| eventJson | Entire prepared summary string, including calculated metrics |

`eventJson` must be plain Multiple lines of text, append changes OFF. Keep eventId
unique and indexed. eventType is Single line of text in the existing schema; if
your tenant instead uses Choice, add `monthly_report` as an allowed value. IDs
for individual users/sessions/scenarios stay empty on a summary item. If the List
was customized to require those fields, remove that additional requirement for
summary items; do not invent participant IDs.

Create a **Monthly KPI reports** List view filtered to eventType equals
`monthly_report`, with Title, monthSGT and occurredAt visible. Existing raw-event
reports should filter eventType not equal to `monthly_report`. Reading all rows
as individual participant events would double-count unrelated records.

## Prepare the report credential

The deployed app accepts a separate `KPI_REPORT_TOKEN` environment variable.
Generate a long random secret, store it in the Vercel project's Production
environment and redeploy. Do not reuse the Bot Control password. This new token
can read monthly aggregate reports only; it cannot change the bot, export raw
participant events or flush delivery queues.

The flow sends it in the `x-kpi-report-token` HTTP header. Store the value using
your tenant's approved secret configuration and enable **Secure inputs** and
**Secure outputs** on the HTTP action. Do not put credentials into the URL, this
document, exported flow definitions, screenshots or chat messages.

## Create the scheduled flow

Create a new scheduled cloud flow called **Carey monthly KPI summaries**. This
flow reads the report API and writes directly with SharePoint actions. Keep the
existing raw-event HTTP receiver and `kpi-trigger.schema.json` unchanged: a
monthly report is not a participant event and must not be sent to that receiver.

1. Set **Recurrence** to daily, 06:00, time zone **Singapore Standard Time**.
   Set trigger concurrency to 1 so two runs cannot update the same month at once.
2. Before the loop, initialize a String variable called `First_reporting_month`
   to the first month with verified KPI collection, in `YYYY-MM` format. If that
   start date is not yet verified, use the current month and extend it later.
   Never publish zero-valued historical reports for time before collection began.
   A partially collected first month still needs to be identified as incomplete
   in the Power BI report; a summary cannot reconstruct missed conversations.
3. Add **Apply to each**, rename it `Month_offsets`, input expression:

   ```text
   range(0, 13)
   ```

   Keep this loop sequential. It refreshes the current and previous 12 months,
   all within the application's 400-day online window. Late answers or delayed
   events can revise earlier months. For an initial test, use `range(0, 1)` and
   restore 13 after the current-month acceptance checks pass.
4. Within the loop, add **Compose**, name it `Report_month`, expression:

   ```text
   formatDateTime(addToTime(startOfMonth(convertTimeZone(utcNow(), 'UTC', 'Singapore Standard Time')), mul(items('Month_offsets'), -1), 'Month'), 'yyyy-MM')
   ```

5. Add a Condition using this expression:

   ```text
   greaterOrEquals(ticks(concat(outputs('Report_month'), '-01T00:00:00Z')), ticks(concat(variables('First_reporting_month'), '-01T00:00:00Z')))
   ```

   Leave **If no** empty. Put all remaining actions below inside **If yes**,
   so months before verified collection are skipped.
6. Add **HTTP**, name it `Get_monthly_report`, method GET. Use your actual
   production origin; for the current project the expected URI expression is:

   ```text
   concat('https://tiktok-auth-topaz.vercel.app/api/bot-control?kpi=true&action=report&month=', outputs('Report_month'))
   ```

   Header: `x-kpi-report-token` = the secret configured above. Do not use a preview
   deployment or a personal deployment URL. A normal request must return HTTP 200
   JSON. Authentication, storage, too-old months or oversized-report failures
   must fail this iteration; do not replace an existing month with an empty object
   or fabricated zero. Use the HTTP action's normal bounded retry policy.
7. Add **Parse JSON**, name it `Parse_monthly_report`. Content:
   `body('Get_monthly_report')`. Use [kpi-monthly-report.schema.json](kpi-monthly-report.schema.json).
8. Add SharePoint **Get items**, name it `Get_monthly_item`, select the existing
   site/List. Top Count 1, enable pagination, Filter Query:

   ```text
   eventId eq '@{body('Parse_monthly_report')?['listItem']?['eventId']}'
   ```

9. Add a condition:

   ```text
   equals(length(body('Get_monthly_item')?['value']), 0)
   ```

   **If yes:** Create item using the six mappings below.

   **If no:** first confirm the found item's eventType is `monthly_report`.
   If it is not, terminate with failure rather than overwrite a raw record.
   Then apply this stale-update condition:

   ```text
   greaterOrEquals(ticks(body('Parse_monthly_report')?['listItem']?['occurredAt']), ticks(coalesce(first(body('Get_monthly_item')?['value'])?['occurredAt'], '1900-01-01T00:00:00Z')))
   ```

   When true, **Update item**, ID:
   `first(body('Get_monthly_item')?['value'])?['ID']`.
   When false, leave the newer item unchanged. Use the same six mappings for
   creation and update. Keep normal run-after settings so writes only follow a
   successful HTTP response, parse and lookup.

| SharePoint field | Expression for both Create item and Update item |
|---|---|
| Title | `body('Parse_monthly_report')?['listItem']?['Title']` |
| eventId | `body('Parse_monthly_report')?['listItem']?['eventId']` |
| eventType | `body('Parse_monthly_report')?['listItem']?['eventType']` |
| monthSGT | `body('Parse_monthly_report')?['listItem']?['monthSGT']` |
| occurredAt | `body('Parse_monthly_report')?['listItem']?['occurredAt']` |
| eventJson | `body('Parse_monthly_report')?['listItem']?['eventJson']` |

The last field is already a JSON string: do not apply `string()` to it again,
and do not map the full HTTP response into it. Leave unrelated participant fields
empty or at the List's existing `missing` defaults. Do not trigger Teams alerts
from this scheduled flow. If a unique-value conflict occurs, fail and retry the
lookup on the next run; never create a second ID for the same month.

One item update replaces the complete monthly report, so Power BI does not see
a half-updated set of metrics for that month. Different months can have different
refresh times. Keep older summary items after their underlying Redis events expire;
the application does not delete Microsoft archive items.

## Connect Power BI

1. Connect Power BI to the existing SharePoint Online List using the approved
   work account. Name the raw query `CareyKPIEvents` (or adjust the source name in
   the supplied query). Prefer the connector's current implementation.
2. Create a blank query called `CareyMonthlyMetrics`, open Advanced Editor and
   paste [powerbi/CareyMonthlyMetrics.pq](powerbi/CareyMonthlyMetrics.pq).
3. That query selects only monthly_report items, validates the envelope, expands
   the precomputed metrics and assigns numeric/date types. It fails visibly on
   invalid summaries or duplicate months instead of silently dropping them.
4. Use `monthSGT` or `monthStart` on the time axis; `metricLabel`/`metricCode` as
   the measure selector. Display `value`, `numerator`, `denominator`, `status`,
   `note`, `asOf`, `pendingEvents` and `definitionVersion` where useful.
5. Set numeric field aggregation to **Don't summarize** when appropriate. Rates
   and distinct-user counts cannot be summed across months. For single-month,
   single-metric cards, a guarded measure is:

   ```dax
   Metric Value =
   IF(
       HASONEVALUE(CareyMonthlyMetrics[monthSGT]) &&
       HASONEVALUE(CareyMonthlyMetrics[metricCode]),
       MAX(CareyMonthlyMetrics[value]),
       BLANK()
   )
   ```

   Percent values use 0–100 (70 means 70%). To use Power BI's Percentage format:

   ```dax
   Metric Percent =
   IF(
       SELECTEDVALUE(CareyMonthlyMetrics[unit]) = "percent",
       DIVIDE([Metric Value], 100),
       BLANK()
   )
   ```

6. Refresh Power BI after the scheduled flow finishes. Configure the Power BI
   refresh schedule/credentials separately; saving a List item does not itself
   refresh an imported dataset. If using a flow action to refresh the dataset,
   put it after the entire monthly loop and only run it after success.

There are 21 metric rows per monthly summary. K6 remains `not_available` with a
null value. A zero denominator is `no_denominator` with null value. Neither should
be displayed as 0%. Counts of zero mean zero recorded qualifying events, not proof
that collection was complete. `collectionEnabled`, `pendingEvents` and
`receiverConfigured` describe the source integration at calculation time; they
do not certify successful historical collection or this summary flow's delivery.

## Acceptance checks on the Microsoft computer

1. Request one month with the report-only token: HTTP 200 and a List item with a
   stable `kpi-report:YYYY-MM` ID. Missing/wrong credentials must return 401.
2. Run the flow for that month twice: exactly one matching List item, updated
   occurredAt, and parseable eventJson. No participant IDs or transcript text in
   the summary. No Teams message is generated.
3. Compare K1, K4, readinessAmongRespondents and transitionAmongReturners against
   the Bot Control Metrics tab from the same report revision. K6 stays blank.
4. In Power BI, confirm 21 rows for that month, including numerator/denominator,
   numeric values and an asOf timestamp. Raw events are absent from this query.
5. Test a failed HTTP request using a test flow: the previous monthly List item
   remains unchanged. Test a supplied older report against a test item: the
   timestamp condition must skip it. Do not overwrite production with fixtures.
6. Re-enable the 13-month loop with the verified `First_reporting_month` guard,
   verify scheduled-run success and dataset refresh,
   then confirm the actual Microsoft item timestamp before saying sync is live.

## References

- [Scheduled Power Automate flows](https://learn.microsoft.com/en-us/power-automate/run-scheduled-tasks)
- [SharePoint connector actions](https://learn.microsoft.com/en-us/connectors/sharepoint/)
- [Expand lists in Power Query](https://learn.microsoft.com/en-us/powerquery-m/table-expandlistcolumn)
- [Expand records in Power Query](https://learn.microsoft.com/en-us/powerquery-m/table-expandrecordcolumn)
