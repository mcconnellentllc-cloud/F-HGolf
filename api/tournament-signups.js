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
        const filter = "?filterByFormula=" + encodeURIComponent(`{Tournament}='${tournament.replace(/'/g, "\\'")}'`);
        const findRes = await fetch(cfgUrl + filter + "&maxRecords=1", { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        if (!findRes.ok) {
          const detail = await findRes.text();
          console.error("config lookup error", findRes.status, detail);
          return res.status(502).json({ ok: false, error: "Could not read the config table." });
        }
        const found = await findRes.json();
        const existing = (found.records || [])[0] || null;
        // Uniqueness guard on Public Slug — reject the save if any OTHER
        // tournament already owns this slug. Same-tournament re-saves are
        // fine (the existing row keeps its slug). Empty/whitespace slugs
        // aren't enforced (many tournaments won't have public cards yet).
        const wantSlug = String(fields["Public Slug"] || "").trim().toLowerCase();
        if (wantSlug) {
          const dupFilter = "?filterByFormula=" + encodeURIComponent(
            `AND(LOWER({Public Slug})='${wantSlug.replace(/'/g, "\\'")}', {Tournament}!='${tournament.replace(/'/g, "\\'")}')`
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
        // Airtable rejects unknown fields — surface a helpful error if
        // the schema hasn't been extended yet. `typecast: true` lets
        // Airtable coerce strings into single-select options / numbers.
        const write = existing
          ? {
              method: "PATCH",
              url: `${cfgUrl}/${existing.id}`,
              body: JSON.stringify({ fields: merged, typecast: true }),
            }
          : {
              method: "POST",
              url: cfgUrl,
              body: JSON.stringify({ records: [{ fields: merged }], typecast: true }),
            };
        const wr = await fetch(write.url, {
          method: write.method,
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
          body: write.body,
        });
        if (!wr.ok) {
          const detail = await wr.text();
          console.error("config write error", wr.status, detail);
          const msg = /Unknown field/i.test(detail)
            ? "Airtable rejected the write — a field name in the payload doesn't exist in the Tournament Config table."
            : "Could not save the config.";
          return res.status(502).json({ ok: false, error: msg, detail });
        }
        const wjson = await wr.json();
        const saved = existing ? wjson : (wjson.records && wjson.records[0]);
        return res.status(200).json({ ok: true, id: saved && saved.id, fields: (saved && saved.fields) || merged });
      } catch (e) {
        console.error("config write exception", e);
        return res.status(500).json({ ok: false, error: "Something went wrong writing the config." });
      }
    }

    return res.status(400).json({ ok: false, error: "Unknown action." });
  }

  const q = req.query || {};

  // GET ?config=<tournament name> returns a single Tournament Config row.
  // GET ?config=1 returns every config row. Public — this feeds the
  // shareable public tournament card, so no admin key required.
  if (q.config !== undefined && q.config !== "") {
    const cfgTable = process.env.CONFIG_TABLE || "Tournament Config";
    const cfgUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(cfgTable)}`;
    const wantAll = q.config === "1" || q.config === 1 || q.config === "all";
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    try {
      let url = cfgUrl + "?pageSize=100";
      if (!wantAll) {
        const name = String(q.config).slice(0, 200);
        url += "&filterByFormula=" + encodeURIComponent(`{Tournament}='${name.replace(/'/g, "\\'")}'`) + "&maxRecords=1";
      }
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      if (!r.ok) {
        const detail = await r.text();
        console.error("config read error", r.status, detail);
        return res.status(502).json({ ok: false, error: "Could not load the config.", detail });
      }
      const data = await r.json();
      const rows = (data.records || []).map((rec) => ({ id: rec.id, fields: rec.fields || {} }));
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
