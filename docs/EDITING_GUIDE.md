# Changing what Carey says — a guide for the non-technical team

This explains **where to change the bot's words and behaviour**, what's safe to edit,
and what will quietly break things if you touch it.

You do not need to understand the code. You do need to know which file to open and
which parts are off-limits.

---

## First: which bot are you changing?

| | **CareyBot** (careytest) | **CareyChats** |
|---|---|---|
| What it is | Mental-health triage — the research study | Growing We social coach — the pivot |
| Status | **Frozen** until the study finishes | Active — this is the one you'll be editing |
| Flow | Age → 4 risk questions → 3 options | Welcome + age → 6 scenarios → coach |

⚠️ **Do not change the study bot.** Changing its wording mid-study invalidates the
research it's producing. Everything below assumes you're editing **CareyChats**.

Both bots run from the same code, so a change to a shared file affects both. Each
section below says which bot it touches.

---

## The golden rules

1. **Edit only between the quote marks.** The words are inside backticks (`` ` ``) or
   quotes. Everything else — brackets, commas, the word `export` — is machinery.
2. **Never delete a `${...}` placeholder.** Those insert live values (a link, an age).
   Deleting one breaks the message.
3. **Never remove anything in square brackets like `[CRISIS]`.** Those are safety
   signals, not text the user sees. See *Do not touch* below.
4. **Changes need a deploy to go live.** Saving the file isn't enough.
5. **After any change, test it** — see *Checking your change worked*.

---

## 1. The coach's personality and coaching style

**File:** `src/config/socialCoachPrompt.ts`
**Affects:** CareyChats only

This is the big one — the instructions that make the coach behave the way it does.
Its tone, what it asks, how it handles someone who's upset, what it refuses to do.

Open the file and look for:

```
export const SOCIAL_COACH_BASE_PROMPT = `
```

**Everything between that opening backtick and the closing `` `.trim(); `` is yours
to edit.** Write in plain English, as if instructing a new staff member.

### ⛔ Do not touch

Further down the same file there's a section about **`[CRISIS]`** and **`[REFER]`**.
Those square-bracket tags are how the coach tells the system *"this person is in
danger"* or *"this person needs a real human"*. The system reads the tag, then sends
the crisis hotline message or the referral link.

**If you delete or rename those tags, the safety features stop working — silently.**
No error appears. The bot keeps chatting normally. You would only find out when
someone in crisis didn't get help.

If you rewrite the prompt, keep the tag rules intact. If you're unsure, ask a
developer to check before it goes live.

---

## 2. The welcome message, menu, and other fixed text

**File:** `src/config/questionnaire.ts`
**Affects:** CareyChats (the constants listed below)

These are messages the system sends directly — the coach isn't involved, so the
wording is exactly what you write.

| What you want to change | Look for |
|---|---|
| The first message (greeting, disclosures, age question) | `WELCOME_TEXT` |
| The nudge when someone doesn't give an age | `AGE_REPROMPT_TEXT` |
| The greeting for someone who's used it before | `WELCOME_BACK_TEXT` |
| The 6-option menu | `SCENARIO_MENU_TEXT` |
| The menu when shown again later | `SCENARIO_MENU_REPEAT_TEXT` |
| **The crisis safety message** | `EMERGENCY_MESSAGE` |
| The "are you 25 or under?" question | `REFERRAL_AGE_FALLBACK` |

### ⚠️ Two of these need extra care

**`EMERGENCY_MESSAGE`** is what someone sees when they express thoughts of suicide or
self-harm. It is sent **word-for-word**, with no AI involved, deliberately. **Any change
needs clinical sign-off before it goes live.** Do not adjust it for tone or length on
your own.

**`WELCOME_TEXT`** contains the data-protection disclosures ("your messages are
stored", "may be reviewed by trained staff"). Those lines are a **PDPA commitment**.
You can reword them, but you cannot remove what they promise without checking whether
the privacy notice still matches.

### Editing the menu

If you change a menu option's wording, that's fine on its own. But if you change what
an option *means* — say, replacing "Something awkward happened" with a different
topic — you must also update the matching entry in `SCENARIOS` in the same file, or
the coach will open on the wrong subject.

---

## 3. How the coach opens on each topic

**File:** `src/config/questionnaire.ts`, the `SCENARIOS` section
**Affects:** CareyChats only

When someone picks option 3, the system tells the coach *"this person wants to talk
about making or keeping friends"* so it doesn't ask "which situation?" all over again.

Each of the six entries looks like:

```
3: {
  label: 'Making or keeping friends',
  slug: 'friends',
  context: 'making new friends or keeping the friendships they already have',
},
```

- **`label`** — safe to edit. A short name for the topic.
- **`context`** — safe to edit. A plain-English description of what the person wants help with. Improving this makes the coach's opening more relevant.
- **`slug`** — ⛔ **do not change.** It's a codeword shared with the coach's instructions and with reporting. Changing it breaks both.

---

## 4. Turning features on and off

**Where:** Vercel → your project → Settings → Environment Variables
**Affects:** whichever project you change

These are switches, not text. Change one, then **redeploy**.

| Setting | What it does |
|---|---|
| `SCREENER_ENABLED` | `false` = no risk questions (the pivot). `true` = the study's 4 questions. |
| `AUTH_ENABLED` | `false` = anyone can use the bot. `true` = approved users only. |
| `CRISIS_STATIC_FIRST` | `true` = the crisis message is sent word-for-word. Leave this on. |
| `COACH_PROVIDER` | Which AI runs the coach. Leave as-is unless a developer says otherwise. |

---

## 5. Who can use the bot (study bot only)

**Where:** SharePoint → the **Whitelist** list

The study bot only replies to approved people. To approve someone, find their row and
set **Status** to `Approved`. Access updates within a few minutes — no developer needed.

**CareyChats has no whitelist** — it's open to anyone.

---

## 6. Who can review conversation quality

**Where:** SharePoint → the **Reviewers** list

Add a row with their name, email, and Status `Approved`. A token is generated
automatically — send it to them privately; it's a password.

To remove someone, set Status to `Revoked`. **Don't delete the row** — keeping it
preserves the record of who reviewed what.

---

## 7. The safety email

**Where:** Power Automate → the safety report flow

Runs at **9:00 and 17:00 SGT**, emailing flagged conversations to the restricted
mailbox. You can change the recipient or the times in the flow itself — no code change.

⛔ **Don't widen the recipient list.** It contains conversation transcripts of at-risk
young people.

---

## Checking your change worked

1. **Deploy** — Vercel → Deployments → *Redeploy*. Wait for it to finish.
2. **Message the bot on Telegram** and walk through the part you changed.
3. **Watch it live** — open `label.html`'s sibling page `uat-logs.html?token=...`,
   press **Capture**, and you'll see conversations as they happen.

If something looks wrong, the fastest fix is to change the text back and redeploy.

---

## When to ask a developer

- The bot stops replying entirely
- You see raw text like `[REFER]` or `SCENARIO: friends` in a user-facing message
  (that means a signal leaked into the conversation — a real bug)
- You want to change the **order** of the flow, add a menu option, or change what a
  step *does* rather than what it *says*
- Anything involving `EMERGENCY_MESSAGE`, the `[CRISIS]` tag, or the disclosures
- You're not sure whether a change is safe

**There is no such thing as a silly check on the safety wording.** Getting it wrong is
much more expensive than asking.

---

## Quick reference

| I want to change… | File / place |
|---|---|
| Coach's personality & style | `src/config/socialCoachPrompt.ts` |
| Welcome, menu, crisis message | `src/config/questionnaire.ts` |
| What the coach opens with per topic | `SCENARIOS` in `src/config/questionnaire.ts` |
| Features on/off | Vercel → Environment Variables |
| Who can use the study bot | SharePoint → Whitelist |
| Who can review quality | SharePoint → Reviewers |
| Safety email time/recipient | Power Automate → safety report flow |
