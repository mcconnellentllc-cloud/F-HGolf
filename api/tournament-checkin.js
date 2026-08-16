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
  // Alternate (standby, not in the active field) — needs an "Alternate" checkbox field.
  if (typeof body.alternate === "boolean") fields["Alternate"] = body.alternate;
  // Cart: Rental or Owned — needs a "Cart Type" single-select field.
  if (typeof body.cartType === "string") fields["Cart Type"] = body.cartType ? body.cartType.slice(0, 20) : null;
  // Specific cart assignment (e.g. "Rental 3" or "Borrowed: Chris Fuesz").
  // Needs a "Cart Assignment" single-line text field. Empty string clears it.
  if (typeof body.cartAssignment === "string") fields["Cart Assignment"] = body.cartAssignment ? body.cartAssignment.slice(0, 120) : null;
  // How many rental carts this team needs (0/1/2). Powers the workbook
  // hero's cart-demand summary. Needs a "Rentals Needed" Number field.
  if (body.rentalsNeeded !== undefined) {
    if (body.rentalsNeeded === "" || body.rentalsNeeded === null) fields["Rentals Needed"] = 0;
    else { const n = Number(body.rentalsNeeded); if (isFinite(n) && n >= 0 && n <= 4) fields["Rentals Needed"] = Math.floor(n); }
  }
  // Per-player payment (Cash/Check/Card) — needs "Player 1 Paid" / "Player 2 Paid" /
  // "Player 3 Paid" / "Player 4 Paid" fields. p3/p4 are optional (4-player teams
  // only); the auto-strip fallback drops missing columns quietly.
  if (typeof body.player1Paid === "string") fields["Player 1 Paid"] = body.player1Paid ? body.player1Paid.slice(0, 20) : null;
  if (typeof body.player2Paid === "string") fields["Player 2 Paid"] = body.player2Paid ? body.player2Paid.slice(0, 20) : null;
  if (typeof body.player3Paid === "string") fields["Player 3 Paid"] = body.player3Paid ? body.player3Paid.slice(0, 20) : null;
  if (typeof body.player4Paid === "string") fields["Player 4 Paid"] = body.player4Paid ? body.player4Paid.slice(0, 20) : null;
  // Inline rename from Check-In roster.
  // Extra meals — sold at check-in to guests/spouses so the kitchen can plan.
  if (body.extraMeals !== undefined && body.extraMeals !== null && body.extraMeals !== "") {
    const em = Number(body.extraMeals);
    if (!isNaN(em) && em >= 0) fields["Extra Meals"] = em;
  }
  // Per-player extras: cart share (0 / 0.5 / 1) + extra meal (bool).
  // p3 and p4 shares are optional — only 4-player tournaments (couples,
  // adult+child) send them. The auto-strip fallback below quietly drops
  // them if the base hasn't grown the Player 3/4 Cart Share columns yet.
  ["p1CartShare", "p2CartShare", "p3CartShare", "p4CartShare"].forEach((k, i) => {
    if (body[k] === undefined) return;
    const target = ["Player 1 Cart Share", "Player 2 Cart Share", "Player 3 Cart Share", "Player 4 Cart Share"][i];
    if (body[k] === "" || body[k] === null) { fields[target] = null; return; }
    const n = Number(body[k]);
    if (!isNaN(n) && n >= 0 && n <= 1) fields[target] = n;
  });
  // Per-player extra meal count (0..N). Accepts number or a boolean-ish value
  // from older callers (true → 1, false → 0).
  ["p1ExtraMeal", "p2ExtraMeal"].forEach((k, i) => {
    if (body[k] === undefined) return;
    const target = i === 0 ? "Player 1 Extra Meal" : "Player 2 Extra Meal";
    if (body[k] === null || body[k] === "") { fields[target] = 0; return; }
    if (typeof body[k] === "boolean") { fields[target] = body[k] ? 1 : 0; return; }
    const n = Number(body[k]);
    if (!isNaN(n) && n >= 0) fields[target] = Math.floor(n);
  });
  if (typeof body.playerName === "string") fields["Player Name"] = body.playerName.slice(0, 200);
  if (typeof body.teamPartners === "string") fields["Team / Partners"] = body.teamPartners.slice(0, 500);
  // Per-player extras purchased (Mulligans, String, etc.). Stored as a
  // JSON string on the "Extras Purchased" Long text field. Shape:
  //   {"Mulligans":["p1","p3"],"String":["p2"]}
  // Sparse — extras with no players aren't included. Empty object "{}"
  // clears every extra for this team. The auto-strip fallback drops the
  // field silently if the Airtable column hasn't been created yet.
  if (typeof body.extrasPurchased === "string") fields["Extras Purchased"] = body.extrasPurchased.slice(0, 4000);
  // Per-team extras-used running count. Captain increments from live.html;
  // the operator can override here if a captain forgets. Same shape as
  // Extras Purchased but a plain count per name: {"Mulligans": 2}.
  if (typeof body.extrasUsed === "string") fields["Extras Used"] = body.extrasUsed.slice(0, 4000);
  // Marker scoring — per-team "this captain scores the whole group" flag.
  // When true, the captain's live scoring token can write scores for
  // every team paired with them on the same tee. Field is auto-stripped
  // if the "Group Scorer" Checkbox column doesn't exist yet on Airtable.
  if (typeof body.groupScorer === "boolean") fields["Group Scorer"] = body.groupScorer;
  // Email — set when the captain changes so the scoring-link email routes
  // to the new captain's inbox. Empty string clears it.
  if (typeof body.email === "string") fields["Email"] = body.email ? body.email.slice(0, 200) : null;
  // Link this signup to a canonical Players table row. Needs a "Player" linked
  // field on Tournament Signups. Empty string clears the link.
  if (typeof body.playerId === "string") fields["Player"] = body.playerId ? [body.playerId] : [];
  // Calcutta — buyer text + amount. Needs Buyer (text) + Buy Amount (number)
  // fields on Tournament Signups.
  if (typeof body.buyer === "string") fields["Buyer"] = body.buyer ? body.buyer.slice(0, 120) : null;
  // Calcutta Paid — track that the buyer settled up (Cash / Check / Card /
  // Online). Empty string clears it.
  if (typeof body.calcuttaPaid === "string") fields["Calcutta Paid"] = body.calcuttaPaid ? body.calcuttaPaid.slice(0, 20) : null;
  // Buyer email — captured once on the Calcutta Buyers card so we can
  // send a receipt. Denormalized: every signup this buyer bought gets
  // the same email. Empty string clears it. Field is dropped by the
  // auto-strip retry below if "Buyer Email" doesn't exist on the base
  // yet, so this is safe to send before the field is added.
  if (typeof body.buyerEmail === "string") fields["Buyer Email"] = body.buyerEmail ? body.buyerEmail.slice(0, 200) : null;
  if (body.buyAmount !== undefined) {
    if (body.buyAmount === null || body.buyAmount === "") fields["Buy Amount"] = null;
    else { var amt = Number(body.buyAmount); if (isFinite(amt) && amt >= 0) fields["Buy Amount"] = amt; }
  }
  // Payout reconciliation — check numbers written for a team's flight prize
  // and for the Buyer's Calcutta payout. Two separate fields on the signup.
  if (typeof body.flightCheck === "string") fields["Flight Check #"] = body.flightCheck ? body.flightCheck.slice(0, 40) : null;
  if (typeof body.calcuttaCheck === "string") fields["Calcutta Check #"] = body.calcuttaCheck ? body.calcuttaCheck.slice(0, 40) : null;

  if (!Object.keys(fields).length) {
    return res.status(400).json({ ok: false, error: "Nothing to update." });
  }

  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}/${id}`;
    // Auto-strip missing Airtable fields and retry — same mechanism the
    // tournament-flights endpoint uses. Newer fields (Player 1 Paid,
    // Player 2 Paid, Extra Meals, Calcutta Paid, etc.) may not exist on
    // every base — without this a single missing field would 422 the
    // whole PATCH and the operator would see the paid checkbox flip
    // back on the next reload because nothing actually saved.
    const stripped = new Set();
    let working = { ...fields };
    let lastDetail = "";
    for (let attempt = 0; attempt < 8; attempt++) {
      const r = await fetch(url, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: working, typecast: true }),
      });
      if (r.ok) {
        const data = await r.json();
        const payload = { ok: true, id: data.id, fields: data.fields || {} };
        if (stripped.size) payload.warning = "Saved without " + [...stripped].join(", ") + " (add those fields on the Tournament Signups table to store them).";
        return res.status(200).json(payload);
      }
      lastDetail = await r.text();
      let missing = null;
      try {
        const parsed = JSON.parse(lastDetail);
        const emsg = parsed && parsed.error && parsed.error.message;
        const m = /Unknown field name[s]?:\s*"([^"]+)"/i.exec(emsg || "");
        if (m) missing = m[1];
      } catch (e) {}
      if (!missing) break;
      stripped.add(missing);
      delete working[missing];
      if (!Object.keys(working).length) {
        return res.status(200).json({ ok: true, id, fields: {}, warning: "Nothing saved — every field in the update was missing on Airtable (" + [...stripped].join(", ") + "). Add them to the Tournament Signups table." });
      }
    }
    console.error("checkin patch error", lastDetail);
    return res.status(502).json({ ok: false, error: "Could not save the check-in." });
  } catch (e) {
    console.error("tournament-checkin error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong saving the check-in." });
  }
};
