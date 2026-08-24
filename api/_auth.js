// Shared auth check. Every tournament-workbook API used to just
// compare req.headers["x-admin-key"] against process.env.ADMIN_KEY.
// Now we also accept an HMAC-signed staff token in the same header:
// same shape as the Player Card magic-link token but with an extra
// `scope: "tournament", key: "<KEY>"` claim so writes can be
// tournament-scoped.
//
// Usage in an endpoint:
//   const auth = require("./_auth")(req);
//   if (!auth) return res.status(401).json({ ok: false, error: "Unauthorized" });
//   // ...
//   if (auth.mode === "staff" && auth.scope !== tournamentKey) {
//     return res.status(403).json({ ok: false, error: "Staff link scoped to a different tournament." });
//   }
//
// Files starting with "_" aren't routed by Vercel.

const crypto = require("crypto");

function secret() {
  const adminKey = process.env.ADMIN_KEY || "";
  if (!adminKey) return null;
  // Same suffix the player-card token helper uses so a staff token +
  // a player token verify against the same secret. Different claim
  // shapes keep the two token types distinct at the check layer.
  return crypto.createHash("sha256").update(adminKey + "|player-magic").digest();
}
function b64urlDecode(str) {
  const pad = str.length % 4 === 2 ? "==" : str.length % 4 === 3 ? "=" : "";
  return Buffer.from(String(str).replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
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
  if (!claims || typeof claims.exp !== "number") return null;
  if (claims.exp < Date.now()) return null;
  return claims;
}

module.exports = function auth(req) {
  const key = String((req.headers && req.headers["x-admin-key"]) || "");
  if (!key) return null;
  const ADMIN_KEY = process.env.ADMIN_KEY || "";
  if (ADMIN_KEY && key === ADMIN_KEY) return { mode: "admin", scope: null };
  const claims = verifyToken(key);
  if (claims && claims.scope === "tournament" && typeof claims.key === "string" && claims.key) {
    return { mode: "staff", scope: claims.key };
  }
  return null;
};
module.exports.verifyToken = verifyToken;
