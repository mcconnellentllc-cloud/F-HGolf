# F&H Golf website — handover plan

Research-only scoping. No resource has been transferred, reconfigured, or
had ownership changed as part of this report. Any statement about
external accounts (registrar, DNS, Vercel billing) is inferred from
what's visible in the repo and needs to be confirmed against the actual
account dashboards before acting.

Context: the site is being built for the **F&H Park & Recreation
District**. Everything below optimizes for continuity after the original
builder steps away, not for builder convenience. The Tournament
Workspace is the highest-value piece and also the piece with the most
moving parts, so it drives most of the risk analysis.

---

## Step 1 — Ownership audit

### a. GitHub repo and org

- **Current owner:** `mcconnellentllc-cloud` (private LLC GitHub org).
  Repo: `F-HGolf`. Confirmed in
  [`admin.html`](../admin.html) line 183 (link to
  `github.com/mcconnellentllc-cloud/F-HGolf`) and in the
  onboarding copy in
  [`build-guide.html`](../build-guide.html).
- **What the district owns today:** nothing.
- **Transfer options:**
  - GitHub repo transfer to a district-owned org (recommended target).
    Repo history, issues, PRs, releases all move. Requires: (1) a
    district-owned GitHub org exists, (2) the current owner initiates
    transfer, (3) a district admin accepts.
  - Fork + archive the original. Loses commit continuity on the
    "official" copy. Only useful if the current owner refuses / is
    unreachable and the district still has the code locally.
- **Bus-factor risk today:** **High.** If `mcconnellentllc-cloud`
  becomes unreachable, the district loses the org, and therefore the
  Pages deployment, the Vercel-linked repo, and any org-level Actions
  secrets. The code itself is safe (multiple local clones exist), but
  the deployed site would go dark until re-hosted somewhere the
  district controls.

### b. Domain: fandhgolf.com

- **What the repo tells us:** the site declares `fandhgolf.com` as its
  GitHub Pages custom domain via [`CNAME`](../CNAME) at the repo root.
- **What the repo does NOT tell us:** registrar, account holder, expiry
  date, auto-renew status, WHOIS privacy provider. **These have to be
  checked against the actual registrar dashboard.** Common candidates
  for a small-business domain are GoDaddy, Namecheap, or Google Domains
  (now Squarespace).
- **Bus-factor risk today:** **Cannot be assessed from the repo.**
  Verify before the handover. A domain that renews on an ex-builder's
  personal credit card and personal email is a total-outage risk if
  renewal payment fails or the renewal notice is missed. **Assume this
  is the worst-case case until proven otherwise.**

Concrete checks to run against the registrar dashboard:

1. Account holder name and email — must be a district or
   role-based address (not personal).
2. Expiry date and time to renewal (< 6 months = act now).
3. Auto-renew status. If auto-renew, whose card is on file?
4. WHOIS contact — should be a role address at the district.
5. Registrar-lock / transfer-lock status. Should be locked; unlock only
   during an actual transfer window.

### c. DNS hosting

- **Inferred:** GitHub Pages CNAME points at
  `<org>.github.io`. `www.fandhgolf.com`, apex A records, and any
  external mail records (SPF/DKIM/DMARC for the Resend sender, plus any
  future MX records if the district ever stands up real mailboxes) all
  live at whichever DNS provider is authoritative for `fandhgolf.com`.
  Often
  this is the same account as the registrar (Namecheap / GoDaddy), but
  not always — some setups use Cloudflare in front.
- **What the repo cannot tell us:** which provider, and who owns that
  account.
- **Verify:** run `dig NS fandhgolf.com` (or use `whatsmydns.net`) to
  see the authoritative nameservers. Then log in to that provider's
  dashboard and confirm the account holder.
- **Bus-factor risk:** **High if the DNS account is the builder's
  personal account.** Losing DNS control means the domain still exists
  but no one can point it anywhere — including at a new host.

### d. GitHub Pages configuration + custom domain

