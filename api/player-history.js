// Vercel serverless function — tournament history for a Player Card.
//
// Requires a magic-link token (issued by /api/player-magic). Returns two
// lists:
//   - upcoming/current: current-year Tournament Signups where the player is
//     the captain OR appears in the Team / Partners roster (fuzzy match).
//   - past: Tournament Archives whose snapshot leaderboard mentions this
//     player's name (via the same team-name split heuristic the Send
//     invites recipient-builder uses).
//
//   POST /api/player-history  { token: "<magic-link token>" }
//     -> 200 { ok: true, name, current: [...], past: [...] }
//     -> 400 { ok: false, error }
//
// Env: AIRTABLE_TOKEN, AIRTABLE_BASE_ID, TOURNAMENTS_TABLE (defaults to
//      "Tournament Signups"), ARCHIVES_TABLE (defaults to
//      "Tournament Archives"), ADMIN_KEY.

const magic = require("./player-magic");

function normalizeName(s) {
  return String(s || "").trim().toLowerCase();
}
function splitTeam(str) {
  return String(str || "")
    .split(/\s*(?:\/|&|,|\band\b|\+)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}
// Loose "the player's name appears anywhere in this string" test — split
// the source on team separators and compare each piece case-insensitively
// against the player's canonical name. Guards against substring false
// positives ("John" matching "Johnson") while still catching common team
// spellings like "Rydge Peterson & Chris Fuesz".
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

module.exports = async (req, res) => {
  if (require("./_cors")(req, res)) return;
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, error: "Method not allowed" }); }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const SIGNUPS = process.env.TOURNAMENTS_TABLE || "Tournament Signups";
  const ARCHIVES = process.env.ARCHIVES_TABLE || "Tournament Archives";
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) return res.status(500).json({ ok: false, error: "Not configured." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const claims = magic.verifyToken && magic.verifyToken(body.token);
  if (!claims) return res.status(400).json({ ok: false, error: "This link has expired or isn't valid." });

  const headers = { Authorization: `Bearer ${AIRTABLE_TOKEN}` };
  const playersUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(process.env.PLAYERS_TABLE || "Players")}/${encodeURIComponent(claims.id)}`;
  try {
    const rp = await fetch(playersUrl, { headers });
    if (!rp.ok) return res.status(400).json({ ok: false, error: "Player not found." });
    const player = await rp.json();
    const playerName = String((player.fields || {}).Name || "").trim();
    if (!playerName) return res.status(200).json({ ok: true, name: "", current: [], past: [] });
    const wantedLower = normalizeName(playerName);

    // Current signups — filter server-side by captain name for the fast
    // path; then filter client-side across all rows for Team / Partners
    // matches. The filter formula does case-insensitive exact match on
    // Player Name so we don't drag every signup row over the wire.
    const safe = playerName.replace(/"/g, '\\"');
    const captainFilter = `LOWER({Player Name})=LOWER("${safe}")`;
    const captainUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(SIGNUPS)}?pageSize=100&filterByFormula=${encodeURIComponent(captainFilter)}`;
    const partnerFilter = `FIND(LOWER("${safe.toLowerCase()}"), LOWER({Team / Partners}))>0`;
    const partnerUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(SIGNUPS)}?pageSize=100&filterByFormula=${encodeURIComponent(partnerFilter)}`;
    const [asCaptain, asPartnerRaw] = await Promise.all([
      airtableList(captainUrl, headers).catch(() => []),
      airtableList(partnerUrl, headers).catch(() => []),
    ]);
    // De-fuzz the partner-side matches: FIND is substring-based, so
    // "John" would hit "Johnson". Reject rows whose Team / Partners
    // doesn't contain the exact name as a split piece.
    const asPartner = asPartnerRaw.filter((rec) => {
      const roster = (rec.fields || {})["Team / Partners"] || "";
      return containsName(roster, wantedLower);
    });
    // Dedup by record id — captain filter can also match rows where the
    // captain and a partner happen to be the same string.
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
    // Sort by tournament KEY (which contains the date) so newer events
    // land first — the KEY convention keeps chronological order stable
    // even without a proper date field.
    current.sort((a, b) => b.tournament.localeCompare(a.tournament));

    // Past — walk archives, split each snapshot leaderboard row's team
    // name into individual player names, keep the ones matching. Also
    // grab the finish position + gross when the snapshot carries them.
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

    return res.status(200).json({ ok: true, name: playerName, current, past });
  } catch (e) {
    console.error("player-history error", e);
    return res.status(500).json({ ok: false, error: "Couldn't load your history." });
  }
};
