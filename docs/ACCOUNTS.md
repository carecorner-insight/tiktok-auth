# CareyBot / CareyChats — Accounts & Credentials Inventory

Every external service the system depends on, what breaks without it, and where its
credentials are used. Covers **both** deployments:

| Bot | Purpose | Status |
|---|---|---|
| **CareyBot** (careytest) | Mental-health triage — the NUS research study build | **Frozen** until the study completes (Sept). Hotfixes only. |
| **CareyChats** | Growing We social coach — the pivot | Active development / user testing |

> ⚠️ **Ownership columns are blank on purpose.** Fill in who holds each account and
> where the credential is stored. Without that, this is a list of dependencies, not a
> handover document — and nobody can recover the system if one person is unavailable.

---

## 1. How to fill this in

For each service below, record:

- **Account owner** — the person or shared account the login belongs to
- **Login** — the email/username used (never the password)
- **Credential location** — the password manager entry or vault path (**never write secrets in this file**)
- **Billing** — who pays, and on which card/PO
- **Backup access** — a second person who can get in

A service with a single owner and no backup is a single point of failure. Mark those.

---

## 2. Core infrastructure

### Vercel — hosting & deployment
Runs both bots as serverless functions. Two **separate projects** from the same GitHub repo.

| | |
|---|---|
| URL | vercel.com |
| Projects | ① CareyBot (study) ② CareyChats (pivot) |
| Account owner | |
| Login | |
| Credential location | |
| Billing | |
| Backup access | |

**If lost:** both bots go down; no deploys possible. Env vars live here — losing access means losing the only copy of some settings unless they're recorded elsewhere.

---

### Upstash — Redis (session storage)
Conversation state, whitelist cache, age persistence, dedup locks. **One database per bot** — they must never share.

| | |
|---|---|
| URL | console.upstash.com |
| Databases | ① study ② pivot (both **Singapore / ap-southeast-1**) |
| Account owner | |
| Login | |
| Credential location | |
| Billing | |
| Backup access | |

**If lost:** in-flight conversations break; users restart. Data is short-lived (6h sessions) so loss is recoverable, but the bots cannot run without it.
**PDPA:** must stay in the Singapore region — session data contains full conversation text.

---

### GitHub — source code
Single repo, both bots. Also runs the scheduled evaluation workflow.

| | |
|---|---|
| Repo | |
| Account owner | |
| Org / access list | |
| Credential location | |
| Backup access | |

**Also holds Actions secrets:** `SIM_BASE_URL`, `SIM_TOKEN`, `QWEN_API_KEY`, `UAT_LOG_TOKEN`.

---

## 3. Messaging platforms

### Telegram — BotFather
Two bots, each with its own token. The token *is* the credential — anyone holding it can read and send messages as that bot.

| | CareyBot (study) | CareyChats (pivot) |
|---|---|---|
| Bot username | | |
| Token holder | | |
| Credential location | | |
| BotFather owner account | | |

**If lost:** you cannot manage the bot (rename, revoke, re-point the webhook). BotFather access is tied to a **personal Telegram account** — this is the most common single point of failure in the whole system. Make sure more than one person can reach it.

---

### TikTok — developer app
Study bot only. The pivot is Telegram-only (TikTok cannot send proactive messages).

| | |
|---|---|
| URL | developers.tiktok.com |
| Account owner | |
| Login | |
| Credential location | |

