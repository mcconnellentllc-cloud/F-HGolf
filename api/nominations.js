// Vercel serverless function — Hall of Fame nominations, both submit
// (public POST) and list (admin GET) in one route so it stays within
// the Hobby-plan 12-function limit.
//
//   GET  (x-admin-key required)  → list nominations (newest first)
//   POST (no auth)               → submit a nomination (public form)
//
// Env vars required:
//   AIRTABLE_TOKEN    – token with data.records:read + :write
//   AIRTABLE_BASE_ID  – e.g. appAwEdD9m6OVN6lg
//   AIRTABLE_TABLE    – "Hall of Fame Nominations"
//   ADMIN_KEY         – shared secret for the admin GET

module.exports = async (req, res) => {
  if (require("./_cors")(req, res)) return;

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE, ADMIN_KEY } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE) {
    return res.status(500).json({ ok: false, error: "Nominations aren't configured yet. Please call (970) 774-6362." });
  }

  if (req.method === "POST") return submitNomination(req, res, { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE });
  if (req.method === "GET")  return listNominations(req, res, { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE, ADMIN_KEY });

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, error: "Method not allowed" });
};

// ---- POST: public submit --------------------------------------------------
async function submitNomination(req, res, env) {
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

  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE)}`;
  const post = (f) => fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields: f }], typecast: true }),
  });

  // Resilient write: if the table is missing an optional column (Airtable
  // returns "Unknown field name: X"), drop that field and retry — so a
  // nomination still saves as long as Nominee Name + Contribution exist.
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
        continue; // retry without the unknown field
      }
      console.error("Airtable error", r.status, detail);
      return res.status(502).json({ ok: false, error: "Could not save your nomination right now. Please try again, or call (970) 774-6362." });
    }
    return res.status(502).json({ ok: false, error: "Could not save your nomination. Please call (970) 774-6362." });
  } catch (e) {
    console.error("nominate error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong. Please try again, or call (970) 774-6362." });
  }
}

// ---- GET: admin list ------------------------------------------------------
async function listNominations(req, res, env) {
  const key = req.headers["x-admin-key"] || "";
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE)}?pageSize=100`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } });
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
}
