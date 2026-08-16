// Shared marker-assignment helper. Used by:
// - tournament-signups.js (?live=TOKEN) to tell the phone which team(s)
//   the captain is authorized to score + which tee-mates to display.
// - tournament-score.js (token POST) to enforce that a leaked token can
//   only write to the team the captain is legitimately marking.
//
// Modes:
//   self         — marker scoring off, or captain is on a solo tee.
//                  captain scores their own team (default fallback).
//   marker       — cycle: captain marks the NEXT team on the tee
//                  sorted by (Slot, Seat). A→B, B→C, C→A.
//   group_scorer — captain's Group Scorer flag is on → writes every
//                  team on their tee (self + others).
//   spectator    — some OTHER team on the tee is Group Scorer →
//                  no writes; captain sees everyone read-only.
//
// stripField input shape (from tournament-signups.js): each field row
// includes hole, slot, seat, start (Day 1) and d2Hole, d2Slot, d2Seat,
// d2Start (Day 2) plus groupScorer boolean. `me` is the token owner's
// stripped row.

function computeMarkerAssignment(me, fieldStripped, markerScoringEnabled, dayKey) {
  const holeKey = dayKey === "d1" ? "hole" : "d2Hole";
  const slotKey = dayKey === "d1" ? "slot" : "d2Slot";
  const seatKey = dayKey === "d1" ? "seat" : "d2Seat";
  const startKey = dayKey === "d1" ? "start" : "d2Start";
  const baseline = {
    mode: "self",
    writeTargets: me ? [me.id] : [],
    marking: null,
    teeMates: [],
    groupScorerName: null,
  };
  if (!markerScoringEnabled || !me) return baseline;
  const myHole = me[holeKey];
  const myStart = me[startKey];
  if (myHole == null || !myStart) return baseline; // no pairing yet
  const mates = fieldStripped
    .filter((r) => r[holeKey] === myHole && r[startKey] === myStart)
    .sort((a, b) =>
      String(a[slotKey]).localeCompare(String(b[slotKey])) ||
      ((a[seatKey] || 0) - (b[seatKey] || 0)) ||
      String(a.id).localeCompare(String(b.id))
    );
  if (mates.length <= 1) return baseline; // solo tee → self fallback
  const meIdx = mates.findIndex((r) => r.id === me.id);
  const groupScorer = mates.find((r) => r.groupScorer);
  if (groupScorer) {
    if (groupScorer.id === me.id) {
      return {
        mode: "group_scorer",
        writeTargets: mates.map((r) => r.id),
        marking: null,
        teeMates: mates,
        groupScorerName: groupScorer.teamName,
      };
    }
    return {
      mode: "spectator",
      writeTargets: [],
      marking: null,
      teeMates: mates,
      groupScorerName: groupScorer.teamName,
    };
  }
  const target = mates[(meIdx + 1) % mates.length];
  return {
    mode: "marker",
    writeTargets: [target.id],
    marking: target.id,
    teeMates: mates,
    groupScorerName: null,
  };
}

// Stripped-field builder — mirrors what tournament-signups.js returns
// so the score endpoint can rebuild the same shape from Airtable when
// validating a write.
function stripSignupField(rec) {
  const f = rec.fields || {};
  return {
    id: rec.id,
    teamName: f["Player Name"] || "",
    hole: (typeof f["Hole"] === "number") ? f["Hole"] : null,
    slot: f["Slot"] || "",
    seat: (typeof f["Seat"] === "number") ? f["Seat"] : null,
    start: f["Start"] || "",
    d2Hole: (typeof f["Day 2 Hole"] === "number") ? f["Day 2 Hole"] : null,
    d2Slot: f["Day 2 Slot"] || "",
    d2Seat: (typeof f["Day 2 Seat"] === "number") ? f["Day 2 Seat"] : null,
    d2Start: f["Day 2 Start"] || "",
    groupScorer: !!f["Group Scorer"],
  };
}

module.exports = { computeMarkerAssignment, stripSignupField };
