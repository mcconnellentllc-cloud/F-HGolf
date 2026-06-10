// Vercel serverless function — returns PUBLISHED (Status = "Approved") course
// reviews for the public Reviews page. Read-only, no auth needed because it
// only ever returns approved reviews and safe fields (name, rating, text,
// date) — never email or pending/hidden reviews.
//
// Env vars: AIRTABLE_TOKEN (data.records:read), AIRTABLE_BASE_ID, REVIEWS_TABLE.

module.exports = async (req, res) => {
  if (require("./_cors")(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const TABLE = process.env.REVIEWS_TABLE || "Reviews";
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return res.status(200).json({ ok: true, records: [] });
  }

  try {
    const params = "filterByFormula=" + encodeURIComponent("{Status}='Approved'") + "&pageSize=100";
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}?${params}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    if (!r.ok) {
      const detail = await r.text();
      console.error("Airtable reviews read error", r.status, detail);
      // Fail soft: the page falls back to its "around the web" content.
      return res.status(200).json({ ok: true, records: [] });
    }
    const data = await r.json();
    const records = (data.records || []).map((rec) => {
      const f = rec.fields || {};
      return {
        id: rec.id,
        created: rec.createdTime,
        name: f["Reviewer Name"] || "",
        rating: Number(f["Rating"]) || 0,
        review: f["Review"] || "",
      };
    });
    records.sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
    return res.status(200).json({ ok: true, count: records.length, records });
  } catch (e) {
    console.error("reviews read error", e);
    return res.status(200).json({ ok: true, records: [] });
  }
};
