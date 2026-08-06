// Vercel serverless function — Tournament Signups list + remove.
//
//   GET  (no key)         -> stripped public payload (team + scores + calcutta
//                            + flight), safe to expose on TV / phone displays.
//   GET  (x-admin-key)    -> full record set including contact + payment info.
//   POST (x-admin-key) { action: "remove", id } -> delete a record.
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

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    if (body.action !== "remove") return res.status(400).json({ ok: false, error: "Unknown action." });
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
    // fresh enough that new scores/buyers show up on the TV promptly.
    if (!isAdmin) res.setHeader("Cache-Control", "public, s-maxage=10, stale-while-revalidate=30");
    const payload = { ok: true, count: out.length, records: out };
    if (!isAdmin) payload.totals = buildTotals(records);
    return res.status(200).json(payload);
  } catch (e) {
    console.error("tournament-signups read error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong loading sign-ups." });
  }
};
