// Vercel serverless function — bulk-assigns flights to teams (staff only,
// admin-key). Batches up to 10 records per Airtable request to stay well under
// the rate limit.
//
// Body: { assignments: [ { id, flight }, ... ] }   flight = 1..N or "" to clear
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
  if (!Array.isArray(body.assignments)) return res.status(400).json({ ok: false, error: "assignments must be a list." });

  const records = body.assignments
    .filter((a) => a && typeof a.id === "string")
    .map((a) => {
      const f = (a.flight === "" || a.flight == null) ? null : Number(a.flight);
      return { id: a.id, fields: { Flight: (f != null && isFinite(f)) ? f : null } };
    });
  if (!records.length) return res.status(400).json({ ok: false, error: "Nothing to assign." });

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}`;
  try {
    let updated = 0;
    for (let i = 0; i < records.length; i += 10) {
      const chunk = records.slice(i, i + 10);
      const r = await fetch(url, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ records: chunk, typecast: true }),
      });
      if (!r.ok) {
        const d = await r.text(); console.error("flights patch", r.status, d);
        return res.status(502).json({ ok: false, error: "Could not save flights (is the Flight number field on the table?)." });
      }
      const data = await r.json();
      updated += (data.records || []).length;
    }
    return res.status(200).json({ ok: true, updated });
  } catch (e) {
    console.error("tournament-flights error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong assigning flights." });
  }
};
