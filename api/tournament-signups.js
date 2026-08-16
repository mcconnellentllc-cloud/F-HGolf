// Vercel serverless function — Tournament Signups list + remove + archives +
// Format config.
//
//   GET  (no key)             -> stripped public payload (team + scores +
//                                calcutta + flight), safe for TV / phone.
//   GET  (x-admin-key)        -> full record set including contact info.
//   GET  ?archives=1 (admin)  -> list rows from the Tournament Archives table.
//   GET  ?config=<name>       -> the Tournament Config row for one tournament
//                                (public — feeds the shareable public card).
//   GET  ?config=1            -> ALL tournament config rows (public list).
//   POST (admin) { action: "remove", id }
//   POST (admin) { action: "archive", name, year, dates, snapshot }
//   POST (admin) { action: "config-write", tournament, fields }
//        -> upsert one Tournament Config row (Format tab writes here).
//
// Consolidates the old tournament-remove endpoint here to stay under Vercel's
// serverless-function cap. Read-only tools still hit GET; frontend uses POST
// with an action body instead of DELETE so shared CORS (GET/POST/OPTIONS) works
// without changes.
//
// Env: AIRTABLE_TOKEN (data.records:read+write), AIRTABLE_BASE_ID,
//      TOURNAMENTS_TABLE (defaults to "Tournament Signups"), ADMIN_KEY.
//
// Tournament Config table (env: CONFIG_TABLE, defaults to "Tournament Config").
// One row per tournament, keyed by the "Tournament" field (matches the
// workbook's `t=` URL parameter). Existing rows already hold "Auction
// State" and "Recap" — Phase 1 adds the Format fields below. Add them
// once in Airtable; the endpoint accepts unknown fields via typecast:
//
//   Tournament        (Single-line text, primary)
//   Name              (Single-line text)     – shareable display name
//   Blurb             (Long text)            – 1-line public description
//   Location          (Single-line text)
//   Start Date        (Date)
//   End Date          (Date)                 – optional, multi-day events
//   Reg Opens         (Date)
//   Reg Closes        (Date)
//   Play Style        (Single select)        – Scramble / Best Ball /
//                                              Bulldog / Stroke / Match /
//                                              Couples / Adult+Child / Junior
//   Players Per Team  (Number, integer)
//   Rounds            (Number, integer 1 or 2)
//   Team Cap          (Number, integer; 0 = unlimited)
//   Alternates Allowed (Checkbox)
//   Calcutta Enabled  (Checkbox)
//   Extra Meals Enabled (Checkbox)         – off by default; when on
//                                            the Check-In team cards
//                                            show per-player "Meals"
//                                            inputs (Founders only).
//   Flights           (Number, integer 0-6)
//   Start Type        (Single select)        – Shotgun / Tee time
//   Waves JSON        (Long text)            – e.g. [{"label":"AM","time":"8:00"}]
//   Extras JSON       (Long text)            – chargeable add-ons for Check-In,
//                                              e.g. [{"name":"Extra dinner","price":30}]
//   Highlights        (Long text)            – JSON array of short advertising
//                                              strings for the public card,
//                                              e.g. ["Lunch Included","Trophies awarded"]
//   Rental Carts      (Number)               – how many carts the course owns,
//                                              default 12. Cart dropdown on
//                                              Check-In uses this as the
//                                              rental-vs-borrowed threshold.
//   Member Carts JSON (Long text)            – JSON array of member-cart
//                                              objects: {name, shed, spot,
//                                              power, notes}. Example:
//                                              [{"name":"Chris Fuesz",
//                                                "shed":"3","spot":"12",
//                                                "power":"Electric",
//                                                "notes":"key in console"}]
//                                              Legacy string entries are
//                                              parsed as {name, notes} for
//                                              backward compatibility.
//   Registration Cost (Currency or Number)  – per TEAM
//   Cart Cost         (Currency or Number)  – per ROUND
//   Card Fee Pct      (Number)               – default 4
//   Public Slug       (Single-line text)     – URL segment for /t/<slug>

// Fields we're willing to hand to anonymous readers — anything not on this list
// is stripped out before the public payload leaves the server.
// Public read never exposes Buyer name or per-team bid amount — a viewer
// only sees the team + whether it has been sold. Aggregate pool totals get
// pre-computed server-side and returned in a separate `totals` block so the
// broadcast display can still show per-flight $$ without leaking per-team bids.
const PUBLIC_FIELDS = [
  "Player Name", "Team / Partners", "Tournament", "Alternate", "Start",
  "Flight",
  "Day1 Scores", "Day2 Scores", "Day1 Gross", "Day2 Gross",
];

function stripRecord(rec) {
  const src = rec.fields || {};
  const out = {};
  for (const f of PUBLIC_FIELDS) if (src[f] !== undefined) out[f] = src[f];
  out.sold = String(src["Buyer"] || "").trim() !== "";
  return { id: rec.id, created: rec.created, fields: out };
}

// Short-window in-memory cache on the admin read. During check-in / auction
// bursts, multiple staff devices ping this endpoint within the same second
// (each debounced client re-fetches after any save). With warm instances,
// this coalesces the traffic — the first request within a window fetches
// Airtable, everyone else reads the cached payload. 1500ms is short enough
// that new saves show up almost immediately, long enough to fold a rapid
// series of check-ins into one Airtable read and stay well clear of the
// 5-req/sec base limit.
const ADMIN_CACHE_MS = 1500;
let _adminCache = null;
let _adminCacheAt = 0;

// Per-tournament, per-flight aggregates (pool $ + sold + total counts). Safe to
// expose publicly — no way to reverse-engineer any individual team's bid.
function buildTotals(records) {
  const totals = {};
  for (const r of records) {
    const f = r.fields || {};
    const t = f["Tournament"]; if (!t) continue;
    const b = totals[t] || (totals[t] = { pools: {}, sold: {}, teams: {} });
    const fl = (f["Flight"] != null && f["Flight"] !== "") ? Number(f["Flight"]) : 0;
    b.teams[fl] = (b.teams[fl] || 0) + 1;
    const amt = typeof f["Buy Amount"] === "number" ? f["Buy Amount"] : 0;
    b.pools[fl] = (b.pools[fl] || 0) + amt;
    if (String(f["Buyer"] || "").trim() !== "") b.sold[fl] = (b.sold[fl] || 0) + 1;
  }
  return totals;
}

