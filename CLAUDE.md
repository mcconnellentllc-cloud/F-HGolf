# F&H Golf Course — repo notes for Claude

## Founders is sacred

Do **not** touch `founders-*.html` or Founders-specific behavior in
`tournament-admin.html` unless the user explicitly asks. Founders is a
2-day tournament with waves, meals, and Calcutta; every other tournament
is single-day/single-wave and does not have those concepts.

Format tab is the single source of truth for tournament settings —
Waves, Meals, Calcutta, Handicaps, Marker Scoring, Flight From (front/back/18),
etc. all live there.

## Scorecard printing — standard for every tournament

The physical F&H scorecard is the same stock for every tournament
(Founders, Couples, and anything future) until the user says otherwise.
Print layout lives in `CARD_OFFSETS` inside `tournament-admin.html` (see
`teeMarkStep` / `teeMarkFirst` / `paperSize` near line 6405).

Measured on the physical card (confirmed 2026-08-17):

- **Paper**: 12in × 5.875in, landscape, 180° rotated in the print CSS.
- **Hole cells** (front nine — same pattern for back nine):
  - Individual hole cell width: **0.25in** (each cell)
  - Pitch between hole left-edges: **0.28125in** (= 9/32", because
    there is a ~1/32" hairline gap between cells).
  - **Do NOT** compute pitch as 2.5in ÷ 9 = 0.2778in. That 2.5in span
    (hole-1 left edge → hole-9 right edge) covers 9 cells PLUS 8 gaps,
    so pitch = (3.375 − 1.125) / 8 = 0.28125in.
  - Hole 1 spans **1.125in → 1.375in** from paper left edge; center = **1.25in**.
  - Hole 9 spans **3.375in → 3.625in**.
- **Name-block region** (top of Men's Hdcp band down through the 3
  player rows to top of Red Tees banner): **3.28125in** total.
  - Individual player cell height: **0.375in** (= 3/8").
  - Gray HOLE row height: **0.375in**.

Circle anchor for tee marks:
- `teeMarkFirst = 1.25in` (center of hole 1's cell)
- `teeMarkStep = 0.28125in`

Team-name rendering:
- Always render **first + last** for every player slot (up to 4).
- 3+ players triggers `.sc-block--dense`: 6pt font, half-height rows,
  fits 4 names in the 3-cell region (prints across horizontal lines).

Printer preset the operator uses is **"F&H card"** on the HP LaserJet
Pro MFP M227fdw. If a print prompt asks about paper size, that preset
answers it.

## Service worker

`sw.js` uses network-first with a cache-shell fallback. Bump `CACHE`
version on every SHELL change or print-CSS change so the operator's
device pulls fresh HTML.

## Git conventions

Development branch pattern: short `type/topic-slug` (e.g.
`fix/scorecard-teemark-nudge`, `chore/claude-md`). Squash-merge PRs.
Never destructive operations without the user's OK. Never `--no-verify`.
