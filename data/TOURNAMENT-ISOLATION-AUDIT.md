# Tournament Isolation Audit (read-only)

**Purpose.** Trace every place tournament data enters, is stored, or is
rendered so the next step (a refactor to per-tournament directories and
namespaced storage) has a complete map. **Nothing in this branch changes
behavior.** Only this file is created; no other file is touched.

**Trigger.** On the live-scoring page for the not-yet-played Haxtun Fire
tournament, an unrelated Couples player (Jim Meeker) appeared as attester
on an Ashton Williams scorecard. That is data from a different tournament
leaking into a tournament that has not started. This audit lists every
mechanism that can cause that class of bleed-through.

**Method.** Read-only grep over every `.html`, `.js` under this repo.
Findings are cited by `file:line`. Nothing was executed and no data
sources (Airtable, localStorage on any device) were mutated.

---

## 1. Shared data files (checked-in JSON under `data/`)

Only two data JSON files ship in the repo, plus one printer reference and
two Markdown reviews. **No `founders-tournament-scores.json` exists in
the current tree** — see §6 for the risk this represents.

| File | Consumed by | Notes |
| --- | --- | --- |
| `data/founders-tournament.json` | `tournament.html:458` only | Founders 2026 AM/PM flights; teams as `{n, players:["Foor","Burton"]}`. Not read by any other page. |
| `data/founders-2026-highlights.json` | `tournament.html:453`, `founders-recap.html:214` | Founders 2026 highlight card. `publish=true` gate. |
| `data/staff-printer.json` | `admin-printer.html:332` only | Printer reference sheet. Tournament-agnostic. |
| `data/founders-2026-am-REVIEW.md` | none (documentation only) | |
| `data/founders-tournament-REVIEW.md` | none (documentation only) | |

**Observation.** There is no `data/tournaments/` directory today. Founders
data is loose in `data/` under Founders-specific filenames, and Couples /
Fire / F&H Scramble have no checked-in data at all — those tournaments
live entirely in Airtable + localStorage. That asymmetry is itself a
cross-contamination hazard: any page that reads a `founders-*.json` file
does so unconditionally (no tournament-id gate), so a future
`tournament.html?t=Haxtun%20Fire...` visit still fetches Founders JSON at
line 458.

**Not-lost check.** Nothing in the current tree looks like the F&H
Scramble final leaderboard either. See §6 (Blast radius) for the
question this raises before Step 2.

---

## 2. Storage keys (`localStorage` / `sessionStorage`)

Every `localStorage` / `sessionStorage` call in the repo (excluding
server-side comments in `api/`). "Namespaced" means the string embeds
the tournament KEY. "Shared" means the same key is used across all
tournaments — those are the leak vectors.

### 2a. Namespaced by tournament KEY (safe today)

| Key template | File:line | Purpose |
| --- | --- | --- |
| `"fh:ciFilters:" + KEY` | `tournament-admin.html:4565` | Check-In filter state |
| `"fh:prDay:" + KEY` | `tournament-admin.html:5738` | Print-day filter |
| `"fh_slots_" + KEY + "_" + wave` (`slotsKey()`) | `tournament-admin.html:6779` | Wave slot assignments |
| `"fh_calc_" + KEY` (`CALCK`) | `tournament-admin.html:11000` | Calcutta local scratch |
| `"fh_cuts_" + KEY` (`CUTK`) | `tournament-admin.html:8665` | Cut markers |
| `"fh_wb_tab_" + KEY` | `tournament-admin.html:11360` | Last active workbook tab |
| `"fh_ca_auction_" + KEY` | `tournament-admin.html:11869` | Auction clerk scratch |
| `"fh_staff_token::" + tournamentKey` | `tournament-admin.html:1213` | Staff auth per tournament |
| Buyer-email cache (`buyerEmailCacheKey()`) | `tournament-admin.html` | Auction buyer email cache |

### 2b. Shared / NOT namespaced (leak vectors)

| Key | File:line | What leaks | Consequence |
| --- | --- | --- | --- |
| `"fh_player_token"` (`LS_TOKEN`) | `score-round.html:147`, `player.html:357` (as `LS_KEY`) | The **magic-link token** identifying the player | A device that scored in one tournament stays "signed in" as that same player when opening `score-round.html` for a second tournament. This is the direct cause of Jim Meeker (Couples) appearing on Ashton Williams' Fire card. |
| `"fh_round_draft_v1"` (`LS_DRAFT`) | `score-round.html:148` | In-flight round scores (holes, tees, course, notes) | An abandoned Couples round can be *offered to resume* when the same device opens Fire scoring 12h later (`score-round.html:213`). |
| `"fh_golfer"` (`GKEY`) | `tournaments.html:296` | Golfer identity for sign-up prefill | Autofills a sign-up form for the wrong tournament as that golfer. Low harm but confusing. |
| `"fh:tmSeason"` (`_tmSeasonKey`) | `admin.html:955` | Season filter in Staff Portal | Not a data leak, but persists across tournaments; noted for completeness. |
| `"fh:prPaperSize"` | `tournament-admin.html:8169, 8180` | Print paper preset | Operator preference; tournament-agnostic by design. Documented, not flagged. |
| `"fh:lastCheckNumber"` | `tournament-admin.html:10398, 10449` | Last physical check number written | Tournament-agnostic by design (same checkbook). Documented, not flagged. |
| `"fh:calcuttaBuyersStatus"` | `tournament-admin.html:9304, 9308` | Calcutta buyers status collapse | **NOT namespaced** — Calcutta buyers status persistence is shared across tournaments. Flag: any Calcutta uses this. |

