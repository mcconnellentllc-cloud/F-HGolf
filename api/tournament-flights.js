// Vercel serverless function — bulk Airtable writes for staff (admin-key).
// Combines flight assignment, team positioning (wave/hole), pairing-sheet
// import, and per-tournament config storage (slot layouts) into one endpoint
// to stay under Vercel's serverless-function limit. All Airtable writes batch
// ≤10 records per request.
//
// Bodies:
//   { assignments: [ { id, flight? , start?, hole? } ] }   -> patch teams
//   { action: "import", tournament, teams: [ { name, partner?, start? } ] } -> seed field
//   { action: "getConfig", tournament }                    -> read slot layout
//   { action: "saveConfig", tournament, config: {...} }    -> upsert slot layout
//
// Needs on Tournament Signups: Flight (number), Start (single select), Hole (number).
// Needs a "Tournament Config" table (or CONFIG_TABLE env override) with fields:
//   · Tournament   (single line text, primary — used as the upsert key)
//   · Slot Config  (long text — stores JSON like {"8 AM":{...},"1 PM":{...}})
//
// Env: AIRTABLE_TOKEN (data.records:write), AIRTABLE_BASE_ID,
//      TOURNAMENTS_TABLE (defaults to "Tournament Signups"),
//      CONFIG_TABLE (defaults to "Tournament Config"), ADMIN_KEY.

