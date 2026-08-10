# Calcutta receipt email — scoping report

Research-only recommendation for adding admin-triggered Calcutta receipt
emails. No code has been changed as part of this report. Outbound only —
inbound email is out of scope.

Use case: after a Calcutta closes, the admin sends each buyer a personal
receipt listing every team that buyer bought and the amount. Two trigger
modes: **one buyer on demand**, and **all buyers at once, one personalized
email per buyer**. Volume is bursty and small: a handful of tournaments a
year, ≤50 receipts per event.

---

## Step 1 — Inventory

### a. Data persistence

**Backend of record is Airtable, reached through Vercel serverless
functions.** GitHub Pages is a static host and never touches data.

- Static site at `fandhgolf.com` is GitHub Pages
  ([`CNAME`](../CNAME) contains `fandhgolf.com`; no `vercel.json` /
  `netlify.toml` at the repo root).
- Serverless functions live in [`api/`](../api) and are deployed to
  Vercel at `f-h-golf.vercel.app`. Routing is handled by
  [`js/api.js`](../js/api.js) at lines 8–15: when the browser is on any
  hostname that is not `*.vercel.app` / localhost, all API calls are
  prefixed with `https://f-h-golf.vercel.app`. GitHub Pages therefore
  serves HTML/CSS/JS only, and the admin workbook cross-origins its
  writes into the Vercel deployment.
- Every serverless function is a thin proxy in front of the Airtable REST
  API. Confirmed by grepping `AIRTABLE_TOKEN` / `AIRTABLE_BASE_ID` in
  every file under `api/`. Example — the Calcutta write path is
  `POST /api/tournament-checkin` in
  [`api/tournament-checkin.js`](../api/tournament-checkin.js) lines
  86–95, which sets `fields["Buyer"]` and `fields["Buy Amount"]` on the
  Tournament Signups record.

**Server-side send is therefore already possible today** — Vercel is
where we host the transactional secret. No new infrastructure needs to
stand up before receipts can go out.

### b. Admin authentication

- Login page: [`admin.html`](../admin.html). Enter passphrase → written
  to `sessionStorage` as `fh_admin_key` + `fh_admin_ok` (see
  `admin.html` lines 273–274, 507).
- Workbook page: [`tournament-admin.html`](../tournament-admin.html)
  reads those keys on load (lines 682–686) and sends the passphrase
  back with every admin call as the `x-admin-key` header.
- Every mutating API function validates that header against the
  `ADMIN_KEY` env var. Example:
  [`api/tournament-checkin.js`](../api/tournament-checkin.js) line 34.

**URL reachability.** Both `admin.html` and `tournament-admin.html` are
served by GitHub Pages at guessable paths (`fandhgolf.com/admin.html`,
`fandhgolf.com/tournament-admin.html`). The pages render, but nothing
useful happens until the passphrase is entered — the API rejects every
write without a matching `x-admin-key`. Any receipt-send endpoint we add
must enforce the same `x-admin-key` check.

### c. Calcutta buyer data structure

Buyers **do not have their own table**. They live on the `Tournament
Signups` (Airtable) record for the team that was bought.

Per-team buyer fields, from
[`api/tournament-checkin.js`](../api/tournament-checkin.js) lines 86–99:

| Airtable field       | Type        | Notes                                     |
| -------------------- | ----------- | ----------------------------------------- |
| `Buyer`              | Single line | Free-text buyer name (max 120 chars)      |
| `Buy Amount`         | Currency    | Numeric, ≥ 0                              |
| `Calcutta Paid`      | Single line | Payment method: Cash / Check / Card / Online (max 20 chars) |
| `Calcutta Check #`   | Single line | Check number when paid by check           |

A single physical person often buys several teams, so the "buyer" as a
domain concept is derived by grouping records where `Buyer` matches
case-insensitively. That grouping already happens in
[`tournament-admin.html`](../tournament-admin.html) `renderCalcuttaSummary`
around lines 4691–4762.

