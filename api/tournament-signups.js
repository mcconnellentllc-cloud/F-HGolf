// Vercel serverless function — Tournament Signups list + remove + archives.
//
//   GET  (no key)             -> stripped public payload (team + scores +
//                                calcutta + flight), safe for TV / phone.
//   GET  (x-admin-key)        -> full record set including contact info.
//   GET  ?archives=1 (admin)  -> list rows from the Tournament Archives table.
//   POST (admin) { action: "remove", id }
//   POST (admin) { action: "archive", name, year, dates, snapshot }
//        -> write a snapshot to the Tournament Archives table.
//
// Consolidates the old tournament-remove endpoint here to stay under Vercel's
// serverless-function cap. Read-only tools still hit GET; frontend uses POST
// with an action body instead of DELETE so shared CORS (GET/POST/OPTIONS) works
// without changes.
//
// Env: AIRTABLE_TOKEN (data.records:read+write), AIRTABLE_BASE_ID,
//      TOURNAMENTS_TABLE (defaults to "Tournament Signups"), ADMIN_KEY.

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

    return res.status(400).json({ ok: false, error: "Unknown action." });
  }

  // GET ?archives=1 returns the archive list. Public — tournament results are
  // published information, so anyone can browse the historical record.
  const q = req.query || {};
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
