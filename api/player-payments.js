// Vercel serverless function — self-logged green-fee payments for a Player Card.
//
// Requires a magic-link token (issued by /api/player-magic).
//
//   POST { action: "list", token }
//     -> 200 { ok: true, payments: [...] }   // newest first
//
//   POST { action: "log", token, method, rateType, baseAmount, surcharge,
//                          total, notes }
//     -> 200 { ok: true, id, payment }
//     method    : "Card" | "Check"
//     rateType  : "9 walk" | "9 cart" | "18 walk" | "18 cart" | "Custom"
//     baseAmount: green fee + cart (dollars, integer OK)
//     surcharge : 0 for Check; base * 0.04 for Card
//     total     : baseAmount + surcharge
//
// Status starts as "Pending" for both methods:
//   - Card payments are pending until reconciled against the Deposyt
//     dashboard (Phase 3b will let staff mark Confirmed).
//   - Check payments are pending until the check arrives at the course
//     and the pro shop marks it Confirmed.
//
// Airtable "Payments" table needs these fields (see the copy-paste prompt
// in the Phase 3a PR body):
//
//   Player Name  (Single-line text, primary)
//   Player ID    (Single-line text)
//   Date         (Date)                – when the payment was initiated
//   Rate Type    (Single-line text)
//   Base Amount  (Number)
//   Surcharge    (Number)
//   Total        (Number)
//   Method       (Single-line text)    – "Card" or "Check"
//   Status       (Single-line text)    – "Pending" | "Confirmed" | "Voided"
//   Notes        (Long text)
//
// Env: AIRTABLE_TOKEN, AIRTABLE_BASE_ID, PAYMENTS_TABLE (defaults to
//      "Payments"), PLAYERS_TABLE (defaults to "Players"), ADMIN_KEY.

const magic = require("./player-magic");

