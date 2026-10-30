# Carey monthly KPI setup handoff

Use the Microsoft Edge session signed into **insight@carecorner.org.sg** on the
Microsoft-access computer. This handoff adds calculated monthly reports to the
existing KPI List for Power BI. It does not change participant questionnaires.

## Deployment prerequisite

The application implementation is on branch `codex/kpi-powerbi-metrics` in
`carecorner-insight/tiktok-auth`. Verify that its release is deployed to the
production project and configure the new Production `KPI_REPORT_TOKEN` before
enabling the Microsoft flow. The existing Bot Control password continues to
unlock the Metrics tab. The Microsoft setup is a separate rollout step.

Confirm the production report response contains `definitionVersion` equal to
`carey-monthly-metrics-v1`, `metrics`, and `listItem`. A successful old-format
report is not enough. Keep secrets out of chat, screenshots and exported files.

## Work on the Microsoft computer

1. Read [KPI_POWERBI_SETUP.md](KPI_POWERBI_SETUP.md). Inspect the actual existing
   site, List columns and flows before changing anything; use `CareyKPIEvents`
   or its existing equivalent. Do not create a second raw-event receiver.
2. Create the scheduled **Carey monthly KPI summaries** flow with the exact
   actions, expressions and field mappings in that guide. Keep other flows and
   their destinations unchanged. No Teams message belongs in this new flow.
3. Use [kpi-monthly-report.schema.json](kpi-monthly-report.schema.json) in its
   Parse JSON action. Save the six prepared `listItem` fields directly. The
   report's `eventJson` is already a JSON string.
4. Start with the current month. Verify repeated runs update one List item with
   `eventId = kpi-report:YYYY-MM`, then enable the guarded historical-month loop.
5. In Power BI, add [powerbi/CareyMonthlyMetrics.pq](powerbi/CareyMonthlyMetrics.pq)
   as a blank query, adjusting the existing List query name if needed. It expands
   precomputed metrics; do not rebuild their denominators in Power BI.
6. Complete the acceptance checks and report the flow's name, successful run
   time, monthly item's ID/month/updated time, Power BI row count, and any
   remaining blocker. Do not include credentials or participant content.

One monthly List item expands to **21 metric rows**. No new List columns are
needed if the original event schema is already in place. K6/Salesforce conversion
stays unavailable; it must remain blank in the visuals, not become zero.

## Included files

- `KPI_POWERBI_SETUP.md`: full setup and acceptance checks.
- `kpi-monthly-report.schema.json`: Parse JSON schema for the report response.
- `powerbi/CareyMonthlyMetrics.pq`: Power BI import transformation.
- `SOCIAL_COACH_KPI_MICROSOFT_SETUP.md` and `kpi-trigger.schema.json`: reference
  for existing raw-event collection. Keep that working flow unchanged.
- `SOCIAL_COACH_KPI_DATA_SPEC.md`: earlier field/collection reference; the new
  monthly-report setup guide describes the reporting additions in this release.
- `examples/SYNTHETIC-*`: example API response, List item and CSV from local
  verification. These contain invented data. Never import them into production.

This is a setup-document bundle, **not an importable Power Automate solution**.
The actual SharePoint write and Power BI execution remain unverified until the
Microsoft computer completes the acceptance checks.
