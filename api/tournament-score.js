// Vercel serverless function — saves a team's hole-by-hole gross for one round
// (staff only, admin-key protected). Writes to the "Tournament Signups" record.
//
// Add these fields to the Tournament Signups table first:
//   Day1 Scores (long text)   Day2 Scores (long text)   -- JSON array of holes
//   Day1 Gross  (number)      Day2 Gross  (number)
//   Flight      (number)      -- set later by the leaderboard flight slider
//
// Body: { id, day: 1|2, scores: [ints|null, ...up to 18] }
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
    return res.status(500).json({ ok: false, error: "Scoring isn't configured yet." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  // Auth: staff use the admin key, captains use a magic-link token.
  // Token path looks up the captain's signup by "Live Token", then
  // enforces marker-scoring permissions:
  //   - Marker Scoring OFF for the tournament → token can only write
  //     to the captain's OWN signup (default).
  //   - Marker Scoring ON → server computes the marker assignment for
  //     the target day and rejects writes to any signup outside the
  //     captain's write-targets. Client passes `targetId` naming which
  //     team to write; falls back to the captain's own id.
  const bodyToken = typeof body.token === "string" ? body.token.trim() : "";
  let id = typeof body.id === "string" ? body.id : "";
  const rawTargetId = typeof body.targetId === "string" ? body.targetId : "";
  if (bodyToken) {
    if (!/^[a-f0-9]{16,64}$/i.test(bodyToken)) {
      return res.status(401).json({ ok: false, error: "Invalid link." });
    }
    const filter = "?filterByFormula=" + encodeURIComponent(`{Live Token}="${bodyToken.replace(/"/g, '\\"')}"`) + "&maxRecords=1";
    const lr = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}${filter}`, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    });
    if (!lr.ok) return res.status(502).json({ ok: false, error: "Could not verify the link." });
    const lj = await lr.json();
    const captainRec = (lj.records || [])[0];
    if (!captainRec) return res.status(401).json({ ok: false, error: "This link is no longer valid." });
    // Default target = captain's own signup.
    id = captainRec.id;
    // Marker scoring permission check. Only fires when the tournament's
    // config has Marker Scoring Enabled = true AND the client asked to
    // write to a different signup than the captain's own.
    const wantsCrossWrite = rawTargetId && rawTargetId !== captainRec.id;
    // The `day` we're writing determines which pairing to check. Extras-
    // only updates don't have a day and always write to the captain's
    // own signup (below); that path bypasses this cross-write logic.
    const dayForAuth = Number(body.day) === 2 ? "d2" : "d1";
    if (wantsCrossWrite) {
      try {
        const marker = require("./_marker.js");
        const tournamentName = String((captainRec.fields || {}).Tournament || "");
        const cfgTable = process.env.CONFIG_TABLE || "Tournament Config";
        // Fetch the tournament config + the full non-alt field in parallel
        // so we can rerun the marker assignment on the server.
        const [cfgR, fieldR] = await Promise.all([
          fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(cfgTable)}?filterByFormula=${encodeURIComponent(`{Tournament}="${tournamentName.replace(/"/g, '\\"')}"`)}&maxRecords=1`,
            { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }),
          fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}?filterByFormula=${encodeURIComponent(`AND({Tournament}="${tournamentName.replace(/"/g, '\\"')}", NOT({Alternate}))`)}&pageSize=100`,
            { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }),
        ]);
        const cfgRec = cfgR.ok ? ((await cfgR.json()).records || [])[0] : null;
        const fieldRecs = fieldR.ok ? ((await fieldR.json()).records || []) : [];
        // Marker Scoring defaults to ON when the config field is undefined
        // / null (missing on Airtable, new tournament, or auto-stripped
        // save). Matches the tournament-signups live handler + the
        // Format-tab checkbox default. Explicit false opts out.
        // FOUNDERS is exempt from the default so its pre-marker-scoring
        // behavior stays intact — same guard as the live-mode handler.
        const _msCfg = cfgRec && cfgRec.fields && cfgRec.fields["Marker Scoring Enabled"];
        const _msIsFoundersAuth = /^Founder/i.test(String(tournamentName || ""));
        const markerScoringEnabled = (_msCfg === undefined || _msCfg === null) ? !_msIsFoundersAuth : !!_msCfg;
        const me = marker.stripSignupField(captainRec);
        const stripped = fieldRecs.map(marker.stripSignupField);
        const assignment = marker.computeMarkerAssignment(me, stripped, markerScoringEnabled, dayForAuth);
        if (!assignment.writeTargets.includes(rawTargetId)) {
          return res.status(403).json({
            ok: false,
            error: "This scoring link isn't authorized to score that team. Ask the pro shop if pairings changed mid-round.",
          });
        }
        id = rawTargetId;
      } catch (e) {
        console.error("marker auth error", e);
        return res.status(500).json({ ok: false, error: "Could not verify marker permissions." });
      }
    }
  } else {
    const key = req.headers["x-admin-key"] || "";
    if (!ADMIN_KEY || key !== ADMIN_KEY) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }

  // Extras-only update path: captain tapped a "used a mulligan" button.
  // The body carries an "extrasUsed" JSON string (team-wide counts like
  // {"Mulligans":2}) and no scores — write only that field and return.
  // Same token auth as the score path (id is already resolved above).
  if (!Array.isArray(body.scores) && typeof body.extrasUsed === "string") {
    if (!id) return res.status(400).json({ ok: false, error: "Missing record id." });
    try {
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}/${id}`;
      const r = await fetch(url, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { "Extras Used": body.extrasUsed.slice(0, 4000) }, typecast: true }),
      });
      if (!r.ok) {
        const detail = await r.text();
        console.error("tournament-score extras update error", r.status, detail);
        // If the "Extras Used" column doesn't exist yet, tell the caller
        // clearly so they know to add it on Airtable.
        if (/Unknown field/i.test(detail)) {
          return res.status(502).json({ ok: false, error: "Airtable doesn't have an \"Extras Used\" field on Tournament Signups yet — ask the pro shop to add it." });
        }
        return res.status(502).json({ ok: false, error: "Could not save the extras update." });
      }
      const data = await r.json();
      return res.status(200).json({ ok: true, id: data.id, extrasUsed: (data.fields || {})["Extras Used"] || "" });
    } catch (e) {
      console.error("tournament-score extras update exception", e);
      return res.status(500).json({ ok: false, error: "Something went wrong saving the extras update." });
    }
  }

  const day = Number(body.day);
  if (!id) return res.status(400).json({ ok: false, error: "Missing record id." });
  if (day !== 1 && day !== 2) return res.status(400).json({ ok: false, error: "Day must be 1 or 2." });
  if (!Array.isArray(body.scores)) return res.status(400).json({ ok: false, error: "Scores must be a list." });

  // Sanitize: up to 18 holes, each a positive integer (1–40) or null if blank.
  const scores = body.scores.slice(0, 18).map((v) => {
    const n = Math.round(Number(v));
    return (isFinite(n) && n >= 1 && n <= 40) ? n : null;
  });

  // Only publish Gross once the whole round is in. A partial gross would make
  // the leaderboard, flights, and public displays start assigning HCPs and
  // flight cuts on garbage mid-round.
  const complete = scores.length === 18 && scores.every((n) => n != null);
  const gross = complete ? scores.reduce((s, n) => s + n, 0) : null;

  const fields = {};
  fields["Day" + day + " Scores"] = JSON.stringify(scores);
  fields["Day" + day + " Gross"] = gross;

  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}/${id}`;
    const r = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields, typecast: true }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error("tournament-score error", r.status, detail);
      const msg = r.status === 422
        ? "Airtable rejected scores — confirm the Day1/Day2 Scores (long text) and Day1/Day2 Gross (number) fields exist on the Tournament Signups table."
        : "Could not save the scores.";
      return res.status(502).json({ ok: false, error: msg });
    }
    const data = await r.json();
    return res.status(200).json({ ok: true, id: data.id, gross: gross, complete: complete, fields: data.fields || {} });
  } catch (e) {
    console.error("tournament-score error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong saving the scores." });
  }
};
