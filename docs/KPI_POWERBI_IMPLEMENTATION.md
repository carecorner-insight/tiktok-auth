# Monthly KPI reports in Microsoft Lists and Bot Control

## Scope and assumptions

The existing KPI List must hold calculated monthly results for Power BI. Microsoft
access is on another computer, so this change prepares and tests the application
and supplies an executable setup handoff; it does not claim the flow is live.
Preserve the existing raw event webhook and its schema. Store one summary item per
month in the same List, with `eventType=monthly_report`, a stable monthly `eventId`,
and all calculated metric rows inside the existing multiline `eventJson` column.
Power BI expands that array; it does not recalculate the measures.

Critical files: `src/analytics/report.ts:15` computes metrics;
`src/analytics/http.ts:68` generates authenticated reports;
`src/analytics/outbox.ts:126` reads retained events;
`public/bot-control.js:1` owns the in-memory control password and UI;
`docs/SOCIAL_COACH_KPI_MICROSOFT_SETUP.md:16` defines the existing List columns.

## Milestone 1 — Derived measures and report format

Files: analytics/report.ts, analytics/monthlyMetrics.ts, analytics/http.ts,
analytics and API tests.

1. Preserve existing report fields and add the documented respondent/user measures.
2. Version metric definitions and include prior-user membership in report revisions.
3. Return flat aggregate metrics and a ready-to-map monthly List item.
4. Allow a separate read-only report token; keep control and raw-export access private.

Verify: focused report/API Jest suites and both TypeScript builds pass. Test
deduplication, empty denominators, late completion, repeat users, incomplete tier
history, rejected authentication and absence of participant identifiers in summaries.

## Milestone 2 — Metrics tab

Files: public/bot-control.html, public/bot-control.js.

1. Add a month selector and explicit refresh using the existing protected report.
2. Show core KPIs, derived outcomes, denominators, coverage and delivery health.
3. Allow CSV and monthly List-item JSON downloads. Clear results when locking or
   when a new report fails, and retain no password in browser storage.

Verify: browser smoke test against a local synthetic API exercises unlock, tab
navigation, month selection, successful and failed reports, downloads and lock.
No real conversations or Microsoft destinations are used for testing.

## Milestone 3 — Microsoft and Power BI handoff

Files: docs/KPI_POWERBI_SETUP.md, docs/kpi-monthly-report.schema.json,
docs/powerbi/CareyMonthlyMetrics.pq and the existing Microsoft setup guide.

1. Document a daily scheduled flow that requests retained monthly reports and
   creates or updates the stable monthly List item, with stale-update protection.
2. Supply a Power Query transformation that selects summary items and expands the
   precomputed metrics, including their status, month, revision and denominators.
3. Provide concrete acceptance checks for the operator on the other computer.

Verify: parse the sample/schema; check mappings against the returned List item;
exercise repeated/updated-month behavior locally. Actual SharePoint writes and
Power BI refresh require the other computer and remain a separate acceptance step.

## Boundaries

No Salesforce matching, new participant questionnaires, medical validity claims,
new database, Codex scheduled task, or automatic deployment is included. Existing
uncommitted documentation is preserved. The user has authorized implementation;
the plan is recorded for review without another approval pause.

## Verification completed — 30 October 2026

- Four focused Jest suites passed: **155 tests** covering report calculations,
  measurement, KPI API authentication and existing session behavior.
- Both TypeScript builds, JavaScript syntax validation and whitespace checks passed.
- Reviewed the actual changes for input validation, credential scope, escaped
  rendering, download safety and credential/participant-data leakage. No security
  findings in the changed paths; production configuration was not audited here.
- Browser verification used the real API handler with in-memory synthetic events:
  rejected incorrect login, unlocked controls, navigated the Metrics tab, checked
  known calculation values, downloaded CSV/JSON, displayed a simulated storage
  failure without stale results, returned to settings, and locked successfully.
  No browser console errors were captured. The narrow layout remained usable.
- Both downloads contained 21 metrics. The synthetic report passed the supplied
  JSON schema; its List `eventJson` was 6,286 characters with no participant IDs
  or authentication credentials.

Power Query was inspected against the report contract, but cannot be executed
here in Power BI. SharePoint writes, scheduled-flow behavior and the actual
dataset refresh remain acceptance checks on the other computer. These checks
were completed locally before the production release. Verify the release's
deployment status separately. See `KPI_POWERBI_HANDOFF.md` for the operator's
starting point and deployment prerequisite.
