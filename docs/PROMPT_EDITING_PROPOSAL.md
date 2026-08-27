# Letting the Team Edit the Coach Prompt Safely — Proposal

**Date:** 26 Aug 2026 · **Status:** DECIDED — see below
**Problem owner:** dev · **Decision needed from:** project lead

> **Decision (27 Aug 2026):** the team chose a **password-gated web editor** — a
> hardened variant of Option C, accepting instant publish over a CI gate, with
> the guardrails enforced in code (tag contract appended at load, length
> validation, versioned history with restore, bundled-prompt fallback, study
> bot excluded via `DYNAMIC_COACH_PROMPT=false`). Implemented as
> `public/prompt-editor.html` + `api/prompt-admin.ts` + `src/lib/promptStore.ts`.
> Model-behaviour dials and A/B variants are planned follow-ups on the same
> store. The analysis below is kept for the record.

## What went wrong last week (the motivating incident)

Three edits to the coach prompt were made through the GitHub web editor by pasting
the raw prompt text **over** the TypeScript file `src/config/socialCoachPrompt.ts`.
This silently broke the build:

- none of those three pushes deployed — the live bot kept running week-old code
  and **nobody was told**;
- the pasted text deleted the `[CRISIS]` / `[REFERRAL]` tag machinery, which is
  how the coach signals a crisis to the platform — had it deployed, crisis
  routing from the coach would have stopped working;
- the edit changed the confidence question from 4 options to 3, silently breaking
  the outcome-measurement schema (see `OUTCOME_METRICS_REVIEW.md`, Exhibit A).

The team was doing the right thing (iterating on the prompt from user testing).
The system made the right thing dangerous. That is a system problem, not a people
problem.

## Requirements

1. A non-technical colleague can change the prompt **without dev assistance**.
2. An edit **cannot** break the build, the crisis tags, or the deploy — the worst
   possible outcome of a bad edit is a worse-sounding coach.
3. Every change is **versioned**: we can see who changed what when, roll back,
   and stamp the version into outcome data (instrument versioning).
4. Fits existing constraints: Vercel Hobby (12-function cap, currently 10 used),
   PDPA, and the frozen NUS-study bot sharing this codebase.

## Options considered

### Option A — prompt as a plain-text file in the repo *(recommended now)*

Move the prompt text out of the TypeScript module into
`src/config/socialCoachPrompt.txt`. The module reads the file; the team edits the
`.txt` on GitHub web exactly as they do today — but there is no syntax to break.

- A CI check (GitHub Action, runs on every push) validates the prompt: file
  exists, non-empty, within length bounds, and the **final assembled prompt**
  still contains exactly one crisis tag and one referral tag (the platform
  appends the safety contract automatically when the text lacks one — that
  machinery already exists and stays in code, out of the team's reach).
- A short `PROMPT_VERSION` line at the top of the file (e.g. `v10 — 2026-09-01`)
  is parsed by code and stamped into every outcome row and UAT log entry.
- Git gives versioning, blame, and rollback for free.

**Pros:** small (≈half a day), removes the entire failure class from last week,
keeps one source of truth, zero new infrastructure, works for the study bot too.
**Cons:** still needs a GitHub account and a ~2-minute deploy wait; edits land on
production on merge (mitigable with branch protection requiring your review —
which restores "without my assistance" only partially).

### Option B — prompt hosted in SharePoint *(the destination, if editing stays frequent)*

The same pattern already used for the whitelist and reviewer list: a SharePoint
list **CoachPrompt** (columns: Version, PromptText, Status = Draft/Live,
EditedBy, EditedAt), read via a Power Automate flow, cached in Redis with a
5-minute TTL. The bot uses the Live row; the bundled repo prompt is the fallback
when SharePoint is unreachable.

- The team edits in SharePoint — an interface they already use daily, with
  SharePoint's own version history and approval workflow. Flipping a Draft to
  Live publishes in ≤5 minutes, **no deploy, no GitHub, no dev**.
- The platform still appends the crisis/referral contract in code, and refuses a
  prompt that is empty or absurdly short, falling back to last-known-good.
- `Version` is stamped into outcome rows, same as Option A.

**Pros:** genuinely zero-dev editing; instant rollback; audit trail owned by the
team. **Cons:** a bad edit goes live in minutes with no CI gate (guard-rails
catch structural breakage, not bad coaching); the prompt becomes runtime config —
one more Power Automate flow to own (see ACCOUNTS.md's warning about flow
ownership); needs a deliberate decision about who may flip Draft→Live.

### Option C — admin web page writing to Redis *(not recommended)*

A token-gated page that saves the prompt straight to Redis. Instant, but: burns a
function slot, loses SharePoint/GitHub audit trails, concentrates risk in one
token, and duplicates what Option B does with infrastructure the team already
trusts. Rejected.

## Recommendation

**Do A now, build B when the editing cadence justifies it.** A is half a day and
permanently prevents a repeat of last week. B is the real answer to "without my
assistance" and reuses the SharePoint+Power Automate+Redis pattern the system
already runs on — schedule it once the outcome-measurement wiring lands, since
both need the same `prompt_version` plumbing.

In both options, the non-negotiables stay in code where the team cannot touch
them: the tag contract, the `[DATA]` schema, and the assembly logic. The
EDITING_GUIDE.md gets updated to match whichever option ships, replacing the
current "edit between the backticks" instructions that just failed us.

## Decisions needed

1. Option A alone, or A now + B next? (Dev recommends both, staged.)
2. If A: should GitHub branch protection require one review before merge, or is
   CI-green auto-deploy acceptable?
3. If B: who is allowed to flip a prompt from Draft to Live, and does the
   safety-relevant wording (crisis message, disclosures) need clinical sign-off
   before publishing — and if so, enforced how (a second Status value, e.g.
   "Approved")?
4. Confirm prompt edits that touch **outcome questions** are treated as
   instrument changes: version bump mandatory, programme team informed.
