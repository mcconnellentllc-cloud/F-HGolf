// Vercel serverless function — tournament expenses (staff only, admin-key).
//   GET  ?t=<Tournament>            -> list expenses for that tournament
//   POST { tournament, description, amount, category }   -> add an expense
//   POST { action: "delete", id }   -> remove an expense
//
// Create an Airtable table (default name "Tournament Expenses") with fields:
//   Tournament (text)   Description (text)   Amount (number/currency)
//   Category (single select: Food, Prizes, Supplies, Labor, Other)
//
// Env: AIRTABLE_TOKEN (data.records:read + write), AIRTABLE_BASE_ID,
//      EXPENSES_TABLE (defaults to "Tournament Expenses"), ADMIN_KEY.

module.exports = async (req, res) => {
  if (require("./_cors")(req, res)) return;

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, ADMIN_KEY } = process.env;
  const TABLE = process.env.EXPENSES_TABLE || "Tournament Expenses";
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return res.status(500).json({ ok: false, error: "Expenses aren't configured yet." });
  }
  const auth = require("./_auth")(req);
  if (!auth) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const base = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}`;
  const auth = { Authorization: `Bearer ${AIRTABLE_TOKEN}` };

  try {
    if (req.method === "GET") {
      const t = (req.query && req.query.t) || "";
      let records = [], offset = "";
      for (let guard = 0; guard < 50; guard++) {
        const r = await fetch(base + "?pageSize=100" + (offset ? "&offset=" + encodeURIComponent(offset) : ""), { headers: auth });
        if (!r.ok) {
          const d = await r.text(); console.error("expenses read", r.status, d);
          return res.status(502).json({ ok: false, error: "Could not load expenses (does the Tournament Expenses table exist?)." });
        }
        const data = await r.json();
        (data.records || []).forEach((rec) => records.push({ id: rec.id, created: rec.createdTime, fields: rec.fields || {} }));
        if (!data.offset) break;
        offset = data.offset;
      }
      if (t) records = records.filter((x) => (x.fields.Tournament || "") === t);
      records.sort((a, b) => String(a.created || "").localeCompare(String(b.created || "")));
      return res.status(200).json({ ok: true, records });
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      body = body || {};

      if (body.action === "delete") {
        const id = typeof body.id === "string" ? body.id : "";
        if (!id) return res.status(400).json({ ok: false, error: "Missing id." });
        const r = await fetch(base + "/" + id, { method: "DELETE", headers: auth });
        if (!r.ok) { const d = await r.text(); console.error("expense delete", r.status, d); return res.status(502).json({ ok: false, error: "Could not remove the expense." }); }
        return res.status(200).json({ ok: true, id });
      }

      const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
      const tournament = clean(body.tournament, 120);
      const description = clean(body.description, 200);
      const category = clean(body.category, 40);
      const amount = Number(body.amount);
      if (!tournament || !description) return res.status(400).json({ ok: false, error: "Tournament and description are required." });
      if (!isFinite(amount) || amount < 0) return res.status(400).json({ ok: false, error: "Enter a valid amount." });

      const fields = { Tournament: tournament, Description: description, Amount: amount };
      if (category) fields.Category = category;
      const r = await fetch(base, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ records: [{ fields }], typecast: true }),
      });
      if (!r.ok) { const d = await r.text(); console.error("expense add", r.status, d); return res.status(502).json({ ok: false, error: "Could not save the expense." }); }
      const data = await r.json();
      return res.status(200).json({ ok: true, record: (data.records && data.records[0]) || null });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error("tournament-expenses error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong with expenses." });
  }
};
