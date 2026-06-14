/* F&H tournament metadata + public "% full" bars.
   Runs on any page that has .schedule items (with data-key) and/or a
   tournament <select>. Pulls live counts from /api/tournament-counts.

   cap = max number of SIGN-UP ENTRIES (= teams for team events, = players for
   individual events). Add/adjust as the board confirms each tournament. */
(function () {
  var TMETA = {
    "Par 4 the Future (May 16)": { end: "2026-05-16", cap: 22, unit: "teams", format: "4-person scramble", fee: "$400/team", note: "Fleming Class of 2032 · lunch included" },
    "M&M Invitational (May 23)": { end: "2026-05-23", format: "invitational", note: "by invite only — no sign-up needed" },
    "Haxtun Daycare (June 6)": { end: "2026-06-06", cap: 22, unit: "teams", format: "4-person scramble", fee: "$400/team", note: "Little Sprouts Learning Center · lunch provided" },
    "John Everitt Memorial (June 13)": { end: "2026-06-13", cap: 22, unit: "teams", format: "4-man scramble", note: "8th annual · proceeds fund course improvements" },
    "Couple's Tournament (June 27)": { end: "2026-06-27", cap: 24, unit: "teams", format: "2-player couples (one entry = a team)" },
    "Red, White & Blue (July 4)": { end: "2026-07-04", cap: 22, unit: "teams", format: "3-man scramble", fee: "$225/team ($75/person)", note: "shotgun 9 AM · 3 flights, cash payout" },
    "Adult/Child Tournament (July 12)": { end: "2026-07-12", cap: 22, unit: "teams", format: "adult + child team", note: "3 PM start" },
    "Junior Golf Camp (July 15–17)": { end: "2026-07-17", cap: 50, unit: "spots", format: "junior camp, ages 6–13", fee: "$70" },
    "2-Lady Scramble (July 23)": { end: "2026-07-23", cap: 22, unit: "teams", format: "2-lady scramble" },
    "Haxtun Bulldog (July 25)": { end: "2026-07-25", cap: 22, unit: "teams", format: "4-man (4 players per team)" },
    "Founder's Tournament (Aug 8–9)": { end: "2026-08-09", cap: 48, unit: "teams", note: "2-day tournament · 2 shotgun starts · Calcutta" },
    "Couple's Tournament (Aug 22)": { end: "2026-08-22", cap: 24, unit: "teams", format: "2-player couples (one entry = a team)" },
    "Haxtun Fire (Sept 19)": { end: "2026-09-19", cap: 22, unit: "teams", format: "4-man scramble" },
    "Cornfest Tournament (Sept 27)": { end: "2026-09-27", cap: 22, unit: "teams", format: "2-man (2 players per team)" },
    "Hole 8 Raffle Contest": { format: "tee shot into the circle on #8", fee: "$5/person · $20/team", note: "2 entries max · two winners" }
  };

  // An event is "past" the day after its end date (so the bar stays live all
  // day on the day of the event, then disappears).
  function isPast(m) {
    if (!m || !m.end) return false;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var end = new Date(m.end + "T00:00:00");
    return end < today;
  }

  function metaLine(m) {
    var parts = [];
    if (m.format) parts.push(m.format);
    if (m.fee) parts.push(m.fee);
    if (m.cap) parts.push(m.cap + " " + (m.unit || "spots") + " max");
    return parts.join(" · ");
  }

  // Pre-select a tournament in the sign-up form and scroll to it. On pages
  // without the form (e.g. the homepage), callers link to tournaments.html?t=…
  function goToSignup(key) {
    var sel = document.querySelector('select[name="tournament"]');
    if (sel) { sel.value = key; sel.dispatchEvent(new Event("change")); }
    var s = document.getElementById("signup");
    if (s) s.scrollIntoView({ behavior: "smooth", block: "start" });
    var nameField = document.querySelector('#tourneyForm [name="name"]');
    if (nameField) setTimeout(function () { nameField.focus(); }, 450);
  }

  // A "Sign Up" control for a schedule row: an in-page button when the form is
  // present, otherwise a link to the tournaments page pre-selecting the event.
  function signupControl(key) {
    var act;
    if (document.querySelector('select[name="tournament"]')) {
      act = document.createElement("button");
      act.type = "button";
      act.addEventListener("click", function () { goToSignup(key); });
    } else {
      act = document.createElement("a");
      act.href = "tournaments.html?t=" + encodeURIComponent(key) + "#signup";
    }
    act.className = "btn btn--solid schedule__signup";
    act.textContent = "Sign Up";
    return act;
  }

  function render(counts) {
    counts = counts || {};
    var items = document.querySelectorAll(".schedule li[data-key]");
    Array.prototype.forEach.call(items, function (li) {
      if (li.getAttribute("data-enhanced")) return;
      var m = TMETA[li.getAttribute("data-key")];
      if (!m) return;
      li.setAttribute("data-enhanced", "1");
      var past = isPast(m);
      var ml = metaLine(m);
      if (ml) { var d = document.createElement("div"); d.className = "schedule__meta"; d.textContent = ml; li.appendChild(d); }
      if (past) {
        li.classList.add("is-past");
        var done = document.createElement("span");
        done.className = "schedule__done";
        done.textContent = "Completed";
        li.appendChild(done);
        return; // no "% full" bar for events that are over
      }
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
      // Sign-up button for every remaining, sign-up-able event (skip invitationals).
      if (m.format !== "invitational") {
        li.appendChild(signupControl(li.getAttribute("data-key")));
      }
    });
  }

  // The next upcoming sign-up event (chronological by end date; TMETA is
  // declared in date order). Skips events with no cap (e.g. invitational/raffle).
  function nextKey() {
    var keys = Object.keys(TMETA);
    for (var i = 0; i < keys.length; i++) {
      var m = TMETA[keys[i]];
      if (m.end && m.cap && !isPast(m)) return keys[i];
    }
    return null;
  }

  // Pull the display name + date out of a key like "Couple's Tournament (June 27)".
  function splitKey(key) {
    var mm = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(key);
    return mm ? { name: mm[1], date: mm[2] } : { name: key, date: "" };
  }

  function renderNext(counts) {
    counts = counts || {};
    var card = document.getElementById("nextUpCard");
    var sect = document.getElementById("nextup");
    if (!card || !sect) return;
    var key = nextKey();
    if (!key) { sect.hidden = true; return; }
    var m = TMETA[key], info = splitKey(key);

    var bar = "";
    var n = counts[key] || 0;
    var pct = Math.min(100, Math.round((n / m.cap) * 100));
    var full = n >= m.cap;
    bar = '<div class="schedule__full' + (full ? " is-full" : "") + '">'
      + '<div class="schedule__track"><div class="schedule__fill" style="width:' + pct + '%"></div></div>'
      + '<span class="schedule__pct">' + (full ? "Full" : (n + " of " + m.cap + " " + (m.unit || "spots") + " · " + pct + "% full")) + "</span></div>";

    var detail = metaLine(m);
    card.innerHTML =
      '<span class="nextup__tag">Next Up</span>'
      + '<p class="nextup__date">' + info.date + "</p>"
      + '<h3 class="nextup__title">' + info.name + "</h3>"
      + (detail ? '<p class="nextup__detail">' + detail + "</p>" : "")
      + (m.note ? '<p class="nextup__note">' + m.note + "</p>" : "")
      + bar
      + '<button type="button" class="btn btn--primary nextup__btn">Sign up for this tournament &rarr;</button>';
    sect.hidden = false;

    var btn = card.querySelector(".nextup__btn");
    if (btn) btn.addEventListener("click", function () { goToSignup(key); });
  }

  function init() {
    var hasSchedule = document.querySelector(".schedule li[data-key]");
    var sel = document.querySelector('select[name="tournament"]');
    var hasNext = document.getElementById("nextUpCard");
    if (!hasSchedule && !sel && !hasNext) return;

    if (hasSchedule || hasNext) {
      fetch(FH_API.url("/api/tournament-counts")).then(function (r) { return r.json(); })
        .then(function (res) { render(res && res.counts); renderNext(res && res.counts); })
        .catch(function () { render({}); renderNext({}); });
    }

    var hint = document.getElementById("tourneyFormat");
    if (sel) {
      // Drop tournaments that are already over so they can't be signed up for.
      Array.prototype.slice.call(sel.options).forEach(function (opt) {
        if (!opt.value) return; // keep the "— choose —" placeholder
        if (isPast(TMETA[opt.value])) opt.remove();
      });
      // Pre-select from ?t=… (used by Sign Up links coming from the homepage).
      try {
        var t = new URLSearchParams(window.location.search).get("t");
        if (t && TMETA[t] && !isPast(TMETA[t])) { sel.value = t; sel.dispatchEvent(new Event("change")); }
      } catch (e) {}
    }
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
