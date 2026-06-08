// Vercel serverless function — receives Hall of Fame nominations and writes
// them to Airtable. Requires these Environment Variables (set in Vercel):
//   AIRTABLE_TOKEN    – personal access token with data.records:write
//   AIRTABLE_BASE_ID  – e.g. appAwEdD9m6OVN6lg
//   AIRTABLE_TABLE    – table name ("Hall of Fame Nominations") or table id
//
// Note: this endpoint only runs on the Vercel deployment (GitHub Pages can't
// host serverless functions). Field names below must match the Airtable table.

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE) {
    return res.status(500).json({ ok: false, error: "The nomination form isn't configured yet. Please call (970) 774-6362." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  // Honeypot: real users never fill this hidden field. Silently accept bots.
  if (body.company) return res.status(200).json({ ok: true });

  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const nominee = clean(body.nominee, 120);
  const contribution = clean(body.contribution, 4000);
  if (!nominee || !contribution) {
    return res.status(400).json({ ok: false, error: "Please include the nominee's name and why they belong." });
  }

  const roleOptions = ["Founder", "Builder", "Volunteer", "Member", "Family", "Other"];
  const fields = { "Nominee Name": nominee, "Contribution": contribution, "Status": "New" };
  const era = clean(body.era, 120);
  const nominatedBy = clean(body.nominatedBy, 120);
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 60);
  if (era) fields["Era / Years at F&H"] = era;
  if (roleOptions.indexOf(body.role) !== -1) fields["Role"] = body.role;
  if (nominatedBy) fields["Nominated By"] = nominatedBy;
  if (email) fields["Submitter Email"] = email;
  if (phone) fields["Submitter Phone"] = phone;

  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error("Airtable error", r.status, detail);
      return res.status(502).json({ ok: false, error: "Could not save your nomination right now. Please try again, or call (970) 774-6362." });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("nominate error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong. Please try again, or call (970) 774-6362." });
  }
};
