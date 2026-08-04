// Vercel serverless function — removes a tournament sign-up / team (staff only,
// admin-key protected). Deletes the record from the "Tournament Signups" table.
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
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return res.status(500).json({ ok: false, error: "Not configured." });
  }

  const key = req.headers["x-admin-key"] || "";
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return res.status(400).json({ ok: false, error: "Missing record id." });

  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}/${id}`;
    const r = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    if (!r.ok) {
      const detail = await r.text();
      console.error("tournament-remove error", r.status, detail);
      return res.status(502).json({ ok: false, error: "Could not remove the team." });
    }
    return res.status(200).json({ ok: true, id });
  } catch (e) {
    console.error("tournament-remove error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong removing the team." });
  }
};