function clean(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function round2(v) { return Math.round(v * 100) / 100; }

const VALID_METHODS = new Set(["Card", "Check"]);
const VALID_RATES = new Set(["9 walk", "9 cart", "18 walk", "18 cart", "Custom"]);

async function loadPlayerName(playerId) {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const TABLE = process.env.PLAYERS_TABLE || "Players";
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}/${encodeURIComponent(playerId)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
  if (!r.ok) return "";
  const j = await r.json();
  return String((j.fields || {}).Name || "").trim();
}

async function listPayments(playerId) {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const TABLE = process.env.PAYMENTS_TABLE || "Payments";
  const safe = playerId.replace(/"/g, '\\"');
  const filter = `{Player ID}="${safe}"`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}?pageSize=100&filterByFormula=${encodeURIComponent(filter)}&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
  if (!r.ok) {
    const detail = await r.text();
    if (r.status === 404 || r.status === 403 || /NOT_FOUND|TABLE_NOT_FOUND|MODEL_ID_NOT_FOUND/.test(detail || "")) {
      return { notReady: true, payments: [] };
    }
    throw new Error("airtable " + r.status + " " + detail);
  }
  const j = await r.json();
  const payments = (j.records || []).map((rec) => {
    const f = rec.fields || {};
    return {
      id: rec.id,
      created: rec.createdTime,
      date: String(f.Date || "").slice(0, 10),
      rateType: String(f["Rate Type"] || "").trim(),
      baseAmount: (typeof f["Base Amount"] === "number") ? f["Base Amount"] : num(f["Base Amount"]),
      surcharge: (typeof f["Surcharge"] === "number") ? f["Surcharge"] : num(f["Surcharge"]),
      total: (typeof f["Total"] === "number") ? f["Total"] : num(f["Total"]),
      method: String(f.Method || "").trim(),
      status: String(f.Status || "").trim() || "Pending",
      notes: String(f.Notes || "").trim(),
    };
  });
  return { payments };
}

async function writePayment(fields) {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const TABLE = process.env.PAYMENTS_TABLE || "Payments";
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}`;
  const headers = { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" };
  const stripped = [];
  async function attempt(body) {
    const r = await fetch(url, {
      method: "POST", headers,
      body: JSON.stringify({ records: [{ fields: body }], typecast: true }),
    });
    const detail = await r.text();
    if (r.ok) return { ok: true, rec: (JSON.parse(detail).records || [])[0] || null };
    const m = /"UNKNOWN_FIELD_NAME"[^"]*"([^"]+)"|Unknown field name:\s*"?([^",}]+)/i.exec(detail);
    const missing = m && (m[1] || m[2]);
    if ((r.status === 422 || r.status === 400) && missing && body[missing] !== undefined) {
      delete body[missing];
      stripped.push(missing);
      return attempt(body);
    }
    return { ok: false, status: r.status, detail };
  }
  const outcome = await attempt(Object.assign({}, fields));
  return { outcome, stripped };
}

module.exports = async (req, res) => {
  if (require("./_cors")(req, res)) return;
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, error: "Method not allowed" }); }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) return res.status(500).json({ ok: false, error: "Not configured." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const claims = magic.verifyToken && magic.verifyToken(body.token);
  if (!claims) return res.status(400).json({ ok: false, error: "This link has expired or isn't valid." });

  const action = String(body.action || "").toLowerCase();

  if (action === "list") {
    try {
      const { notReady, payments } = await listPayments(claims.id);
      return res.status(200).json({ ok: true, notReady: !!notReady, payments });
    } catch (e) {
      console.error("player-payments list error", e);
      return res.status(500).json({ ok: false, error: "Couldn't load your payments." });
    }
  }

  if (action === "log") {
    const method = clean(body.method, 20);
    if (!VALID_METHODS.has(method)) return res.status(400).json({ ok: false, error: "Method must be Card or Check." });
    const rateType = clean(body.rateType, 40);
    if (!VALID_RATES.has(rateType)) return res.status(400).json({ ok: false, error: "Rate type must be one of the offered rates." });
    const baseAmount = round2(num(body.baseAmount));
    const surcharge = round2(num(body.surcharge));
    const total = round2(num(body.total));
    if (baseAmount <= 0 || baseAmount > 5000) return res.status(400).json({ ok: false, error: "Base amount must be positive (and reasonable)." });
    // Server-side recompute so we don't trust whatever the client sent —
    // Card = base + 4%, Check = base. Any drift from the client value >5¢
    // is a client bug worth failing loud on.
    const expectedSurcharge = method === "Card" ? round2(baseAmount * 0.04) : 0;
    const expectedTotal = round2(baseAmount + expectedSurcharge);
    if (Math.abs(surcharge - expectedSurcharge) > 0.05 || Math.abs(total - expectedTotal) > 0.05) {
      return res.status(400).json({ ok: false, error: "Surcharge/total didn't match the base amount." });
    }
    const notes = clean(body.notes, 1000);
    let playerName = "";
    try { playerName = await loadPlayerName(claims.id); } catch (e) {}
    if (!playerName) return res.status(400).json({ ok: false, error: "Player not found." });
    const today = new Date();
    const iso = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
    try {
      const { outcome, stripped } = await writePayment({
        "Player Name": playerName,
        "Player ID": claims.id,
        "Date": iso,
        "Rate Type": rateType,
        "Base Amount": expectedSurcharge === surcharge ? baseAmount : baseAmount,
        "Surcharge": expectedSurcharge,
        "Total": expectedTotal,
        "Method": method,
        "Status": "Pending",
        "Notes": notes,
      });
      if (!outcome.ok) {
        if (outcome.status === 404 || outcome.status === 403 || /NOT_FOUND|TABLE_NOT_FOUND|MODEL_ID_NOT_FOUND/.test(outcome.detail || "")) {
          return res.status(502).json({ ok: false, error: "The Payments table isn't set up in Airtable yet. Ask the pro shop to create it." });
        }
        console.error("player-payments log failed", outcome.status, outcome.detail);
        return res.status(502).json({ ok: false, error: "Couldn't log your payment." });
      }
      const rec = outcome.rec;
      const f = (rec && rec.fields) || {};
      const payment = {
        id: rec ? rec.id : null,
        created: rec ? rec.createdTime : null,
        date: String(f.Date || iso),
        rateType: String(f["Rate Type"] || rateType),
        baseAmount: (typeof f["Base Amount"] === "number") ? f["Base Amount"] : baseAmount,
        surcharge: (typeof f["Surcharge"] === "number") ? f["Surcharge"] : expectedSurcharge,
        total: (typeof f["Total"] === "number") ? f["Total"] : expectedTotal,
        method: String(f.Method || method),
        status: String(f.Status || "Pending"),
        notes: String(f.Notes || notes),
      };
      return res.status(200).json({ ok: true, id: payment.id, payment, stripped });
    } catch (e) {
      console.error("player-payments log error", e);
      return res.status(500).json({ ok: false, error: "Couldn't log your payment." });
    }
  }

  return res.status(400).json({ ok: false, error: "Unknown action." });
};
