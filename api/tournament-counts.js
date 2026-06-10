// Vercel serverless function — PUBLIC sign-up counts per tournament, used to
// show "% full" on the public Tournaments page. Returns ONLY counts (no names,
// emails, or any personal info), so it's safe to be public / unauthenticated.
//
// Env: AIRTABLE_TOKEN (data.records:read), AIRTABLE_BASE_ID, TOURNAMENTS_TABLE.

module.exports = async (req, res) => {
  if (require("./_cors")(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const TABLE = process.env.TOURNAMENTS_TABLE || "Tournament Signups";
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return res.status(200).json({ ok: true, counts: {} });
  }

  try {
    const counts = {};
    let offset = null;
    for (let page = 0; page < 10; page++) {
      let url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}?pageSize=100&fields%5B%5D=Tournament`;
      if (offset) url += "&offset=" + encodeURIComponent(offset);
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      if (!r.ok) { console.error("counts read", r.status, await r.text()); break; }
      const data = await r.json();
      (data.records || []).forEach(function (rec) {
        const t = rec.fields && rec.fields["Tournament"];
        if (t) counts[t] = (counts[t] || 0) + 1;
      });
      offset = data.offset;
      if (!offset) break;
    }
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.status(200).json({ ok: true, counts: counts });
  } catch (e) {
    console.error("tournament-counts error", e);
    return res.status(200).json({ ok: true, counts: {} }); // fail soft
  }
};
