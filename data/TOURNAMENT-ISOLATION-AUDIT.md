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

**End of audit. No production files were modified.**
