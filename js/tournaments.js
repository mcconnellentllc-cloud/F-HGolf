/* F&H tournament metadata + public "% full" bars.
   Runs on any page that has .schedule items (with data-key) and/or a
   tournament <select>. Pulls live counts from /api/tournament-counts.

   cap = max number of SIGN-UP ENTRIES (= teams for team events, = players for
   individual events). Add/adjust as the board confirms each tournament. */
(function () {
  var TMETA = {
    "Par 4 the Future (May 16)": { cap: 22, unit: "teams", format: "4-person scramble", fee: "$400/team", note: "Fleming Class of 2032 · lunch included" },
    "M&M Invitational (May 23)": { format: "invitational", note: "by invite only — no sign-up needed" },
    "Haxtun Daycare (June 6)": { cap: 22, unit: "teams", format: "4-person scramble", fee: "$400/team", note: "Little Sprouts Learning Center · lunch provided" },
    "John Everitt Memorial (June 13)": { cap: 22, unit: "teams", format: "4-man scramble", note: "8th annual · proceeds fund course improvements" },
    "Couple's Tournament (June 27)": { cap: 24, unit: "teams", format: "2-player couples (one entry = a team)" },
    "Red, White & Blue (July 4)": { cap: 22, unit: "teams", format: "3-man scramble", fee: "$225/team ($75/person)", note: "shotgun 9 AM · 3 flights, cash payout" },
    "Adult/Child Tournament (July 12)": { cap: 22, unit: "teams", format: "adult + child team", note: "3 PM start" },
    "Junior Golf Camp (July 15–17)": { cap: 50, unit: "spots", format: "junior camp, ages 6–13", fee: "$70" },
    "2-Lady Scramble (July 23)": { cap: 22, unit: "teams", format: "2-lady scramble" },
    "Haxtun Bulldog (July 25)": { cap: 22, unit: "teams", format: "4-man (4 players per team)" },
    "Founder's Tournament (Aug 8–9)": { cap: 48, unit: "teams", note: "2-day tournament · 2 shotgun starts · Calcutta" },
    "Couple's Tournament (Aug 22)": { cap: 24, unit: "teams", format: "2-player couples (one entry = a team)" },
    "Haxtun Fire (Sept 19)": { cap: 22, unit: "teams", format: "4-man scramble" },
    "Cornfest Tournament (Sept 27)": { cap: 22, unit: "teams", format: "2-man (2 players per team)" },
    "Hole 8 Raffle Contest": { format: "tee shot into the circle on #8", fee: "$5/person · $20/team", note: "2 entries max · two winners" }
  };

  function metaLine(m) {
    var parts = [];
    if (m.format) parts.push(m.format);
    if (m.fee) parts.push(m.fee);
    if (m.cap) parts.push(m.cap + " " + (m.unit || "spots") + " max");
    return parts.join(" · ");
  }

  function render(counts) {
    counts = counts || {};
    var items = document.querySelectorAll(".schedule li[data-key]");
    Array.prototype.forEach.call(items, function (li) {
      if (li.getAttribute("data-enhanced")) return;
      var m = TMETA[li.getAttribute("data-key")];
      if (!m) return;
      li.setAttribute("data-enhanced", "1");
      var ml = metaLine(m);
      if (ml) { var d = document.createElement("div"); d.className = "schedule__meta"; d.textContent = ml; li.appendChild(d); }
      if (m.cap) {
        var n = counts[li.getAttribute("data-key")] || 0;
        var pct = Math.min(100, Math.round((n / m.cap) * 100));
        var full = n >= m.cap;
        var bar = document.createElement("div");
        bar.className = "schedule__full" + (full ? " is-full" : "");
        bar.innerHTML = '<div class="schedule__track"><div class="schedule__fill" style="width:' + pct + '%"></div></div>'
          + '<span class="schedule__pct">' + (full ? "Full" : (n + " of " + m.cap + " " + (m.unit || "spots") + " · " + pct + "% full")) + "</span>";
        li.appendChild(bar);
      }
    });
  }

  function init() {
    var hasSchedule = document.querySelector(".schedule li[data-key]");
    var sel = document.querySelector('select[name="tournament"]');
    if (!hasSchedule && !sel) return;

    if (hasSchedule) {
      fetch("/api/tournament-counts").then(function (r) { return r.json(); })
        .then(function (res) { render(res && res.counts); })
        .catch(function () { render({}); });
    }

    var hint = document.getElementById("tourneyFormat");
    if (sel && hint) {
      sel.addEventListener("change", function () {
        var m = TMETA[sel.value];
        if (m) {
          var ml = metaLine(m);
          var full = (ml ? "Format: " + ml : "") + (m.note ? (ml ? " — " : "") + m.note : "");
          if (full) { hint.hidden = false; hint.textContent = full; } else { hint.hidden = true; }
        } else { hint.hidden = true; }
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
