// Vercel serverless function — self-posted rounds for a Player Card.
//
// Requires a magic-link token (issued by /api/player-magic). Two actions:
//
//   POST { action: "list", token }
//     -> 200 { ok: true, rounds: [ { id, date, holes, tees, course, gross,
//              notes, created } ... ] }   // newest first, up to 100
//
//   POST { action: "save", token, date, holes, tees, course, gross, notes }
//     -> 200 { ok: true, id, round }
//
// Airtable "Rounds" table needs these fields (create via the Airtable AI
// Assistant, same pattern as Player 3/4 Paid and Recap):
//
//   Player Name (Single-line text, primary)
//   Player ID   (Single-line text)
//   Date        (Date)
//   Holes       (Number, integer 9 or 18)
//   Tees        (Single-line text)
//   Course      (Single-line text; defaults to "F&H Golf Course")
//   Gross       (Number, integer)
//   Notes       (Long text)
//
// If a field doesn't exist yet, the endpoint auto-strips it and retries so
// a partial schema still saves the core fields — same graceful-degrade
// pattern the Signups + Config endpoints use.
//
// Env: AIRTABLE_TOKEN, AIRTABLE_BASE_ID, ROUNDS_TABLE (defaults to "Rounds"),
//      PLAYERS_TABLE (defaults to "Players"), ADMIN_KEY.

const magic = require("./player-magic");

function clean(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function isValidDateStr(s) {
  // YYYY-MM-DD only. Airtable accepts other formats via typecast, but
  // pinning to ISO keeps the wire simple and rejects garbage early.
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function airtableGet(url, headers) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error("airtable " + r.status);
  return r.json();
}

async function loadPlayerName(playerId) {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const TABLE = process.env.PLAYERS_TABLE || "Players";
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}/${encodeURIComponent(playerId)}`;
  const j = await airtableGet(url, { Authorization: `Bearer ${AIRTABLE_TOKEN}` });
  return String((j.fields || {}).Name || "").trim();
}

async function listRounds(playerId) {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const TABLE = process.env.ROUNDS_TABLE || "Rounds";
  const safe = playerId.replace(/"/g, '\\"');
  const filter = `{Player ID}="${safe}"`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}?pageSize=100&filterByFormula=${encodeURIComponent(filter)}&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc`;
  const headers = { Authorization: `Bearer ${AIRTABLE_TOKEN}` };
  const r = await fetch(url, { headers });
  if (!r.ok) {
    const detail = await r.text();
    // Table not yet created / access denied → return empty list so the
    // Card renders "no rounds yet" instead of a scary error.
    if (r.status === 404 || r.status === 403 || /NOT_FOUND|TABLE_NOT_FOUND|MODEL_ID_NOT_FOUND/.test(detail || "")) {
      return { notReady: true, rounds: [] };
    }
    throw new Error("airtable " + r.status + " " + detail);
  }
  const j = await r.json();
  const rounds = (j.records || []).map((rec) => {
    const f = rec.fields || {};
    return {
      id: rec.id,
      created: rec.createdTime,
      date: String(f.Date || "").slice(0, 10),
      holes: Number(f.Holes) || null,
      tees: String(f.Tees || "").trim(),
      course: String(f.Course || "").trim(),
      gross: (typeof f.Gross === "number") ? f.Gross : (f.Gross ? Number(f.Gross) : null),
      notes: String(f.Notes || "").trim(),
    };
  });
  return { rounds };
}

async function saveRound({ playerId, playerName, date, holes, tees, course, gross, notes }) {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const TABLE = process.env.ROUNDS_TABLE || "Rounds";
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}`;
  const headers = { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" };
  const fields = {
    "Player Name": playerName,
    "Player ID": playerId,
    "Date": date,
    "Holes": holes,
    "Tees": tees,
    "Course": course,
    "Gross": gross,
    "Notes": notes,
  };
  // Auto-strip unknown fields — Airtable 422s with UNKNOWN_FIELD_NAME when
  // the operator hasn't created every column yet. We drop the offender and
  // retry so the core round still saves.
  const stripped = [];
  async function attempt(body) {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ records: [{ fields: body }], typecast: true }),
    });
    const detail = await r.text();
    if (r.ok) {
      const j = JSON.parse(detail);
      return { ok: true, rec: (j.records || [])[0] || null };
    }
    // Try to identify the missing field name and strip it.
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
      const { notReady, rounds } = await listRounds(claims.id);
      return res.status(200).json({ ok: true, notReady: !!notReady, rounds });
    } catch (e) {
      console.error("player-rounds list error", e);
      return res.status(500).json({ ok: false, error: "Couldn't load your rounds." });
    }
  }

  if (action === "save") {
    const date = clean(body.date, 10);
    if (!isValidDateStr(date)) return res.status(400).json({ ok: false, error: "Date is required (YYYY-MM-DD)." });
    const holes = Number(body.holes);
    if (holes !== 9 && holes !== 18) return res.status(400).json({ ok: false, error: "Holes must be 9 or 18." });
    const tees = clean(body.tees, 40);
    const course = clean(body.course, 120) || "F&H Golf Course";
    const gross = Number(body.gross);
    if (!isFinite(gross) || gross <= 0 || gross > 300) return res.status(400).json({ ok: false, error: "Gross must be a positive number (up to 300)." });
    const notes = clean(body.notes, 1000);
    let playerName = "";
    try { playerName = await loadPlayerName(claims.id); } catch (e) {}
    if (!playerName) return res.status(400).json({ ok: false, error: "Player not found." });
    try {
      const { outcome, stripped } = await saveRound({ playerId: claims.id, playerName, date, holes, tees, course, gross, notes });
      if (!outcome.ok) {
        console.error("player-rounds save failed", outcome.status, outcome.detail);
        // Table missing entirely → tell the operator, not the player.
        if (outcome.status === 404 || outcome.status === 403 || /NOT_FOUND|TABLE_NOT_FOUND|MODEL_ID_NOT_FOUND/.test(outcome.detail || "")) {
          return res.status(502).json({ ok: false, error: "The Rounds table isn't set up in Airtable yet. Ask the pro shop to create it." });
        }
        return res.status(502).json({ ok: false, error: "Couldn't save your round." });
      }
      const rec = outcome.rec;
      const f = (rec && rec.fields) || {};
      const savedRound = {
        id: rec ? rec.id : null,
        created: rec ? rec.createdTime : null,
        date: String(f.Date || date).slice(0, 10),
        holes: Number(f.Holes) || holes,
        tees: String(f.Tees || tees).trim(),
        course: String(f.Course || course).trim(),
        gross: (typeof f.Gross === "number") ? f.Gross : gross,
        notes: String(f.Notes || notes).trim(),
      };
      // Surface stripped fields so the operator sees the schema drift on
      // the response (dev-tools) rather than silently losing data.
      return res.status(200).json({ ok: true, id: savedRound.id, round: savedRound, stripped });
    } catch (e) {
      console.error("player-rounds save error", e);
      return res.status(500).json({ ok: false, error: "Couldn't save your round." });
    }
  }

  return res.status(400).json({ ok: false, error: "Unknown action." });
};
