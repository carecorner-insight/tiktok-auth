# Outcome Metrics — Design Review

**Date:** 26 Aug 2026 · **Status:** for team discussion, before the outcome pipeline is wired
**Companion doc:** `OUTCOME_METRICS_IMPROVEMENTS.md` (concrete fixes, effort, ordering)

The Developer Briefing defines three programme outcomes, captured by questions the
coach asks in-conversation and reported to a dedicated SharePoint list as structured
data (`[DATA]` tag → validation → outcome row; no chat content). The parsing and
storage code is built and tested. **Before wiring it, this review asks: are the
metrics themselves solid, and are we collecting them the right way?**

The short answer: the engineering pattern is right, but several metrics have
validity problems that are cheap to fix now and expensive to fix after funder
reporting has started — and one live defect has already appeared.

---

## Exhibit A — the instrument has already drifted

The briefing defines the confidence question as a **4-point** scale:

> 1 😬 Still nervous · 2 😐 Not sure yet · 3 🙂 A bit more ready · 4 💪 Ready to try it

The **v9 coach prompt** (edited via GitHub in Aug 2026) shows only **3 options** —
😐 "Not sure yet" was dropped, and 💪 moved from position 4 to position 3. The
validation code still accepts 1–4. Consequences if data collection had started:

- a logged `3` means *"ready to try it"* under v9 but *"a bit more ready"* under the briefing;
- `4` can never occur, silently;
- nothing in a row records which wording produced it.

The v9 prompt also dropped the returning-user comparison question entirely.

**Lesson:** the survey instrument lives inside a prompt that gets rewritten without
versioning. Every outcome row must carry a `prompt_version`, and prompt edits that
touch outcome questions must be treated as instrument changes (see
`PROMPT_EDITING_PROPOSAL.md`).

---

## Outcome 1 — Confidence (weakest validity, fixable)

| Issue | Why it matters |
|---|---|
| Self-rated confidence, asked by the coach that just coached you, at the moment of peak optimism | Measures satisfaction/demand-characteristics, not capability |
| `confidence_change` scale is *same / more / much more* | **Decline is unrepresentable** — the metric can only ever show improvement |
| The comparison question is redundant | `previous_confidence_rating` and `confidence_rating` are both stored; the honest delta is computable — asking adds bias, not information |
| Previous confidence keyed by scenario *type* | "Relationships" covers a breakup and a family conflict; cross-situation comparison under one slug is noisy |

**Highest-value fix on the table:** the planned 2-week check-in (pivot brief F5)
exists and is not connected to outcomes. Asking *"did you try it, and how did it
go?"* converts felt confidence into a **behavioural outcome** — the difference
between "users feel readier" and "users do the thing".

## Outcome 2 — Choosing appropriate responses (measures preference, not ability)

- `script_selected` (1/2) has no ground truth — both scripts are coach-written and
  presumably fine, so the choice between them is close to a coin-flip statistic.
- `roleplay_response_fit`'s *"neither"* conflates "user still struggling" with
  "coach generated bad options" — ambiguous attribution.
- The free-text reason is the genuinely valuable field (kept unredacted by team
  decision) but needs qualitative coding before it reports anything.
- A real ability measure would score the user's roleplay replies pre/post — the
  labelling platform's rubric machinery could do this, but it is a larger,
  consent-sensitive step. Not recommended for this iteration.

## Outcome 3A — Clarity (acceptable design, biased sample)

- Retrospective pre/post in one message is defensible, but the scales are
  asymmetric: *before* is absolute (lost / some idea / rough plan), *after* is
  relative (clearer) — no true delta is computable, and pairing both in one
  message invites self-consistent answering.
- **Survivorship bias:** the question fires only at a graceful close. Users who
  bail mid-session — plausibly the ones not helped — never enter the dataset.
  This applies to every end-of-session metric, and nothing measures the
  denominator today.

## Outcome 3B — Help-seeking (right idea, two structural holes)

- *"What made you decide to reach out?"* segments help-seekers; it does not
  measure whether help-seeking **increased**. The funnel that would —
  referral surfaced → link delivered → **link clicked** → arrived — is
  unmeasured at its most important edge (`insight_link_clicks` unimplemented).
- v9 asks the question **before** delivering the link: measurement friction at
  the funnel's most fragile moment. Ask after.
- The pivot brief's own F6 gap stands: the menu has no "connect with a worker"
  entry, so `path_selected: connect_worker` mostly cannot occur except via a
  coach-initiated `[REFERRAL]`.

---

## The collection mechanism

The `[DATA]` tag pattern — strict validation, rejected-key counting, separate
content-free list — is the right shape for Telegram, and the code quality is good.
Three honest weaknesses:

1. **The LLM is the measurement device.** It must ask the question at the right
   state, map "yeah kinda I guess?" onto an enum, and emit valid JSON — each step
   probabilistic. Raw answers are deliberately not stored (PDPA), so mapping error
   is invisible. Mitigation: eval-harness personas that exercise the outcome
   questions, plus a sample audit via the labelling platform (transcript answer
   vs logged enum) to *estimate* the error rate.
2. **No denominators.** A row exists only when `[DATA]` appears; "asked but
   unanswered" and "session ended early" are indistinguishable from "never
   asked". Emit one outcome row per coached session, nulls included — the
   stable-empty-string schema already supports this.
3. **No instrument version.** Exhibit A is the proof. Stamp `prompt_version`
   into every row — the labelling platform already does exactly this with
   `JUDGE_VERSION`; copy the discipline.

---

## Recommendations, ranked

1. Add `prompt_version` to the outcome schema; reconcile v9's 3-point scale with
   the 1–4 schema **before any data lands**.
2. Wire the F5 check-in to Outcome 1 ("did you try it?") — the only behavioural
   outcome available.
3. Drop `confidence_change` as a question; compute the delta from the two stored
   ratings (also fixes the can't-decline bias).
4. Emit per-session rows for denominators.
5. Implement the redirect/UTM click endpoint; move the 3B question after link
   delivery.
6. Sample-audit enum-mapping fidelity via the labelling platform.

None of this invalidates the built pipeline — parser, store, and logger all
survive. These are schema and prompt-side corrections, best made before wiring.

## Decisions needed

- Sign off on the confidence scale: 3-point (v9) or 4-point (briefing)? Whichever
  wins, code, prompt, and SharePoint columns must match, and the choice is
  frozen once reporting starts.
- Is computing confidence change (instead of asking it) acceptable to the
  programme team's reporting narrative?
- Approve adding the check-in outcome question to F5's message copy (needs the
  consent line in the welcome disclosures — see pivot brief §7).
- Confirm the F6 referral entry point decision (7th menu option / "type help" /
  coach-initiated only) — Outcome 3B's volume depends on it.
