// Vercel serverless function — consolidated Player Card endpoint.
//
// The public site has FIVE player-facing actions (magic-link request,
// magic-link verify, tournament history, rounds list/save, payments
// list/log) that could each be its own file, but Vercel's per-project
// function cap forces us to fold them under one route — same pattern
// used by tournament-signups.js. Route by { action } in the POST body.
//
//   POST { action: "magic-request", name }
//     -> 200 { ok: true, sent: true,  maskedEmail: "k***@g***.com",
//              message: "We sent your sign-in link to k***@g***.com." }
//     -> 200 { ok: true, sent: false,
//              message: "We couldn't find a Player Card by that name — check
//                        the spelling, or call the pro shop at (970) 774-6362." }
//     Reveals whether a name matched (privacy trade-off the operator opted
//     into) so the person who typed their real name sees which inbox to check.
//
//   POST { action: "create", name, email, phone?, street?, city?, state?,
//                             zip?, company (honeypot) }
//     -> 200 { ok: true, created: true, sent: true, maskedEmail,
//              message: "Your Player Card is set up — we sent your sign-in
//                        link to k***@g***.com." }
//     -> 400 { ok: false, error }  (missing name/email, dup name, bad email)
//     Public write. Honeypot rejects obvious bots. Duplicates by
//     case-insensitive Name are refused with "there's already a Player
//     Card by that name — try signing in instead." New rows land with
//     Member=false and a "self-signed up on YYYY-MM-DD" note; staff
//     upgrade to Member from admin-people.html after verifying.
//
//   POST { action: "magic-verify", token }
//     -> 200 { ok: true, player: { id, name, email, phone, ... } }
//     -> 400 { ok: false, error }
//
//   POST { action: "history", token }
//     -> 200 { ok: true, name, current: [...], past: [...] }
//
//   POST { action: "rounds-list", token }
//     -> 200 { ok: true, notReady?: boolean, rounds: [...] }
//
//   POST { action: "rounds-save", token, date, holes, tees, course, gross, notes }
//     -> 200 { ok: true, id, round }
//
//   POST { action: "payments-list", token }
//     -> 200 { ok: true, notReady?: boolean, payments: [...] }
//
//   POST { action: "payments-log", token, method, rateType, baseAmount,
//                                  surcharge, total, notes }
//     -> 200 { ok: true, id, payment }
//
// Airtable tables used (see the PR body for the exact schemas):
//   Players           — canonical member directory
//   Tournament Signups — current tournament roster
//   Tournament Archives — snapshotted past tournaments
//   Rounds            — self-posted scores
//   Payments          — self-logged green-fee payments (card + check)
//
// Auth: HMAC-SHA256 signed token, secret derived from ADMIN_KEY so no
// new env var is needed. 30-day TTL. Token format:
//   base64url({id, exp}) + "." + base64url(hmacSha256(secret, payload))
//
// Env: AIRTABLE_TOKEN, AIRTABLE_BASE_ID, ADMIN_KEY, RESEND_API_KEY,
//      PLAYERS_TABLE (defaults "Players"),
//      TOURNAMENTS_TABLE (defaults "Tournament Signups"),
//      ARCHIVES_TABLE (defaults "Tournament Archives"),
//      ROUNDS_TABLE (defaults "Rounds"),
//      PAYMENTS_TABLE (defaults "Payments").

const crypto = require("crypto");

