// Vercel serverless function — accepts a tournament sign-up and writes it to the
// Airtable "Tournament Signups" table. Mirrors api/review-submit.js.
//
// Env: AIRTABLE_TOKEN (data.records:write), AIRTABLE_BASE_ID,
//      TOURNAMENTS_TABLE (defaults to "Tournament Signups").

module.exports = async (req, res) => {
  if (require("./_cors")(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const TABLE = process.env.TOURNAMENTS_TABLE || "Tournament Signups";
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return res.status(500).json({ ok: false, error: "Sign-ups aren't configured yet. Please call (970) 774-6362." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  if (body.company) return res.status(200).json({ ok: true }); // honeypot

  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = clean(body.name, 120);
  const tournament = clean(body.tournament, 120);
  if (!name || !tournament) {
    return res.status(400).json({ ok: false, error: "Please choose a tournament and enter your name." });
  }

  const fields = { "Player Name": name, "Tournament": tournament, "Status": "New" };
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 60);
  const team = clean(body.team, 500);
  const notes = clean(body.notes, 2000);
  const carts = parseInt(body.carts, 10);
  if (email) fields["Email"] = email;
  if (phone) fields["Phone"] = phone;
  if (team) fields["Team / Partners"] = team;
  if (!isNaN(carts) && carts >= 0) fields["Carts"] = carts;
  if (notes) fields["Notes"] = notes;

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
      console.error("Airtable tournament signup error", r.status, detail);
      return res.status(502).json({ ok: false, error: "Could not save your sign-up right now. Please try again, or call (970) 774-6362." });
    }
    return res.status(502).json({ ok: false, error: "Could not save your sign-up. Please call (970) 774-6362." });
  } catch (e) {
    console.error("tournament-signup error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong. Please try again, or call (970) 774-6362." });
  }
};