**No email field for buyers exists.** There is no `Buyer Email` field on
Tournament Signups; `Email` on that record belongs to the *team's player*,
not to whoever bought that team.

### d. Existing serverless / backend / Actions

- Serverless: yes, 13 functions in `api/`. All routed through
  `js/api.js` which points at Vercel.
- Third-party backends: Airtable (data), Deposyt (payments; hosted form
  URL in [`js/api.js`](../js/api.js) line 20), Resend (transactional
  email; see below).
- GitHub Actions: none — no `.github/` directory in the repo
  (`ls .github` returns "No such file or directory").
- **A transactional-email pipeline already exists.** Signup confirmations
  are sent from [`api/tournament-signup.js`](../api/tournament-signup.js)
  via `POST https://api.resend.com/emails` (lines 43–71). Resend keys and
  the `From` address are already provisioned. Reusing that pipeline is a
  small delta rather than a new integration.

### e. Existing secrets

Reporting presence only, no values.

**In the repository.** None. `.gitignore` includes only `models/`. There
is no `.env`, `.env.example`, or committed config file with secrets.

**In Vercel environment variables** (inferred from `process.env` reads
across `api/`):
- `AIRTABLE_TOKEN` — Airtable personal access token.
- `AIRTABLE_BASE_ID` — the Airtable base UID.
- `ADMIN_KEY` — the shared admin passphrase.
- `RESEND_API_KEY` — transactional email API key (already used by
  `api/tournament-signup.js`).
- `RESEND_FROM` — optional; defaults to
  `F&H Golf <noreply@fandhgolf.com>`.
- Table-name overrides: `TOURNAMENTS_TABLE`, `CONFIG_TABLE`,
  `PLAYERS_TABLE`, `REVIEWS_TABLE`, `AIRTABLE_TABLE` (Hall of Fame).

**In GitHub Actions secrets.** None — no workflows exist to hold them.

---

## Step 2 — Email address capture

This is the real blocker.

### Current state

Buyer email addresses **do not exist anywhere in the data**. The only
`Email` field on `Tournament Signups` belongs to the team's player, not
to the person who bought the team in the Calcutta. A buyer who did not
also play has no email on file.

### What it would take to add an email field

The Calcutta tab already renders per-team buyer inputs. Adding email
capture is a well-shaped change and can happen in one sprint:

1. **Airtable schema.** Add a `Buyer Email` single-line-text field on
   Tournament Signups. The auto-strip retry pattern already in
   `api/tournament-checkin.js` (lines 113–142) means the endpoint will
   keep working the moment the field appears — no code has to ship first.
2. **API surface.** `api/tournament-checkin.js` currently maps
   `body.buyer` → `Buyer`, `body.buyAmount` → `Buy Amount`. Add a
   `body.buyerEmail` → `Buyer Email` line right below (~5 lines).
3. **Admin UI.** The Calcutta tab (`renderCalcutta` /
   `renderCalcuttaSummary` in `tournament-admin.html`) needs one more
   input per buyer group. Simplest UX: on the **Calcutta Buyers** tab
   (which already groups by buyer name), one email input per buyer card.
   Filling in that input writes the same email onto every team that
   buyer bought.
4. **Backfill for existing buyers.** The `Bulk import` button we
   already ship on the Calcutta tab (paste `Team, Buyer, Amount`) can be
   extended to accept `Team, Buyer, Amount, Email` in the same flow.
5. **Optional link to signup emails.** For buyers who also played, an
   autofill can pre-populate the buyer email from their own signup
   record — one lookup by name match.

### Buyers with no address on file

- **Skip silently.** The send-all flow reports something like
  "45 receipts queued, 5 buyers have no email on file — export as PDF
  instead?" — printing a paper receipt for those five is already
  supported today via the browser's Print dialog on the Calcutta Buyers
  tab (`printBuyersList`).
- **Prompt on send.** Alternative: the one-buyer send button opens a
  modal that prefills the address if one exists and lets the operator
  type one in on the spot, saving it back onto the buyer's team
  records before sending.
