// Vercel serverless function — returns Hall of Fame nominations from Airtable
// for the Staff Portal. Read-only. Protected by an admin key so the list (which
// can include submitter contact info) is never publicly dumped.
//
// Env vars required:
//   AIRTABLE_TOKEN    – token with data.records:READ (add this scope!)
//   AIRTABLE_BASE_ID  – e.g. appAwEdD9m6OVN6lg
//   AIRTABLE_TABLE    – "Hall of Fame Nominations"
//   ADMIN_KEY         – shared secret the portal sends (e.g. the staff password)

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE, ADMIN_KEY } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE) {
    return res.status(500).json({ ok: false, error: "Nominations aren't configured yet." });
  }

  // Auth: the portal sends the staff key. No key set or mismatch → refuse.
  const key = req.headers["x-admin-key"] || "";
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}?pageSize=100`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    if (!r.ok) {
      const detail = await r.text();
      console.error("Airtable read error", r.status, detail);
      const msg = r.status === 403
        ? "Airtable refused the read. The token likely needs the 'data.records:read' scope."
        : "Could not load nominations right now.";
      return res.status(502).json({ ok: false, error: msg });
    }
    const data = await r.json();
    const records = (data.records || []).map((rec) => ({
      id: rec.id,
      created: rec.createdTime,
      fields: rec.fields || {},
    }));
    // newest first (Airtable always returns createdTime, regardless of schema)
    records.sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
    return res.status(200).json({ ok: true, count: records.length, records });
  } catch (e) {
    console.error("nominations read error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong loading nominations." });
  }
};
