// Vercel serverless function — saves a team's hole-by-hole gross for one round
// (staff only, admin-key protected). Writes to the "Tournament Signups" record.
//
// Add these fields to the Tournament Signups table first:
//   Day1 Scores (long text)   Day2 Scores (long text)   -- JSON array of holes
//   Day1 Gross  (number)      Day2 Gross  (number)
//   Flight      (number)      -- set later by the leaderboard flight slider
//
// Body: { id, day: 1|2, scores: [ints|null, ...up to 18] }
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
    return res.status(500).json({ ok: false, error: "Scoring isn't configured yet." });
  }
  const key = req.headers["x-admin-key"] || "";
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const id = typeof body.id === "string" ? body.id : "";
  const day = Number(body.day);
  if (!id) return res.status(400).json({ ok: false, error: "Missing record id." });
  if (day !== 1 && day !== 2) return res.status(400).json({ ok: false, error: "Day must be 1 or 2." });
  if (!Array.isArray(body.scores)) return res.status(400).json({ ok: false, error: "Scores must be a list." });

  // Sanitize: up to 18 holes, each a positive integer (1–40) or null if blank.
  const scores = body.scores.slice(0, 18).map((v) => {
    const n = Math.round(Number(v));
    return (isFinite(n) && n >= 1 && n <= 40) ? n : null;
  });
  const gross = scores.reduce((s, n) => s + (n || 0), 0);

  const fields = {};
  fields["Day" + day + " Scores"] = JSON.stringify(scores);
  fields["Day" + day + " Gross"] = gross;

  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}/${id}`;
    const r = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields, typecast: true }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error("tournament-score error", r.status, detail);
      const msg = r.status === 422
        ? "Airtable rejected scores — confirm the Day1/Day2 Scores (long text) and Day1/Day2 Gross (number) fields exist on the Tournament Signups table."
        : "Could not save the scores.";
      return res.status(502).json({ ok: false, error: msg });
    }
    const data = await r.json();
    return res.status(200).json({ ok: true, id: data.id, gross: gross, fields: data.fields || {} });
  } catch (e) {
    console.error("tournament-score error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong saving the scores." });
  }
};