- **Never fabricate.** Do not use a fallback like
  `no-reply-<slug>@fandhgolf.com`. Every attempted send needs a real
  address or must be explicitly skipped.

---

## Step 3 — Send mechanism options

### Disqualified: API key in client-side JS

Any option that embeds a transactional-email API key in the browser is
**disqualified**. The admin site is static and served from GitHub Pages;
JS shipped to the browser is world-readable. Anyone hitting
`view-source:` on `tournament-admin.html` would be able to send email
from `noreply@fandhgolf.com` at whatever volume the key permits. Not
listed as a tradeoff — it's out.

### Qualifying options

**Option A. Reuse the existing Vercel serverless + Resend pipeline (recommended).**
- **Where the secret lives:** Vercel env var `RESEND_API_KEY`, already
  present and already used by `api/tournament-signup.js`.
- **How it works:** Add a new endpoint
  `POST /api/calcutta-receipt` behind the same `x-admin-key` check.
  Body: `{ signupId }` for one buyer, or
  `{ tournament, buyerName }` for a whole buyer's basket, or
  `{ tournament, all: true }` for all buyers. Endpoint fetches the
  Airtable rows, renders the HTML receipt, calls Resend the same way
  `sendConfirmationEmail` in `tournament-signup.js` already does.
- **Cost:** Resend free tier is 3,000 emails / month and 100 emails /
  day. Both modes fit inside the free tier at this volume by a factor
  of ~50. If the free tier is ever exceeded, next tier is Pro at $20 /
  month for 50,000 emails / month. Airtable calls are unchanged.
- **Setup effort:** ≤ 6 hours end to end — endpoint, admin buttons,
  HTML template, per-buyer send loop with 200 ms spacer to stay under
  Resend rate limits.
- **Deliverability:** unchanged from today's confirmation flow (see
  Step 4). No new DNS work if the current signup confirmation
  deliverability is acceptable.

**Option B. GitHub Actions workflow triggered from the admin.**
- **Where the secret lives:** GitHub Actions secret (would need to be
  provisioned — none exist today; see Step 1e).
- **How it works:** Admin clicks Send → a POST to
  `api.github.com/repos/mcconnellentllc-cloud/F-HGolf/actions/workflows/send-receipts.yml/dispatches`
  with a payload naming the tournament / buyer. The workflow reads
  Airtable, sends via Resend / SES / etc. Requires a GitHub PAT with
  workflow scope, either in Vercel env (defeats the point) or in a
  personal browser session (fragile).
- **Cost:** GitHub Actions minutes on public repos are free.
- **Setup effort:** ≥ 10 hours. New auth surface (PAT rotation), new
  concurrency semantics, no live progress in the admin UI without
  polling the workflow-run API, and any hiccup lands in Actions logs
  instead of the admin. Strictly worse than reusing the Vercel
  pipeline.

**Option C. Hosted form/email service with no custom backend.**
- Services: Formspree, Formsubmit, EmailJS, Getform, etc.
- **Where the secret lives:** the vendor. But the vendor's protocol
  requires either an endpoint key that lives in client JS
  (disqualified — see above), or a webhook target that only accepts
  form submissions (not per-recipient personalized send loops).
- Not viable for per-recipient receipts because these services don't
  offer a "send arbitrary email to arbitrary recipient" primitive
  under a secret. Best they can do is CC the operator on a
  confirmation, which is the wrong direction.

### Summary table

| Option | Secret location | Cost | Setup | Fit |
| ------ | --------------- | ---- | ----- | --- |
| A. Vercel + Resend | Vercel env (present) | $0 | ~6 h | **Best** |
| B. Actions | Actions secret (would need) | $0 | ~10 h | Worse |
| C. Hosted service | vendor | $0–$$ | ~4 h | Doesn't fit the shape |

---

## Step 4 — Deliverability

### DNS on fandhgolf.com

I do not have DNS lookup tools from this environment. The following are
requirements Resend imposes on every sending domain — verify with a
`dig fandhgolf.com TXT` / `dig <selector>._domainkey.fandhgolf.com` from
your machine or the Resend dashboard.

