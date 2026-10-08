# Social-coach KPI decisions and review checkpoints

Decision date: 30 September 2026 (Singapore time).

These decisions were approved during the pre-implementation review of the
Carey KPI Data Spec — Chatlog Computation. This note records the implementation
target; it is not evidence that a flow, column, survey or report is deployed.

## Settled

1. Scope is the social coach only; preserve the study bot's behaviour and logging.
2. Derive eligibility from the existing numerical age: 13–30 inclusive. Keep age non-gating; exclude unknown ages from eligible-user totals and report them separately.
3. Add optional, short outcome questions only at appropriate moments; never delay support or crisis handling for feedback.
4. Keep the current six-hour inactivity session boundary. K3 uses distinct session-start dates in Singapore time, not distinct message dates.
5. K2a completion means reaching the readiness check-in, not answering it. Record response coverage separately.
6. Early support uses recorded distress-tier history up to referral delivery, not later escalation. Missing tier history cannot establish low distress.
7. Start new measurement prospectively; backfill only historical facts supported by retained records. Do not reconstruct missing ratings or progress as if observed.
8. Deliver bot-side collection first; exact 60-day Salesforce conversion matching is a later milestone.
9. An analytics outage should not stop otherwise working coaching. Retry durably where possible and report gaps; loss is still possible if events cannot be saved durably.
10. Use a dedicated KPI Power Automate receiver, separate from the existing transcript/alert flow, to limit the effect of KPI mapping failures.
11. An age-eligible user's genuine text message counts as monthly activity, including greetings, commands and maintenance messages. Exclude testers and duplicate deliveries; distinguish maintenance/failure activity from successful coaching.
12. Attribute a scenario's completion to its start month. Preserve report revisions and an as-of timestamp when late completions update a month.
13. Collect retrospective before-and-now clarity at closing with the same 1–3 scale meanings. Label it retrospective self-report, not causal evidence.
14. Keep feedback lightweight: log platform-known events without extra questions; readiness remains a natural coaching check-in. Clarity replaces usefulness in selected feedback offers rather than being added on top.
15. New unanswered KPI response fields use exactly `missing`, lowercase. Use response choices for ratings; parse valid values for calculations. Preserve whether the question was asked, and do not alter IDs, crisis booleans or legitimate negative answers.
16. Distress tiers are explicitly labelled AI estimates, with a versioned rubric and staff sample checks before dependable funder reporting. They do not change safety-routing rules.
17. Initial pilot feedback policy: at most one optional feedback offer per user per seven days; clarity replaces usefulness in 20% of those offers. Report the actual sample and response counts.
18. Superseded on 30 September: the user authorized completing implementation, self-testing and enabling live collection without further batch review. Salesforce conversion remains deferred.
19. Added on 2 October 2026: include `ageBand` on new KPI events, using `under-13`, `13-17`, `18-25`, `26-30`, `31-40`, `41-50`, `51-plus` and `missing`. Derive it from the existing self-reported age at event collection time; do not export exact ages or infer age from message text. Retain activity outside the 13–30 cohort for separate filtering, while keeping the built-in report cohort and feedback-question rules unchanged. Historical records without the field remain unknown; the receiver accepts older retries with `missing` rather than guessing a band.

## Accepted risks

- Self-report and voluntary responses can be biased; completion is not proof of improvement.
- Sampling and cooldowns reduce feedback burden but also reduce the number of ratings.
- AI tier estimates require validation and are not diagnoses or substitutes for the crisis flag.
- Durable retries reduce loss and duplication; they cannot promise loss-free collection when storage itself fails.
- Numerical eligibility and referral-time tier history are agreed implementation choices that differ from literal or conflicting wording in the PDF; funder acceptance remains a reporting prerequisite.

## Open or deferred

- Verify the actual production prompt, flow mappings, columns, credentials and existing-data coverage before enabling collection.
- The existing Telegram webhook does not verify sender authenticity. Before relying on production KPI events, verify and secure this boundary: a forged POST could otherwise impersonate a user and inflate activity or safety records. This baseline batch does not change authentication.
- Establish the approved tier rubric, staff review process, tester registry and operational failure owner before production reporting.
- Review the exact feedback wording and pilot results before enabling surveys. Adjusting scales changes the instrument version; adjusting sampling changes the collection-policy version.
- Confirm organisational access and retention requirements for the new content-free KPI list and retry storage before live collection.
- Define and connect Salesforce attribution with the form owner when the conversion milestone begins.
- Any change to the age cohort, session boundary, completion definition or instrument must return to review; do not silently change historical calculations.

## Verdict and batches

The design is cleared for implementation and production rollout after verification.
External configuration is a real prerequisite, not implied by a successful build.
The malformed classifier on main is restored to its last buildable version without
activating the behaviour changes embedded in the pasted patch.

| Batch | Scope | Review proof |
|---|---|---|
| 1 | Restore the buildable classifier and preserve these decisions | Application/API typechecks pass; targeted routing, safety and study regressions pass; restored file matches the known-good parent |
| 2 | KPI contract, response choices, validation and computation fixtures; no runtime wiring | Valid/missing/invalid cases and hand-calculated expected results are tested |
| 3 | Platform-known identity, activity, session, scenario and support events | Duplicate, restart, month-boundary, error, maintenance and study-isolation cases pass |
| 4 | Separate KPI delivery, durable retry and receiver/list instructions | Timeout, partial failure, duplicate and recovery tests pass; live receiver remains disabled until verified |
| 5 | Reviewed lightweight feedback and labelled tier metadata | Sample/cooldown, answer binding, missing response, invalid metadata and safety-precedence tests pass |
| 6 | Monthly reporting and reconciliation | SGT cohorts, latest valid ratings, missing data, tester exclusions and late revisions match expected calculations |
| 7 | Salesforce attribution | Agreed matching fixtures cover duplicate referrals and the 60-day boundary |

The prior review pause is superseded by the latest implementation request. Restore the prior version to back out
the baseline repair. Keep future collection disabled during rollout; preserve
already-delivered events and their schema versions if rolling back a collector.