- **Configuration:** driven by `CNAME` in the repo root. Persists
  automatically when the repo is transferred to another org, but the
  **Enforce HTTPS** toggle in the new org's Pages settings must be
  re-enabled after transfer. GitHub also re-issues a Let's Encrypt cert
  under the new org, which can take 15–60 minutes.
- **Pages URL breakage on repo transfer:** the
  `<org>.github.io/F-HGolf/` URL changes. Anything hardcoded to
  `mcconnellentllc-cloud.github.io/...` breaks. Grep the repo for that
  string during handover; the CNAME'd `fandhgolf.com` URL keeps working
  as long as DNS still points at Pages.
- **Vercel-side URL breakage:** if the repo transfers, the Vercel
  project (see next item) either has to follow the new repo owner or be
  re-linked. The public API endpoint `f-h-golf.vercel.app` and the
  hardcoded reference to it in
  [`js/api.js`](../js/api.js) lines 8–15 are the risk surface.

### e. Third-party service accounts

Every runtime dependency the site pulls from an external account,
grouped by criticality.

**Critical (site breaks without them):**

| Service | Purpose | Account currently on | Notes |
| ------- | ------- | -------------------- | ----- |
| **Vercel** | Hosts every API in `api/` and stores every server-side secret. Public origin is `f-h-golf.vercel.app`. Referenced at [`admin.html`](../admin.html) line 188. | `mcconnellentllc-clouds-projects` team | **Highest priority to transfer.** All admin writes route through here. |
| **Airtable** | System of record for signups, scores, Calcutta, expenses, archives, tournament config, players, nominations, reviews. | Unknown from repo; `AIRTABLE_BASE_ID` env var in Vercel. | The base itself is on some Airtable workspace. Ownership of that workspace matters as much as ownership of the token. |
| **Resend** | Sends signup confirmation emails via `api/tournament-signup.js` line 63. | Unknown from repo; `RESEND_API_KEY` env var in Vercel. | The transactional email path in production and — per Step 4 — the path Calcutta receipts will use. |
| **DNS provider** | Points `fandhgolf.com` at Pages + issues CAA if any. | Inferred, see (c). | |
| **Domain registrar** | Owns the domain lease. | Inferred, see (b). | |

**Non-critical (site loses features gracefully):**

| Service | Purpose | Fallback | Notes |
| ------- | ------- | -------- | ----- |
| **Google Fonts** (`fonts.googleapis.com`) | Fraunces + Source Sans 3 typefaces. Referenced in every HTML `<head>`. | System font fallback in CSS. | Free forever, no account. |
| **jsDelivr CDN** (`cdn.jsdelivr.net`) | `qrcode@1.5.3` on the QR-code displays. | Local generation via the same library bundled, or the api.qrserver.com fallback list in [`tournament-admin.html`](../tournament-admin.html) around line 5347. | Free CDN, no account. |
| **api.qrserver.com / quickchart.io / chart.googleapis.com** | QR-code image fallbacks. | Cascading — three tried in order. | No account; but any of these three could quietly deprecate the API. |
| **Facebook Meta Page Plugin** | Optional embedded page feed at [`index.html`](../index.html) `#contact`. | The page shows a static Facebook link card as the baseline. The plugin loads on top only if Meta returns HTML. | Free, no account required for the render; the Facebook Page itself IS a service account — see below. |
| **Facebook Page `fandhgolf`** | Course's public Facebook presence. | — | Owned by whichever admin(s) run the Facebook Page today. Verify separately. |
| **Deposyt** | Hosted card-payment form for green fees + tournament entries. Referenced in [`js/api.js`](../js/api.js) line 20 as a hardcoded URL. | Cash / check payment. | The Deposyt merchant account is a separate business relationship — the URL just points at whichever merchant configured that hosted form. |

**Not in play today, may become relevant later:**

| Service | Purpose |
| ------- | ------- |
| **District mailbox provider** (whatever the district already uses, or a small paid Google Workspace / Fastmail tenant) | Real inboxes behind the `admin@`, `data@`, `calcutta@` role addresses used across this doc. Not a Step-4 dependency — Calcutta receipts send via Resend regardless (see Step 4). This only matters for the mailboxes that *receive* replies. |