module.exports = async (req, res) => {
  if (require("./_cors")(req, res)) return;
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, ADMIN_KEY } = process.env;
  const TABLE = process.env.TOURNAMENTS_TABLE || "Tournament Signups";
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return res.status(500).json({ ok: false, error: "Sign-ups aren't configured yet." });
  }

  const key = req.headers["x-admin-key"] || "";
  const isAdmin = ADMIN_KEY && key === ADMIN_KEY;
  // Public GET is allowed; POST + any non-GET always requires the admin key.
  if (!isAdmin && req.method !== "GET") {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const listUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}`;
  const ARCHIVES = process.env.ARCHIVES_TABLE || "Tournament Archives";
  const archivesUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(ARCHIVES)}`;

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    if (body.action === "remove") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return res.status(400).json({ ok: false, error: "Missing record id." });
      try {
        const r = await fetch(`${listUrl}/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        if (!r.ok) {
          const detail = await r.text();
          console.error("tournament-signups remove error", r.status, detail);
          return res.status(502).json({ ok: false, error: "Could not remove the team." });
        }
        return res.status(200).json({ ok: true, id });
      } catch (e) {
        console.error("tournament-signups remove exception", e);
        return res.status(500).json({ ok: false, error: "Something went wrong removing the team." });
      }
    }

    if (body.action === "archive") {
      // Snapshot a completed tournament to the Archives table. Snapshot is a
      // JSON blob (leaderboard, calcutta, payouts, P&L) generated client-side.
      const name = typeof body.name === "string" ? body.name.slice(0, 200) : "";
      const year = typeof body.year === "string" ? body.year.slice(0, 8) : "";
      const dates = typeof body.dates === "string" ? body.dates.slice(0, 120) : "";
      const snapshot = body.snapshot; // object; JSON-encoded before write
      if (!name || !year) return res.status(400).json({ ok: false, error: "Missing name or year." });
      const fields = {
        "Name": name,
        "Year": year,
        "Dates": dates,
        "Committed At": new Date().toISOString(),
        "Snapshot": snapshot ? JSON.stringify(snapshot).slice(0, 100000) : "",
      };
      // Pull common headline stats out of the snapshot so they're queryable in
      // Airtable without JSON parsing.
      if (snapshot && typeof snapshot === "object") {
        if (typeof snapshot.champion === "string") fields["Champion"] = snapshot.champion.slice(0, 200);
        if (typeof snapshot.teams === "number") fields["Teams"] = snapshot.teams;
        if (typeof snapshot.totalPool === "number") fields["Total Pool"] = snapshot.totalPool;
        if (typeof snapshot.entryIncome === "number") fields["Entry Income"] = snapshot.entryIncome;
        if (typeof snapshot.calcuttaPool === "number") fields["Calcutta Pool"] = snapshot.calcuttaPool;
      }
      try {
        const r = await fetch(archivesUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ records: [{ fields }], typecast: true }),
        });
        if (!r.ok) {
          const detail = await r.text();
          console.error("archive write error", r.status, detail);
          const msg = /Unknown field/i.test(detail) || /TABLE_NOT_FOUND/i.test(detail)
            ? "Airtable rejected the archive — confirm the Tournament Archives table + fields exist."
            : "Could not save the archive.";
          return res.status(502).json({ ok: false, error: msg });
        }
        const data = await r.json();
        const archived = (data.records && data.records[0]) || null;
        return res.status(200).json({ ok: true, id: archived && archived.id });
      } catch (e) {
        console.error("archive exception", e);
        return res.status(500).json({ ok: false, error: "Something went wrong writing the archive." });
      }
    }

    if (body.action === "team-merge") {
      // Merge two Signups rows (same tournament) into one 4-player team.
      // The "keep" row's Player Name stays the captain (checks continue to
      // be written to them). Every other player name (keep partners + drop
      // captain + drop partners) is concatenated into the keep row's
      // Team / Partners field with " / " separators. Money fields sum,
      // Player linked fields merge, notes concatenate. The drop row is
      // deleted last so a partial failure never orphans data.
      const keepId = typeof body.keepId === "string" ? body.keepId : "";
      const dropId = typeof body.dropId === "string" ? body.dropId : "";
      if (!keepId || !dropId) return res.status(400).json({ ok: false, error: "Missing keepId or dropId." });
      if (keepId === dropId) return res.status(400).json({ ok: false, error: "keepId and dropId are the same record." });
      try {
        const [keepRes, dropRes] = await Promise.all([
          fetch(`${listUrl}/${keepId}`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }),
          fetch(`${listUrl}/${dropId}`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }),
        ]);
        if (!keepRes.ok || !dropRes.ok) {
          console.error("team-merge fetch error", keepRes.status, dropRes.status);
          return res.status(502).json({ ok: false, error: "Could not read one of the team signups." });
        }
        const keep = await keepRes.json();
        const drop = await dropRes.json();
        const kf = keep.fields || {}, df = drop.fields || {};
        if (kf.Tournament && df.Tournament && kf.Tournament !== df.Tournament) {
          return res.status(400).json({ ok: false, error: "Both teams must belong to the same tournament." });
        }
        // Build the merged player roster. Player Name of keep stays as the
        // captain; everyone else (keep partners + drop captain + drop
        // partners) becomes the new Team / Partners list, deduped by
        // case-insensitive full-name match.
        const captain = String(kf["Player Name"] || "").trim();
        const partnersFromKeep = String(kf["Team / Partners"] || "").split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean);
        const dropCaptain = String(df["Player Name"] || "").trim();
        const partnersFromDrop = String(df["Team / Partners"] || "").split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean);
        const seen = new Set();
        function pushUnique(bucket, name) {
          const key = name.toLowerCase();
          if (!name || seen.has(key)) return;
          seen.add(key);
          bucket.push(name);
        }
        if (captain) seen.add(captain.toLowerCase());
        const mergedPartners = [];
        partnersFromKeep.forEach(n => pushUnique(mergedPartners, n));
        if (dropCaptain) pushUnique(mergedPartners, dropCaptain);
        partnersFromDrop.forEach(n => pushUnique(mergedPartners, n));
        const fields = { "Team / Partners": mergedPartners.join(" / ") };
        // Money + counts sum. Only include the field on the PATCH if at
        // least one side had a real value — avoids nulling out an empty
        // field on Airtable when neither side set it.
        const sumFields = ["Amount Paid", "Extra Meals", "Player 1 Cart Share", "Player 2 Cart Share", "Player 1 Extra Meal", "Player 2 Extra Meal", "Buy Amount"];
        sumFields.forEach((f) => {
          const kv = typeof kf[f] === "number" ? kf[f] : (kf[f] ? Number(kf[f]) : 0);
          const dv = typeof df[f] === "number" ? df[f] : (df[f] ? Number(df[f]) : 0);
          if (kv || dv) fields[f] = (kv || 0) + (dv || 0);
        });
        // Player linked records — union.
        const kLinks = Array.isArray(kf.Player) ? kf.Player : [];
        const dLinks = Array.isArray(df.Player) ? df.Player : [];
        const linkSet = new Set([...kLinks, ...dLinks]);
        if (linkSet.size) fields.Player = [...linkSet];
        // Notes concatenate with a divider so nothing gets lost.
        const kNotes = String(kf.Notes || "").trim();
        const dNotes = String(df.Notes || "").trim();
        if (kNotes || dNotes) fields.Notes = [kNotes, dNotes].filter(Boolean).join("\n---\n");
        // Preserve Checked In if either side was already checked in.
        if (kf["Checked In"] || df["Checked In"]) fields["Checked In"] = true;
        // Preserve Buyer / Buyer Email — prefer keep, fall back to drop.
        if (!kf["Buyer"] && df["Buyer"]) fields["Buyer"] = df["Buyer"];
        if (!kf["Buyer Email"] && df["Buyer Email"]) fields["Buyer Email"] = df["Buyer Email"];
        // Auto-strip missing fields (same pattern as tournament-checkin)
        // so a base that hasn't grown a specific column yet still saves
        // the safe subset.
        let working = { ...fields };
        const stripped = new Set();
        for (let attempt = 0; attempt < 8; attempt++) {
          const pr = await fetch(`${listUrl}/${keepId}`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ fields: working, typecast: true }),
          });
          if (pr.ok) break;
          const detail = await pr.text();
          let missing = null;
          try {
            const parsed = JSON.parse(detail);
            const emsg = parsed && parsed.error && parsed.error.message;
            const m = /Unknown field name[s]?:\s*"([^"]+)"/i.exec(emsg || "");
            if (m) missing = m[1];
          } catch (e) {}
          if (!missing) {
            console.error("team-merge PATCH keep error", pr.status, detail);
            return res.status(502).json({ ok: false, error: "Could not save the merged team.", detail });
          }
          stripped.add(missing);
          delete working[missing];
          if (!Object.keys(working).length) break;
        }
        // Delete the drop row.
        const del = await fetch(`${listUrl}/${dropId}`, { method: "DELETE", headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        if (!del.ok) {
          const detail = await del.text();
          console.error("team-merge delete error", del.status, detail);
          return res.status(502).json({ ok: false, error: "Merged fields saved on the surviving team, but the duplicate team row could not be deleted — remove it manually in Airtable." });
        }
        const payload = { ok: true, keepId, dropId, players: [captain].concat(mergedPartners).filter(Boolean) };
        if (stripped.size) payload.warning = "Merged without " + [...stripped].join(", ") + " (fields not on the base).";
        return res.status(200).json(payload);
      } catch (e) {
        console.error("team-merge exception", e);
        return res.status(500).json({ ok: false, error: "Something went wrong merging the teams." });
      }
    }

    if (body.action === "player-merge") {
      // Merge two Players table rows: the "keep" row survives with the
      // caller-supplied merged fields; the "drop" row's signups are
      // re-linked to the keep row, then the drop row itself is deleted.
      // Order matters — do the field write + re-link BEFORE the delete so
      // a partial failure never orphans historical Signups.
      const keepId = typeof body.keepId === "string" ? body.keepId : "";
      const dropId = typeof body.dropId === "string" ? body.dropId : "";
      const mergedFields = (body.fields && typeof body.fields === "object") ? body.fields : {};
      if (!keepId || !dropId) return res.status(400).json({ ok: false, error: "Missing keepId or dropId." });
      if (keepId === dropId) return res.status(400).json({ ok: false, error: "keepId and dropId are the same record." });
      const PLAYERS = process.env.PLAYERS_TABLE || "Players";
      const playersUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(PLAYERS)}`;
      try {
        // Step 1 — write merged fields onto the keep record.
        if (Object.keys(mergedFields).length) {
          const wr = await fetch(`${playersUrl}/${keepId}`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ fields: mergedFields, typecast: true }),
          });
          if (!wr.ok) {
            const detail = await wr.text();
            console.error("player-merge PATCH keep error", wr.status, detail);
            return res.status(502).json({ ok: false, error: "Could not save merged fields to the surviving player.", detail });
          }
        }
        // Step 2 — find every Signups row linked to the drop player and
        // repoint its Player link at the keep id. Airtable linked-record
        // fields want an ARRAY of record ids.
        const filter = "?filterByFormula=" + encodeURIComponent(`FIND('${dropId}', ARRAYJOIN({Player}))`) + "&pageSize=100";
        let offset = "";
        const relinkIds = [];
        for (let guard = 0; guard < 20; guard++) {
          const url = listUrl + filter + (offset ? "&offset=" + encodeURIComponent(offset) : "");
          const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
          if (!r.ok) {
            const detail = await r.text();
            console.error("player-merge signups lookup error", r.status, detail);
            return res.status(502).json({ ok: false, error: "Could not find signups linked to the drop player." });
          }
          const data = await r.json();
          (data.records || []).forEach((rec) => relinkIds.push(rec.id));
          if (!data.offset) break;
          offset = data.offset;
        }
        // Batch PATCH up to 10 per Airtable call.
        while (relinkIds.length) {
          const batch = relinkIds.splice(0, 10).map((id) => ({ id, fields: { Player: [keepId] } }));
          const patchRes = await fetch(listUrl, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ records: batch, typecast: true }),
          });
          if (!patchRes.ok) {
            const detail = await patchRes.text();
            console.error("player-merge signups relink error", patchRes.status, detail);
            return res.status(502).json({ ok: false, error: "Could not re-link some signups to the surviving player.", detail });
          }
        }
        // Step 3 — delete the drop player row.
        const del = await fetch(`${playersUrl}/${dropId}`, { method: "DELETE", headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        if (!del.ok) {
          const detail = await del.text();
          console.error("player-merge delete drop error", del.status, detail);
          return res.status(502).json({ ok: false, error: "Merged fields saved and signups re-linked, but could not delete the duplicate player row — remove it manually in Airtable." });
        }
        return res.status(200).json({ ok: true, keepId: keepId, dropId: dropId, relinked: relinkIds.length });
      } catch (e) {
        console.error("player-merge exception", e);
        return res.status(500).json({ ok: false, error: "Something went wrong merging the players." });
      }
    }

    if (body.action === "config-write") {
      // Upsert a Tournament Config row keyed by the "Tournament" field.
      // Admin writes only. Body: { tournament, fields } where fields is a
      // plain object of Airtable field name → value. Missing fields are
      // left alone (PATCH semantics on update).
      const tournament = typeof body.tournament === "string" ? body.tournament.trim().slice(0, 200) : "";
      const fields = (body.fields && typeof body.fields === "object") ? body.fields : null;
      if (!tournament || !fields) return res.status(400).json({ ok: false, error: "Missing tournament or fields." });
      const cfgTable = process.env.CONFIG_TABLE || "Tournament Config";
      const cfgUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(cfgTable)}`;
      try {
        // Look up any existing row for this tournament.
        // Airtable formula strings support backslash-escaping inside
        // DOUBLE quotes but not single quotes — using {F}='O\'Brien' silently
        // matches nothing. Every tournament with an apostrophe (Couple's,
        // Founder's) was hitting this: existing lookup returned no match,
        // config-write would then insert a duplicate row instead of
        // updating the real one, and the next load would surface the stale
        // number the operator thought they saved over.
        // Fetch ALL matching rows (not maxRecords=1). The pre-PR-#286
        // apostrophe bug quietly inserted a duplicate row every save
        // attempt on tournaments whose names contain a ' (Couple's,
        // Founder's, etc.). The result: reads returned a random duplicate,
        // so a Team Cap = 18 save appeared to revert to whatever some
        // OTHER duplicate happened to have. Dedup on write: keep the
        // newest row, delete the older duplicates.
        const filter = "?filterByFormula=" + encodeURIComponent(`{Tournament}="${tournament.replace(/"/g, '\\"')}"`);
        const findRes = await fetch(cfgUrl + filter + "&pageSize=100", { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        if (!findRes.ok) {
          const detail = await findRes.text();
          console.error("config lookup error", findRes.status, detail);
          return res.status(502).json({ ok: false, error: "Could not read the config table." });
        }
        const found = await findRes.json();
        const matches = (found.records || []).slice().sort((a, b) => String(b.createdTime || "").localeCompare(String(a.createdTime || "")));
        const existing = matches[0] || null;
        const stragglers = matches.slice(1);
        // Delete duplicates in parallel — best-effort, non-blocking. A
        // failed delete doesn't fail the save; the next config-write on
        // this tournament will retry the cleanup.
        if (stragglers.length) {
          console.log(`config-write: deduping ${stragglers.length} stale row(s) for "${tournament}"`);
          await Promise.all(stragglers.map((rec) =>
            fetch(`${cfgUrl}/${rec.id}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
            }).catch((e) => console.error("dedup delete failed for", rec.id, e))
          ));
        }
        // Uniqueness guard on Public Slug — reject the save if any OTHER
        // tournament already owns this slug. Same-tournament re-saves are
        // fine (the existing row keeps its slug). Empty/whitespace slugs
        // aren't enforced (many tournaments won't have public cards yet).
        const wantSlug = String(fields["Public Slug"] || "").trim().toLowerCase();
        if (wantSlug) {
          const dupFilter = "?filterByFormula=" + encodeURIComponent(
            `AND(LOWER({Public Slug})="${wantSlug.replace(/"/g, '\\"')}", {Tournament}!="${tournament.replace(/"/g, '\\"')}")`
          ) + "&maxRecords=1";
          const dupRes = await fetch(cfgUrl + dupFilter, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
          if (dupRes.ok) {
            const dupJson = await dupRes.json();
            const dupRow = (dupJson.records || [])[0] || null;
            if (dupRow) {
              const owner = (dupRow.fields && dupRow.fields.Tournament) || "another tournament";
              return res.status(409).json({
                ok: false,
                error: `Public slug "${wantSlug}" is already taken by "${owner}". Pick a different slug — leading with the tournament date (e.g. "august-22-2026-couples-scramble") keeps every event unique across years.`,
              });
            }
          }
        }
        // Always merge the Tournament key on writes so brand-new rows
        // still get their identifier.
        const merged = Object.assign({ Tournament: tournament }, fields);
        // Auto-strip unknown fields + retry — same pattern the
        // tournament-checkin endpoint uses. Airtable's "Unknown field
        // name" 422 used to hard-fail the WHOLE Format save; now the
        // offender drops out and the rest lands so the operator's Team
        // Cap / Extras / Slug edits all still persist even if e.g.
        // "Extras JSON" hasn't been added to the base yet.
        // Response payload includes a `warning` naming any dropped
        // fields so the operator can add them to Airtable if needed.
        const stripped = new Set();
        let working = { ...merged };
        let lastDetail = "";
        let savedRec = null;
        for (let attempt = 0; attempt < 8; attempt++) {
          const write = existing
            ? { method: "PATCH", url: `${cfgUrl}/${existing.id}`, body: JSON.stringify({ fields: working, typecast: true }) }
            : { method: "POST", url: cfgUrl, body: JSON.stringify({ records: [{ fields: working }], typecast: true }) };
          const wr = await fetch(write.url, {
            method: write.method,
            headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
            body: write.body,
          });
          if (wr.ok) {
            const wjson = await wr.json();
            savedRec = existing ? wjson : (wjson.records && wjson.records[0]);
            break;
          }
          lastDetail = await wr.text();
          let missing = null;
          try {
            const parsed = JSON.parse(lastDetail);
            const emsg = parsed && parsed.error && parsed.error.message;
            const m = /Unknown field name[s]?:\s*"([^"]+)"/i.exec(emsg || "");
            if (m) missing = m[1];
          } catch (e) {}
          if (!missing) {
            console.error("config write error", wr.status, lastDetail);
            const msg = /Unknown field/i.test(lastDetail)
              ? "Airtable rejected the write — a field name in the payload doesn't exist in the Tournament Config table."
              : "Could not save the config.";
            return res.status(502).json({ ok: false, error: msg, detail: lastDetail });
          }
          stripped.add(missing);
          delete working[missing];
          // Never strip the identifier — without Tournament we couldn't
          // find the row on the next save either.
          if (!Object.keys(working).length || !working.Tournament) {
            return res.status(200).json({
              ok: true,
              id: null,
              fields: {},
              warning: "Nothing saved — every field in the update was missing on Airtable (" + [...stripped].join(", ") + "). Add them to the Tournament Config table.",
            });
          }
        }
        if (!savedRec) {
          console.error("config write exhausted retries", lastDetail);
          return res.status(502).json({ ok: false, error: "Could not save the config after 8 retry attempts.", detail: lastDetail });
        }
        const payload = { ok: true, id: savedRec.id, fields: savedRec.fields || merged };
        if (stripped.size) payload.warning = "Saved without " + [...stripped].join(", ") + " (add those fields on the Tournament Config table to store them).";
        return res.status(200).json(payload);
      } catch (e) {
        console.error("config write exception", e);
        return res.status(500).json({ ok: false, error: "Something went wrong writing the config." });
      }
    }

    if (body.action === "live-mint") {
      // Admin only. Body: { signupId, rotate?: boolean, email?: boolean, origin?: string }
      // Generates a random token (16 bytes hex) and writes it to the
      // Signup's "Live Token" field. Returns the shareable URL for the
      // captain. If a token already exists and rotate=false, reuses it —
      // the captain can text the same link across two days. Rotate=true
      // invalidates the old one (staff use if a phone is lost).
      // When email=true (default) and the signup has an Email on file, the
      // captain is auto-emailed the scoring link. Set email=false to just
      // mint the URL (staff copy/text manually).
      const signupId = typeof body.signupId === "string" ? body.signupId.trim() : "";
      if (!signupId) return res.status(400).json({ ok: false, error: "Missing signup id." });
      const rotate = !!body.rotate;
      const sendEmail = body.email !== false; // default true
      // Public origin so the emailed link points at fandhgolf.com, not the
      // internal Vercel URL. Falls back to a hard-coded value if the caller
      // doesn't hand one over.
      const origin = (typeof body.origin === "string" && /^https?:\/\//.test(body.origin))
        ? body.origin.replace(/\/$/, "")
        : "https://fandhgolf.com";
      const sigUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}/${signupId}`;
      try {
        // Read the signup so we have the captain's email + team + tournament
        // even when we're reusing an existing token.
        const gr = await fetch(sigUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        if (!gr.ok) return res.status(502).json({ ok: false, error: "Could not read the signup." });
        const rec = await gr.json();
        const f = (rec && rec.fields) || {};
        let captainEmail = String(f["Email"] || "").trim();
        const captainName = String(f["Player Name"] || "").trim();
        const tournamentName = String(f["Tournament"] || "").trim();
        // Fallback: the signup's Email column is a denormalized copy that
        // can lag behind the canonical Players row (operator sets an
        // email via the Player Card modal but never re-syncs the
        // signup). If it's blank AND this signup is linked to a Player,
        // pull the email off the Player. If we find one, also write it
        // back to the signup so subsequent mints don't re-fetch.
        if (!captainEmail && Array.isArray(f["Player"]) && f["Player"][0]) {
          const playerId = f["Player"][0];
          const playersTable = process.env.PLAYERS_TABLE || "Players";
          try {
            const pr = await fetch(
              `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(playersTable)}/${playerId}`,
              { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
            );
            if (pr.ok) {
              const pj = await pr.json();
              const pEmail = String((pj && pj.fields && pj.fields["Email"]) || "").trim();
              if (pEmail) {
                captainEmail = pEmail;
                // Best-effort back-fill on the signup. Non-blocking on
                // failure — we already have the email in memory.
                fetch(sigUrl, {
                  method: "PATCH",
                  headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ fields: { "Email": pEmail }, typecast: true }),
                }).catch((e) => console.error("live-mint email backfill failed", e));
              }
            }
          } catch (e) {
            console.error("live-mint player-lookup error", e);
          }
        }
        let token = rotate ? "" : String(f["Live Token"] || "").trim();
        if (!token) {
          token = require("crypto").randomBytes(16).toString("hex");
          const wr = await fetch(sigUrl, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ fields: { "Live Token": token }, typecast: true }),
          });
          if (!wr.ok) {
            const detail = await wr.text();
            console.error("live-mint write error", wr.status, detail);
            const msg = /Unknown field/i.test(detail)
              ? "Airtable is missing the 'Live Token' single-line-text field on Tournament Signups. Add it and try again."
              : "Could not mint the captain link.";
            return res.status(502).json({ ok: false, error: msg });
          }
        }
        const url = `${origin}/live.html?t=${token}`;
        // Best-effort email delivery. Failure to send doesn't fail the mint —
        // staff still has the URL to text/copy manually.
        let emailed = false;
        let emailError = null;
        if (sendEmail && captainEmail) {
          const key = process.env.RESEND_API_KEY;
          if (key) {
            const from = process.env.RESEND_FROM || "F&H Golf <noreply@fandhgolf.com>";
            const first = captainName.split(/\s+/)[0] || "there";
            const escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
            const subject = `Your scoring link — ${tournamentName || "F&H tournament"}`;
            const html = `
<p>Hi ${escHtml(first)},</p>
<p>Here's your live scoring link for <strong>${escHtml(tournamentName || "the tournament")}</strong>. Tap it on your phone at the first tee and it will open your team's scorecard. No password.</p>
<p><a href="${escHtml(url)}" style="display:inline-block;background:#17472A;color:#f6f2e8;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open my scorecard</a></p>
<p style="font-size:0.85rem;color:#666">Or paste this into your browser:<br><code>${escHtml(url)}</code></p>
<p style="font-size:0.85rem;color:#666">Add it to your home screen once it opens for one-tap access all round. Scores auto-save as you tap.</p>
<p>— F&amp;H Golf</p>`;
            try {
              const er = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
                body: JSON.stringify({ from, to: [captainEmail], subject, html }),
              });
              if (er.ok) { emailed = true; }
              else { emailError = await er.text().catch(() => ""); console.error("live-mint email failed", er.status, emailError); }
            } catch (e) {
              emailError = String(e && e.message || e);
              console.error("live-mint email error", e);
            }
          } else {
            emailError = "no-resend-key";
          }
        }
        return res.status(200).json({
          ok: true,
          token,
          url,
          captainEmail: captainEmail || null,
          emailed,
          emailError,
        });
      } catch (e) {
        console.error("live-mint exception", e);
        return res.status(500).json({ ok: false, error: "Something went wrong minting the link." });
      }
    }

    return res.status(400).json({ ok: false, error: "Unknown action." });
  }

  const q = req.query || {};

  // GET ?live=<token> — public read for a captain's phone. Returns the
  // captain's team, the tournament's par + config, and the current flight
  // leaderboard (stripped, non-Alt). No admin key required — the token
  // itself is the auth. Missing/expired tokens 401 so the phone page can
  // show a "link is no longer valid, ask the pro shop for a fresh one".
  if (q.live !== undefined && q.live !== "") {
    const token = String(q.live).trim().slice(0, 100);
    if (!/^[a-f0-9]{16,64}$/i.test(token)) {
      return res.status(401).json({ ok: false, error: "Invalid link." });
    }
    const cfgTable = process.env.CONFIG_TABLE || "Tournament Config";
    try {
      // Look up the signup that owns this token.
      const filter = "?filterByFormula=" + encodeURIComponent(`{Live Token}="${token.replace(/"/g, '\\"')}"`) + "&maxRecords=1";
      const listUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}${filter}`;
      const lr = await fetch(listUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      if (!lr.ok) {
        const detail = await lr.text();
        if (/Unknown field/i.test(detail)) {
          return res.status(500).json({ ok: false, error: "Live scoring isn't set up on Airtable yet — add a 'Live Token' single-line-text field on Tournament Signups." });
        }
        return res.status(502).json({ ok: false, error: "Could not verify the link." });
      }
      const lj = await lr.json();
      const me = (lj.records || [])[0];
      if (!me) return res.status(401).json({ ok: false, error: "This link is no longer valid. Ask the pro shop for a fresh one." });
      const tournament = String((me.fields && me.fields.Tournament) || "");
      // Fetch the tournament's config (pars, name, rounds) and its full
      // leaderboard-eligible field in parallel.
      const [cfgRes, fieldRes] = await Promise.all([
        fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(cfgTable)}?filterByFormula=${encodeURIComponent(`{Tournament}="${tournament.replace(/"/g, '\\"')}"`)}&maxRecords=1`,
          { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }),
        fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}?filterByFormula=${encodeURIComponent(`AND({Tournament}="${tournament.replace(/"/g, '\\"')}", NOT({Alternate}))`)}&pageSize=100`,
          { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }),
      ]);
      const cfg = cfgRes.ok ? ((await cfgRes.json()).records || [])[0] : null;
      const fieldRows = fieldRes.ok ? ((await fieldRes.json()).records || []) : [];
      const stripField = (rec) => {
        const f = rec.fields || {};
        return {
          id: rec.id,
          teamName: f["Player Name"] || "",
          partners: f["Team / Partners"] || "",
          flight: f["Flight"] || null,
          // Shotgun start hole (1..9). Comes from Pairings; used by the phone
          // app to land the captain on their tee hole instead of hole 1, and
          // to navigate holes in play order (H, H+1, …, wrap to H-1).
          hole: (typeof f["Hole"] === "number") ? f["Hole"] : null,
          slot: f["Slot"] || "",
          seat: (typeof f["Seat"] === "number") ? f["Seat"] : null,
          start: f["Start"] || "", // "8 AM" / "1 PM"
          d2Hole: (typeof f["Day 2 Hole"] === "number") ? f["Day 2 Hole"] : null,
          d2Slot: f["Day 2 Slot"] || "",
          d2Seat: (typeof f["Day 2 Seat"] === "number") ? f["Day 2 Seat"] : null,
          d2Start: f["Day 2 Start"] || "",
          day1: f["Day1 Scores"] || "",
          day2: f["Day2 Scores"] || "",
          day1Gross: f["Day1 Gross"] || null,
          day2Gross: f["Day2 Gross"] || null,
          // Extras: purchased is a sparse per-player map (staff writes it
          // on Check-In), used is a team-wide count per extra name that
          // the captain increments from their phone. Both are Long text
          // JSON strings; the phone app parses.
          extrasPurchased: f["Extras Purchased"] || "",
          extrasUsed: f["Extras Used"] || "",
          // Per-team override from Check-In: this captain scores the
          // whole group for their tee (both their team and everyone
          // else paired with them). Default false = standard
          // USGA-style marker pairing (A marks B, B marks A, etc.).
          groupScorer: !!f["Group Scorer"],
        };
      };
      const markerScoringEnabled = !!(cfg && cfg.fields && cfg.fields["Marker Scoring Enabled"]);
      const meStripped = stripField(me);
      const fieldStripped = fieldRows.map(stripField);
      // Compute the marker assignment for THIS captain on Day 1 + Day 2.
      // - "self" mode: marker scoring off for the tournament, or captain
      //   is on a solo tee with nobody paired.
      // - "group_scorer" mode: captain has Group Scorer flag → can write
      //   every tee-mate (self + others).
      // - "spectator" mode: another team on the tee is Group Scorer →
      //   no write access; captain sees everyone read-only.
      // - "marker" mode (default when marker scoring is on): captain
      //   writes exactly one other team, cycling through the tee-mates
      //   sorted by (Slot, Seat). A→B, B→C, C→A for trios.
      const assign = (dayKey) => {
        const holeKey = dayKey === "d1" ? "hole" : "d2Hole";
        const slotKey = dayKey === "d1" ? "slot" : "d2Slot";
        const seatKey = dayKey === "d1" ? "seat" : "d2Seat";
        const startKey = dayKey === "d1" ? "start" : "d2Start";
        const myHole = meStripped[holeKey];
        const myStart = meStripped[startKey];
        // Baseline shape returned when nothing matches or marker mode is off.
        const base = { mode: "self", writeTargets: [meStripped.id], marking: null, teeMates: [], groupScorerName: null };
        if (!markerScoringEnabled) return base;
        if (myHole == null || !myStart) return base; // no pairing yet → self-score
        const mates = fieldStripped
          .filter((r) => r[holeKey] === myHole && r[startKey] === myStart)
          .sort((a, b) => (String(a[slotKey]).localeCompare(String(b[slotKey])) || ((a[seatKey] || 0) - (b[seatKey] || 0)) || String(a.id).localeCompare(String(b.id))));
        if (mates.length <= 1) return base; // solo tee → self-score fallback
        const meIdx = mates.findIndex((r) => r.id === meStripped.id);
        const groupScorer = mates.find((r) => r.groupScorer);
        // Someone on this tee — including possibly me — is the group scorer.
        if (groupScorer) {
          if (groupScorer.id === meStripped.id) {
            return {
              mode: "group_scorer",
              writeTargets: mates.map((r) => r.id),
              marking: null,
              teeMates: mates,
              groupScorerName: groupScorer.teamName,
            };
          }
          return {
            mode: "spectator",
            writeTargets: [],
            marking: null,
            teeMates: mates,
            groupScorerName: groupScorer.teamName,
          };
        }
        // Standard marker cycle — A→B, B→C, C→A.
        const target = mates[(meIdx + 1) % mates.length];
        return {
          mode: "marker",
          writeTargets: [target.id],
          marking: target.id,
          teeMates: mates,
          groupScorerName: null,
        };
      };
      const d1 = assign("d1");
      const d2 = assign("d2");
      return res.status(200).json({
        ok: true,
        team: meStripped,
        tournament,
        config: cfg ? {
          name: cfg.fields["Name"] || tournament,
          rounds: cfg.fields["Rounds"] || 1,
          playersPerTeam: cfg.fields["Players Per Team"] || 2,
          // Extras list from Format tab. Phone app renders one button
          // per configured extra so the captain can tap when a mulligan
          // (or string, or whatever the operator added) gets used up.
          extras: cfg.fields["Extras JSON"] || "",
          markerScoring: markerScoringEnabled,
        } : { name: tournament, rounds: 1, playersPerTeam: 2, extras: "", markerScoring: false },
        // Per-day marker assignment: which team(s) this captain can
        // score, and which tee-mates to display read-only alongside.
        // Empty writeTargets = spectator (all read-only).
        markerAssignment: { d1: d1, d2: d2 },
        field: fieldStripped,
      });
    } catch (e) {
      console.error("live read exception", e);
      return res.status(500).json({ ok: false, error: "Something went wrong loading your scorecard." });
    }
  }

  // GET ?config=<tournament name> returns a single Tournament Config row.
  // GET ?config=1 returns every config row. Public — this feeds the
  // shareable public tournament card, so no admin key required.
  if (q.config !== undefined && q.config !== "") {
    const cfgTable = process.env.CONFIG_TABLE || "Tournament Config";
    const cfgUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(cfgTable)}`;
    const wantAll = q.config === "1" || q.config === 1 || q.config === "all";
    // Short CDN cache. Long enough to absorb a burst on tournament pages,
    // short enough that a Format save shows up on fandhgolf.com in seconds
    // — the last thing we want is "I saved Team Cap 18 but the public page
    // is still showing 22" for two minutes.
    res.setHeader("Cache-Control", "public, s-maxage=5, stale-while-revalidate=30");
    try {
      let url = cfgUrl + "?pageSize=100";
      if (!wantAll) {
        const name = String(q.config).slice(0, 200);
        // NOTE: no maxRecords=1 here. Duplicate rows still linger for
        // tournaments whose names contain apostrophes (pre-PR-#286
        // bug). If Airtable's default sort returns an older duplicate
        // first, the operator sees stale data. Fetch all matches +
        // pick the newest below.
        url += "&filterByFormula=" + encodeURIComponent(`{Tournament}="${name.replace(/"/g, '\\"')}"`) + "&pageSize=100";
      }
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      if (!r.ok) {
        const detail = await r.text();
        console.error("config read error", r.status, detail);
        return res.status(502).json({ ok: false, error: "Could not load the config.", detail });
      }
      const data = await r.json();
      let rows = (data.records || [])
        .slice()
        .sort((a, b) => String(b.createdTime || "").localeCompare(String(a.createdTime || "")))
        .map((rec) => ({ id: rec.id, fields: rec.fields || {} }));
      // Course-wide settings live in a "__course__" sentinel row (edited
      // from the Staff Portal's Tournaments page). Hide it from the
      // config=all listing so it never shows up as a phantom tournament.
      if (wantAll) rows = rows.filter((r) => (r.fields && r.fields.Tournament) !== "__course__");
      // Dedup by Tournament name: the pre-PR-#286 apostrophe bug left
      // multiple rows per tournament for Couple's / Founder's / etc.
      // The public list has to pick ONE — always the newest. Same reason
      // config-write cleans up on write; this covers reads that happen
      // before the next write triggers a cleanup.
      if (wantAll) {
        const seen = Object.create(null);
        rows = rows.filter((r) => {
          const key = (r.fields && r.fields.Tournament) || "";
          if (seen[key]) return false;
          seen[key] = true;
          return true;
        });
      }
      if (wantAll) return res.status(200).json({ ok: true, count: rows.length, records: rows });
      return res.status(200).json({ ok: true, record: rows[0] || null });
    } catch (e) {
      console.error("config read exception", e);
      return res.status(500).json({ ok: false, error: "Something went wrong loading the config." });
    }
  }

  // GET ?archives=1 returns the archive list. Public — tournament results are
  // published information, so anyone can browse the historical record.
  if (q.archives === "1" || q.archives === 1) {
    if (!isAdmin) res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    try {
      const archs = [];
      let offset = "";
      for (let guard = 0; guard < 20; guard++) {
        const url = archivesUrl + "?pageSize=100" + (offset ? "&offset=" + encodeURIComponent(offset) : "");
        const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        if (!r.ok) {
          const detail = await r.text();
          console.error("archives list error", r.status, detail);
          return res.status(502).json({ ok: false, error: "Could not load archives.", detail });
        }
        const data = await r.json();
        (data.records || []).forEach((rec) => archs.push({ id: rec.id, created: rec.createdTime, fields: rec.fields || {} }));
        if (!data.offset) break;
        offset = data.offset;
      }
      // Newest year first.
      archs.sort((a, b) => String(b.fields.Year || "").localeCompare(String(a.fields.Year || "")));
      return res.status(200).json({ ok: true, count: archs.length, records: archs });
    } catch (e) {
      console.error("archives list exception", e);
      return res.status(500).json({ ok: false, error: "Something went wrong loading archives." });
    }
  }

  // Admin burst-coalescing cache — serve the last payload if it's under
  // ADMIN_CACHE_MS old. Not authoritative across container boundaries
  // (each warm Vercel instance has its own memory), but a big help within
  // a single instance during check-in / auction rush.
  if (isAdmin && _adminCache && (Date.now() - _adminCacheAt) < ADMIN_CACHE_MS) {
    res.setHeader("Cache-Control", "private, max-age=1");
    res.setHeader("X-FH-Cache", "hit");
    return res.status(200).json(_adminCache);
  }

  try {
    const records = [];
    let offset = "";
    for (let guard = 0; guard < 50; guard++) {
      const url = listUrl + "?pageSize=100" + (offset ? "&offset=" + encodeURIComponent(offset) : "");
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      if (!r.ok) {
        const detail = await r.text();
        console.error("Airtable tournament read error", r.status, detail);
        const msg = r.status === 403
          ? "Airtable refused the read. The token likely needs the 'data.records:read' scope."
          : "Could not load sign-ups right now.";
        return res.status(502).json({ ok: false, error: msg });
      }
      const data = await r.json();
      (data.records || []).forEach((rec) => records.push({ id: rec.id, created: rec.createdTime, fields: rec.fields || {} }));
      if (!data.offset) break;
      offset = data.offset;
    }
    records.sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
    const out = isAdmin ? records : records.map(stripRecord);
    // Public displays poll every ~15s — allow a tiny edge cache but keep it
    // fresh enough that new scores/buyers show up on the TV promptly. Admin
    // gets a 1-second browser cache so mashing Refresh doesn't storm the API.
    if (!isAdmin) res.setHeader("Cache-Control", "public, s-maxage=10, stale-while-revalidate=30");
    else res.setHeader("Cache-Control", "private, max-age=1");
    const payload = { ok: true, count: out.length, records: out };
    if (!isAdmin) payload.totals = buildTotals(records);
    // Public auction state — read from the Tournament Config table so the
    // Calcutta display can show only the flight currently up for auction.
    // Admin doesn't use this field (staff drive the auction directly), so
    // skip the extra Airtable round-trip on admin GETs. Public GET is
    // already edge-cached, so this only fires ~once per 10s regardless of
    // TV-display polling.
    if (!isAdmin) {
      try {
        const cfgTable = process.env.CONFIG_TABLE || "Tournament Config";
        const cfgUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(cfgTable)}?pageSize=100`;
        const cr = await fetch(cfgUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        if (cr.ok) {
          const cdata = await cr.json();
          const auctionStates = {};
          const recaps = {};
          (cdata.records || []).forEach((rec) => {
            const f = rec.fields || {};
            const name = String(f["Tournament"] || "").trim();
            if (!name) return;
            if (typeof f["Auction State"] === "string") {
              try { auctionStates[name] = JSON.parse(f["Auction State"]) || {}; } catch (e) {}
            }
            // Public recap text -- the operator publishes it from the admin
            // Recap tab and any page (e.g. founders-recap.html) can render
            // it without needing admin auth.
            if (typeof f["Recap"] === "string" && f["Recap"].trim()) recaps[name] = f["Recap"];
          });
          payload.auctionStates = auctionStates;
          payload.recaps = recaps;
        }
      } catch (e) { /* auction-state read is best-effort */ }
    }
    if (isAdmin) { _adminCache = payload; _adminCacheAt = Date.now(); }
    return res.status(200).json(payload);
  } catch (e) {
    console.error("tournament-signups read error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong loading sign-ups." });
  }
};
