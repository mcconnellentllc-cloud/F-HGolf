/* F&H Golf — shared tournament-rules generator.
   Consumed by the workbook Rules tab (tournament-admin.html) and the
   public tournament-rules.html page. Given a Tournament Config record
   from Airtable, returns an HTML fragment that describes the format,
   ties, and the course-wide OB / penalty / play-the-ball rules — so a
   Haxtun Fire 4-man doesn't have to show Founders-scramble language,
   and every future tournament auto-gets rules matching its Format tab.

   Founders and the Aug 22 Couples still have their own hand-authored
   pages (founders-rules.html + couples-rules.html) — those aren't
   touched. Only new / generic tournaments route through this. */
(function () {
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // "two-man" / "three-man" / "four-man" / "5-player". Uses "-man" only for
  // the common scramble team sizes so the phrasing reads naturally
  // ("Two-man scramble"); falls back to a neutral "<N>-player" for anything
  // exotic. Adult/child (perTeam=2 with roles set) is handled separately
  // in buildRules below.
  function teamNoun(perTeam) {
    if (perTeam === 2) return "two-man";
    if (perTeam === 3) return "three-man";
    if (perTeam === 4) return "four-man";
    return perTeam + "-player";
  }
  function cap(s) { return String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1); }

  function parseWaves(raw) {
    if (!raw) return [];
    try {
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (w) { return w && (w.time || w.label); });
    } catch (e) { return []; }
  }

  function waveTimesString(waves) {
    var parts = waves.map(function (w) { return String(w.time || "").trim(); }).filter(Boolean);
    if (!parts.length) return "";
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts.join(" and ");
    return parts.slice(0, -1).join(", ") + ", and " + parts[parts.length - 1];
  }

  function coerceBool(v) {
    if (v === true) return true;
    if (typeof v === "string") { var s = v.toLowerCase(); return s === "true" || s === "1" || s === "yes"; }
    if (typeof v === "number") return v !== 0;
    return false;
  }

  // Course-wide rules — identical across every F&H tournament. Kept in one
  // place so a future rule change edits one string, not twelve pages.
  function courseRulesHTML() {
    return ''
      + '<h4>Out of Bounds</h4>'
      + '<ul>'
      +   '<li><b>Hole #1</b> is OB on <b>both sides</b>. West side <b>white stakes</b> &mdash; OB line only runs as far north as the <b>northernmost stake</b>; further north (still to the west) is <b>in play</b>.</li>'
      +   '<li>The <b>exterior fence</b> of the entire course is OB.</li>'
      +   '<li>Penalty: <b>stroke and distance</b> (USGA R.18.2). Play a provisional when in doubt.</li>'
      + '</ul>'
      + '<h4>Penalty areas &mdash; local rule (no grounding)</h4>'
      + '<ul>'
      +   '<li>Penalty areas at: <b>between holes #3 &amp; #4</b>, <b>between holes #6 &amp; #7</b>, and the <b>hole west of the driving range</b>.</li>'
      +   '<li><b>No grounding clubs</b> in these areas &mdash; enforced like a bunker (R.12.2b). Grounding = <b>+2 strokes</b>.</li>'
      +   '<li>Relief options (all <b>+1 stroke</b>): stroke &amp; distance, back-on-line, or <b>2 club lengths</b> lateral from where the ball crossed the edge, no closer to hole (R.17).</li>'
      + '</ul>'
      + '<h4>Playing the ball</h4>'
      + '<ul>'
      +   '<li><b>Play it down.</b> No fluffing, no bumping. Improving lie/line = <b>+2 strokes</b> (R.8.1).</li>'
      +   '<li><b>Drops:</b> from <b>higher than knee</b>, within <b>1 club length</b>, in the <b>same cut of grass</b> as the chosen point.</li>'
      +   '<li><b>Tree relief (young trees):</b> trunk under <b>4&Prime; diameter</b> &rarr; <b>2 club lengths</b> relief, no closer to hole.</li>'
      +   '<li><b>Unplayable</b> (outside penalty area): <b>+1 stroke</b>, then stroke &amp; distance / back-on-line / 2 club lengths lateral (R.19).</li>'
      + '</ul>';
  }

  function tiesHTML(calcutta) {
    var extra = calcutta
      ? '<li><b>Calcutta 1st &rarr; scorecard playoff</b> using the same Men\'s Hdcp order.</li>'
      : "";
    return ''
      + '<h4>Ties' + (calcutta ? "" : " (no Calcutta this tournament)") + '</h4>'
      + '<ul>'
      +   '<li><b>Flight money 2nd &amp; 3rd &rarr; split the pot.</b> Only 1st is played off.</li>'
      +   '<li><b>Flight money 1st &rarr; scorecard playoff (Men\'s Hdcp order).</b> Hole 11 hardest, then hole 2, then 15, down the list. First lower score wins. Committee chip-off if the whole card ties.</li>'
      +   extra
      + '</ul>';
  }

  function scrambleHTML(perTeam, rounds, waves, calcutta) {
    var noun = teamNoun(perTeam);
    var teeAll = perTeam === 2 ? "Both tee off" : "All " + perTeam + " tee off";
    var putAll = perTeam === 2 ? "Both players putt" : "All " + perTeam + " players putt";
    var teeOptions = perTeam === 2 ? "the best of the two drives" : "the best of the " + perTeam + " drives";
    var out = ''
      + '<h4>Format &amp; scramble mechanics</h4>'
      + '<ul>'
      +   '<li><b>' + cap(noun) + ' scramble.</b> ' + teeAll + '; the team selects ' + teeOptions + ', non-selected balls are picked up.</li>'
      +   '<li><b>Everyone plays from the same location &mdash; every shot.</b> After the drive is selected, all players hit their next shot from the spot of the selected ball. One team score per hole.</li>'
      +   '<li><b>On the green:</b> mark the selected ball <b>1 putter-head length</b> from the ball. <b>' + putAll + ' from the same placement</b> off the marker.</li>';
    if (rounds >= 2) {
      var times2 = waveTimesString(waves);
      out += '<li>Full 18 each day; two-day cumulative gross decides flight winners.'
          + (times2 ? ' Shotgun' + (waves.length > 1 ? "s" : "") + ' at <b>' + esc(times2) + '</b>.' : '')
          + ' Report 10 min early. Flights set by Day&nbsp;1 gross.</li>';
    } else {
      var times1 = waveTimesString(waves);
      out += '<li>Full 18 &mdash; one-day tournament.'
          + (times1 ? ' Shotgun' + (waves.length > 1 ? "s" : "") + ' at <b>' + esc(times1) + '</b>.' : '')
          + ' Report 10 min early.</li>';
    }
    out += calcutta
      ? '<li><b>Calcutta:</b> flight bidding pool. See the Calcutta card for buy prices and payouts.</li>'
      : '<li><b>No Calcutta.</b> Flight prizes only.</li>';
    out += '</ul>';
    return out;
  }

  function adultChildHTML(rounds, waves) {
    var times = waveTimesString(waves);
    return ''
      + '<h4>Format &mdash; adult + child scramble</h4>'
      + '<ul>'
      +   '<li><b>Two-player teams &mdash; one adult, one child.</b> Both tee off; the team selects the better drive.</li>'
      +   '<li>Both play from the spot of the selected ball on every subsequent shot until holed.</li>'
      +   '<li>Full 18' + (rounds >= 2 ? " each day (two-day cumulative gross)" : " &mdash; one-day tournament") + '.'
      +   (times ? ' Start' + (waves.length > 1 ? "s" : "") + ' at <b>' + esc(times) + '</b>.' : '')
      +   ' Report 10 min early.</li>'
      + '</ul>';
    }

  function juniorHTML() {
    return ''
      + '<h4>Format &mdash; junior camp</h4>'
      + '<ul>'
      +   '<li><b>Youth instruction camp.</b> Rules and drills are announced on-site each day.</li>'
      +   '<li>Age-appropriate groups; certified instructor supervision throughout.</li>'
      +   '<li>Water and snacks provided.</li>'
      + '</ul>';
  }

  function individualHTML(rounds, waves) {
    var times = waveTimesString(waves);
    return ''
      + '<h4>Format &mdash; individual stroke play</h4>'
      + '<ul>'
      +   '<li><b>One player, one ball.</b> Play your own ball throughout under standard USGA stroke play.</li>'
      +   '<li>Full 18' + (rounds >= 2 ? " each day (two-day cumulative gross)" : " &mdash; one-day tournament") + '.'
      +   (times ? ' Shotgun' + (waves.length > 1 ? "s" : "") + ' at <b>' + esc(times) + '</b>.' : '')
      +   ' Report 10 min early.</li>'
      + '</ul>';
  }

  // Main entry — returns an HTML string suitable for injection into a
  // container that already has the outer scaffolding (heading + description).
  function buildTournamentRules(cfg, key) {
    cfg = cfg || {};
    var perTeam = Number(cfg["Players Per Team"]) || 2;
    var rounds = Number(cfg["Rounds"]) || 1;
    var waves = parseWaves(cfg["Waves JSON"]);
    if (!waves.length) waves = [{ label: "AM", time: "" }];
    var calcutta = coerceBool(cfg["Calcutta Enabled"]);
    var playStyle = String(cfg["Play Style"] || "").toLowerCase();
    var keyLower = String(key || "").toLowerCase();

    // Route by Play Style first; fall back to name-based heuristics for
    // tournaments where Play Style isn't set on the config row.
    var isAdultChild = /adult\/child|adult\s*\+\s*child|adult%20child/i.test(keyLower);
    var isJunior = /junior\s*golf\s*camp/i.test(keyLower);
    var isIndividual = /stroke/i.test(playStyle) && !/scramble/i.test(playStyle);

    var formatHTML;
    if (isJunior) formatHTML = juniorHTML();
    else if (isAdultChild) formatHTML = adultChildHTML(rounds, waves);
    else if (isIndividual) formatHTML = individualHTML(rounds, waves);
    else formatHTML = scrambleHTML(perTeam, rounds, waves, calcutta);

    // Junior camp doesn't need OB / ties — it's not a competition.
    if (isJunior) return formatHTML;
    return formatHTML + courseRulesHTML() + tiesHTML(calcutta);
  }

  window.FH_RULES = { buildTournamentRules: buildTournamentRules };
})();
