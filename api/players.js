// Vercel serverless function — Players table CRUD (staff only, admin-key).
// Canonical customer records: one row per person, deduped across tournaments.
//
//   GET  /api/players                   -> list all
//   GET  /api/players?id=recXXX         -> fetch one
//   GET  /api/players?name=Rydge+Peterson  -> case-insensitive name search
//   POST /api/players  body: { id?, ...fields }  -> create or update
//
// The Airtable "Players" table needs these fields (create in Airtable):
//   Name (single line, primary), Phone, Email, Street, City, State, Zip,
//   Member (checkbox), Notes (long text)
//
// Env: AIRTABLE_TOKEN (data.records:read+write), AIRTABLE_BASE_ID,
//      PLAYERS_TABLE (defaults to "Players"), ADMIN_KEY.

module.exports = async (req, res) => {
  if (require("./_cors")(req, res)) return;
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, ADMIN_KEY } = process.env;
  const TABLE = process.env.PLAYERS_TABLE || "Players";
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) return res.status(500).json({ ok: false, error: "Not configured." });
  // Accept either the real admin key or a tournament-scoped staff token
  // so a staff link on tournament-admin.html can still resolve names
  // when promoting captains. Staff tokens don't get to WRITE to the
  // Players table — only read (GET). POSTs still require admin.
  const auth = require("./_auth")(req);
  if (!auth) return res.status(401).json({ ok: false, error: "Unauthorized" });
  if (req.method !== "GET" && auth.mode === "staff") {
    return res.status(403).json({ ok: false, error: "Staff links can't edit the Players directory." });
  }

  const base = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}`;
  const authRead = { Authorization: `Bearer ${AIRTABLE_TOKEN}` };
  const authWrite = { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" };
  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  function notReady(status, detail) {
    if (status !== 403 && status !== 404 && !/NOT_FOUND|MODEL_ID_NOT_FOUND|TABLE_NOT_FOUND|AUTHENTICATION_REQUIRED|INVALID_PERMISSIONS/i.test(detail || "")) return false;
    return true;
  }

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      const id = typeof q.id === "string" ? q.id : "";
      const name = typeof q.name === "string" ? q.name.trim() : "";

      if (id) {
        const r = await fetch(`${base}/${id}`, { headers: authRead });
        if (!r.ok) {
          const d = await r.text();
          if (notReady(r.status, d)) return res.status(200).json({ ok: true, notReady: true, records: [] });
          return res.status(502).json({ ok: false, error: "Could not load player." });
        }
        const data = await r.json();
        return res.status(200).json({ ok: true, records: [{ id: data.id, fields: data.fields || {} }] });
      }

      let url = base + "?pageSize=100";
      if (name) {
        const safe = name.replace(/"/g, '\\"');
        url += `&filterByFormula=${encodeURIComponent(`LOWER({Name})=LOWER("${safe}")`)}`;
      }
      const out = [];
      let offset = "";
      for (let guard = 0; guard < 20; guard++) {
        const r = await fetch(url + (offset ? `&offset=${encodeURIComponent(offset)}` : ""), { headers: authRead });
        if (!r.ok) {
          const d = await r.text();
          if (notReady(r.status, d)) return res.status(200).json({ ok: true, notReady: true, records: [] });
          console.error("players list error", r.status, d);
          return res.status(502).json({ ok: false, error: "Could not load players." });
        }
        const data = await r.json();
        (data.records || []).forEach((rec) => out.push({ id: rec.id, fields: rec.fields || {} }));
        if (!data.offset) break;
        offset = data.offset;
      }
      return res.status(200).json({ ok: true, count: out.length, records: out });
    }

    // POST — create or update
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    const fields = {};
    if (typeof body.name === "string") fields.Name = clean(body.name, 120);
    if (typeof body.phone === "string") fields.Phone = clean(body.phone, 40);
    if (typeof body.email === "string") fields.Email = clean(body.email, 200);
    if (typeof body.street === "string") fields.Street = clean(body.street, 200);
    if (typeof body.city === "string") fields.City = clean(body.city, 100);
    if (typeof body.state === "string") fields.State = clean(body.state, 20);
    if (typeof body.zip === "string") fields.Zip = clean(body.zip, 20);
    if (typeof body.member === "boolean") fields.Member = body.member;
    if (typeof body.notes === "string") fields.Notes = clean(body.notes, 2000);

    if (!Object.keys(fields).length) return res.status(400).json({ ok: false, error: "Nothing to save." });

    const id = typeof body.id === "string" ? body.id : "";
    if (id) {
      const r = await fetch(`${base}/${id}`, { method: "PATCH", headers: authWrite, body: JSON.stringify({ fields, typecast: true }) });
      const detail = await r.text();
      if (!r.ok) {
        if (notReady(r.status, detail)) return res.status(200).json({ ok: false, notReady: true });
        console.error("players update error", r.status, detail);
        return res.status(502).json({ ok: false, error: "Could not update player." });
      }
      const data = JSON.parse(detail);
      return res.status(200).json({ ok: true, id: data.id, fields: data.fields || {} });
    }

    // Create — need at least Name to avoid empty phantom records
    if (!fields.Name) return res.status(400).json({ ok: false, error: "Name is required for a new player." });
    const r = await fetch(base, { method: "POST", headers: authWrite, body: JSON.stringify({ records: [{ fields }], typecast: true }) });
    const detail = await r.text();
    if (!r.ok) {
      if (notReady(r.status, detail)) return res.status(200).json({ ok: false, notReady: true });
      console.error("players create error", r.status, detail);
      return res.status(502).json({ ok: false, error: "Could not create player." });
    }
    const data = JSON.parse(detail);
    const rec = (data.records || [])[0] || {};
    return res.status(200).json({ ok: true, id: rec.id, fields: rec.fields || {} });
  } catch (e) {
    console.error("players error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong." });
  }
};
