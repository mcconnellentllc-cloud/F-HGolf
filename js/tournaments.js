/* F&H tournament metadata + public "% full" bars.
   Runs on any page that has .schedule items (with data-key) and/or a
   tournament <select>. Pulls live counts from /api/tournament-counts.

   cap = max number of SIGN-UP ENTRIES (= teams for team events, = players for
   individual events). Add/adjust as the board confirms each tournament. */
(function () {
  var TMETA = {
    "Par 4 the Future (May 16)": { end: "2026-05-16", cap: 22, unit: "teams", team: 4, format: "4-person scramble", fee: "$400/team", note: "Fleming Class of 2032 · lunch included" },
    "M&M Invitational (May 23)": { end: "2026-05-23", format: "invitational", note: "by invite only — no sign-up needed" },
    "Haxtun Daycare (June 6)": { end: "2026-06-06", cap: 22, unit: "teams", team: 4, format: "4-person scramble", fee: "$400/team", note: "Little Sprouts Learning Center · lunch provided" },
    "John Everitt Memorial (June 13)": { end: "2026-06-13", cap: 22, unit: "teams", team: 4, format: "4-man scramble", note: "8th annual · proceeds fund course improvements" },
    "Couple's Tournament (June 27)": { end: "2026-06-27", cap: 24, unit: "teams", team: 2, roles: ["Your name", "Partner's name"], format: "2-player couples (one entry = a team)" },
    "Red, White & Blue (July 4)": { end: "2026-07-04", cap: 22, unit: "teams", team: 3, format: "3-man scramble", fee: "$225/team ($75/person)", note: "shotgun 9 AM · 3 flights, cash payout" },
    "Adult/Child Tournament (July 12)": { end: "2026-07-12", cap: 22, unit: "teams", team: 2, roles: ["Adult's name", "Child's name"], format: "adult + child team", note: "3 PM start" },
    "Junior Golf Camp (July 15–17)": { end: "2026-07-17", cap: 50, unit: "spots", team: 1, roles: ["Camper's name"], format: "junior camp, ages 6–13", fee: "$70" },
    "2-Lady Scramble (July 23)": { end: "2026-07-23", cap: 22, unit: "teams", team: 2, roles: ["Your name", "Partner's name"], format: "2-lady scramble" },
    "Haxtun Bulldog (July 25)": { end: "2026-07-25", cap: 22, unit: "teams", team: 4, format: "4-man (4 players per team)" },
    "Founder's Tournament (Aug 8–9)": {
      end: "2026-08-09", cap: 64, unit: "teams", team: 2,
      format: "2-day 2-man scramble", note: "2-day tournament · 2 shotgun starts · Calcutta",
      ctaLabel: "Enter the Founders",
      // Single entry point: the Founders recap page is the hub. Its own
      // nav strip fans out to Flights / Calcutta / Leaderboard / Past,
      // so the schedule row only needs one "Open Founders card" button.
      card: { label: "Open Founders card", href: "founders-recap.html" }
    },
    "Couple's Tournament (Aug 22)": {
      end: "2026-08-22", cap: 24, unit: "teams", team: 2,
      roles: ["Your name", "Partner's name"],
      format: "2-player couples (one entry = a team)",
      // Public link row: same fan-out Founders has (Rules / Leaderboard /
      // Recap / History) but pointed at the generic tournament pages that
      // read ?t=<KEY>. Sign Up is rendered separately by signupControl().
      links: [
        { label: "Rules", href: "couples-rules.html" },
        { label: "Live leaderboard", href: "couples-leaderboard-display.html" },
        { label: "Recap", href: "recap.html?t=Couple%27s%20Tournament%20(Aug%2022)" },
        { label: "Past events", href: "history.html?name=Couple%27s%20Tournament" }
      ]
    },
    "Haxtun Fire (Sept 19)": { end: "2026-09-19", cap: 22, unit: "teams", team: 4, format: "4-man scramble" },
    "Cornfest Tournament (Sept 27)": { end: "2026-09-27", cap: 22, unit: "teams", team: 2, format: "2-man (2 players per team)" },
    "Hole 8 Raffle Contest": { team: 1, format: "tee shot into the circle on #8", fee: "$5/person · $20/team", note: "2 entries max · two winners" },

    // ----- Next-year TBD placeholders -----
    // The thank-you email's "Reserve my spot for next year" CTA points at
    // these entries. Keep the KEY stable ("<name> (TBD YYYY)") so signups
    // pile onto one card; when the board picks dates in winter, rename
    // the KEY here + in tournaments.html + migrate the signup rows in
    // Airtable in one pass. Date reads "TBD YYYY" in the schedule row +
    // "Date will be set by the board over winter" on the card itself.
    "Couple's Tournament (TBD 2027)": {
      tbd: true, cap: 24, unit: "teams", team: 2,
      roles: ["Your name", "Partner's name"],
      format: "2-player couples (one entry = a team)",
      note: "Date will be set by the board over winter — reserve your spot now."
    }
  };
  window.FH_TMETA = TMETA; // shared with the sign-up success/payment block

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

  // Single "Open card" primary button. Tournaments that carry their own
   // dedicated page (currently just the Founders -> tournament.html) hand
   // out one link on the schedule row; the destination page itself carries
   // the fan-out nav to Rules / Flights / Calcutta / Recap / Leaderboard.
   // Falls back to the older chip row when a tournament has only `links`.
   function cardButton(m) {
     if (!m || !m.card || !m.card.href) return null;
     var a = document.createElement("a");
     a.className = "btn btn--primary schedule__card";
     a.href = m.card.href;
     if (m.card.newTab === true) { a.target = "_blank"; a.rel = "noopener"; }
     a.innerHTML = (m.card.label || "Open tournament") + ' &rarr;';
     return a;
   }
   function linksNav(m, past) {
     if (!m || !m.links || !m.links.length) return null;
     var nav = document.createElement("nav");
     nav.className = "schedule__links";
     nav.setAttribute("aria-label", "Tournament links");
     nav.innerHTML = m.links.map(function (l) {
       var label = l.label;
       if (past && /^(results|leader)/i.test(label)) label = "Final results";
       return '<a class="schedule__link" href="' + l.href + '"' + (l.newTab === true ? ' target="_blank" rel="noopener"' : '') + '>' + label + ' &rarr;</a>';
     }).join("");
     return nav;
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
      // TBD placeholders — board sets the date in winter, meanwhile the
      // reserve-my-spot link from the thank-you email lands here.
      if (m.tbd) {
        var tbdNote = document.createElement("div");
        tbdNote.className = "schedule__meta schedule__tbd";
        tbdNote.textContent = m.note || "Date will be set by the board over winter — reserve your spot now.";
        li.appendChild(tbdNote);
        li.appendChild(signupControl(li.getAttribute("data-key")));
        return;
      }
      if (past) {
        li.classList.add("is-past");
        var done = document.createElement("span");
        done.className = "schedule__done";
        done.textContent = "Completed";
        li.appendChild(done);
        // Prefer a single "Open card" button when the tournament has its
        // own page; that page carries the recap + everything else. Fall
        // back to the older chip row when only `links` are configured.
        var pastCard = cardButton(m);
        if (pastCard) { li.appendChild(pastCard); }
        else {
          var pastNav = linksNav(m, true);
          if (pastNav) li.appendChild(pastNav);
        }
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
      // Prefer a single "Open card" button when the tournament has its own
      // dedicated page; fall back to the older chip row otherwise.
      var liveCard = cardButton(m);
      if (liveCard) { li.appendChild(liveCard); }
      else {
        var liveNav = linksNav(m, false);
        if (liveNav) li.appendChild(liveNav);
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
    var ctaLabel = m.ctaLabel || "Sign up for this tournament";
    // Public-facing links tied to this tournament (Flights / Calcutta / Results
    // etc.) — rendered as a small chip row when present.
    var navHtml = "";
    var showBigBtn = !(m.links && m.links.length);
    if (m.links && m.links.length) {
      navHtml = '<nav class="nextup__nav" aria-label="Tournament links">'
        + '<a class="nextup__nav-link nextup__nav-link--primary" href="#signup" data-signup="1">Sign up</a>'
        + m.links.map(function (l) {
            // Same-tab by default so the browser back button returns to the
            // tournaments card. Individual links can opt in with newTab: true.
            return '<a class="nextup__nav-link" href="' + l.href + '"' + (l.newTab === true ? ' target="_blank" rel="noopener"' : '') + '>' + l.label + '</a>';
          }).join("")
        + '</nav>';
    }
    card.innerHTML =
      '<span class="nextup__tag">Next Up</span>'
      + '<p class="nextup__date">' + info.date + "</p>"
      + '<h3 class="nextup__title">' + info.name + "</h3>"
      + (detail ? '<p class="nextup__detail">' + detail + "</p>" : "")
      + (m.note ? '<p class="nextup__note">' + m.note + "</p>" : "")
      + bar
      + navHtml
      + (showBigBtn ? '<button type="button" class="btn btn--primary nextup__btn">' + ctaLabel + ' &rarr;</button>' : "");
    sect.hidden = false;

    var btn = card.querySelector(".nextup__btn");
    if (btn) btn.addEventListener("click", function () { goToSignup(key); });
    // The "Sign up" chip inside the nav routes through goToSignup so the form
    // pre-selects this tournament.
    var signChip = card.querySelector('.nextup__nav-link[data-signup="1"]');
    if (signChip) signChip.addEventListener("click", function (e) { e.preventDefault(); goToSignup(key); });
  }

  // One teammate name field (optional). Player 1 is the static "Your name".
  function teammateField(label, idx) {
    var wrap = document.createElement("label");
    wrap.className = "form__field";
    var span = document.createElement("span");
    span.className = "form__label";
    span.textContent = label;
    var input = document.createElement("input");
    input.type = "text"; input.name = "player" + idx; input.maxLength = 120;
    input.autocomplete = "off"; input.className = "tourney-player";
    wrap.appendChild(span); wrap.appendChild(input);
    return wrap;
  }

  // Build the player fields to match the chosen tournament's team size.
  function renderPlayers(sel) {
    var box = document.getElementById("teammates");
    var section = document.getElementById("teamSection");
    var nameLabel = document.getElementById("nameLabel");
    var teamHint = document.getElementById("teamHint");
    if (!box || !section) return;
    box.innerHTML = "";
    var m = TMETA[sel.value];
    var size = (m && m.team) || 1;
    var roles = (m && m.roles) || null;
    if (nameLabel) nameLabel.innerHTML = ((roles && roles[0]) ? roles[0] : "Your name") + ' <span class="req">*</span>';
    if (size > 1) {
      for (var i = 2; i <= size; i++) {
        var lbl = (roles && roles[i - 1]) ? roles[i - 1] : (size === 2 ? "Partner's name" : "Player " + i + "'s name");
        box.appendChild(teammateField(lbl, i));
      }
      section.hidden = false;
      if (teamHint) teamHint.textContent = "This is a " + size + "-player team. Add your teammates' names if you have them — only your own name is required.";
    } else {
      section.hidden = true;
    }
  }

  function onTournamentChange(sel) {
    var hint = document.getElementById("tourneyFormat");
    var m = TMETA[sel.value];
    if (hint) {
      if (m) {
        var ml = metaLine(m);
        var full = (ml ? "Format: " + ml : "") + (m.note ? (ml ? " — " : "") + m.note : "");
        if (full) { hint.hidden = false; hint.textContent = full; } else { hint.hidden = true; }
      } else { hint.hidden = true; }
    }
    renderPlayers(sel);
  }

  function init() {
    var hasSchedule = document.querySelector(".schedule li[data-key]");
    var sel = document.querySelector('select[name="tournament"]');
    var hasNext = document.getElementById("nextUpCard");
    if (!hasSchedule && !sel && !hasNext) return;

    if (hasSchedule || hasNext) {
      // Fetch live counts + Format-tab configs in parallel. Configs let
      // us override the hardcoded caps in TMETA with whatever the
      // operator set on the Format tab (e.g. Aug 22 Couples: Team Cap
      // moved 24 → 18). The public site was rendering stale caps
      // because it only knew the seed values.
      Promise.all([
        fetch(FH_API.url("/api/tournament-counts")).then(function (r) { return r.json(); }).catch(function () { return { counts: {} }; }),
        fetch(FH_API.url("/api/tournament-signups?config=1")).then(function (r) { return r.json(); }).catch(function () { return { records: [] }; }),
      ]).then(function (results) {
        var countsRes = results[0] || {};
        var cfgRes = results[1] || {};
        var configs = (cfgRes && cfgRes.records) || [];
        configs.forEach(function (rec) {
          var f = (rec && rec.fields) || {};
          var key = String(f.Tournament || "").trim();
          if (!key || !TMETA[key]) return;
          var m = TMETA[key];
          var cap = Number(f["Team Cap"]);
          if (isFinite(cap) && cap > 0) m.cap = cap;
          if (typeof f["Play Style"] === "string" && f["Play Style"].trim()) m.format = f["Play Style"].trim();
          var ppt = Number(f["Players Per Team"]);
          if (isFinite(ppt) && ppt > 0) m.team = ppt;
        });
        render(countsRes.counts);
        renderNext(countsRes.counts);
      });
    }

    if (sel) {
      // Drop tournaments that are already over so they can't be signed up for.
      Array.prototype.slice.call(sel.options).forEach(function (opt) {
        if (!opt.value) return; // keep the "— choose —" placeholder
        if (isPast(TMETA[opt.value])) opt.remove();
      });
      sel.addEventListener("change", function () { onTournamentChange(sel); });

      // "Looking for a partner" disables the teammate fields (you don't have them yet).
      var lfp = document.getElementById("lfp");
      if (lfp) lfp.addEventListener("change", function () {
        var on = lfp.checked, box = document.getElementById("teammates");
        Array.prototype.forEach.call(document.querySelectorAll("#teammates .tourney-player"), function (inp) {
          inp.disabled = on; if (on) inp.value = "";
        });
        if (box) box.classList.toggle("is-disabled", on);
      });

      // Pre-select from ?t=… (used by Sign Up links coming from the homepage).
      // Also handles the "Reserve my spot for next year" link inside older
      // thank-you emails — those emails were sent with ?t=<this-year KEY>,
      // which is already past by the time someone clicks. When the target
      // KEY is past, look for a matching TBD placeholder ("<name> (TBD YYYY)")
      // for the same tournament base name and pre-select that instead, plus
      // surface a small "reserving for next year" note on the form.
      try {
        var params = new URLSearchParams(window.location.search);
        var t = params.get("t");
        if (t) {
          var rerouted = false;
          if (TMETA[t] && isPast(TMETA[t])) {
            var base = t.replace(/\s*\([^)]*\)\s*$/, "").trim();
            var tbdKey = null;
            Object.keys(TMETA).forEach(function (k) {
              if (tbdKey) return;
              var mm = TMETA[k];
              if (mm && mm.tbd && k.indexOf(base + " (TBD") === 0) tbdKey = k;
            });
            if (tbdKey) { t = tbdKey; rerouted = true; }
          }
          if (TMETA[t] && !isPast(TMETA[t])) sel.value = t;
          if (rerouted) {
            var note = document.getElementById("tourneyPrefill");
            if (note) {
              var info = splitKey(t);
              note.hidden = false;
              note.textContent = "Reserving your spot for the " + info.name + " — the board sets the date over winter. We'll follow up once it's picked.";
            }
          }
        }
      } catch (e) {}

      onTournamentChange(sel); // initialize hint + player fields for the current selection
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