module.exports = async (req, res) => {
  if (require("./_cors")(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, ADMIN_KEY } = process.env;
  const TABLE = process.env.TOURNAMENTS_TABLE || "Tournament Signups";
  const CFG_TABLE = process.env.CONFIG_TABLE || "Tournament Config";
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) return res.status(500).json({ ok: false, error: "Not configured." });
  const key = req.headers["x-admin-key"] || "";
  if (!ADMIN_KEY || key !== ADMIN_KEY) return res.status(401).json({ ok: false, error: "Unauthorized" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}`;
  const cfgUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(CFG_TABLE)}`;
  const auth = { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" };
  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  try {
    // ---- Slot config (pairings layout) ------------------------------------
    // Reads/upserts a single record in Tournament Config keyed by Tournament
    // name. Config JSON is small (<1 KB), so we store the whole per-wave map
    // in one Slot Config text field. Missing table returns an empty config
    // gracefully so the app still runs — the admin just loses cross-device
    // slot persistence and falls back to localStorage.
    if (body.action === "getConfig") {
      const t = clean(body.tournament, 200);
      if (!t) return res.status(400).json({ ok: false, error: "tournament required." });
      const q = `?filterByFormula=${encodeURIComponent(`{Tournament}='${t.replace(/'/g, "\\'")}'`)}&maxRecords=1`;
      const r = await fetch(cfgUrl + q, { headers: { Authorization: auth.Authorization } });
      if (!r.ok) {
        if (r.status === 404) return res.status(200).json({ ok: true, config: {}, auctionState: {} });
        const d = await r.text(); console.error("getConfig", r.status, d);
        return res.status(200).json({ ok: true, config: {}, auctionState: {}, warning: "Config table missing — using localStorage only." });
      }
      const data = await r.json();
      const rec = (data.records || [])[0];
      let cfg = {}, aState = {};
      if (rec && rec.fields) {
        if (typeof rec.fields["Slot Config"] === "string") {
          try { cfg = JSON.parse(rec.fields["Slot Config"]) || {}; } catch (e) { cfg = {}; }
        }
        if (typeof rec.fields["Auction State"] === "string") {
          try { aState = JSON.parse(rec.fields["Auction State"]) || {}; } catch (e) { aState = {}; }
        }
      }
      return res.status(200).json({ ok: true, config: cfg, auctionState: aState, id: rec ? rec.id : null });
    }
    if (body.action === "saveConfig") {
      const t = clean(body.tournament, 200);
      if (!t) return res.status(400).json({ ok: false, error: "tournament required." });
      // Accept slot config, auction state, or both. Missing keys leave the
      // stored value unchanged so a partial write from one screen doesn't
      // wipe out settings owned by another.
      const cfg = (body.config && typeof body.config === "object") ? body.config : null;
      const aState = (body.auctionState && typeof body.auctionState === "object") ? body.auctionState : null;
      if (!cfg && !aState) return res.status(400).json({ ok: false, error: "config or auctionState required." });
      const q = `?filterByFormula=${encodeURIComponent(`{Tournament}='${t.replace(/'/g, "\\'")}'`)}&maxRecords=1`;
      const findR = await fetch(cfgUrl + q, { headers: { Authorization: auth.Authorization } });
      if (!findR.ok) {
        const d = await findR.text(); console.error("saveConfig find", findR.status, d);
        return res.status(200).json({ ok: false, error: "Config table missing — add a Tournament Config table (fields: Tournament, Slot Config, Auction State) in Airtable." });
      }
      const findData = await findR.json();
      const existing = (findData.records || [])[0];
      const fields = { Tournament: t };
      if (cfg) fields["Slot Config"] = JSON.stringify(cfg).slice(0, 20000);
      if (aState) fields["Auction State"] = JSON.stringify(aState).slice(0, 4000);
      if (existing && existing.id) {
        const upR = await fetch(cfgUrl, { method: "PATCH", headers: auth, body: JSON.stringify({ records: [{ id: existing.id, fields }] }) });
        if (!upR.ok) { const d = await upR.text(); console.error("saveConfig patch", upR.status, d); return res.status(502).json({ ok: false, error: "Couldn't update tournament config." }); }
      } else {
        const upR = await fetch(cfgUrl, { method: "POST", headers: auth, body: JSON.stringify({ records: [{ fields }] }) });
        if (!upR.ok) { const d = await upR.text(); console.error("saveConfig create", upR.status, d); return res.status(502).json({ ok: false, error: "Couldn't save tournament config." }); }
      }
      return res.status(200).json({ ok: true });
    }

    if (body.action === "import") {
      const tournament = clean(body.tournament, 120);
      if (!tournament || !Array.isArray(body.teams)) return res.status(400).json({ ok: false, error: "tournament and teams required." });
      const records = body.teams
        .map((t) => {
          const name = clean(t.name, 200);
          if (!name) return null;
          const fields = { "Player Name": name, Tournament: tournament, Status: "New" };
          const start = clean(t.start, 20); if (start) fields.Start = start;
          const partner = clean(t.partner, 200); if (partner) fields["Team / Partners"] = partner;
          return { fields };
        })
        .filter(Boolean);
      if (!records.length) return res.status(400).json({ ok: false, error: "No teams to import." });
      let created = 0;
      for (let i = 0; i < records.length; i += 10) {
        const r = await fetch(url, { method: "POST", headers: auth, body: JSON.stringify({ records: records.slice(i, i + 10), typecast: true }) });
        if (!r.ok) { const d = await r.text(); console.error("import", r.status, d); return res.status(502).json({ ok: false, error: "Import failed partway. Some teams may have been added." }); }
        const data = await r.json();
        created += (data.records || []).length;
      }
      return res.status(200).json({ ok: true, created });
    }

    if (!Array.isArray(body.assignments)) return res.status(400).json({ ok: false, error: "assignments must be a list." });
    const records = body.assignments
      .filter((a) => a && typeof a.id === "string")
      .map((a) => {
        const fields = {};
        if (a.flight !== undefined) {
          const f = (a.flight === "" || a.flight == null) ? null : Number(a.flight);
          fields.Flight = (f != null && isFinite(f)) ? f : null;
        }
        if (typeof a.start === "string") fields.Start = a.start ? a.start.slice(0, 20) : null;
        if (a.hole !== undefined) { const h = Number(a.hole); fields.Hole = (a.hole === "" || a.hole == null || !isFinite(h)) ? null : h; }
        if (typeof a.slot === "string") fields.Slot = a.slot ? a.slot.slice(0, 10) : null;
        // Seat: 1 or 2 within the tee slot (Team 1 / Team 2). Clears to null
        // when a team goes back to Unplaced. Requires a "Seat" (Number) field
        // on the Signups table — missing field returns a 502 from Airtable
        // with a helpful hint from the catch below.
        if (a.seat !== undefined) {
          const s = Number(a.seat);
          fields.Seat = (a.seat === "" || a.seat == null || !isFinite(s)) ? null : Math.max(1, Math.min(3, s));
        }
        // Day 2 pairings — separate fields so Day 1 layout stays intact
        // as the operator arranges tomorrow's shotgun. Same shape as Day 1.
        // Missing fields on the Signups table get auto-stripped (see below).
        if (a.d2Hole !== undefined) { const h2 = Number(a.d2Hole); fields["Day 2 Hole"] = (a.d2Hole === "" || a.d2Hole == null || !isFinite(h2)) ? null : h2; }
        if (typeof a.d2Slot === "string") fields["Day 2 Slot"] = a.d2Slot ? a.d2Slot.slice(0, 10) : null;
        if (a.d2Seat !== undefined) {
          const s2 = Number(a.d2Seat);
          fields["Day 2 Seat"] = (a.d2Seat === "" || a.d2Seat == null || !isFinite(s2)) ? null : Math.max(1, Math.min(3, s2));
        }
        // Day 2 wave — separate from Start so a team can be Day 1 AM but
        // Day 2 PM (typical: Champ + 1st flight move to the afternoon,
        // 2nd + 3rd stay in the morning).
        if (typeof a.d2Start === "string") fields["Day 2 Start"] = a.d2Start ? a.d2Start.slice(0, 20) : null;
        return { id: a.id, fields };
      })
      .filter((r) => Object.keys(r.fields).length);
    if (!records.length) return res.status(400).json({ ok: false, error: "Nothing to update." });
    // Optional-field auto-heal. Airtable rejects the whole batch when it sees
    // a field name the table doesn't have (Seat, Slot, Cart Type — these
    // arrived in later PRs and some bases haven't added them yet). Rather
    // than fail the whole apply, we detect UNKNOWN_FIELD_NAME, drop the
    // offending field from every record, and retry the same batch. Repeat
    // until Airtable accepts or every field is stripped.
    const stripped = new Set();
    async function patchBatch(batch) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const r = await fetch(url, { method: "PATCH", headers: auth, body: JSON.stringify({ records: batch, typecast: true }) });
        if (r.ok) return await r.json();
        const detail = await r.text();
        let missing = null;
        try { const parsed = JSON.parse(detail); const msg = parsed && parsed.error && parsed.error.message; const m = /Unknown field name[s]?:\s*"([^"]+)"/i.exec(msg || ""); if (m) missing = m[1]; } catch (e) {}
        if (!missing) { console.error("assignments patch", r.status, detail); throw new Error(detail); }
        stripped.add(missing);
        batch.forEach((rec) => { if (rec.fields && Object.prototype.hasOwnProperty.call(rec.fields, missing)) delete rec.fields[missing]; });
        // Skip records that ended up with no fields at all after stripping.
        batch = batch.filter((rec) => rec.fields && Object.keys(rec.fields).length);
        if (!batch.length) return { records: [] };
      }
      throw new Error("Retry limit hit while stripping unknown fields.");
    }
    let updated = 0;
    for (let i = 0; i < records.length; i += 10) {
      try {
        const data = await patchBatch(records.slice(i, i + 10));
        updated += (data.records || []).length;
      } catch (e) {
        console.error("assignments patch (after strip)", e.message);
        return res.status(502).json({ ok: false, error: "Could not save changes (are Flight/Start/Hole/Slot/Seat fields on the table?).", strippedFields: [...stripped] });
      }
    }
    const payload = { ok: true, updated };
    if (stripped.size) payload.warning = "Applied without " + [...stripped].join(", ") + " (add those fields on the Signups table to store them).";
    return res.status(200).json(payload);
  } catch (e) {
    console.error("tournament-flights error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong updating teams." });
  }
};
