// Vercel serverless function — records tournament check-in + payment for a
// sign-up (staff only, admin-key protected). Updates fields on the existing
// "Tournament Signups" record so it shows in the Staff Portal / workspace.
//
// Add these fields to the Tournament Signups table first:
//   Checked In  (checkbox)
//   Amount Paid (number / currency)
//   Pay Method  (single select: Cash, Check, Card, Other)
//   Paid At     (date, include time)
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
    return res.status(500).json({ ok: false, error: "Check-in isn't configured yet." });
  }

  const key = req.headers["x-admin-key"] || "";
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return res.status(400).json({ ok: false, error: "Missing record id." });

  const fields = {};
  if (typeof body.checkedIn === "boolean") fields["Checked In"] = body.checkedIn;
  if (body.amountPaid !== undefined && body.amountPaid !== null && body.amountPaid !== "") {
    const amt = Number(body.amountPaid);
    if (!isNaN(amt) && amt >= 0) fields["Amount Paid"] = amt;
  }
  if (typeof body.payMethod === "string" && body.payMethod) fields["Pay Method"] = body.payMethod.slice(0, 40);
  if (typeof body.checkNumber === "string") fields["Check Number"] = body.checkNumber ? body.checkNumber.slice(0, 40) : null;
  if (typeof body.paidAt === "string" && body.paidAt) fields["Paid At"] = body.paidAt;
  // Shotgun wave (8 AM / 1 PM); empty string clears it.
  if (typeof body.start === "string") fields["Start"] = body.start ? body.start.slice(0, 20) : null;

  if (!Object.keys(fields).length) {
    return res.status(400).json({ ok: false, error: "Nothing to update." });
  }

  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}/${id}`;
    const r = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields, typecast: true }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error("checkin patch error", r.status, detail);
      const msg = r.status === 422
        ? "Airtable rejected the update — confirm the Checked In / Amount Paid / Pay Method / Paid At fields exist on the Tournament Signups table."
        : "Could not save the check-in.";
      return res.status(502).json({ ok: false, error: msg });
    }
    const data = await r.json();
    return res.status(200).json({ ok: true, id: data.id, fields: data.fields || {} });
  } catch (e) {
    console.error("tournament-checkin error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong saving the check-in." });
  }
};