### f. Secrets

**In the repository — none.** `.gitignore` covers `models/` only; no
`.env`, no `.env.example`, no secrets in tracked files. Confirmed by
`grep -R AIRTABLE_TOKEN` — every hit is `process.env.AIRTABLE_TOKEN` on
the server side.

**In Vercel environment variables** (inferred from `process.env` reads
across `api/`):

| Env var | Purpose | Sensitivity |
| ------- | ------- | ----------- |
| `AIRTABLE_TOKEN` | Personal access token for the Airtable base | High. Read + write on every table. |
| `AIRTABLE_BASE_ID` | Airtable base UID | Low. Not a secret in the crypto sense, but leaking it plus the token = full data access. |
| `ADMIN_KEY` | Shared passphrase the admin workbook sends in `x-admin-key` | High. Grants full write access to every admin endpoint. |
| `RESEND_API_KEY` | Transactional email sending | High. Can be used to send from `fandhgolf.com`. |
| `RESEND_FROM` | Default From address | Low. |
| `TOURNAMENTS_TABLE` / `CONFIG_TABLE` / `PLAYERS_TABLE` / `REVIEWS_TABLE` / `AIRTABLE_TABLE` | Table-name overrides | Low. |

**In GitHub Actions secrets — none.** No `.github/` directory exists in
the repo (`ls .github` returns "No such file or directory"), so no
workflow-level secrets to inventory.

### g. Personal-email flags

Grep produced this list of personal-email dependencies in the current
site. **Every one of these is a bus-factor risk.**

- **`mcconnellentllc@gmail.com`** — builder's personal Gmail, referenced
  as the way to gain access to the project in
  [`admin.html`](../admin.html) lines 216 and 225, and in
  [`build-guide.html`](../build-guide.html) lines 92 and 153. **This
  address is the sole documented onboarding path for new contributors.**
  It also implicitly gates access to:
  - the `mcconnellentllc-cloud` GitHub org
  - the `mcconnellentllc-clouds-projects` Vercel team
  - almost certainly the Airtable workspace where the base lives
  - probably the Resend account
  - possibly the domain registrar
  - possibly the DNS provider
  **If this Gmail account goes away, every one of the above
  becomes unreachable at the same time.** Highest-risk single point of
  failure in the entire stack.

- **`fandhgolfcourse@gmail.com`** — the course's role-based Gmail,
  published in [`index.html`](../index.html) lines 163 and 465,
  [`tournaments.html`](../tournaments.html) line 258. Role-based on the
  face of it, but it's still a Gmail account owned by whoever set it up
  and holds the password. Verify the recovery details and current
  password holder before treating this as "the district's mailbox".

Nothing else in the repo hardcodes a personal address.

---

## Step 2 — Target ownership model

Recommended end state: **the district owns every account**, and the
builder is a collaborator with least-privilege access during whatever
active build window remains.

### GitHub — recommend new district-owned org, then transfer

Two options:

- **Option 1 (recommended): create a new district-owned GitHub org
  (e.g. `fandhgolf` or `fh-park-rec`) and transfer the `F-HGolf` repo
  to it.** Pros: clean org name, full org-level control (billing,
  member management, security policies). Preserves commit history,
  issues, PRs, releases, wikis. GitHub Pages `CNAME`
  (`fandhgolf.com`) travels with the repo — Pages settings re-render
  after transfer, but the custom-domain routing keeps working because
  the DNS record at the registrar still resolves to Pages.
  Cons: Vercel project must be re-linked to the new repo owner (a few
  clicks, but must be done before the next push, or CI/CD breaks).

