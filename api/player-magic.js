// Vercel serverless function — player magic-link auth.
//
// Public sign-in for the Player Card page. A player types their name (as it
// appears on the Player Card in the Players table). We look them up by
// case-insensitive exact match. When we find them AND they have an email
// on file, we send a short-lived signed link to that email. The response
// is deliberately identical whether we found them or not — we don't
// reveal directory membership to unauthenticated callers.
//
//   POST /api/player-magic
//     { action: "request", name: "Rydge Peterson" }
//        -> always 200 { ok: true, message: "If we found a match, we sent a link." }
//
//     { action: "verify", token: "<opaque>" }
//        -> 200 { ok: true, player: { id, name, email, member, ... } }
//        -> 400 { ok: false, error: "Link expired or invalid." }
//
// Token format: base64url(JSON({ id, exp })) + "." + base64url(hmacSha256(secret, payload))
// TTL: 30 days (link is comfortable across "email it to myself, click on
// another device tomorrow" flows). Secret is derived from ADMIN_KEY so it
// stays stable across deploys without a new env var.
//
// Env: AIRTABLE_TOKEN, AIRTABLE_BASE_ID, PLAYERS_TABLE (defaults to "Players"),
//      ADMIN_KEY (used as HMAC seed), RESEND_API_KEY.

const crypto = require("crypto");

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function secret() {
  // Derive a stable HMAC secret from ADMIN_KEY so we don't require a new
  // env var. Adding a namespace suffix so this secret can't collide with
  // any other HMAC use of ADMIN_KEY (there is none today, but cheap to be
  // safe). ADMIN_KEY MUST be set for this endpoint to work.
  const adminKey = process.env.ADMIN_KEY || "";
  if (!adminKey) return null;
  return crypto.createHash("sha256").update(adminKey + "|player-magic").digest();
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
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
  // Timing-safe compare so a partial-guess attacker can't measure how many
  // leading bytes match.
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let claims;
  try { claims = JSON.parse(b64urlDecode(payloadB).toString("utf8")); } catch (e) { return null; }
  if (!claims || typeof claims.id !== "string" || typeof claims.exp !== "number") return null;
  if (claims.exp < Date.now()) return null;
  return claims;
}

async function findPlayerByName(name) {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const TABLE = process.env.PLAYERS_TABLE || "Players";
  const safe = String(name).replace(/"/g, '\\"');
  const filter = `LOWER({Name})=LOWER("${safe}")`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}?maxRecords=1&filterByFormula=${encodeURIComponent(filter)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
  if (!r.ok) return null;
  const j = await r.json();
  const rec = (j.records || [])[0];
  return rec ? { id: rec.id, fields: rec.fields || {} } : null;
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

async function sendMagicEmail({ to, playerName, link }) {
  const from = process.env.RESEND_FROM_CALCUTTA || "F&H Golf Course <clubhouse@fandhgolf.com>";
  const replyTo = process.env.RESEND_REPLY_TO_CALCUTTA || "clubhouse@fandhgolf.com";
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const firstName = String(playerName).split(/\s+/)[0] || playerName;
  const subject = "Your F&H Player Card sign-in link";
  const text = [
    `${firstName},`,
    ``,
    `Here's your sign-in link for your F&H Player Card.`,
    `Tap it on any device to open your card — no password.`,
    ``,
    `  ${link}`,
    ``,
    `The link is good for 30 days. If you didn't request this, ignore this email.`,
    ``,
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
function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

module.exports = async (req, res) => {
  if (require("./_cors")(req, res)) return;
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, error: "Method not allowed" }); }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, ADMIN_KEY, RESEND_API_KEY } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !ADMIN_KEY) {
    return res.status(500).json({ ok: false, error: "Not configured." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const action = String(body.action || "").toLowerCase();

  if (action === "verify") {
    const claims = verifyToken(body.token);
    if (!claims) return res.status(400).json({ ok: false, error: "This link has expired or isn't valid. Request a new one." });
    const rec = await loadPlayerById(claims.id);
    if (!rec) return res.status(400).json({ ok: false, error: "Player not found." });
    const f = rec.fields || {};
    return res.status(200).json({
      ok: true,
      player: {
        id: rec.id,
        name: f.Name || "",
        email: f.Email || "",
        phone: f.Phone || "",
        street: f.Street || "",
        city: f.City || "",
        state: f.State || "",
        zip: f.Zip || "",
        member: !!f.Member,
        notes: f.Notes || "",
      },
    });
  }

  if (action === "request") {
    const name = String(body.name || "").trim();
    // Always same response shape + status — don't reveal whether we found
    // a match or whether the match had an email on file.
    const generic = { ok: true, message: "If we found a match with an email on file, we sent a link." };
    if (!name) return res.status(200).json(generic);
    if (!RESEND_API_KEY) return res.status(200).json(generic);
    try {
      const rec = await findPlayerByName(name);
      if (!rec) return res.status(200).json(generic);
      const email = String((rec.fields || {}).Email || "").trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(200).json(generic);
      const token = mintToken(rec.id);
      if (!token) return res.status(200).json(generic);
      const origin = (req.headers.origin || req.headers.referer || "https://fandhgolf.com").replace(/\/$/, "");
      const cleanOrigin = /^https?:\/\/[^\/]+/.exec(origin);
      const base = cleanOrigin ? cleanOrigin[0] : "https://fandhgolf.com";
      const link = base + "/player.html?token=" + encodeURIComponent(token);
      // Fire and don't fail the response if the send errors — response
      // still says "we sent a link" so a caller can't detect delivery.
      sendMagicEmail({ to: email, playerName: rec.fields.Name || name, link }).catch(() => {});
      return res.status(200).json(generic);
    } catch (e) {
      console.error("player-magic request error", e);
      return res.status(200).json(generic);
    }
  }

  return res.status(400).json({ ok: false, error: "Unknown action." });
};

// Export the token verifier so other endpoints (players self-read/write,
// player-history) can validate a magic-link token without duplicating the
// HMAC scheme.
module.exports.verifyToken = verifyToken;