**Auth reads** (`admin-people.html:148`, `admin-printer.html:164`) use a
generic `_readAuth(k)` helper that pulls whatever key the caller names —
they inherit their caller's namespacing decision.

`js/api.js` does not touch `localStorage`.
`api/tournament-flights.js` and `api/player-card.js` only mention
`localStorage` in *comments* — no server-side storage.

---

## 3. Seed / demo / placeholder data hardcoded in the source

Any array of scores, teams, players, or par values baked into the code.
Every one of these must go before Step 2 completes — an empty tournament
must render empty.

| Location | Value | Why it's a leak |
| --- | --- | --- |
| `tournament-admin.html:2615` | `PARS9_PP = [4,3,4,4,5,4,4,3,5]` | F&H par; assumed for every tournament. Fire course/par is TODO (see §6). |
| `tournament-admin.html:5540` | `PAR9 = [4,3,4,4,5,4,4,3,5]` | Same. |
| `tournament-admin.html:5541` | `PARS = PAR9.concat(PAR9)` | 18-hole assumption baked in. |
| `tournament-admin.html:11001` | `CALC_DEFAULTS = { entryPP: 120, greenFeePP: 20, mealPP: 30, cartRentalFee: 22, extraMealFee: 10, surchargePct: 4, handicapMultiplier: 0.8, flights: 4, flightSplit: [50,30,20], calcuttaCommission: 10, calcuttaSplit: [40,30,20,10], pars: [4,3,4,4,5,4,4,3,5,4,3,4,4,5,4,4,3,5] }` | Founders-shaped defaults applied to any tournament that has no saved Calcutta config. Fire entry-per-player is $100 (user stated); this seeds $120. |
| `live.html:494` | `PARS9 = [4,3,4,4,5,4,4,3,5]` | Fire scoring assumes F&H par. |
| `score-round.html:153` | `PARS9 = [4,3,4,4,5,4,4,3,5]` | Player self-score assumes F&H par. |

**No hardcoded team rosters, player names, or scores** were found by
grep. `Ashton`, `Meeker`, `Jim Meek` return **zero** matches in HTML/JS.
That confirms the Ashton/Meeker cross-tournament event was a **runtime**
leak (via `fh_player_token`, §2b) — not a checked-in placeholder.

**Confirmed empty of demo data.** `leaderboard.html`, `auction.html`,
`sponsor.html`, `live.html`, `tournament-rules.html`, `recap.html` do
not contain hardcoded team lists or scores.

---

## 4. Global window/module state that survives navigation

| Global | Set in | Read in | Risk |
| --- | --- | --- | --- |
| `window.FH_TMETA` | `js/tournaments.js:111` (populated by shared script) | `tournament-admin.html:1315`, `admin.html` cards | The tournament registry. Correct for shared use, but every consumer must key off `param("t")` — see §5 for pages that don't. |
| `window.__fhActive` | `tournament-admin.html:2079, 6227, 6341, 11363` | Same file | Which workbook tab is active. Confined to `tournament-admin.html`. Not cross-tournament. |
| `window.FH_API` | `js/api.js` | All pages that call the API | Constants only. |

No page-level JS caches (`window.__lastTeams`, module-level `let teams
= []`, etc.) were found that persist across a `<link>` navigation
between two `?t=` values.

---

## 5. Cross-imports and cross-page contamination

### 5a. Shared scripts (imported by many pages)

All pages import from `js/`:

- `js/api.js` — API URL helper. No state.
- `js/main.js` — nav / theme boot.
- `js/tournaments.js` — the `FH_TMETA` registry (source of truth for
  tournament identity strings).
- `js/theme-fire.js` — applies `body.theme-fire` when
  `?t=Haxtun%20Fire...`.
- `js/tournament-rules.js` — rules markup for `tournament-rules.html`
  and the Rules tab on `live.html`.

None of the above holds tournament-scoped state. `theme-fire.js`
correctly *derives* its behavior from the URL parameter.

### 5b. Hardcoded KEYs — pages pinned to one specific tournament

These pages have no `?t=` reader; they will always show the tournament
whose KEY is baked into the source:

| File:line | Hardcoded KEY | Risk on refactor |
| --- | --- | --- |
| `couples-leaderboard-display.html:188` | `"Couple's Tournament (Aug 22)"` | Correct today; must move to a `TOURNAMENT_ID = 'couples-2025'` constant. |
| `founders-recap.html:97` | `"Founder's Tournament (Aug 8–9)"` | Same — move to `founders-2026`. |
| `founders-flights.html:111` | `"Founder's Tournament (Aug 8–9)"` | Same. |
| `founders-calcutta-display.html:248` | `"Founder's Tournament (Aug 8–9)"` | Same. |
| `founders-leaderboard-display.html:214` | `_tParam \|\| "Founder's Tournament (Aug 8–9)"` | Falls back to Founders when `?t=` is omitted. |

### 5c. Pages that read `?t=` (the KEY-driven pages)

| File:line | Pattern |
| --- | --- |
| `tournament-admin.html:1314` | `var KEY = param("t");` |
| `leaderboard.html:548` | `var KEY = _tParam;` |
| `auction.html:108` | `var KEY = params.get("t") \|\| "";` |
| `sponsor.html:226` | `var KEY = params.get("t") \|\| "";` |
| `recap.html:130` | `var KEY = params.get("t") \|\| "";` |
| `tournament-rules.html:96` | `var KEY = params.get("t") \|\| "";` |

