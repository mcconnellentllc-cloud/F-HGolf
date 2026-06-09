# F&H Golf Course — Website

A simple, mobile-responsive static website for **F&H Golf Course** in Fleming, Colorado —
a public 9-hole course (par 36, 3,261 yards) between Fleming and Haxtun in eastern Colorado.

Plain HTML/CSS/JS. No frameworks, no build step.

## How to open

Just **double-click `index.html`** — it opens in your default web browser. No server or
install required.

## Structure

```
F-HGolf/
  index.html       Single-page site (nav, hero, stat strip, course, scorecard, rates, location, contact)
  story.html       Full founder's history + audio narration + newspaper archive
  hall-of-fame.html  Founders, builders & volunteers who contributed to F&H
  css/styles.css   All styling (editorial-heritage design via CSS custom properties)
  js/main.js       Smooth-scroll nav, mobile hamburger, nav-scroll elevation
  images/          Logo (logo.svg), newspaper scans; drop hero/course photos here
  audio/           Auto-generated narration (fh-story.mp3) + script
  README.md        This file
```

## Design & assets

- **Type:** Fraunces (display serif) + Source Sans 3 (body), loaded from Google
  Fonts. Colors live as CSS custom properties in `:root` (`css/styles.css`).
- **Color scheme:** green (brand, dominant) + warm white/cream, with
  **charcoal/black** depth (hero overlay, gallery, footer) and a **crimson-red**
  accent (eyebrows, rules, borders, primary CTA, stat-strip edge).
- **Logo:** `images/logo.png` is the real F&H logo (golf ball + flag + "F&H"),
  shown in a white emblem chip in the nav and footer. Drop a replacement at the
  same path to swap it. (`images/logo.svg` is the earlier original crest, kept as
  an alternate.)
- **Hero photo:** `images/hero.jpg` (course sunset) sits under a cinematic dark
  overlay. If the file is ever removed, the hero falls back to a green gradient.
- **Gallery & band:** the "On the Course" gallery uses `images/course-sunset.jpg`,
  `course-dusk.jpg`, and `course-night.jpg`; the immersive quote band uses
  `images/band.jpg`. These were built from community photos (low-resolution
  ~206 px) — replace with higher-resolution originals at the same paths for a
  crisper result.

## TODO — placeholders to confirm

These values are placeholders in the code. Search for the word `PLACEHOLDER` in
`index.html` to find them quickly.

- [ ] **Scorecard pars** — per-hole pars (4,4,3,4,5,4,3,4,5) are a placeholder layout
      that sums to par 36. Confirm actual per-hole pars.
