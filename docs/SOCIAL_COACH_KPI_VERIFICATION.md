# Social-coach KPI verification — 30 September 2026

## Verified locally

- Application and API TypeScript checks pass.
- 28 affected suites, **397 tests pass**: 105 new measurement, report, API and
  real-storage integration checks, plus 292 existing bot/safety/control checks.
- Real Redis 7.2, isolated disposable database, real encrypted sessions and graph.
  Telegram transport, models and Microsoft HTTP responses are synthetic mocks;
  no participant data was used and no staff crisis alerts were sent.
- Continuous checks run the same affected groups on GitHub, without production
  secrets or model calls.

The tests cover age eligibility, tester exclusion, SGT boundaries, latest valid
ratings, missing responses, scenario-start-month attribution and late revisions,
session-start days, any-prior-month returners, paired clarity, weekly feedback
limits, strict answer binding, crisis priority and prospective-only measurement.

Delivery checks cover deduplication, storage acknowledgements, outages/retries,
worker leases, model/send failures, first-contact session-ID consistency,
maintenance without AI, collection-off with an outstanding question, and study
isolation. Referral checks cover fixed signed destinations, storage outages and
identifiable link previews; clicks are not Salesforce conversions.

## Existing repository issues

Main contained a literal pasted Git patch in intentClassifierNode.ts, making it
uncompilable. This release restores its last buildable implementation and adds
measurement only; it does not activate the pasted patch's proposed routing changes.

The full legacy suite is not green: a wider run found 10 failing suites / 9 failing
tests (562 passed), including obsolete PHQ9 imports, older graph fixtures, copy
expectations, missing test encryption configuration and a whitelist-TTL mismatch.
These were also present before this implementation. The affected regression suites
above pass; unrelated legacy tests were not rewritten to hide their failures.

## Not yet verified externally

Local success is not proof of live collection. At the time of this verification,
Vercel and Microsoft require sign-in. Production secrets, Telegram's matching
webhook secret, the new receiver and actual Microsoft rows have not been verified.
Collection is opt-in through KPI_COLLECTION_ENABLED; deployment alone does not
enable it. Real selected-model metadata adherence also needs a pilot check.

Follow [Microsoft setup and activation](./SOCIAL_COACH_KPI_MICROSOFT_SETUP.md).
Only mark collection live after a tester conversation produces correctly mapped,
unique rows in CareyKPIEvents and the pending queue drains. Salesforce matching
remains deferred; AI distress labels remain unvalidated and reports provisional.