`live.html`, `score-round.html`, and `player.html` derive the
tournament from the **token**, not from `?t=` — see §5d.

### 5d. Token-driven pages (the real leak surface)

`score-round.html` and `player.html` identify the current player by a
magic-link token stored in a **shared** localStorage key
(`fh_player_token`, §2b). Whichever tournament last signed the player
in owns that token, and the *next* tournament to open `score-round.html`
on that device signs in as that same player until the token expires or
the user explicitly signs out. The `/api/player-card` endpoint has no
notion of "this player only belongs to this tournament", so the API
resolves the token against the whole player universe — hence Jim
Meeker (Couples) surfacing on Ashton Williams' Fire card.

`live.html` derives its scoring context from the same token-driven
`score-round.html` flow (and from `?t=` for display), but the *attester*
list appears to come from Airtable rows keyed by player name/id rather
than by tournament — so a player who exists in the Couples table and
happens to be present at Fire will show up. **This deserves a
server-side check in Step 2.** (Marked as follow-up in §6 — not
verified here.)

### 5e. API surface (server-side)

All 12 API functions live in `api/`. Every tournament-facing one takes
`Tournament` from the request body or query string:

- `api/tournament-signups.js`
- `api/tournament-signup.js` (has cap map incl. `"Haxtun Fire (Sept 19,
  2026)": 22`)
- `api/tournament-checkin.js`
- `api/tournament-score.js`
- `api/tournament-flights.js`
- `api/tournament-counts.js`
- `api/tournament-expenses.js`

Non-tournament (global) endpoints:

- `api/player-card.js` — resolves the magic-link token. **Does not scope
  results to a tournament.** (This is the server side of §5d.)
- `api/players.js` — global player registry.
- `api/nominations.js`, `api/reviews.js` — Founders-shaped.
- `api/calcutta-receipt.js` — takes a tournament in the payload.

Auth helpers `api/_auth.js`, `api/_cors.js`, `api/_marker.js` are
tournament-agnostic infra.

---

## 6. Blast radius — what Step 2 could break

Ranked by "how bad if we get it wrong."

1. **Founders 2026 historical data.** Founders is played. Its
   Airtable rows + `data/founders-tournament.json` +
   `data/founders-2026-highlights.json` are the source of truth for
   `tournament.html`, `founders-recap.html`, `founders-flights.html`,
   `founders-calcutta-display.html`, `founders-leaderboard-display.html`.
   CLAUDE.md rule: **Founders is sacred; do not touch `founders-*.html`
   unless explicitly asked.** Step 2 must preserve every existing
   `founders-*.html` KEY string during any rename so the old pages keep
   resolving Airtable + JSON data. If Step 2 moves Founders JSON under
   `data/tournaments/founders-2026/`, every `fetch("data/founders-*.json")`
   call in the listed pages needs the new path AND a redirect for any
   external link the user has bookmarked.

2. **`founders-tournament-scores.json` — MISSING FROM REPO.** The user
   flagged this file as "hand-transcribed teams 31–64, must not be lost."
   `ls data/` shows it is **not present** in the current tree. Before
   Step 2 starts, we need to know: was it renamed? Removed intentionally?
   Never checked in? A git-log check should be run against the file
   name before any refactor. **Do not proceed with Step 2 until this is
   resolved.**

3. **F&H Scramble final leaderboard.** Also flagged as must-not-lose.
   No file in the current tree matches this description; the data is
   presumably in Airtable. If it's Airtable-only, Step 2 does not touch
   it, but this should be confirmed before starting.

4. **Shared `fh_player_token` and `fh_round_draft_v1`.** These are the
   root cause of the reported leak. Namespacing them by tournament id
   will fix the leak but will also **sign every player out of every
   tournament on every device** they've used — an intentional break
   the user should be prepared for. Alternatively the tokens can stay
   shared but the server-side `/api/player-card` should scope the
   attester lookup by tournament id. The user should pick the trade-off
   before Step 2.