// ---------- Token (HMAC) ---------------------------------------------------
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
function secret() {
  const adminKey = process.env.ADMIN_KEY || "";
  if (!adminKey) return null;
  return crypto.createHash("sha256").update(adminKey + "|player-magic").digest();
}
function b64url(buf) { return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"); }
function b64urlDecode(str) {
  const pad = str.length % 4 === 2 ? "==" : str.length % 4 === 3 ? "=" : "";
  return Buffer.from(String(str).replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}
function mintToken(playerId) {
  const s = secret(); if (!s) return null;
  const payload = JSON.stringify({ id: playerId, exp: Date.now() + TTL_MS });
  const payloadB = b64url(payload);
  const sig = b64url(crypto.createHmac("sha256", s).update(payloadB).digest());
  return payloadB + "." + sig;
}
function verifyToken(token) {
  const s = secret(); if (!s) return null;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [payloadB, sig] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", s).update(payloadB).digest());
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let claims;
  try { claims = JSON.parse(b64urlDecode(payloadB).toString("utf8")); } catch (e) { return null; }
  if (!claims || typeof claims.id !== "string" || typeof claims.exp !== "number") return null;
  if (claims.exp < Date.now()) return null;
  return claims;
}

// ---------- Airtable helpers ----------------------------------------------
function escHtml(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
function clean(v, max) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function round2(v) { return Math.round(v * 100) / 100; }
function normalizeName(s) { return String(s || "").trim().toLowerCase(); }
function splitTeam(str) {
  return String(str || "").split(/\s*(?:\/|&|,|\band\b|\+)\s*/i).map((s) => s.trim()).filter(Boolean);
}
function containsName(source, wantedLower) {
  const pieces = splitTeam(source);
  for (const p of pieces) if (normalizeName(p) === wantedLower) return true;
  return false;
}

async function airtableList(url, headers) {
  const out = [];
  let offset = "";
  for (let guard = 0; guard < 50; guard++) {
    const r = await fetch(url + (offset ? (url.indexOf("?") >= 0 ? "&" : "?") + "offset=" + encodeURIComponent(offset) : ""), { headers });
    if (!r.ok) throw new Error("Airtable " + r.status);
    const j = await r.json();
    (j.records || []).forEach((rec) => out.push({ id: rec.id, createdTime: rec.createdTime, fields: rec.fields || {} }));
    if (!j.offset) break;
    offset = j.offset;
  }
  return out;
}

async function findPlayerByName(name) {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const TABLE = process.env.PLAYERS_TABLE || "Players";
  // Case + whitespace insensitive match: lower + trim + collapse internal
  // runs of whitespace on both sides. "KYLE  MCCONNELL " matches "Kyle McConnell".
  const norm = String(name).trim().replace(/\s+/g, " ").toLowerCase();
  const safe = norm.replace(/"/g, '\\"');
  // Airtable's LOWER + TRIM handle case + surrounding whitespace; we
  // rely on the operator not double-spacing names in the directory.
  const filter = `LOWER(TRIM({Name}))="${safe}"`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}?maxRecords=1&filterByFormula=${encodeURIComponent(filter)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
  if (!r.ok) return null;
  const j = await r.json();
  const rec = (j.records || [])[0];
  return rec ? { id: rec.id, fields: rec.fields || {} } : null;
}

// Mask an email for on-screen confirmation: "kyle.m@example.com" →
// "k***m@e***e.com". Keeps the first + last char of the local part and
// first + last char of the domain name (minus TLD) so the person sees
// enough to know which inbox to check without exposing the full address.
function maskEmail(email) {
  const m = /^([^@]+)@([^@]+)$/.exec(String(email || "").trim());
  if (!m) return "";
  const local = m[1];
  const domain = m[2];
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  const maskPart = (s) => {
    if (!s) return "";
    if (s.length <= 2) return s[0] + "*";
    return s[0] + "***" + s[s.length - 1];
  };
  return maskPart(local) + "@" + maskPart(host) + tld;
}
async function loadPlayerById(id) {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const TABLE = process.env.PLAYERS_TABLE || "Players";
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}/${encodeURIComponent(id)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
  if (!r.ok) return null;
  const j = await r.json();
  return { id: j.id, fields: j.fields || {} };
}

// ---------- Magic-link email ----------------------------------------------
async function sendMagicEmail({ to, playerName, link }) {
  const from = process.env.RESEND_FROM_CALCUTTA || "F&H Golf Course <clubhouse@fandhgolf.com>";
  const replyTo = process.env.RESEND_REPLY_TO_CALCUTTA || "clubhouse@fandhgolf.com";
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const firstName = String(playerName).split(/\s+/)[0] || playerName;
  const subject = "Your F&H Player Card sign-in link";
  const text = [
    `${firstName},`, ``,
    `Here's your sign-in link for your F&H Player Card.`,
    `Tap it on any device to open your card — no password.`, ``,
    `  ${link}`, ``,
    `The link is good for 30 days. If you didn't request this, ignore this email.`, ``,
    `— F&H Golf Course`,
  ].join("\n");
  const brand = "#1B5E20";
  const serif = "Georgia, 'Times New Roman', serif";
  const sans = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
  const html = `<!doctype html><html><body style="margin:0;background:#f6f4ef;font-family:${sans};">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f4ef;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="background:#fff;border-radius:12px;border:1px solid #e6e2d8;padding:32px 36px;">
        <tr><td style="font:600 12px ${sans};color:${brand};letter-spacing:0.12em;text-transform:uppercase;">F&amp;H Golf Course</td></tr>
        <tr><td style="font:400 24px/1.25 ${serif};color:#222;padding:8px 0 6px 0;">Your Player Card sign-in link</td></tr>
        <tr><td style="font:400 15px/1.5 ${sans};color:#333;padding:8px 0 16px 0;">${escHtml(firstName)}, tap the button below to open your F&amp;H Player Card. No password to remember.</td></tr>
        <tr><td style="padding:8px 0 20px 0;">
          <a href="${escHtml(link)}" style="display:inline-block;background:${brand};color:#fff;text-decoration:none;font:700 15px ${sans};padding:12px 24px;border-radius:8px;">Open my Player Card &rarr;</a>
        </td></tr>
        <tr><td style="font:400 13px/1.55 ${sans};color:#666;">The link is good for 30 days. If you didn't request this, you can safely ignore this email.</td></tr>
        <tr><td style="font:400 12px/1.5 ${sans};color:#999;padding:20px 0 0 0;border-top:1px solid #eee;margin-top:20px;">F&amp;H Golf Course · Fleming, Colorado</td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject, html, text }),
  });
  return r.ok;
}

// ---------- History (current signups + past archives) ---------------------
async function fetchHistory(claims) {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const SIGNUPS = process.env.TOURNAMENTS_TABLE || "Tournament Signups";
  const ARCHIVES = process.env.ARCHIVES_TABLE || "Tournament Archives";
  const headers = { Authorization: `Bearer ${AIRTABLE_TOKEN}` };
  const player = await loadPlayerById(claims.id);
  if (!player) throw new Error("player-not-found");
  const playerName = String((player.fields || {}).Name || "").trim();
  if (!playerName) return { name: "", current: [], past: [] };
  const wantedLower = normalizeName(playerName);
  const safe = playerName.replace(/"/g, '\\"');
  const captainFilter = `LOWER({Player Name})=LOWER("${safe}")`;
  const captainUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(SIGNUPS)}?pageSize=100&filterByFormula=${encodeURIComponent(captainFilter)}`;
  const partnerFilter = `FIND(LOWER("${safe.toLowerCase()}"), LOWER({Team / Partners}))>0`;
  const partnerUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(SIGNUPS)}?pageSize=100&filterByFormula=${encodeURIComponent(partnerFilter)}`;
  const [asCaptain, asPartnerRaw] = await Promise.all([
    airtableList(captainUrl, headers).catch(() => []),
    airtableList(partnerUrl, headers).catch(() => []),
  ]);
  const asPartner = asPartnerRaw.filter((rec) => containsName((rec.fields || {})["Team / Partners"] || "", wantedLower));
  const seen = new Set();
  const current = [];
  [...asCaptain, ...asPartner].forEach((rec) => {
    if (seen.has(rec.id)) return; seen.add(rec.id);
    const f = rec.fields || {};
    current.push({
      id: rec.id,
      tournament: String(f.Tournament || "").trim(),
      role: normalizeName(f["Player Name"]) === wantedLower ? "captain" : "teammate",
      team: String(f["Team / Partners"] || "").trim(),
      alternate: !!f.Alternate,
      paid: String(f["Paid?"] || "").trim() || (f["Paid"] ? "Yes" : ""),
    });
  });
  current.sort((a, b) => b.tournament.localeCompare(a.tournament));
  const archivesUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(ARCHIVES)}?pageSize=100`;
  const archives = await airtableList(archivesUrl, headers).catch(() => []);
  const past = [];
  archives.forEach((rec) => {
    const f = rec.fields || {};
    let snap = null;
    try { snap = JSON.parse(f.Snapshot || "null"); } catch (e) { snap = null; }
    const rows = (snap && Array.isArray(snap.leaderboard)) ? snap.leaderboard : [];
    rows.forEach((row) => {
      if (!row || !row.name) return;
      if (!containsName(row.name, wantedLower)) return;
      past.push({
        archiveId: rec.id,
        tournament: String(f.Name || "").trim(),
        year: String(f.Year || "").trim(),
        dates: String(f.Dates || "").trim(),
        team: row.name,
        flight: row.flight || "",
        grossPlace: row.grossPlace || null,
        netPlace: row.netPlace || null,
        gross: (row.gross == null ? null : row.gross),
        net: (row.net == null ? null : row.net),
      });
    });
  });
  past.sort((a, b) => String(b.year).localeCompare(String(a.year)));
  return { name: playerName, current, past };
}

// ---------- Rounds --------------------------------------------------------
async function listRounds(playerId) {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const TABLE = process.env.ROUNDS_TABLE || "Rounds";
  const safe = playerId.replace(/"/g, '\\"');
  const filter = `{Player ID}="${safe}"`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}?pageSize=100&filterByFormula=${encodeURIComponent(filter)}&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
  if (!r.ok) {
    const detail = await r.text();
    if (r.status === 404 || r.status === 403 || /NOT_FOUND|TABLE_NOT_FOUND|MODEL_ID_NOT_FOUND/.test(detail || "")) {
      return { notReady: true, rounds: [] };
    }
    throw new Error("airtable " + r.status);
  }
  const j = await r.json();
  const rounds = (j.records || []).map((rec) => {
    const f = rec.fields || {};
    return {
      id: rec.id, created: rec.createdTime,
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

async function writeRow(table, fields) {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`;
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
      delete body[missing]; stripped.push(missing);
      return attempt(body);
    }
    return { ok: false, status: r.status, detail };
  }
  const outcome = await attempt(Object.assign({}, fields));
  return { outcome, stripped };
}

// ---------- Payments ------------------------------------------------------
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
    throw new Error("airtable " + r.status);
  }
  const j = await r.json();
  const payments = (j.records || []).map((rec) => {
    const f = rec.fields || {};
    return {
      id: rec.id, created: rec.createdTime,
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

const VALID_METHODS = new Set(["Card", "Check"]);
const VALID_RATES = new Set(["9 walk", "9 cart", "18 walk", "18 cart", "Custom"]);

// ---------- Handler --------------------------------------------------------
module.exports = async (req, res) => {
  if (require("./_cors")(req, res)) return;
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, error: "Method not allowed" }); }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, ADMIN_KEY } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !ADMIN_KEY) {
    return res.status(500).json({ ok: false, error: "Not configured." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const action = String(body.action || "").toLowerCase();

  // --- Magic request (public, no token) --- returns a masked-email
  // confirmation on success + a "not found" message on miss. The operator
  // opted into this small privacy trade-off so members see which inbox
  // to check, and a mis-typed name doesn't stall silently.
  if (action === "magic-request") {
    const name = String(body.name || "").trim();
    const notFound = { ok: true, sent: false, message: "We couldn't find a Player Card by that name — check the spelling, or call the pro shop at (970) 774-6362." };
    const noEmail = { ok: true, sent: false, message: "We found your Player Card but there's no email on file — call the pro shop at (970) 774-6362 to add one." };
    const genericFail = { ok: true, sent: false, message: "We couldn't send a link right now — please try again in a moment." };
    if (!name) return res.status(200).json(notFound);
    if (!process.env.RESEND_API_KEY) return res.status(200).json(genericFail);
    try {
      const rec = await findPlayerByName(name);
      if (!rec) return res.status(200).json(notFound);
      const email = String((rec.fields || {}).Email || "").trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(200).json(noEmail);
      const token = mintToken(rec.id);
      if (!token) return res.status(200).json(genericFail);
      const origin = (req.headers.origin || req.headers.referer || "https://fandhgolf.com").replace(/\/$/, "");
      const cleanOrigin = /^https?:\/\/[^\/]+/.exec(origin);
      const base = cleanOrigin ? cleanOrigin[0] : "https://fandhgolf.com";
      const link = base + "/player.html?token=" + encodeURIComponent(token);
      sendMagicEmail({ to: email, playerName: rec.fields.Name || name, link }).catch(() => {});
      const masked = maskEmail(email);
      return res.status(200).json({
        ok: true, sent: true, maskedEmail: masked,
        message: "We sent your sign-in link to " + masked + " — check that inbox.",
      });
    } catch (e) {
      console.error("magic-request error", e);
      return res.status(200).json(genericFail);
    }
  }

  // --- Create Player Card (public, no token) --- new-golfer path from the
  // "we couldn't find you" state on the sign-in form. Creates a Players
  // row + immediately mints and emails the sign-in link so the flow ends
  // at the same "check your inbox" screen.
  if (action === "create") {
    if (body.company) return res.status(200).json({ ok: true, created: true, sent: false, message: "Thanks!" }); // honeypot
    const nameRaw = String(body.name || "").trim().replace(/\s+/g, " ");
    const email = String(body.email || "").trim();
    if (!nameRaw) return res.status(400).json({ ok: false, error: "Type your full name." });
    if (nameRaw.length < 3) return res.status(400).json({ ok: false, error: "Full name looks too short." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: "A valid email is required so we can email your sign-in link." });
    if (!process.env.RESEND_API_KEY) return res.status(500).json({ ok: false, error: "Email service isn't configured. Call the pro shop at (970) 774-6362." });
    try {
      const existing = await findPlayerByName(nameRaw);
      if (existing) return res.status(400).json({ ok: false, error: "There's already a Player Card by that name. Try signing in instead — click Back and use \"Email me a sign-in link\"." });
      // Create the row via /api/players write. Same table + auth as the
      // admin Players CRUD endpoint; we're just reaching in with the
      // Airtable REST API directly to avoid a self-call.
      const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
      const PLAYERS = process.env.PLAYERS_TABLE || "Players";
      const today = new Date();
      const iso = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
      const cleanS = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
      const fields = {
        Name: nameRaw.slice(0, 120),
        Email: email.slice(0, 200),
        Phone: cleanS(body.phone, 40),
        Street: cleanS(body.street, 200),
        City: cleanS(body.city, 100),
        State: cleanS(body.state, 20),
        Zip: cleanS(body.zip, 20),
        Member: false,
        Notes: "Self-signed up via player.html on " + iso,
      };
      // Drop empty strings so Airtable doesn't stamp blank cells.
      Object.keys(fields).forEach((k) => { if (fields[k] === "") delete fields[k]; });
      const { outcome, stripped } = await writeRow(PLAYERS, fields);
      if (!outcome.ok) {
        console.error("player-card create failed", outcome.status, outcome.detail);
        return res.status(502).json({ ok: false, error: "Couldn't create your Player Card right now — please try again in a minute, or call (970) 774-6362." });
      }
      const rec = outcome.rec;
      const playerId = rec ? rec.id : null;
      if (!playerId) return res.status(502).json({ ok: false, error: "Player Card created but the sign-in link couldn't be sent — call (970) 774-6362." });
      const token = mintToken(playerId);
      const origin = (req.headers.origin || req.headers.referer || "https://fandhgolf.com").replace(/\/$/, "");
      const cleanOrigin = /^https?:\/\/[^\/]+/.exec(origin);
      const base = cleanOrigin ? cleanOrigin[0] : "https://fandhgolf.com";
      const link = base + "/player.html?token=" + encodeURIComponent(token);
      sendMagicEmail({ to: email, playerName: nameRaw, link }).catch(() => {});
      const masked = maskEmail(email);
      return res.status(200).json({
        ok: true, created: true, sent: true, maskedEmail: masked, stripped,
        message: "Your Player Card is set up — we sent your sign-in link to " + masked + ". Check that inbox.",
      });
    } catch (e) {
      console.error("player-card create error", e);
      return res.status(500).json({ ok: false, error: "Couldn't create your Player Card right now — please try again in a minute." });
    }
  }

  // Everything else requires a valid magic-link token.
  const claims = verifyToken(body.token);
  if (!claims) return res.status(400).json({ ok: false, error: "This link has expired or isn't valid." });

  if (action === "magic-verify") {
    const rec = await loadPlayerById(claims.id);
    if (!rec) return res.status(400).json({ ok: false, error: "Player not found." });
    const f = rec.fields || {};
    return res.status(200).json({
      ok: true,
      player: {
        id: rec.id,
        name: f.Name || "", email: f.Email || "", phone: f.Phone || "",
        street: f.Street || "", city: f.City || "", state: f.State || "", zip: f.Zip || "",
        member: !!f.Member, notes: f.Notes || "",
      },
    });
  }

  if (action === "history") {
    try {
      const out = await fetchHistory(claims);
      return res.status(200).json({ ok: true, ...out });
    } catch (e) {
      if (String(e && e.message) === "player-not-found") return res.status(400).json({ ok: false, error: "Player not found." });
      console.error("history error", e);
      return res.status(500).json({ ok: false, error: "Couldn't load your history." });
    }
  }

  if (action === "rounds-list") {
    try {
      const { notReady, rounds } = await listRounds(claims.id);
      return res.status(200).json({ ok: true, notReady: !!notReady, rounds });
    } catch (e) { console.error("rounds-list error", e); return res.status(500).json({ ok: false, error: "Couldn't load your rounds." }); }
  }

  if (action === "rounds-save") {
    const date = clean(body.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: "Date is required (YYYY-MM-DD)." });
    const holes = Number(body.holes);
    if (holes !== 9 && holes !== 18) return res.status(400).json({ ok: false, error: "Holes must be 9 or 18." });
    const tees = clean(body.tees, 40);
    const course = clean(body.course, 120) || "F&H Golf Course";
    const gross = Number(body.gross);
    if (!isFinite(gross) || gross <= 0 || gross > 300) return res.status(400).json({ ok: false, error: "Gross must be a positive number (up to 300)." });
    const notes = clean(body.notes, 1000);
    const player = await loadPlayerById(claims.id);
    const playerName = player ? String((player.fields || {}).Name || "").trim() : "";
    if (!playerName) return res.status(400).json({ ok: false, error: "Player not found." });
    const TABLE = process.env.ROUNDS_TABLE || "Rounds";
    try {
      const { outcome, stripped } = await writeRow(TABLE, {
        "Player Name": playerName, "Player ID": claims.id,
        "Date": date, "Holes": holes, "Tees": tees, "Course": course, "Gross": gross, "Notes": notes,
      });
      if (!outcome.ok) {
        console.error("rounds-save failed", outcome.status, outcome.detail);
        if (outcome.status === 404 || outcome.status === 403 || /NOT_FOUND|TABLE_NOT_FOUND|MODEL_ID_NOT_FOUND/.test(outcome.detail || "")) {
          return res.status(502).json({ ok: false, error: "The Rounds table isn't set up in Airtable yet. Ask the pro shop to create it." });
        }
        return res.status(502).json({ ok: false, error: "Couldn't save your round." });
      }
      const rec = outcome.rec; const f = (rec && rec.fields) || {};
      return res.status(200).json({
        ok: true, id: rec ? rec.id : null, stripped,
        round: {
          id: rec ? rec.id : null, created: rec ? rec.createdTime : null,
          date: String(f.Date || date).slice(0, 10),
          holes: Number(f.Holes) || holes,
          tees: String(f.Tees || tees).trim(),
          course: String(f.Course || course).trim(),
          gross: (typeof f.Gross === "number") ? f.Gross : gross,
          notes: String(f.Notes || notes).trim(),
        },
      });
    } catch (e) { console.error("rounds-save error", e); return res.status(500).json({ ok: false, error: "Couldn't save your round." }); }
  }

  if (action === "payments-list") {
    try {
      const { notReady, payments } = await listPayments(claims.id);
      return res.status(200).json({ ok: true, notReady: !!notReady, payments });
    } catch (e) { console.error("payments-list error", e); return res.status(500).json({ ok: false, error: "Couldn't load your payments." }); }
  }

  if (action === "payments-log") {
    const method = clean(body.method, 20);
    if (!VALID_METHODS.has(method)) return res.status(400).json({ ok: false, error: "Method must be Card or Check." });
    const rateType = clean(body.rateType, 40);
    if (!VALID_RATES.has(rateType)) return res.status(400).json({ ok: false, error: "Rate type must be one of the offered rates." });
    const baseAmount = round2(num(body.baseAmount));
    if (baseAmount <= 0 || baseAmount > 5000) return res.status(400).json({ ok: false, error: "Base amount must be positive (and reasonable)." });
    // Server-authoritative surcharge/total — never trust the client math.
    const expectedSurcharge = method === "Card" ? round2(baseAmount * 0.04) : 0;
    const expectedTotal = round2(baseAmount + expectedSurcharge);
    const surcharge = round2(num(body.surcharge));
    const total = round2(num(body.total));
    if (Math.abs(surcharge - expectedSurcharge) > 0.05 || Math.abs(total - expectedTotal) > 0.05) {
      return res.status(400).json({ ok: false, error: "Surcharge/total didn't match the base amount." });
    }
    const notes = clean(body.notes, 1000);
    const player = await loadPlayerById(claims.id);
    const playerName = player ? String((player.fields || {}).Name || "").trim() : "";
    if (!playerName) return res.status(400).json({ ok: false, error: "Player not found." });
    const today = new Date();
    const iso = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
    const TABLE = process.env.PAYMENTS_TABLE || "Payments";
    try {
      const { outcome, stripped } = await writeRow(TABLE, {
        "Player Name": playerName, "Player ID": claims.id,
        "Date": iso, "Rate Type": rateType,
        "Base Amount": baseAmount, "Surcharge": expectedSurcharge, "Total": expectedTotal,
        "Method": method, "Status": "Pending", "Notes": notes,
      });
      if (!outcome.ok) {
        if (outcome.status === 404 || outcome.status === 403 || /NOT_FOUND|TABLE_NOT_FOUND|MODEL_ID_NOT_FOUND/.test(outcome.detail || "")) {
          return res.status(502).json({ ok: false, error: "The Payments table isn't set up in Airtable yet. Ask the pro shop to create it." });
        }
        console.error("payments-log failed", outcome.status, outcome.detail);
        return res.status(502).json({ ok: false, error: "Couldn't log your payment." });
      }
      const rec = outcome.rec; const f = (rec && rec.fields) || {};
      return res.status(200).json({
        ok: true, id: rec ? rec.id : null, stripped,
        payment: {
          id: rec ? rec.id : null, created: rec ? rec.createdTime : null,
          date: String(f.Date || iso), rateType: String(f["Rate Type"] || rateType),
          baseAmount: (typeof f["Base Amount"] === "number") ? f["Base Amount"] : baseAmount,
          surcharge: (typeof f["Surcharge"] === "number") ? f["Surcharge"] : expectedSurcharge,
          total: (typeof f["Total"] === "number") ? f["Total"] : expectedTotal,
          method: String(f.Method || method), status: String(f.Status || "Pending"),
          notes: String(f.Notes || notes),
        },
      });
    } catch (e) { console.error("payments-log error", e); return res.status(500).json({ ok: false, error: "Couldn't log your payment." }); }
  }

  return res.status(400).json({ ok: false, error: "Unknown action." });
};
