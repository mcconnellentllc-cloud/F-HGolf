// Vercel serverless function — returns tournament sign-ups for the Staff Portal.
// Read-only, protected by the admin key (it includes participant contact info).
//
// Env: AIRTABLE_TOKEN (data.records:read), AIRTABLE_BASE_ID,
//      TOURNAMENTS_TABLE (defaults to "Tournament Signups"), ADMIN_KEY.

module.exports = async (req, res) => {
  if (require("./_cors")(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, ADMIN_KEY } = process.env;
  const TABLE = process.env.TOURNAMENTS_TABLE || "Tournament Signups";
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return res.status(500).json({ ok: false, error: "Sign-ups aren't configured yet." });
  }

  const key = req.headers["x-admin-key"] || "";
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const listUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}`;
    const records = [];
    let offset = "";
    // Page through every record (Airtable returns up to 100 per page).
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
    return res.status(200).json({ ok: true, count: records.length, records });
  } catch (e) {
    console.error("tournament-signups read error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong loading sign-ups." });
  }
};