5. **`live.html` attester list.** Not fully traced in this audit.
   Whatever surfaces the attester dropdown must be tournament-scoped
   server-side; §5d is a hypothesis, not a verification. Step 2 should
   include a small server-side check ("resolve attester within
   tournament X only") before it declares the leak fixed.

6. **`admin.html` season filter (`fh:tmSeason`).** Not a data leak but
   would be surprising if it silently reset for every user. Namespacing
   it (or leaving it shared) is a UX call, not a correctness one.

7. **Every hardcoded `PAR9` / `PARS9_PP`.** Six locations across three
   files (§3). Refactor must make par a per-tournament config value.
   Any tournament that omits par should fail loud, not fall back to
   F&H's 4,3,4,4,5,4,4,3,5.

8. **`CALC_DEFAULTS` in `tournament-admin.html:11001`.** Founders-shaped
   defaults will silently apply to Fire if Fire's Calcutta config isn't
   saved. Fire's entry fee is $100/player (user-stated), not $120. If
   Step 2 lands and Fire hasn't been given its own Calcutta config
   first, the workbook will compute Fire pot at the wrong number.

---

## 7. Haxtun Fire — what we do NOT know (TODOs for Step 2 config)

The following are **required inputs for `haxtun-fire-2026/config.json`
and must not be guessed.** Every field below should be written as
`"TODO"` in the config until the user confirms it:

- Course (F&H? somewhere else?)
- Tees played (White? Multiple?)
- Par per hole
- Hole count (9 or 18)
- Entry fee per player (user said $100/man → $400/team; needs written
  confirmation for the config)
- Format (scramble? shotgun? modified?)
- Players per team
- Contests (KP holes, long drive, hole-in-one — user mentioned Alvin
  and Sherrilyn sponsoring HIO on #8 for $5-in-pot / $1000 win; the
  rest are unspecified)
- Shotgun vs tee times
- Start time
- Any 9-hole vs 18-hole toggle
- Field cap (currently `22` teams in
  `api/tournament-signup.js` — this may or may not be correct)

Do not populate any of these from Founders precedent.

---

## 8. Recommended Step 2 order (proposal — not executed)

*Only listed here so the review can flag anything the user wants
resequenced or removed before Step 2 begins.*

1. Resolve §6.2 (missing `founders-tournament-scores.json`) and §6.3
   (F&H Scramble location). Do not touch anything until both are
   accounted for.
2. Create `data/tournaments/index.json` and one folder per known
   tournament (`founders-2026`, `couples-2025`, `haxtun-fire-2026`,
   plus a `fh-scramble-<year>` if applicable), each with
   `config.json` (fields per §7), `teams.json`, `scores.json`.
3. Ship Fire's `scores.json` as `{"holes": {}, "published": false}`
   and its `config.json` with every §7 field as `"TODO"`.
4. Add a `storageKey(tournamentId, purpose)` helper producing
   `fhgolf:<tournamentId>:<purpose>` and rewrite every §2 caller to
   use it. Delete every hardcoded local key.
5. Add per-page `const TOURNAMENT_ID = 'haxtun-fire-2026';` (etc.) to
   every currently-hardcoded-KEY page (§5b), keep `?t=` on the
   currently-KEY-driven pages, and remove or narrow `fh_player_token`
   so it either scopes by tournament id or the server enforces the
   scope.
6. Delete every hardcoded `PAR9` / `PARS9` / `CALC_DEFAULTS` (§3) and
   route through the new config loader. Add a render-time guard that
   throws if no matching entry exists in `scores.json`.
7. Verify by:
   - `git diff` shows no change to `founders-tournament-scores.json`
     (if it re-enters the tree in the meantime) or to any surviving
     F&H Scramble file;
   - `grep -n "localStorage\.\(get\|set\|remove\)Item" -r .` shows
     zero raw calls (all should route through `storageKey()`);
   - Opening `score-round.html` with no token, on a fresh device, in
     each tournament in turn shows only that tournament's players;
   - `admin.html` still lists every tournament card;
   - Founders 2026 pages render byte-for-byte identical output before
     and after (screenshot diff or DOM diff).

---

## 9. Missing-file archaeology (Task 1)

Two hand-transcribed datasets are known-to-user but unaccounted-for in
the working tree. Both were searched:

### (a) `founders-tournament-scores.json`

- **`git log --all --diff-filter=D`** for any deleted `*founders*` path:
  no results. Never existed in any commit.
- **`git log --all --oneline`** for the filename: no results.
- **`git log --all --grep='founders-tournament-scores'`**: only my own
  audit commit (`ce2f427`), which mentions it in a follow-up note.
- **`git rev-list --all | git grep 'publishScores'`**: no results in any
  commit on any branch, ever.
- **`git stash list`**: empty.
- **Working tree grep for `publishScores`**: no matches.

**Verdict: NOT IN REPO, NOT IN GIT HISTORY, NOT IN STASH.**
The file was never committed on this repository. It may have existed
only in a prior local scratch, on the user's other machine, or in a
different repo. No restore command is available — nothing to restore
from. Before Step 2 begins, the user needs to confirm: (i) is the
transcription stored anywhere else (Airtable, Numbers, spreadsheet on
their laptop, an earlier chat's file attachments), (ii) should Step 2
proceed under the assumption that Founders 2026 team-31..64 scores
are ONLY in the operator's Airtable base, or (iii) does the user want
to re-transcribe before we refactor?

### (b) F&H Scramble final leaderboard

- **`git log --all --diff-filter=D`** for any deleted `*scramble*`
  path: no results.
- **`git log --all --grep='scramble' -i`**: matches only tournament
  RULES text and a generic "same-location scramble" rules PR — none
  reference a data file.
- **`git rev-list --all | git grep 'cardOff'`**: no results on any
  branch, ever.
- **`git rev-list --all | git grep 'Wolff'`**: no results.
- **Working tree grep for `cardOff`, `Wolff`, `R\. Wolff`**: no
  matches.

**Verdict: NOT IN REPO, NOT IN GIT HISTORY.** The Scramble leaderboard
— winner R. Wolff at 61, 22 teams, `cardOff()` comparator, `rank()`
function — was never committed here as a `.json` or an inline JS
block. Either it lives elsewhere (a prior local prototype, another
repo, only in the deployed Airtable), or it was rendered live from
Airtable without a checked-in seed. Same question as (a) for the user
before Step 2 begins.

### Restore commands (would-be, if either had existed)

Neither is recoverable from this repository. If the user hands over
the missing bytes (paste, file attach, or another repo URL), Step 2
will add them at `data/tournaments/founders-2026/scores.json` and
`data/tournaments/fh-scramble-<year>/scores.json` under the refactor's
naming convention. Nothing has been recreated or fabricated in this
audit.

---

## 7. AIRTABLE & API

*(Numbered §7 per the user's Task 2 instruction; sequential to §6.
§8 above remains the proposed Step 2 order and §9 above is the
missing-file archaeology.)*

The first audit covered checked-in JSON and browser storage. Couples,
Haxtun Fire, and F&H Scramble do not have checked-in JSON; they live
in Airtable. Every isolation guarantee for those tournaments therefore
depends on the queries in `api/*.js`. This section inventories them.

### 7.1 Base and table structure

There is **one Airtable base** (`AIRTABLE_BASE_ID`). Every tournament
shares every table. Per-tournament separation is **only** by a string
field named `Tournament` on the row.

| Table (env override → default) | Per-row tournament field | Shape |
| --- | --- | --- |
| `TOURNAMENTS_TABLE` → **Tournament Signups** | **`Tournament`** (single-line text, freeform string) | One row per signup. **All tournaments' rows share this table.** |
| `CONFIG_TABLE` → **Tournament Config** | **`Tournament`** (single-line text, freeform string, primary key) | One row per tournament. **Sponsors/Donors JSON, Slot Config, Waves JSON, Extras JSON, Format-tab settings, Auction State, Recap all packed into long-text fields on this one row.** |
| `EXPENSES_TABLE` → **Tournament Expenses** | **`Tournament`** (text) | One row per line-item expense. |
| `ARCHIVES_TABLE` → **Tournament Archives** | **`Name`** (text) + **`Year`** | Snapshot per completed tournament. |
| `PLAYERS_TABLE` → **Players** | **NONE** — global | One row per human. Not tournament-scoped by design (identity carries across events). |
| `ROUNDS_TABLE` → **Rounds** | **NONE** — global | Self-posted casual rounds. Filed under `Player ID`, not tournament. |
| `PAYMENTS_TABLE` → **Payments** | **NONE** — global | Green-fee payments (member card). |
| `REVIEWS_TABLE` → **Reviews** | **NONE** | Site reviews. |
| `AIRTABLE_TABLE` (nominations) → **Hall of Fame Nominations** | Assumed Founders-specific by name; no tournament field on the row. |

**Two things stand out:**

1. **`Tournament` is a plain string, not a linked record**, in both
   Signups and Config. A one-character typo, an apostrophe difference
   (`Couple's` vs. `Couples`), or a year suffix mismatch (`Sept 19`
   vs. `Sept 19, 2026`) creates a phantom tournament that only some
   pages find. This is why the earlier phantom-URL cycle happened
   at all.
2. **Players / Rounds / Payments are global by design.** Any cross-
   tournament identity of a person (e.g. a magic-link token) resolves
   against the whole Players table, not against per-tournament roster
   membership. See §7.3.

### 7.2 Every Airtable query in `api/`

Format: `file:line` — table — filter — tournament-scoped?

**Read paths:**

| Location | Table | Filter (verbatim) | Scoped? |
| --- | --- | --- | --- |
| `api/tournament-signups.js:1181` (dupCheck) | Signups | `{Tournament}="<t>"` | ✅ yes |
| `api/tournament-signups.js:992` (live-token lookup) | Signups | `{Live Token}="<token>"` maxRecords=1 | ✅ indirectly (token → row → row's Tournament field is source of truth) |
| `api/tournament-signups.js:1011` (live-field) | Signups | `AND({Tournament}="<t>", NOT({Alternate}))` pageSize=100 | ✅ yes |
| `api/tournament-signups.js:1009` (live-config) | Config | `{Tournament}="<t>"` maxRecords=1 | ✅ yes |
| `api/tournament-signups.js:1263` (?config=<name>) | Config | `{Tournament}="<name>"` pageSize=100 | ✅ yes |
| `api/tournament-signups.js:1255` (?config=1) | Config | no filter (returns ALL rows) | ❌ intentional — public list of every tournament card |
| `api/tournament-signups.js:1345` (bare GET, admin+public) | Signups | **NO FILTER — returns EVERY signup across EVERY tournament** | ❌ **LEAK VECTOR** — the client is expected to filter by `KEY` (see §7.3 for the mechanism) |
| `api/tournament-signups.js:532` (sponsor-submit find) | Config | `{Tournament}="<t>"` maxRecords=1 | ✅ yes |
| `api/tournament-signups.js:618` (config-write find) | Config | `{Tournament}="<t>"` | ✅ yes |
| `api/tournament-signups.js:647` (config-write dupes) | Config | (same-name duplicate cleanup) | ✅ yes |
| `api/tournament-signups.js:1378` (auction states) | Config | no filter (loops every row) | ❌ intentional — public map of all auction states |
| `api/tournament-signups.js:456` (player-merge signup lookup) | Signups | `FIND('<dropId>', ARRAYJOIN({Player}))` pageSize=100 | ❌ **cross-tournament by design** (a player merge re-links across every tournament they've played) |
| `api/tournament-signups.js:809` (upsertPlayerCard name match, called from sign-up write path) | Players | `LOWER({Name})=LOWER("<n>")` | N/A (Players is global) |
| `api/tournament-signup.js:32` (cap check) | Signups | `AND({Tournament}="<t>", {Status}!="Cancelled", NOT({Alternate}))` | ✅ yes |
| `api/tournament-signup.js:92` (upsertPlayerCard) | Players | `LOWER({Name})=LOWER("<n>")` | N/A (Players is global) |
| `api/tournament-counts.js:24` (public counts) | Signups | no filter, `fields[]=Tournament` only | ❌ intentional — aggregates per-tournament counts server-side; only returns counts, no PII |
| `api/tournament-checkin.js` | Signups | (does not read; writes by id — see §7.5) | N/A |
| `api/tournament-flights.js:60` (getConfig) | Config | `{Tournament}="<t>"` maxRecords=1 | ✅ yes |
| `api/tournament-flights.js:94` (saveConfig find) | Config | `{Tournament}="<t>"` maxRecords=1 | ✅ yes |
| `api/tournament-flights.js:209` (patchBatch) | Signups | (writes by id, no filter) | ❌ **LEAK VECTOR** — a batch of `assignments:[{id,...}]` is accepted from the client and blindly PATCHed by record id, with no check that the ids belong to the caller's tournament (see §7.5) |
| `api/tournament-expenses.js:32` | Expenses | no filter (loads ALL, then client-side `records.filter(x => x.fields.Tournament === t)` at line 42) | ❌ **inefficient but not a leak** — server-side filter would be safer |
| `api/tournament-score.js:52` (live-token lookup) | Signups | `{Live Token}="<token>"` maxRecords=1 | ✅ indirectly |
| `api/tournament-score.js:80` (marker cfg fetch) | Config | `{Tournament}="<t>"` maxRecords=1 | ✅ yes |
| `api/tournament-score.js:82` (marker field fetch) | Signups | `AND({Tournament}="<t>", NOT({Alternate}))` | ✅ yes |
| `api/player-card.js:143` (findPlayerByName) | Players | `LOWER(TRIM({Name}))="<n>"` maxRecords=1 | N/A (Players is global — see §7.3) |
| `api/player-card.js:180` (loadPlayerById) | Players | GET by id | N/A |
| `api/player-card.js:244,246` (fetchHistory captain + partner) | Signups | `LOWER({Player Name})=LOWER("<n>")` and `FIND(LOWER("<n>"), LOWER({Team / Partners}))>0` | ❌ **cross-tournament by design** (Player Card is meant to show every tournament that player has been on) |
| `api/player-card.js:267` (archives read) | Archives | no filter | ❌ intentional |
| `api/player-card.js:302` (rounds-list) | Rounds | `{Player ID}="<id>"` | N/A |
| `api/player-card.js:357` (payments-list) | Payments | `{Player}="<name>" OR ...` | N/A |
| `api/player-card.js:790-816` (stats action) | Rounds/Payments/Players/Signups | each `listAll(...)` with no filter | ❌ **admin-only aggregate, reads all rows across all tournaments** |
| `api/players.js:66` (find/create) | Players | `LOWER({Name})=LOWER("<n>")` | N/A (Players is global) |
| `api/reviews.js:31` | Reviews | `{Status}='Approved'` | N/A |
| `api/nominations.js:57,99` (submit/list) | AIRTABLE_TABLE | no filter | Founders-shaped by design |

**Write paths (see §7.5 for scope enforcement):**

| Location | Table | Op | Scope check? |
| --- | --- | --- | --- |
| `api/tournament-signup.js:184` | Signups | POST — new signup, tournament from body | ❌ tournament string is whatever the client sends |
| `api/tournament-checkin.js:145` | Signups | PATCH by id | ❌ **no tournament check on the target id** (see §7.5) |
| `api/tournament-score.js:120,173,217` | Signups | PATCH by id (extras, attest, scores) | ✅ marker-writeTargets check for cross-writes (line 96) |
| `api/tournament-flights.js:209` | Signups | PATCH batch by id | ❌ no per-id tournament check |
| `api/tournament-flights.js:110,112` | Config | PATCH/POST (Slot/Auction/Recap) | ⚠️ writes to whatever `body.tournament` string names — no `scopeReject` guard |
| `api/tournament-signups.js:172` (remove) | Signups | DELETE by id | ⚠️ admin-only, no tournament check |
| `api/tournament-signups.js:215` (archive) | Archives | POST — snapshot | ✅ `scopeReject(name)` |
| `api/tournament-signups.js:442,474,487` (player-merge) | Players + Signups | PATCH keep, batch relink, DELETE drop | ❌ cross-tournament by design |
| `api/tournament-signups.js:411` (team-merge delete) | Signups | DELETE drop row | ✅ merge refuses if the two rows have different `Tournament` (line 261) |
| `api/tournament-signups.js:569-576` (sponsor-submit) | Config | PATCH/POST — Donors JSON | ⚠️ writes to whatever `body.tournament` names (public endpoint; no scope guard, but confined to that Config row) |
| `api/tournament-signups.js:610-630` (config-write) | Config | PATCH/POST | ✅ `scopeReject(tournament)` |
| `api/tournament-expenses.js:55,70` | Expenses | DELETE by id / POST new | ⚠️ no tournament check on delete-by-id |
| `api/player-card.js:747` (profile-save) | Players | PATCH | N/A |
| `api/player-card.js:791` (stats listAll — read only) | (read) | — | — |
| `api/nominations.js` | AIRTABLE_TABLE | POST | Founders-shaped |
| `api/reviews.js:79` | Reviews | POST | N/A |
| `api/calcutta-receipt.js` | (email only, no Airtable write) | — | — |

**Leak inventory (queries with no tournament constraint that can leak
data across tournaments):**

1. **`GET /api/tournament-signups`** (no query params) — returns the
   ENTIRE Signups table for every tournament in one payload. Every
   consumer (workbook, leaderboard, TV displays, phone live-page's
   Signup polling) is trusted to client-filter by exact-match
   `Tournament === KEY`. Any string mismatch fails silent; any string
   collision leaks cross-tournament data. This is the widest leak
   vector by row count.
2. **`fetchHistory` in `player-card.js`** — by design, a Player Card
   sees every tournament the player has ever been on. Not a bug, but
   means any change to the Player Card that ever renders a Signup
   field beyond team/tournament could disclose cross-tournament info.
3. **`stats` action in `player-card.js`** — admin-only aggregate over
   all four tables with no per-tournament partition.

### 7.3 The Meeker path — how a Couples player attested on a Fire card

The tokens that identify a captain to `live.html` come from two
different places. Both are relevant.

**Path A — the URL-token path (`?t=<hex>` on `live.html`):**
`live.html:488` reads `TOKEN = q.get("t")`. This token is a per-signup
`Live Token` (16-64 hex chars) that the pro shop texts to a captain
from Check-In. `/api/tournament-signups?live=<token>`
(`tournament-signups.js:992`) resolves the token to **exactly one
Signups row** via `{Live Token}="<token>"` — the row's own `Tournament`
field is the source of truth for what event this captain is scoring.
The subsequent `field` query (line 1011) filters `Signups` by that
row's `Tournament`. This path is server-side scoped correctly. **If
the wrong tournament appears on Ashton's screen, it is because his
`Live Token` row itself is tagged with the wrong `Tournament` string
in Airtable — not because the server ever cross-joined tables.**

**Path B — the shared player-token path (`fh_player_token`, §2b):**
`score-round.html` and `player.html` sign in via a global-scope magic
link token. That token resolves against the **Players** table — a
table with no `Tournament` field. So the SAME person "signed in" on
one tournament is signed in for every tournament on that device.
`fetchHistory` (`player-card.js:243-250`) then looks up **every**
Signups row where that player is captain OR appears in
`Team / Partners`, across every tournament, sorted by
`b.tournament.localeCompare(a.tournament)`. If that captain also has
a Fire signup, both show up in the current list.

**The actual mechanism for the Meeker/Williams event (best-fit
explanation given the code that exists):**

- `Player Name` and `Team / Partners` on Signups are **plain text**,
  not linked records. Any Signups row can list any name in either
  field.
- The `Tournament` field on Signups is **plain text**. During the
  earlier phantom-URL / string-bouncing cycle (fixed in PR #415),
  several Signups rows almost certainly got their `Tournament` string
  edited to a variant of "Haxtun Fire (Sept …)". If an existing
  Couples signup for Ashton Williams — with Jim Meeker in the
  `Team / Partners` field or otherwise co-listed — had its
  `Tournament` field changed to the Fire canonical key (either by
  Airtable Assistant, an inline rename, or a hand edit), that row is
  now a Fire row. `/api/tournament-signups?live=<Ashton's Fire
  token>` returns Ashton's Fire row, and the `field` query returns
  every Fire signup including that mis-tagged one. The marker
  algorithm (§tournament-signups.js:1078-1123) then picks a tee-mate
  from `field` sorted by `(Slot, Seat)`. If Jim landed on the same
  `Hole` + `Start` as Ashton — either from a real pairing entry or a
  copied row that still had a Couples hole assignment — the marker
  cycle assigns Jim as Ashton's scorer.
- Nothing on the server side would have caught this. There is no
  "which players are eligible for tournament X" registry — eligibility
  is inferred from the presence of a Signups row with a matching
  `Tournament` field.

**Underlying design cause:** tournament identity is a plain string
smeared across every row of every table, and eligibility is inferred
from row-presence rather than declared. The moment two tournaments'
rows carry the same `Tournament` string, they are the same tournament
as far as the server can tell.

### 7.4 `api/` directory endpoint-by-endpoint

`Tournament?` = whether the endpoint requires or scopes by a
tournament identifier. `Fallback?` = what happens when it's absent.

| Endpoint | Purpose | Tournament? | Fallback? | Notes |
| --- | --- | --- | --- | --- |
| `POST /api/tournament-signup` | New public signup | Required (body.tournament) | 400 "Please choose a tournament" | Writes whatever string is given; no dictionary check |
| `POST /api/tournament-checkin` | Staff PATCH one signup row | ❌ NOT required — writes by row id | Writes whatever row id names, silently | **Leak vector — see §7.5** |
| `POST /api/tournament-score` | Player writes hole scores | Derived from token → row → tournament | 401 if no token | Marker cross-writes are scoped (line 96) |
| `POST /api/tournament-flights` (assignments) | Staff PATCH batch by id | ❌ NOT required — writes by row id | Writes whatever ids are named | **Leak vector — see §7.5** |
| `POST /api/tournament-flights` (getConfig/saveConfig) | Read/write one config row | Required (body.tournament) | 400 "tournament required" | No `scopeReject` on saveConfig |
| `POST /api/tournament-flights` (import) | Bulk create signups from pairing sheet | Required | 400 | Server writes `Tournament: <t>` verbatim |
| `POST /api/tournament-signups` (remove) | Delete signup by id | ❌ | Silently deletes | Admin-only, no tournament check |
| `POST /api/tournament-signups` (archive) | Snapshot to Archives | Required (body.name) | 400 | `scopeReject(name)` enforced |
| `POST /api/tournament-signups` (team-merge) | Merge two teams | Derived from row `Tournament` fields | Refuses cross-tournament merges (line 261) | ✅ scoped |
| `POST /api/tournament-signups` (player-merge) | Merge two Players rows | ❌ cross-tournament by design | | |
| `POST /api/tournament-signups` (sponsor-submit) | Public sponsor add | Required (body.tournament) | 400 | No scope guard (public endpoint by nature) |
| `POST /api/tournament-signups` (config-write) | Format-tab save | Required (body.tournament) | 400 | `scopeReject` enforced |
| `GET /api/tournament-signups` | Public/admin signup list | ❌ | **Returns EVERY row in the table for every tournament** | Client-filters by `KEY` string match |
| `GET /api/tournament-signups?live=<token>` | Live-scoring bootstrap | Derived from token | 401 | Server-scoped correctly |
| `GET /api/tournament-signups?config=<t>` | One config row | Required | Returns null | Server-scoped |
| `GET /api/tournament-signups?config=1` | All config rows | ❌ by design | Returns all | Intentional public list |
| `GET /api/tournament-signups?dupCheck=<t>&names=…` | Roster de-dupe | Required | Empty matches | Server-scoped |
| `GET /api/tournament-signups?archives=1` | Archives list | ❌ by design | Returns all | Intentional public browsing |
| `GET /api/tournament-counts` | Public per-tournament counts | ❌ (aggregates all) | Fails soft to `{counts:{}}` | Returns only counts, no PII |
| `GET /api/tournament-expenses?t=<t>` | Line-item list | Optional | If `t` empty, returns EVERY expense row across all tournaments | ⚠️ minor leak — expense descriptions could disclose planning across events. Also this endpoint has a bug: `const auth` declared twice in the same scope (line 21 and line 25) which is a SyntaxError; the endpoint likely 500s on every request. |
| `POST /api/tournament-expenses` | Add/delete expense | Required for add; ❌ for delete-by-id | 400 for add; deletes silently for delete | Admin-only |
| `POST /api/player-card` (magic-request/create/verify/history/…) | Player Card | ❌ global by design | | See §7.3 for the cross-tournament read consequences |
| `POST /api/player-card` (stats) | Admin site stats | ❌ | Aggregates across every table | Admin-key gated |
| `GET/POST /api/players` | Player registry | ❌ global by design | | |
| `POST /api/reviews`, `GET /api/reviews` | Site reviews | ❌ | | |
| `POST /api/nominations` | Hall of Fame nominations | ❌ (Founders-shaped) | | |
| `POST /api/calcutta-receipt` | Send email receipt | Required (body carries tournament for the email copy) | 400 | Just an email endpoint |

**Bugs surfaced by this audit that are not part of the isolation
question but are worth flagging:**

- `api/tournament-expenses.js:21,25` — `const auth` is declared twice
  in the same function scope. This is a JS SyntaxError. The endpoint
  is almost certainly non-functional. Same class of bug as the
  `tournament-flights.js` fix mentioned in that file's comments.
  **Not fixed here (audit is read-only). Flag for Step 2 or a
  standalone bugfix PR.**

### 7.5 Write safety — cross-tournament PATCH surface

Any endpoint that accepts a Signups record id from the client and
PATCHes it without verifying the row's `Tournament` matches the
caller's scope can be used (accidentally or maliciously) to edit a
row in a different tournament. Rank-ordered by exposure:

1. **`POST /api/tournament-checkin`** — accepts `{ id, checkedIn?,
   amountPaid?, playerName?, teamPartners?, cartAssignment?,
   groupScorer?, buyer?, buyAmount?, buyerEmail?, flightCheck?,
   calcuttaCheck?, ... }` and PATCHes the row by id
   (`tournament-checkin.js:145`). The only auth is `require("./_auth")
   (req)`. **There is no equivalent of `tournament-signups.js`'s
   `scopeReject()` here.** A staff token scoped to the Fire tournament
   could PATCH a Couples signup's Player Name, Buyer, Buy Amount,
   check number, cart assignment, or paid status by knowing the row
   id. This IS the "editing one overwrites another" symptom
   mechanism.
2. **`POST /api/tournament-flights`** (assignments) — accepts
   `assignments:[{id,flight,start,hole,slot,seat,d2Hole,d2Slot,d2Seat,
   d2Start}]` and PATCHes the batch (`tournament-flights.js:209`).
   Same problem: no per-id tournament check. A malformed pairing-sheet
   import (or a client bug that keeps a stale id from a prior
   tournament switch in the workbook) can rewrite pairings on rows
   that belong to another tournament.
3. **`POST /api/tournament-flights`** (saveConfig) — writes to the
   Config row named by `body.tournament`. Admin-only. Missing the
   `scopeReject` guard that `tournament-signups.js`'s `config-write`
   uses. A staff token scoped to Fire can rewrite Couples' Slot
   Config, Auction State, or Recap by naming that tournament in the
   body.
4. **`POST /api/tournament-signups action=remove`** — deletes any
   Signups row by id, no tournament check. Admin-only.
5. **`POST /api/tournament-signups action=sponsor-submit`** — public
   endpoint. Writes to the Config row for whatever `body.tournament`
   string names. Rate/dup-limited but not tournament-restricted.
   Anyone can submit a "sponsor" tile to any tournament's config
   row.
6. **`POST /api/tournament-expenses action=delete`** — admin-only,
   deletes any expense row by id with no tournament check. (Currently
   probably 500ing due to the SyntaxError above; a fix would restore
   this exposure.)

**Write paths that are safe:**

- `tournament-score.js` marker cross-writes — server re-runs the
  marker assignment against the row's own tournament and rejects
  writes to any signup not in the writer's `writeTargets`
  (`tournament-score.js:96`).
- `tournament-signups.js` team-merge — refuses if the two rows'
  `Tournament` fields differ (line 261).
- `tournament-signups.js` config-write — enforces `scopeReject` for
  every tournament other than the sentinel `__course__` row.
- `tournament-signups.js` archive — enforces `scopeReject`.

**Fix pattern for Step 2:** every endpoint that PATCHes/DELETEs a
Signups row by id should first GET the row, read its `Tournament`
field, and reject if the caller is a staff token whose `scope`
doesn't match. Same pattern for endpoints that write to a Config row
named in the body. The `_auth` module already surfaces the scope; the
guard just isn't wired everywhere.

---

**End of audit. No production files were modified.**