- [ ] **Hours / Season** — currently "April 1 – September 1". Confirm season + daily hours.
- [ ] **Cart fee** — currently "$14". Confirm current rate.
- [x] **Green fees** — 9 holes $19 / 18 holes $32 (from the course's Scan-to-Pay notice).
- [ ] **Photos (resolution)** — the hero/gallery/band photos are low-res (~206 px) community images; replace with higher-resolution originals at the same paths for a sharper result.
- [ ] **Founder names** — confirm spellings of founder names in the "Our Story" section.
- [ ] **Audio (optional)** — replace `audio/fh-story.mp3` with a family/Willard human recording.
- [ ] **Lease article date** — the "Fleming Agrees to Lease F&H" clipping is undated; confirm the year if known.

## Content Sources

The "Our Story" section and founding timeline are public history derived from
*The Story of F&H Golf Course* by founder Willard Hart.

`story.html` holds the complete founder's account in full, published with the
family's blessing, and is linked from the "Our Story" section via the
"Read the Full History" button.

`audio/fh-story.mp3` is an **auto-generated** narration of the full story
(created with the free, offline Piper TTS voice *en_US-ryan-high*). It can be
replaced later with a human recording — keep the same filename
(`audio/fh-story.mp3`) and it's a drop-in swap with no HTML changes.
`audio/narration.txt` is the lightly-normalized script used to generate it.

The "From the Archives" section on `story.html` reproduces vintage newspaper
articles in an old-timey newspaper style, alongside the original scanned
clippings:
- "Grass Greens Being Considered" (Feb. 21, 1985) — `images/grass-greens-1985.jpg`
- "Snow May Fly, But It's Green at F&H" (*Journal-Advocate*, Nov. 21, 1987),
  with the pipe-trenching photo — `images/trenching-1987.jpg`,
  `images/snow-green-1987-p1.jpg`, `images/snow-green-1987-p2.jpg`
- "Fleming Agrees to Lease F&H" (undated) — `images/fleming-leases-fh.jpg`
- "Summer Fun Means Fairway Fun" (*Platte Valley Edition*, May 28, 2000) —
  only the Fleming-Haxtun portion of this regional feature is reproduced; the
  sign photo (`images/fh-sign-2000.jpg`) and course-layout diagram
  (`images/fh-layout-2000.jpg`) are included. References to other-town courses
  were intentionally omitted at the owner's request.

Proper-noun spellings follow the original newspaper text (e.g. "James
McPhilomy," "Heginbotham Estate," "Samm Vandenbark").

> ⚠️ **DO NOT publish financial-history figures, lender names, or member contribution
> amounts — those records are internal only.**

## Facebook

The Contact section has a styled **"Follow F&H on Facebook"** card (icon, blurb,
and a "Visit our Facebook Page" button to <https://www.facebook.com/fandhgolf/>).
This card is the guaranteed-working baseline and always shows.

Below it, an **optional** live feed uses Meta's official Page Plugin. It is an
enhancement only: the SDK loads asynchronously and the feed stays hidden unless
JavaScript confirms the plugin actually rendered (a real iframe mounts within a
few seconds). If Meta's widget is blocked, the page isn't embeddable, or it comes
up empty, the feed **auto-hides** and visitors simply see the follow card — never
a broken or blank box. No tracking pixel, no Facebook Login.

## Pay for Play (QR)

The Rates section has a **"Pay for Play"** block with a QR code and a **Pay Online**
button. The QR (`images/pay-qr.png`) was **regenerated from the course's own
Scan-to-Pay code** — decoded to its Deposyt hosted-payment URL, then re-encoded at
high resolution so it always scans cleanly. The button links to the same URL, so
phone users can simply tap instead of scanning.

If the course's payment link ever changes, update both the button `href` in
`index.html` and regenerate `images/pay-qr.png` from the new URL.

## Hall of Fame

`hall-of-fame.html` honors the founders, builders, and volunteers behind F&H
(sourced from Willard Hart's account and the local press). Each person currently
shows an **initials medallion** placeholder.

**To add a real photo:** drop a square image in `images/hof/` (e.g.
`images/hof/willard-hart.jpg`) and, in `hall-of-fame.html`, replace that person's
`<div class="hof__avatar">WH</div>` with:

```html
<img class="hof__photo" src="images/hof/willard-hart.jpg" alt="Portrait of Willard Hart" />
```

The image is cropped to a circle automatically. Send photos and I'll wire them in.

## Hall of Fame nominations

`nominate.html` is a public form to nominate Hall of Fame members. It submits to
`api/nominate.js`, a **Vercel serverless function** that writes a record to
Airtable. This feature only works on the **Vercel deployment** (GitHub Pages
can't run serverless functions).

Required Vercel **Environment Variables**:

| Key | Value |
| --- | --- |
| `AIRTABLE_TOKEN` | Airtable personal access token with `data.records:write` |
| `AIRTABLE_BASE_ID` | the base id (e.g. `appAwEdD9m6OVN6lg`) |
| `AIRTABLE_TABLE` | the table **name** (`Hall of Fame Nominations`) |

The function writes to these Airtable fields: `Nominee Name`, `Contribution`,
`Era / Years at F&H`, `Role`, `Nominated By`, `Submitter Email`,
`Submitter Phone`, `Status` (set to `New`). Keep these field names in sync with
the table. Includes a honeypot anti-spam field and graceful error handling.

## Staff portal

`admin.html` is a hidden staff launcher (review nominations, payments, GitHub,
Vercel, Facebook + how-tos). It's reached by clicking the **F&H crest in the
footer** of any page, and gated by a client-side password (in `admin.html`).

The portal lists **submitted nominations** in-page (newest first) via
`api/nominations.js`, a read-only Vercel function. It requires the Airtable
token to also have the **`data.records:read`** scope, plus a Vercel env var
**`ADMIN_KEY`** (set it to the staff password) — the portal sends that key so the
list (which can include submitter contact info) is never publicly exposed.

Note: a password in a static page is a **soft gate** — it keeps casual visitors
out, but is visible to anyone who views source. Real security is that each
linked tool (Airtable, Deposyt, Vercel, GitHub) has its own login. To change the
password, edit `PASS` in the script at the bottom of `admin.html`. The page is
also marked `noindex`.

## Tournaments

`tournaments.html` shows the 2026 schedule and a **sign-up form**. Sign-ups go to
Airtable and appear in the Staff Portal:
- `api/tournament-signup.js` (POST) — writes a registration with `Status = "New"`.
- `api/tournament-signups.js` (GET, admin-key protected) — feeds the portal's
  "Tournament Sign-ups" panel.

**Setup:** create an Airtable table named **`Tournament Signups`** in the same base
with fields: `Player Name` (text), `Tournament` (single select or text),
`Email` (email), `Phone` (phone), `Team / Partners` (long text), `Carts`
(number), `Notes` (long text), `Status` (single select: New, Confirmed, Paid,
Cancelled), `Submitted At` (created time). The form also remembers a returning
golfer's name/email/phone in their own browser (localStorage) to autofill. Override the table name with the optional `TOURNAMENTS_TABLE`
Vercel env var. Uses the same `AIRTABLE_TOKEN` / `AIRTABLE_BASE_ID` / `ADMIN_KEY`.

## Reviews

`reviews.html` shows: real public reviews (Cam Crabtree @cam_pga's Instagram
"hidden gem" video, a 5★ Yelp quote, a Golf Digest panelist quote, with links to
the listing sites), **community reviews** submitted on-site, and a star-rating
**Leave a Review** form.

Submitting/displaying uses two Vercel functions + a separate Airtable table:
- `api/review-submit.js` (POST) — writes a review with **Status = "Pending"** (so
  nothing publishes until staff approve it).
- `api/reviews.js` (GET, public) — returns only **Status = "Approved"** reviews and
  safe fields (name, rating, text, date) — never email.

**Setup:** create an Airtable table named **`Reviews`** in the same base with
fields: `Reviewer Name` (text), `Rating` (number 1–5), `Review` (long text),
`Email` (email), `Status` (single select: Pending, Approved, Hidden),
`Submitted At` (created time). The functions default to a table named `Reviews`;
set the optional Vercel env var `REVIEWS_TABLE` to override. To **publish** a
review, set its Status to **Approved** (do it in Airtable, or via the Reviews
card in the Staff Portal).

## Reference details

- Phone: (970) 774-6362
- Address: 43355 County Rd 30, Fleming, CO 80728
- Facebook: https://www.facebook.com/fandhgolf/
- Map center: lat 40.643101975582, lng -102.7566068238