- **SPF** — needs `include:_spf.resend.com` (or the vendor's equivalent)
  in the SPF TXT record on `fandhgolf.com`. If the domain is currently
  sending signup confirmations without one, either the messages are
  landing in spam already or Resend is signing with its own return path
  domain.
- **DKIM** — Resend provisions a DKIM key when the domain is added to
  the Resend dashboard. Two CNAME records (`resend._domainkey.fandhgolf.com`
  and a second one Resend assigns) need to exist. The signup confirmation
  flow already works, so this is likely already set up. Confirm in the
  Resend dashboard → Domains before assuming.
- **DMARC** — a `_dmarc.fandhgolf.com` TXT record at policy `p=none`
  (monitor mode) is enough to be safe and gets aggregate reports. `p=quarantine`
  is fine for a transactional-only domain once SPF and DKIM are aligned.

**Concrete check to run:** in the Resend dashboard, `fandhgolf.com`
should show a green "verified" status. If it doesn't, add the records
Resend prescribes before scoping the send loop; otherwise receipts will
land in spam.

### From / Reply-To

- **From:** `F&H Golf Calcutta <calcutta@fandhgolf.com>` or reuse the
  existing `F&H Golf <noreply@fandhgolf.com>`. A dedicated
  `calcutta@` mailbox is easier to filter on inbound (which is out of
  scope) but harmless to reserve now.
- **Reply-To:** must point at a real inbox someone monitors.
  Recommendation: `fandhgolfcourse@gmail.com` — that address is
  already published as the course's contact address on the site
  ([`index.html`](../index.html) contact block), so replies routing
  there don't add any new inbound handling burden.

### CAN-SPAM / unsubscribe

These receipts are **transactional messages sent to people who
transacted**. Under CAN-SPAM (US), transactional email — content whose
primary purpose is to confirm a completed transaction, provide
warranty/safety information, deliver information about an existing
account, etc. — is exempt from the unsubscribe requirement and from
the marketing-email content rules.

Recommendations regardless:

- Include a **physical mailing address** for the course
  (`43355 County Rd 30, Fleming, CO 80728`, already on the site
  footer). Free, prevents any borderline case from tripping the rule.
- Include a plain-text line like *"You are receiving this because you
  purchased a team in the F&H Golf Calcutta at the 2026 Founder's
  Tournament."* — makes the transactional purpose explicit if a
  recipient forwards to their spam filter provider.
- No unsubscribe link required. Do not add one to a receipt — it
  invites confusion ("did I unsubscribe from a receipt of a payment I
  owe?").

---

## Step 5 — Receipt content and privacy

### Privacy: email body only, no public URL

The receipt names a specific buyer and their dollar amounts. **It must
not be reachable at any public or guessable URL.**

- **Deliver the receipt in the email body.** HTML + plain-text
  multipart, self-contained.
- **Do not host a public "view online" page.** The pattern used by
  bulk vendors ("this receipt didn't render? click here") is the wrong
  fit — the URL leaks the buyer's identity and total. If a hosted
  view is genuinely needed later, it MUST be behind a per-message
  opaque token (≥ 128 bits of entropy), stored in Airtable against the
  buyer's record, verified server-side, and expired after 30 days.
- **The existing `founders-calcutta-display.html` public page already
  strips buyer names + amounts** (see
  [`api/tournament-signups.js`](../api/tournament-signups.js) line 21,
  `PUBLIC_FIELDS`) — that design constraint carries over to receipts.

### Proposed layout

Plain email, single-column, no images beyond the F&H logo.

```
F&H Golf Course
2026 Founder's Tournament · Aug 8–9

Calcutta Receipt for Casey Goddard

Purchases

  T-06  Mike Foor / (partner)          $375
  T-27  Brian Lock / (partner)         $375
  T-64  Jason Koberstein / (partner)   $500
  T-68  Don Nolin / (partner)          $500

  Total                                $1,750

Payment status: Paid — Check
Check #: 2071

You are receiving this because you purchased teams in the F&H Golf
Calcutta at the 2026 Founder's Tournament. Questions? Reply to this
email or call the course at (970) 774-6362.

F&H Golf Course · 43355 County Rd 30 · Fleming, CO 80728
```

### Should winnings appear on the receipt?

**No, not on the receipt itself.** Recommend a separate "Payout notice"
email flow if that's ever wanted. Reasons:

1. **Timing.** Buyers pay before Day 1. Winnings are known only after
   Day 2 finishes. The receipt is a pre-tournament document; folding
   post-tournament data into it would delay its send by ~24 hours or
   require re-sending an updated copy.
2. **Ownership.** Payouts are a separate money movement the tournament
   account handles — that has its own paper trail (Calcutta Check #
   already on Signups). Mixing purchase and payout into one document
   makes reconciliation harder for the treasurer.
3. **Scope creep risk.** A payout notice needs to render for buyers
   with zero winning teams too ("Thanks for playing — no payout this
   year"), which changes the audience calculus. Keep the two flows
   apart so the receipt shape stays tight.

---

## Step 6 — Recommendation

**Recommended path: Option A — new
`POST /api/calcutta-receipt` endpoint on Vercel, sending through the
existing Resend integration.**

Reasoning:
- The transactional-email pipeline already exists and works. Reusing it
  is the smallest safe change: Resend key already provisioned, DKIM
  either already configured or one dashboard action away, `From`
  address already reserved, HTML render helper pattern already in
  `sendConfirmationEmail`.
- Every alternative either shares the same underlying vendor with more
  moving parts (GitHub Actions) or violates the client-side-secret
  disqualification (hosted email services).
- Cost is $0 at every foreseeable volume for this use case.

**Fallback if Resend is ever deprecated / rate-limited:** swap the
provider (SES, Postmark) behind the same endpoint. That's a 1-hour
change touching one file.

### Rough effort — Option A

| Piece | Effort |
| ----- | ------ |
| Airtable schema: `Buyer Email` field on Tournament Signups | 5 min |
| `api/tournament-checkin.js`: accept `buyerEmail`, write to `Buyer Email` | 15 min |
| Admin Calcutta Buyers tab: per-buyer email input + save-on-blur | 60 min |
| `api/calcutta-receipt.js`: new endpoint, single-buyer + bulk modes, x-admin-key check, Airtable read, HTML render, Resend send | 2.5 h |
| Admin buttons: **Send receipt** on one buyer card + **Send all** in the tab header, with modal confirmation | 60 min |
| HTML/text receipt template + course logo inline | 45 min |
| Manual verify: DKIM green in Resend dashboard, one test send to a personal address, one bulk test to two addresses | 30 min |
| **Total** | **~ 5.5 h** |

### Preconditions before any code is written

1. **Confirm `fandhgolf.com` is verified in Resend.** SPF + DKIM +
   DMARC records visible and green in the Resend dashboard. If not,
   fix DNS first — sending code without deliverability is worse than
   not sending. 15 minutes if records are already there; up to a few
   hours propagation if not.
2. **Confirm the send-from address.** Either reuse
   `noreply@fandhgolf.com` (already in `RESEND_FROM` default) or
   provision `calcutta@fandhgolf.com`. Decide before writing the
   template.
3. **Confirm reply routing.** Reply-To goes to
   `fandhgolfcourse@gmail.com` unless someone else on the board
   wants replies.
4. **Add the `Buyer Email` field on Airtable.** The auto-strip retry
   pattern means the API keeps working the moment the field appears;
   no code has to ship in advance. But the admin can't collect
   emails until the field exists.
5. **Decide on the "no email on file" behavior.** Silent skip with a
   summary count is the recommended default; if the operator wants
   the "prompt to enter one at send time" behavior instead, the modal
   design gets an extra state.

Once those five are settled, the code lands in one sitting and the
receipts can go out for the next Calcutta.