**Used by:** `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, and the daily token-refresh cron.

---

## 4. AI providers

### Alibaba DashScope — Qwen (pivot's primary AI)
Powers the social coach, the intent classifier, crisis follow-up turns, and the evaluation harness. Uses the **Singapore** endpoint (`dashscope-intl`).

| | |
|---|---|
| URL | dashscope-intl.console.aliyun.com |
| Account owner | |
| Login | |
| Credential location | |
| Billing | |
| Backup access | |

**If lost:** the pivot bot cannot reply at all. **PDPA:** must remain the international/Singapore endpoint, not the mainland China one.

---

### AIBots via Directus — Singapore government AI platform
Study bot's primary AI. Requires IP whitelisting, which is why all calls route through Directus.

| | |
|---|---|
| Directus URL | |
| Account owner | |
| Whitelisted IPs | |
| Credential location | |
| Platform contact | |

**Note:** the seeded bot prompts live **on this platform**, not in the code repo. If the coach ever runs with `COACH_PROVIDER=aibots`, its prompt is edited there.

---

### Dify — AI fallback
Backup for AIBots. **Flagged as a PDPA risk** — it can route conversation data off Singapore-approved infrastructure when AIBots fails. Pending a compliance decision.

| | |
|---|---|
| URL | |
| Account owner | |
| Credential location | |

---

### OpenAI — local simulator only
Used by `npm run simulate` on a developer machine. Not used by either deployed bot.

| | |
|---|---|
| Account owner | |
| Credential location | |

---

## 5. Microsoft 365

### SharePoint — data storage
All permanent records. **Separate lists per bot** so study and pilot data never mix.

| List | Used by | Contents |
|---|---|---|
| Whitelist | study only | Approved user IDs |
| Conversation log | both | Per-turn logs + outcome/KPI fields |
| Demographics | both | Age, once per user |
| Eval results | both | Automated test archive |
| Labels | optional | Reply-quality review |
| Reviewers | optional | Who may review replies |

| | |
|---|---|
| Tenant / site URL | |
| Site owner | |
| Who can edit lists | |
| Backup access | |

---

### Power Automate — flows
The bridge between the bots and SharePoint. **The flow URL is itself a secret** — anyone with it can write to your lists.

| Flow | Purpose | Owner | Status |
|---|---|---|---|
| Whitelist lookup | Study RBAC | | |
| Conversation log write | Both bots | | |
| Demographics write | Both bots | | |
| Eval results write | Testing | | |
| **Safety report (9:00 & 17:00 SGT)** | Flagged-user email | | |
| Reviewer lookup | Labelling access | | |
| Reviewer token generator | Auto-fills tokens | | |

⚠️ **Flows are owned by the person who created them.** If that person leaves the organisation, their flows stop running — silently. Move them to a **service account or shared owner**, especially the safety report.

---

### Restricted mailbox — safety alerts
Receives flagged-user transcripts twice daily.

| | |
|---|---|
| Mailbox address | |
| Who has access | |
| Retention policy | |

**PDPA:** contains conversation transcripts of at-risk users. Must be a restricted mailbox with a named, limited access list — ideally a shared mailbox, not an individual's inbox.

---

### Power BI — reporting
Reads the SharePoint lists for KPI and quality dashboards. Read-only; collects nothing.

| | |
|---|---|
| Workspace | |
| Owner | |

---

## 6. Legacy / to retire

| Service | Used by | Action |
|---|---|---|
| Google Sheets + Gmail | Old `api/daily-risk-report.js` | Superseded by the Power Automate safety report. Decide whether to retire. |

Env vars involved: `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SPREADSHEET_ID`, `GMAIL_EMAIL`, `GMAIL_PASSWORD`, `ALERT_EMAIL`.

---

## 7. Shared secrets (not accounts)

Tokens the system generates rather than a vendor account. All live in Vercel env vars.

| Secret | Grants |
|---|---|
| `SESSION_ENCRYPTION_KEY` | Decrypts stored conversations — **different per bot** |
| `SIM_TOKEN` | Drives the bot as any user, bypassing the whitelist. Treat as high privilege. |
| `UAT_LOG_TOKEN` | Reads live conversation logs and dashboards |
| `LABELER_TOKENS` | Per-reviewer labelling access |

**Rotate all of these when anyone with access leaves.**

---

## 8. Review checklist

- [ ] Every service has a named owner **and** a backup
- [ ] No credential is written in this file — only its location
- [ ] Power Automate flows are owned by a shared/service account, not an individual
- [ ] The two bots use **separate** Redis databases and SharePoint lists
- [ ] Someone other than the original creator can reach BotFather
- [ ] Safety-report mailbox access list is current
- [ ] Rotation owner and cadence agreed for the shared secrets