- **Option 2: transfer just the repo within the existing org
  (i.e., don't transfer at all) and give the district admin rights.**
  Pros: nothing breaks, no Vercel relink. Cons: does not solve the
  bus-factor problem — the org still belongs to `mcconnellentllc-cloud`
  and every underlying account (Vercel, Airtable, Resend) still runs
  through the builder's identity. **Not a real handover.**

**What breaks on repo transfer to a new org:**

- **Pages URL.** `mcconnellentllc-cloud.github.io/F-HGolf` stops
  working. The custom-domain `fandhgolf.com` keeps working because it's
  wired to DNS, not to the org name.
- **Vercel-side integration.** The GitHub App the current Vercel
  project uses is installed on `mcconnellentllc-cloud`. After transfer,
  either (a) install the Vercel GitHub App on the new org and re-link
  the project, or (b) migrate the Vercel project's Git integration in
  the same session. Neither is hard; either has to happen before the
  next merge to main, or auto-deploys stop.
- **Any hardcoded reference to `mcconnellentllc-cloud`** breaks the
  moment the repo path 404s. Grep in the handover runbook. Known hits
  today: `admin.html` lines 183 and 188, `build-guide.html` lines 92
  and 153.
- **Not broken by transfer:** the CNAME, the DNS record, the domain
  itself, all Vercel env vars, all Airtable data. Those live outside
  GitHub.

### Role-based email addresses for every service account

Every service account below should be re-registered (or have its
primary email changed) to a role-based mailbox on `fandhgolf.com`, and
NOT to a personal Gmail:

| Service | Recommended primary email |
| ------- | ------------------------- |
| GitHub org owner | `admin@fandhgolf.com` (or `it@`) |
| Vercel team owner | same |
| Airtable workspace owner | `data@fandhgolf.com` or reuse `admin@` |
| Resend account owner | `admin@fandhgolf.com` |
| Domain registrar account | `admin@fandhgolf.com` |
| DNS provider account | `admin@fandhgolf.com` |
| Facebook Page admin | tie to a second board member, not the builder |
| Deposyt merchant | already the course's business relationship; verify contact email is a course address, not personal |

These role addresses only need to *receive* — sending is handled by
Resend under Step 4. The simplest realization is aliases /
distribution lists on whichever mail provider the district already
uses (or a small Google Workspace / Fastmail tenant if it doesn't),
routed to the appropriate board members so no one has to check a new
inbox every day.

### Credential storage and passing on

- **Do not maintain a shared plaintext password document. Ever.**
- Use **1Password Teams** or **Bitwarden Business**, provisioned under
  the district. Every one of the accounts above gets an entry with
  username, password, recovery codes, and MFA seed (or a note that MFA
  is on and its recovery kit is stored in the vault).
- **MFA on every account.** Prefer TOTP over SMS. The TOTP seed goes in
  the same vault entry so a second admin can log in when the primary is
  out.
- The **runbook file** in the repo (Step 5) points at the vault for
  actual secrets; it never contains them. It's OK to say "the Airtable
  workspace owner is `data@fandhgolf.com`; token rotation instructions
  are in the vault entry titled 'Airtable — F&H Golf base'."
- Rotate **every current secret** during handover: `AIRTABLE_TOKEN`,
  `ADMIN_KEY`, `RESEND_API_KEY`. Old values become invalid the moment
  the new ones are pushed. This closes the door on any residual access
  the builder had.

---

## Step 3 — Successor skill assumption

The site has to survive under whichever assumption is realistic. Both
paths below are laid out with what must be dropped, what stays, and
where each current component sits on the risk curve.

### Path A — Non-technical successor (clubhouse manager, board member)

**Goal:** the site never requires a `git push`, a Vercel redeploy, a
Node.js install, or an SSH session for a full calendar year.

**Components that STAY safe under this path:**

- **Static content pages** (`index.html`, `tournaments.html`,
  `hall-of-fame.html`, `story.html`, `founders-rules.html`, etc.).
  These are HTML files. Copy edits can be handled by anyone with a
  GitHub account and a text editor — GitHub's web UI supports this
  directly. The `build-guide.html` page inside the repo already
  explains the flow at a beginner level and can carry over unchanged.
- **The public Founders pages** (`founders-recap.html`,
  `founders-leaderboard-display.html`, `founders-calcutta-display.html`,
  `founders-flights.html`) that read from Airtable via the existing
  Vercel API. They keep working as long as the API keeps running.
- **`data/founders-2026-highlights.json`** (recap copy) — edited in
  place, changes go live on next Pages build. Non-technical-safe.

**Components that BECOME an outage risk under this path:**

- **The entire Vercel deployment.** Every serverless function in
  `api/`. If a Vercel bill goes unpaid, a token expires, or an
  environment variable gets accidentally deleted, admin writes stop
  working and there's no one comfortable diagnosing it.
  - **Mitigation:** freeze the API. Once handover is complete, no more
    API changes until a technical successor is available. Existing
    admin flows keep working; new features get parked.
- **Airtable token expiry / rotation.** Airtable personal access tokens
  don't expire, which is a virtue here — but they can be rotated at any
  time from the Airtable UI, and if the successor rotates by accident
  the API 401s until the new token is pushed to Vercel env vars.
  - **Mitigation:** two Airtable tokens, both in Vercel as
    `AIRTABLE_TOKEN` and `AIRTABLE_TOKEN_BACKUP`, the endpoint tries
    the primary first and falls back. That's a small technical addition
    up front for a lot of continuity headroom later.
- **Resend account.** Same failure modes as Airtable — token
  rotation or account suspension stops confirmation *and* (post-Step-4)
  Calcutta-receipt emails.
  - **Mitigation:** transfer the Resend account into district ownership
    as part of Step 1 (see the sequence in Step 6). No key rotation is
    required on transfer. Under Path A this is a stable dependency:
    non-expiring API key, one vendor, one bill.
- **The Tournament Workspace admin (`tournament-admin.html`).** The
  most complex artifact in the repo, ~6,000 lines of JS. Under Path A
  this is basically a black box the successor uses but can't repair.
  - **Mitigation:** the Recap tab and static pages can be edited via
    GitHub web UI. Everything else (scores, Calcutta, payouts) has to
    Just Work — which means active monitoring during the first
    tournament under new ownership, and a fallback plan (paper
    scorecards, spreadsheet Calcutta) if it doesn't.

**Features that would have to be dropped or simplified:**

- Any planned expansion of the admin (new tabs, new endpoints). Freeze
  the surface area.
- The Deposyt on-site payment integration is fine because it's a hosted
  form (no code to maintain), but any change to the payment flow gets
  frozen too.
- The Facebook Page embed (`fb-page` widget in `index.html`) has to
  either stay as-is or be removed. Any Meta API change and it silently
  stops working.

### Path B — Technical successor

**Goal:** normal ongoing development possible.

**What becomes safe to keep** on top of Path A:

- Adding new admin tabs / endpoints. The pattern in `api/` (Vercel
  function that reads / writes Airtable behind `x-admin-key`) is easy
  to extend.
- Extending the Recap system to future tournaments — trivial: copy
  `founders-2026-highlights.json` → `founders-2027-highlights.json`,
  swap the fetch path.
- Rotating tokens on a schedule, monitoring Vercel logs, upgrading the
  Node.js runtime when Vercel deprecates the current one.
- Adding proper CI checks (test on PR, prevent merges that break the
  build).

**Additional outage risks Path B accepts that Path A avoids:**

- Vercel Node.js runtime deprecations (currently 18.x / 20.x; Vercel
  drops old runtimes on their own timeline). Requires a rebuild every
  1–2 years.
- Airtable schema drift — the site is already resilient to unknown
  fields (auto-strip retry pattern in `api/tournament-checkin.js` +
  `api/tournament-flights.js`), but new features on new fields require
  matching admin UI work.

### Which path to plan for

**Plan for Path A. Design for Path B.** Meaning: the docs, the
credential inventory, the runbook, and the freeze policy should all be
written assuming the next primary successor is non-technical. But the
architecture should not be so simplified that a future technical
successor is boxed out of extending it.

---

## Step 4 — Email: Resend (settled)

**Decision: send Calcutta receipts through Resend, via a new
server-side endpoint. This resolves the contradiction between this doc
and `docs/email-scoping.md`; both now agree.**

### Reasoning

- **No new vendor.** Resend is already in production. Signup
  confirmations already send through it via
  [`api/tournament-signup.js`](../api/tournament-signup.js) line 63
  using `RESEND_API_KEY` in Vercel env vars. A Calcutta receipt
  endpoint reuses the same account, the same key, the same From address,
  the same DKIM records.
- **No expiring credential.** Resend API keys are non-expiring; they
  don't rotate on their own timer. That's a real advantage for a
  Path-A successor who won't be logging into a vendor dashboard on a
  6–12 month cycle to rotate a secret.
- **No new account for the district to inherit.** Whichever account
  currently holds `RESEND_API_KEY` is already part of the ownership
  transfer (see Step 1e and the sequence in Step 6). Adding one
  endpoint doesn't add one account.
- **Existing DKIM / SPF setup carries over.** If signup confirmations
  are landing in inboxes today (verify), receipts will too. If they
  aren't, the fix is the same one either way.

### Implementation summary

Details live in [`docs/email-scoping.md`](./email-scoping.md). Short
form: new endpoint `POST /api/calcutta-receipt` on Vercel, gated by
the same `x-admin-key` check as every other admin write. Modes:
one-buyer send, all-buyers send. Content is per-recipient HTML rendered
server-side and posted to `https://api.resend.com/emails` — the same
call `sendConfirmationEmail` already makes.

### No option puts a credential in client-side JS

Confirmed. `RESEND_API_KEY` stays in Vercel env vars; the browser
never sees it. The Calcutta admin sends a `POST` request with the
admin's session `x-admin-key` header, and the Vercel function
translates that into the Resend call server-side.

### Precondition list

Before any code lands (repeated from `docs/email-scoping.md` for
completeness):

1. Confirm `fandhgolf.com` is verified in the Resend dashboard — SPF,
   DKIM, DMARC all green.
2. Confirm the send-from address. Default is
   `F&H Golf <noreply@fandhgolf.com>`. Reserve `calcutta@fandhgolf.com`
   as an alternative if the board prefers a purpose-specific sender.
3. Confirm the reply-to address routes to a monitored inbox. Current
   default in the site copy: `fandhgolfcourse@gmail.com`.
4. Add `Buyer Email` field on the Airtable `Tournament Signups` table.
5. Decide the no-email-on-file behavior: silent skip with a summary
   count, or prompt-to-enter-at-send-time. Silent skip is recommended.

Item 4 is the real blocker — buyers currently have no email field at
all.

---

## Step 5 — Handover package contents

Every artifact below should exist in the repo under `docs/` **before**
the transfer, so the successor has a self-contained bundle they can
open in a browser.

### Recommended file structure

```
docs/
├── README.md                    (index of everything below)
├── handover-plan.md             (this file — stays as the transfer plan)
├── runbook/
│   ├── content-updates.md       (edit copy on any page)
│   ├── publishing-results.md    (tournament day workflow)
│   ├── recap-flow.md            (the publish=true flip + admin Recap tab)
│   ├── calcutta-receipts.md     (whichever pattern from Step 4 wins)
│   ├── json-flags.md            (every "publish" / "showTitles" / etc. flag)
│   └── admin-workbook.md        (tab by tab overview of tournament-admin.html)
├── credentials.md               (inventory — no secret values, points at vault)
├── renewal-calendar.md          (domain, cert, token, secret expiries)
├── known-issues.md              (bugs, unfinished work, deferred decisions)
├── contacts.md                  (who to call when something breaks)
└── email-scoping.md             (already exists; older scoping report)
```

### Contents of each file

- **`runbook/content-updates.md`** — For each page, which file to edit,
  which strings can be changed safely, which cannot. Screenshots of
  GitHub web editor.
- **`runbook/publishing-results.md`** — Step-by-step: how to enter
  scores on tournament day, how to publish flights, how to close a
  Calcutta, how to run "Commit snapshot to History", when NOT to hit
  the reset flow (with its `window.__fhResetTournament()` incantation
  documented so the operator knows it exists but understands it is
  destructive).
- **`runbook/recap-flow.md`** — The `data/founders-YYYY-highlights.json`
  pattern. `publish: true` → live. What each field does. How to add
  next year's file.
- **`runbook/calcutta-receipts.md`** — The Step 4 Resend flow: Calcutta
  admin → Send Receipts → per-buyer via Resend. Covers the "no email on
  file" behavior, how to spot-check delivery in the Resend dashboard,
  and how to resend a single buyer if a bounce comes back.
- **`runbook/json-flags.md`** — Every gated flag in `data/*.json` and
  what happens when it flips. Currently:
  `data/founders-2026-highlights.json` → `publish`, `champions.score`,
  `champions.scoreType`, `board.showTitles`, `board.members`.
- **`runbook/admin-workbook.md`** — Tab-by-tab reference. Check-In,
  Pairings, Scores, Flights, Calcutta, Calcutta Buyers, Leaderboard,
  Payout, $ Summary, Calc, Rules, Recap, History. What each does and
  what NOT to click.
- **`credentials.md`** — For each secret / account: name, what it does,
  where the value lives (vault entry title, Vercel env var name),
  rotation steps. **Never the value itself.**
- **`renewal-calendar.md`** — A table with next 24 months of expiries:
  domain renewal, Let's Encrypt (auto, but noted), Airtable token
  (no auto-expiry, but rotate on personnel change), Resend API key
  (no auto-expiry, same), Vercel Node runtime deprecations. One row
  per event with date + owner + action.
- **`known-issues.md`** — At time of handover: the 14 open items in
  `data/founders-2026-am-REVIEW.md`, plus every "we deferred X"
  scattered through commits.
- **`contacts.md`** — Who to call. Registrar support number, Vercel
  support tier, Airtable support, the builder's role during warranty
  window (if any), which board member owns which decision.

---

## Step 6 — Sequence

Ordered task list. Bold items are **blockers** — they get harder or
riskier the more the site grows, and should happen before any more
features ship.

### Phase 0 — Verify what actually exists (before any transfers)

Nothing here changes ownership. It's fact-finding.

1. **Log into the domain registrar for `fandhgolf.com`.** Confirm the
   account holder email, the expiry date, auto-renew, WHOIS contact,
   card on file. Screenshot for `renewal-calendar.md`.
2. **`dig NS fandhgolf.com`.** Confirm which DNS provider is
   authoritative. Log in there, confirm account holder.
3. **List Vercel team members.** `mcconnellentllc-clouds-projects`.
   Which humans have Owner / Member access? Which email addresses?
4. **List Airtable workspace collaborators.** Same question.
5. **List Resend account members.** Same question.
6. **Confirm which board member holds the recovery seeds for
   `fandhgolfcourse@gmail.com`.** If none — flag as immediate risk.

### Phase 1 — Provision district-owned identity (before transfers)

7. **Stand up role-based mailboxes on `fandhgolf.com`** —
   `admin@fandhgolf.com`, `treasurer@fandhgolf.com`,
   `calcutta@fandhgolf.com`, whatever the board decides. Use whichever
   mailbox provider the district already runs, or a small paid
   Google Workspace / Fastmail tenant if it doesn't. Aliases or
   distribution lists are fine — these only need to *receive*, since
   Calcutta receipts and signup confirmations both send via Resend
   (Step 4). **This is a prerequisite for every subsequent ownership
   transfer** because every account below wants a real contact email.
8. **Provision a district-owned password vault** (1Password Teams /
   Bitwarden Business), invite two board members as admins.
9. **Create a district-owned GitHub org.** Recommend the name
   `fandhgolf` if available, `fh-park-rec` otherwise. Owner:
   `admin@fandhgolf.com`.

### Phase 2 — Handover the runtime accounts (BEFORE more features)

The order here matters. Vercel depends on GitHub; Airtable and Resend
are independent. Do GitHub → Vercel → Airtable → Resend so nothing
breaks in the middle.

10. **Transfer the GitHub repo** `mcconnellentllc-cloud/F-HGolf` →
    `<district org>/F-HGolf`. Immediately after transfer: enable
    "Enforce HTTPS" in Pages settings; verify `fandhgolf.com` still
    resolves.
11. **Re-link Vercel to the new repo.** Install the Vercel GitHub App
    on the district org, re-link the `f-h-golf` project's Git source,
    verify auto-deploy on next commit.
12. **Migrate the Airtable base to a district-owned workspace** OR
    change the workspace owner to `data@fandhgolf.com`. Airtable's
    "change base owner" and "move to different workspace" flows are
    both supported. Regenerate `AIRTABLE_TOKEN` under the new owner's
    identity, update Vercel env var, delete the old token from the
    builder's Airtable account.
13. **Regenerate `ADMIN_KEY`.** Update Vercel env, tell the operators
    the new passphrase.
14. **Move Resend account** to `admin@fandhgolf.com` OR retire it.
    Under Step 4 this may be retired entirely — decide first, execute
    second.
15. **Domain + DNS ownership transfer.** If the registrar allows
    changing account holder without a full domain transfer (most do),
    that's the cheapest path. Otherwise initiate a full transfer to a
    district-controlled registrar account. This is the highest-stakes
    step — if the domain lapses during a transfer window the whole
    site goes dark. Do it carefully, in a low-traffic window (winter,
    not August).

### Phase 3 — Write the handover package (before builder steps away)

16. Write every file listed in Step 5 under `docs/`. Cross-link from
    the top-level `README.md`.
17. **Freeze feature work** during the writing period. Every change
    that lands during the handover has to be re-documented.
18. Do a **dry-run session** with the successor: they follow the
    runbook to publish a fake recap, close a fake Calcutta, and rotate
    a fake token, all from the docs alone. Any step they can't
    complete without asking the builder — rewrite that section.

### Phase 4 — Retire personal-email dependencies

19. **Remove every reference to `mcconnellentllc@gmail.com`** from the
    site copy. Two files: `admin.html` and `build-guide.html`.
    Replacement: whichever role-based address the district decides is
    the "how to get access" contact.
20. **Rotate every secret** the builder had access to
    (`AIRTABLE_TOKEN`, `ADMIN_KEY`, `RESEND_API_KEY` if kept,
    Vercel tokens, GitHub PATs if any). Confirm the old values are
    invalid.
21. **Revoke the builder's access** to the district's GitHub org,
    Vercel team, Airtable workspace, Resend account, password vault,
    domain registrar, and DNS provider.
    Leave a warranty window agreed in advance if the district wants
    one — clearly time-boxed.

### Phase 5 — Ongoing (post-handover)

22. Renewal calendar reminders fire per the `renewal-calendar.md`
    schedule.
23. Board rotates the vault admins as terms turn over.
24. Any future rebuild / migration only proceeds under the assumption
    that the current architecture is what it is — no more
    "we can just refactor later" is available after this point.

### Items that get harder the longer they wait

Flagged explicitly. If more features ship before these are done, each
one gets more expensive:

- **Step 15 — domain + DNS transfer.** Every day the domain is on the
  builder's registrar account is another day the district's operations
  depend on the builder paying a personal renewal invoice.
- **Step 10 — GitHub repo transfer.** Every new hardcoded reference to
  `mcconnellentllc-cloud/*` in the code is another find-and-replace
  during the transfer. Grep now, keep the count low.
- **Step 12 — Airtable base ownership.** Every new table schema change
  under the builder's identity is another reason for the district to
  re-enter table permissions after the migration.
- **Step 19 — copy references.** Every new onboarding doc that
  mentions the personal Gmail is another string to rewrite.

Everything else in the sequence is "hard when it happens, but no
harder later." Prioritize the four above.
