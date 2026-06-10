// Vercel serverless function — accepts a public course review and writes it to
// the Airtable "Reviews" table with Status = "Pending" (so nothing publishes
// until staff approve it). Mirrors api/nominate.js.
//
// Env vars: AIRTABLE_TOKEN (data.records:write), AIRTABLE_BASE_ID, REVIEWS_TABLE.

module.exports = async (req, res) => {
  if (require("./_cors")(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const TABLE = process.env.REVIEWS_TABLE || "Reviews";
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return res.status(500).json({ ok: false, error: "Reviews aren't configured yet. Please call (970) 774-6362." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  if (body.company) return res.status(200).json({ ok: true }); // honeypot

  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = clean(body.name, 80);
  const review = clean(body.review, 2000);
  var rating = parseInt(body.rating, 10);
  if (!(rating >= 1 && rating <= 5)) rating = 0;
  if (!review) {
    return res.status(400).json({ ok: false, error: "Please write a short review before submitting." });
  }

  const fields = { "Review": review, "Status": "Pending" };
  if (name) fields["Reviewer Name"] = name;
  if (rating) fields["Rating"] = rating;
  const email = clean(body.email, 200);
  if (email) fields["Email"] = email;

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}`;
  const post = (f) => fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields: f }], typecast: true }),
  });

  try {
    let working = { ...fields };
    for (let attempt = 0; attempt < 8; attempt++) {
      const r = await post(working);
      if (r.ok) return res.status(200).json({ ok: true });
      const detail = await r.text();
      let msg = detail;
      try { msg = (JSON.parse(detail).error || {}).message || detail; } catch (e) {}
      const m = /Unknown field name:?\s*"?([^"]+?)"?$/i.exec(String(msg).trim());
      if (m && working.hasOwnProperty(m[1]) && Object.keys(working).length > 2) {
        delete working[m[1]];
        continue;
      }
      console.error("Airtable review write error", r.status, detail);
      return res.status(502).json({ ok: false, error: "Could not save your review right now. Please try again, or call (970) 774-6362." });
    }
    return res.status(502).json({ ok: false, error: "Could not save your review. Please call (970) 774-6362." });
  } catch (e) {
    console.error("review-submit error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong. Please try again, or call (970) 774-6362." });
  }
};
