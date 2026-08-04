// Vercel serverless function — team positioning for a tournament (staff only,
// admin-key). Two jobs, both batched ≤10 records/request to respect rate limits:
//   POST { assignments: [ { id, start?, hole? } ] }   -> move teams (wave/hole)
//   POST { action: "import", tournament, teams: [ { name, start } ] } -> seed field
//
// Needs a "Start" (single select) and "Hole" (number) field on Tournament Signups.
//
// Env: AIRTABLE_TOKEN (data.records:write), AIRTABLE_BASE_ID,
//      TOURNAMENTS_TABLE (defaults to "Tournament Signups"), ADMIN_KEY.

module.exports = async (req, res) => {
  if (require("./_cors")(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, ADMIN_KEY } = process.env;
  const TABLE = process.env.TOURNAMENTS_TABLE || "Tournament Signups";
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) return res.status(500).json({ ok: false, error: "Not configured." });
  const key = req.headers["x-admin-key"] || "";
  if (!ADMIN_KEY || key !== ADMIN_KEY) return res.status(401).json({ ok: false, error: "Unauthorized" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}`;
  const auth = { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" };
  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  try {
    if (body.action === "import") {
      const tournament = clean(body.tournament, 120);
      if (!tournament || !Array.isArray(body.teams)) return res.status(400).json({ ok: false, error: "tournament and teams required." });
      const records = body.teams
        .map((t) => {
          const name = clean(t.name, 200);
          if (!name) return null;
          const fields = { "Player Name": name, Tournament: tournament, Status: "New" };
          const start = clean(t.start, 20); if (start) fields.Start = start;
          return { fields };
        })
        .filter(Boolean);
      if (!records.length) return res.status(400).json({ ok: false, error: "No teams to import." });
      let created = 0;
      for (let i = 0; i < records.length; i += 10) {
        const r = await fetch(url, { method: "POST", headers: auth, body: JSON.stringify({ records: records.slice(i, i + 10), typecast: true }) });
        if (!r.ok) { const d = await r.text(); console.error("position import", r.status, d); return res.status(502).json({ ok: false, error: "Import failed partway. Some teams may have been added." }); }
        const data = await r.json();
        created += (data.records || []).length;
      }
      return res.status(200).json({ ok: true, created });
    }

    if (!Array.isArray(body.assignments)) return res.status(400).json({ ok: false, error: "assignments must be a list." });
    const records = body.assignments
      .filter((a) => a && typeof a.id === "string")
      .map((a) => {
        const fields = {};
        if (typeof a.start === "string") fields.Start = a.start ? a.start.slice(0, 20) : null;
        if (a.hole !== undefined) { const h = Number(a.hole); fields.Hole = (a.hole === "" || a.hole == null || !isFinite(h)) ? null : h; }
        return { id: a.id, fields };
      })
      .filter((r) => Object.keys(r.fields).length);
    if (!records.length) return res.status(400).json({ ok: false, error: "Nothing to move." });
    let updated = 0;
    for (let i = 0; i < records.length; i += 10) {
      const r = await fetch(url, { method: "PATCH", headers: auth, body: JSON.stringify({ records: records.slice(i, i + 10), typecast: true }) });
      if (!r.ok) { const d = await r.text(); console.error("position patch", r.status, d); return res.status(502).json({ ok: false, error: "Could not save positions (is the Hole number field on the table?)." }); }
      const data = await r.json();
      updated += (data.records || []).length;
    }
    return res.status(200).json({ ok: true, updated });
  } catch (e) {
    console.error("tournament-position error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong positioning teams." });
  }
};
