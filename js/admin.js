    (function () {
      var FLAG = "fh_admin_ok";
      var KEYK = "fh_admin_key";
      var PASS = "fandhgolf!!";
      var gate = document.getElementById("adminGate");
      var panel = document.getElementById("adminPanel");
      var form = document.getElementById("adminLogin");
      var input = document.getElementById("adminPass");
      var err = document.getElementById("adminErr");
      var logout = document.getElementById("adminLogout");
      var list = document.getElementById("nomList");
      var countEl = document.getElementById("nomCount");
      var refresh = document.getElementById("nomRefresh");
      var touList = document.getElementById("touList");
      var touCount = document.getElementById("touCount");
      var touRefresh = document.getElementById("touRefresh");

      // Persist the admin session in localStorage so it survives browser
      // restarts, service-worker cache bumps, and closing the tab. Old
      // sessionStorage-only sessions get migrated on first read so nobody
      // has to re-enter the passphrase after this ships.
      function _readAuth(k) {
        try {
          var v = localStorage.getItem(k);
          if (v) return v;
          var s = sessionStorage.getItem(k);
          if (s) { try { localStorage.setItem(k, s); } catch (e) {} return s; }
        } catch (e) {}
        return "";
      }
      function _writeAuth(k, v) {
        try { localStorage.setItem(k, v); } catch (e) {}
        try { sessionStorage.setItem(k, v); } catch (e) {}
      }
      function _clearAuth() {
        try { localStorage.removeItem(FLAG); localStorage.removeItem(KEYK); } catch (e) {}
        try { sessionStorage.removeItem(FLAG); sessionStorage.removeItem(KEYK); } catch (e) {}
      }
      function getKey() { return _readAuth(KEYK); }
      function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
      function fmtDate(iso) { try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch (e) { return ""; } }

      function render(records) {
        if (!records || !records.length) { list.innerHTML = '<p class="noms__msg">No nominations yet.</p>'; countEl.textContent = ""; return; }
        countEl.textContent = "(" + records.length + ")";
        list.innerHTML = records.map(function (rec) {
          var f = rec.fields || {};
          var name = esc(f["Nominee Name"] || "(no name)");
          var role = esc(f["Role"] || "");
          var status = esc(f["Status"] || "New");
          var era = esc(f["Era / Years at F&H"] || "");
          var why = esc(f["Contribution"] || "");
          var by = esc(f["Nominated By"] || "");
          var email = esc(f["Submitter Email"] || "");
          var phone = esc(f["Submitter Phone"] || "");
          var when = fmtDate(rec.created);
          var meta = [role, era].filter(Boolean).join(" · ");
          var line = [];
          if (by) line.push("Nominated by " + by);
          if (email) line.push('<a href="mailto:' + email + '">' + email + "</a>");
          if (phone) line.push('<a href="tel:' + phone.replace(/[^0-9+]/g, "") + '">' + phone + "</a>");
          if (when) line.push(when);
          var cls = status.toLowerCase().replace(/[^a-z]/g, "");
          return '<article class="nom">'
            + '<div class="nom__head"><span class="nom__name">' + name + "</span>"
            + '<span class="nom__status nom__status--' + cls + '">' + status + "</span></div>"
            + (meta ? '<div class="nom__meta">' + meta + "</div>" : "")
            + (why ? '<p class="nom__why">' + why + "</p>" : "")
            + (line.length ? '<div class="nom__by">' + line.join(" · ") + "</div>" : "")
            + "</article>";
        }).join("");
      }

      function loadNominations() {
        if (!list) return;
        list.innerHTML = '<p class="noms__msg">Loading nominations…</p>';
        fetch(FH_API.url("/api/nominations"), { headers: { "x-admin-key": getKey() } })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; }); })
          .then(function (res) {
            if (res.j && res.j.ok) { render(res.j.records); }
            else if (res.status === 401) { list.innerHTML = '<p class="noms__msg">Session expired — click <strong>Lock</strong> and sign in again.</p>'; }
            else { list.innerHTML = '<p class="noms__msg">' + esc((res.j && res.j.error) || "Couldn't load nominations.") + "</p>"; }
          })
          .catch(function () { list.innerHTML = '<p class="noms__msg">Network error loading nominations.</p>'; });
      }

      function renderTournaments(records) {
        if (!touList) return;
        if (!records || !records.length) { touList.innerHTML = '<p class="noms__msg">No sign-ups yet.</p>'; if (touCount) touCount.textContent = ""; return; }
        touCount.textContent = "(" + records.length + ")";
        var groups = {};
        records.forEach(function (rec) {
          var t = (rec.fields && rec.fields["Tournament"]) || "Other";
          (groups[t] = groups[t] || []).push(rec);
        });
        touList.innerHTML = Object.keys(groups).sort().map(function (t) {
          var recs = groups[t];
          var emails = recs.map(function (r) { return (r.fields && r.fields["Email"]) || ""; }).filter(Boolean).join(",");
          var carts = recs.reduce(function (s, r) { return s + (parseInt(r.fields && r.fields["Carts"], 10) || 0); }, 0);
          var rows = recs.map(function (rec) {
            var f = rec.fields || {};
            var name = esc(f["Player Name"] || "(no name)");
            var team = esc(f["Team / Partners"] || "");
            var notes = esc(f["Notes"] || "");
            var email = esc(f["Email"] || "");
            var phone = esc(f["Phone"] || "");
            var c = (f["Carts"] !== undefined && f["Carts"] !== "") ? esc(f["Carts"]) : "";
            var status = esc(f["Status"] || "New");
            var when = fmtDate(rec.created);
            var line = [];
            if (team) line.push("Team: " + team);
            if (c !== "") line.push(c + " cart(s)");
            if (email) line.push('<a href="mailto:' + email + '">' + email + "</a>");
            if (phone) line.push('<a href="tel:' + phone.replace(/[^0-9+]/g, "") + '">' + phone + "</a>");
            if (when) line.push(when);
            var cls = status.toLowerCase().replace(/[^a-z]/g, "");
            return '<article class="nom">'
              + '<div class="nom__head"><span class="nom__name">' + name + "</span>"
              + '<span class="nom__status nom__status--' + cls + '">' + status + "</span></div>"
              + (notes ? '<p class="nom__why">' + notes + "</p>" : "")
              + (line.length ? '<div class="nom__by">' + line.join(" · ") + "</div>" : "")
              + "</article>";
          }).join("");
          var actions = '<button type="button" class="btn btn--solid tgroup__calc" data-players="' + recs.length + '">&rarr; Calculator</button>'
            + (emails ? ' <a class="btn btn--solid" href="mailto:?bcc=' + encodeURIComponent(emails) + "&subject=" + encodeURIComponent("F&H — " + t) + '">Email all</a>' : "");
          return '<div class="tgroup">'
            + '<div class="tgroup__head"><h4 class="tgroup__name">' + esc(t) + ' <span class="tgroup__count">' + recs.length + " signed up" + (carts ? " · " + carts + " carts" : "") + "</span></h4>"
            + '<div class="tgroup__actions">' + actions + "</div></div>"
            + rows + "</div>";
        }).join("");
        Array.prototype.forEach.call(touList.querySelectorAll(".tgroup__calc"), function (b) {
          b.addEventListener("click", function () { setCalcPlayers(parseInt(b.getAttribute("data-players"), 10) || 0); });
        });
      }

      // ---- Tournament finance calculator (self-contained, no backend) ----
      function money(n) { n = isFinite(n) ? n : 0; return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
      function calcId(id) { return document.getElementById(id); }
      function setCalcPlayers(n) {
        var p = calcId("cPlayers");
        if (p) { p.value = n; recalc(); var panel = calcId("financePanel"); if (panel) panel.scrollIntoView({ behavior: "smooth", block: "center" }); }
      }
      function recalc() {
        var num = function (id) { var el = calcId(id); return el ? (parseFloat(el.value) || 0) : 0; };
        var players = num("cPlayers"), entry = num("cEntry"), course = num("cCourse"), meal = num("cMeal");
        var flights = Math.max(1, num("cFlights"));
        var totalEntry = players * entry;
        var toCourse = players * course;
        var mealCheck = players * meal;
        var prize = totalEntry - toCourse - mealCheck;
        var perFlight = prize / flights;
        var set = function (id, v) { var el = calcId(id); if (el) el.textContent = v; };
        set("oEntry", money(totalEntry));
        set("oCourse", money(toCourse));
        set("oMeal", money(mealCheck));
        set("oPrize", money(prize));
        set("oPerFlight", money(perFlight));
      }
      (function initCalc() {
        ["cPlayers", "cEntry", "cCourse", "cMeal", "cFlights"].forEach(function (id) {
          var el = calcId(id); if (el) el.addEventListener("input", recalc);
        });
        recalc();
      })();

      // Latest signup records — snapshotted from loadTournaments so the
      // Send-invites modal can rebuild its current-signups recipient list
      // without a second network round-trip.
      var _touRecords = [];
      function loadTournaments() {
        // Two consumers share the same fetch: the Sign-ups page's
        // #touList and the Tournaments page's #tmYears (via
        // buildManager). Only one of those DOM roots exists on any
        // given page after the cards-only refactor, so we run the
        // fetch whenever EITHER is present and guard each write.
        var tmYearsEl = document.getElementById("tmYears");
        if (!touList && !tmYearsEl) return;
        if (touList) touList.innerHTML = '<p class="noms__msg">Loading sign-ups…</p>';
        fetch(FH_API.url("/api/tournament-signups"), { headers: { "x-admin-key": getKey() } })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; }); })
          .then(function (res) {
            if (res.j && res.j.ok) {
              _touRecords = res.j.records || [];
              if (touList) renderTournaments(res.j.records);
              buildManager(res.j.records);
            } else if (res.status === 401) {
              if (touList) touList.innerHTML = '<p class="noms__msg">Session expired — click <strong>Lock</strong> and sign in again.</p>';
              buildManager([]);
            } else {
              if (touList) touList.innerHTML = '<p class="noms__msg">' + esc((res.j && res.j.error) || "Couldn't load sign-ups.") + "</p>";
              buildManager([]);
            }
          })
          .catch(function () {
            if (touList) touList.innerHTML = '<p class="noms__msg">Network error loading sign-ups.</p>';
            buildManager([]);
          });
      }

      // ---- Site activity stats -----------------------------------------
      // Small dashboard card showing Rounds / Payments / Members / Signups
      // aggregates. Hits POST /api/player-card { action: "stats" } behind
      // the admin key so it can piggyback on that endpoint's Airtable
      // credentials without adding a new serverless function (Vercel
      // Hobby caps us at 12).
      function loadSiteStats() {
        var grid = document.getElementById("statsGrid");
        if (!grid) return;
        grid.innerHTML = '<p class="noms__msg">Loading site activity…</p>';
        fetch(FH_API.url("/api/player-card"), {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-admin-key": getKey() },
          body: JSON.stringify({ action: "stats" })
        })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (j) {
            if (!j || !j.ok) {
              grid.innerHTML = '<p class="noms__msg">' + esc((j && j.error) || "Couldn't load site activity.") + '</p>';
              return;
            }
            grid.innerHTML = renderStats(j);
          })
          .catch(function () { grid.innerHTML = '<p class="noms__msg">Network error loading site activity.</p>'; });
      }
      function renderStats(s) {
        var r = s.rounds || {};
        var p = s.payments || {};
        var pl = s.players || {};
        var su = s.signups || {};
        // subHtml is inserted verbatim, so callers own the escaping.
        function tile(titleText, bigNum, subHtml) {
          return '<div class="stat-tile">'
            + '<div class="stat-tile__t">' + esc(titleText) + '</div>'
            + '<div class="stat-tile__n">' + esc(String(bigNum)) + '</div>'
            + (subHtml ? '<div class="stat-tile__s">' + subHtml + '</div>' : '')
            + '</div>';
        }
        var latestSub = r.latest && r.latest.date
          ? 'Most recent: <b>' + esc(r.latest.date) + '</b>' + (r.latest.name ? ' &middot; ' + esc(r.latest.name) : '')
          : 'No rounds yet';
        var dollars = "$" + (Number(p.dollarsTotal) || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        return ''
          + tile("Rounds logged", r.total || 0, (r.thisWeek || 0) + " this week &middot; " + (r.thisMonth || 0) + " this month")
          + tile("Players who logged a round", r.distinctPlayers || 0, latestSub)
          + tile("Payments logged", p.total || 0, (p.thisMonth || 0) + " this month &middot; " + esc(dollars) + " total")
          + tile("Player Cards", pl.total || 0, (p.distinctPlayers || 0) + " have made a payment")
          + tile("Tournament sign-ups", su.field || 0, (su.alternate || 0) + " on alternate list");
      }

      // ---- Search People (portal quick-find) ---------------------------
      // Loads the full Players table once (same source as admin-people.html)
      // and does client-side prefix / substring matching on Name, Phone, and
      // Email so keystrokes feel instant. Selecting a result reveals a
      // small detail block with contact info + a link to the full People
      // page for edits.
      var _spAll = [];
      var _spLoaded = false;
      var _spSelectedId = "";
      function _spNormPhone(s) { return String(s || "").replace(/\D+/g, ""); }
      function loadSearchPeople() {
        var hint = document.getElementById("spHint");
        var input = document.getElementById("spInput");
        if (!input) return; // page has no Players Admin UI
        if (_spLoaded) return;
        if (hint) hint.textContent = "Loading people…";
        fetch(FH_API.url("/api/players"), { headers: { "x-admin-key": getKey() } })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (j) {
            if (!j || !j.ok) {
              if (hint) hint.textContent = (j && j.error) || "Couldn't load people.";
              return;
            }
            _spAll = (j.records || []).map(function (r) {
              var f = r.fields || {};
              return {
                id: r.id,
                name: String(f.Name || ""),
                phone: String(f.Phone || ""),
                phoneDigits: _spNormPhone(f.Phone),
                email: String(f.Email || ""),
                city: String(f.City || ""),
                state: String(f.State || ""),
                street: String(f.Street || ""),
                zip: String(f.Zip || ""),
                member: !!f.Member,
                notes: String(f.Notes || ""),
                _hay: (String(f.Name || "") + " " + String(f.Phone || "") + " " + String(f.Email || "") + " " + String(f.City || "") + " " + String(f.State || "")).toLowerCase()
              };
            });
            _spLoaded = true;
            var spCount = document.getElementById("spCount");
            if (spCount) spCount.textContent = _spAll.length ? "(" + _spAll.length + ")" : "";
            if (hint) hint.textContent = _spAll.length ? "Ready — type to search " + _spAll.length + " people." : "No people yet.";
            if (input) input.disabled = false;
          })
          .catch(function () {
            if (hint) hint.textContent = "Network error loading people.";
          });
      }
      function spRenderResults(query) {
        var host = document.getElementById("spResults");
        var hint = document.getElementById("spHint");
        if (!host) return;
        var q = String(query || "").trim().toLowerCase();
        var qDigits = _spNormPhone(query);
        if (!q) { host.hidden = true; host.innerHTML = ""; if (hint) hint.textContent = _spLoaded ? ("Ready — type to search " + _spAll.length + " people.") : "Loading people…"; return; }
        var matches = _spAll.filter(function (p) {
          if (p._hay.indexOf(q) !== -1) return true;
          if (qDigits && p.phoneDigits && p.phoneDigits.indexOf(qDigits) !== -1) return true;
          return false;
        });
        // Sort: exact-name-prefix first, then any-name-prefix, then substring.
        matches.sort(function (a, b) {
          var an = a.name.toLowerCase(), bn = b.name.toLowerCase();
          var ap = an.indexOf(q) === 0 ? 0 : 1;
          var bp = bn.indexOf(q) === 0 ? 0 : 1;
          if (ap !== bp) return ap - bp;
          if (an !== bn) return an < bn ? -1 : 1;
          return 0;
        });
        var shown = matches.slice(0, 20);
        if (!shown.length) {
          host.innerHTML = '<div class="sp-result sp-result--empty">No matches.</div>';
          host.hidden = false;
          if (hint) hint.textContent = "0 matches.";
          return;
        }
        host.innerHTML = shown.map(function (p) {
          var sub = [p.phone, p.email, [p.city, p.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
          return '<button type="button" class="sp-result" role="option" data-id="' + esc(p.id) + '">'
            + '<span class="sp-result__name">' + esc(p.name || "(no name)") + (p.member ? ' <span class="sp-badge">member</span>' : "") + '</span>'
            + (sub ? '<span class="sp-result__sub">' + esc(sub) + '</span>' : '')
            + '</button>';
        }).join("");
        host.hidden = false;
        if (hint) hint.textContent = "Showing " + shown.length + (matches.length > shown.length ? " of " + matches.length : "") + " match" + (matches.length === 1 ? "" : "es") + ".";
      }
      function spRenderView(p) {
        var addr = [p.street, [p.city, p.state].filter(Boolean).join(", "), p.zip].filter(Boolean).join(" · ");
        return ''
          + '<div class="sp-detail__head">'
          +   '<h4 class="sp-detail__name">' + esc(p.name || "(no name)") + (p.member ? ' <span class="sp-badge">member</span>' : "") + '</h4>'
          +   '<button type="button" class="btn btn--solid sp-detail__close" data-sp-close>Close</button>'
          + '</div>'
          + '<dl class="sp-detail__grid">'
          +   (p.phone ? '<dt>Phone</dt><dd><a href="tel:' + esc(p.phone) + '">' + esc(p.phone) + '</a></dd>' : '<dt>Phone</dt><dd class="sp-detail__blank">—</dd>')
          +   (p.email ? '<dt>Email</dt><dd><a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a></dd>' : '<dt>Email</dt><dd class="sp-detail__blank">—</dd>')
          +   (addr ? '<dt>Address</dt><dd>' + esc(addr) + '</dd>' : '')
          +   (p.notes ? '<dt>Notes</dt><dd>' + esc(p.notes) + '</dd>' : '')
          + '</dl>'
          + '<div class="sp-detail__actions">'
          +   '<button type="button" class="btn btn--primary" data-sp-edit>Edit</button>'
          +   '<button type="button" class="btn sp-btn-danger" data-sp-delete>Delete</button>'
          + '</div>'
          + '<p class="sp-detail__status" data-sp-status></p>';
      }
      function spRenderEdit(p) {
        function row(label, name, val, type) {
          type = type || "text";
          return '<label class="sp-edit__row"><span>' + esc(label) + '</span>'
            + '<input type="' + type + '" name="' + esc(name) + '" value="' + esc(val || "") + '" /></label>';
        }
        return ''
          + '<div class="sp-detail__head">'
          +   '<h4 class="sp-detail__name">Edit &mdash; ' + esc(p.name || "(no name)") + '</h4>'
          +   '<button type="button" class="btn btn--solid sp-detail__close" data-sp-cancel>Cancel</button>'
          + '</div>'
          + '<form class="sp-edit" onsubmit="return false;">'
          +   '<div class="sp-edit__grid">'
          +     row("Name", "name", p.name)
          +     row("Phone", "phone", p.phone, "tel")
          +     row("Email", "email", p.email, "email")
          +     row("Street", "street", p.street)
          +     row("City", "city", p.city)
          +     row("State", "state", p.state)
          +     row("Zip", "zip", p.zip)
          +     '<label class="sp-edit__row sp-edit__row--chk"><input type="checkbox" name="member"' + (p.member ? " checked" : "") + ' /><span>Member</span></label>'
          +   '</div>'
          +   '<label class="sp-edit__row sp-edit__row--full"><span>Notes</span><textarea name="notes" rows="3">' + esc(p.notes || "") + '</textarea></label>'
          +   '<div class="sp-detail__actions">'
          +     '<button type="button" class="btn btn--primary" data-sp-save>Save changes</button>'
          +     '<button type="button" class="btn btn--solid" data-sp-cancel>Cancel</button>'
          +   '</div>'
          +   '<p class="sp-detail__status" data-sp-status></p>'
          + '</form>';
      }
      function spOpenDetail(id) {
        var detail = document.getElementById("spDetail");
        var results = document.getElementById("spResults");
        var p = null;
        for (var i = 0; i < _spAll.length; i++) if (_spAll[i].id === id) { p = _spAll[i]; break; }
        if (!p || !detail) return;
        _spSelectedId = id;
        detail.innerHTML = spRenderView(p);
        detail.hidden = false;
        if (results) { results.hidden = true; results.innerHTML = ""; }
      }
      function _spFind(id) {
        for (var i = 0; i < _spAll.length; i++) if (_spAll[i].id === id) return _spAll[i];
        return null;
      }
      function _spSetStatus(msg, isErr) {
        var el = document.querySelector("#spDetail [data-sp-status]");
        if (el) { el.textContent = msg || ""; el.classList.toggle("is-err", !!isErr); }
      }
      function _spReloadInto(p, updatedFields) {
        // Update local cache row from server response.
        var f = updatedFields || {};
        p.name = String(f.Name != null ? f.Name : p.name || "");
        p.phone = String(f.Phone != null ? f.Phone : p.phone || "");
        p.phoneDigits = _spNormPhone(p.phone);
        p.email = String(f.Email != null ? f.Email : p.email || "");
        p.street = String(f.Street != null ? f.Street : p.street || "");
        p.city = String(f.City != null ? f.City : p.city || "");
        p.state = String(f.State != null ? f.State : p.state || "");
        p.zip = String(f.Zip != null ? f.Zip : p.zip || "");
        p.notes = String(f.Notes != null ? f.Notes : p.notes || "");
        if (f.Member != null) p.member = !!f.Member;
        p._hay = (p.name + " " + p.phone + " " + p.email + " " + p.city + " " + p.state).toLowerCase();
      }
      // Delegated actions on the detail block — view, edit form, save, delete.
      var _spDetail = document.getElementById("spDetail");
      if (_spDetail) {
        _spDetail.addEventListener("click", function (e) {
          var t = e.target && e.target.closest ? e.target : null;
          if (!t) return;
          if (t.closest("[data-sp-close]") || t.closest("[data-sp-cancel]")) {
            if (t.closest("[data-sp-cancel]") && _spSelectedId) {
              // Cancel edit → go back to view
              var p = _spFind(_spSelectedId);
              if (p) { _spDetail.innerHTML = spRenderView(p); return; }
            }
            _spDetail.hidden = true; _spDetail.innerHTML = ""; _spSelectedId = "";
            var input = document.getElementById("spInput");
            if (input) { input.value = ""; input.focus(); }
            return;
          }
          if (t.closest("[data-sp-edit]")) {
            var p2 = _spFind(_spSelectedId); if (!p2) return;
            _spDetail.innerHTML = spRenderEdit(p2);
            var first = _spDetail.querySelector('input[name="name"]');
            if (first) first.focus();
            return;
          }
          if (t.closest("[data-sp-save]")) {
            var p3 = _spFind(_spSelectedId); if (!p3) return;
            var form = _spDetail.querySelector("form.sp-edit"); if (!form) return;
            var payload = { id: p3.id };
            Array.prototype.forEach.call(form.querySelectorAll("input, textarea"), function (el) {
              var n = el.getAttribute("name"); if (!n) return;
              if (el.type === "checkbox") { payload.member = !!el.checked; return; }
              payload[n] = String(el.value || "").trim();
            });
            _spSetStatus("Saving…", false);
            fetch(FH_API.url("/api/players"), {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-admin-key": getKey() },
              body: JSON.stringify(payload)
            })
              .then(function (r) { return r.json().catch(function () { return {}; }); })
              .then(function (j) {
                if (!j || !j.ok) { _spSetStatus((j && j.error) || "Save failed.", true); return; }
                _spReloadInto(p3, j.fields || {});
                _spDetail.innerHTML = spRenderView(p3);
                _spSetStatus("Saved.", false);
              })
              .catch(function () { _spSetStatus("Network error.", true); });
            return;
          }
          if (t.closest("[data-sp-delete]")) {
            var p4 = _spFind(_spSelectedId); if (!p4) return;
            var ok = confirm(
              "Are you sure you want to delete \"" + (p4.name || "(no name)") + "\"?\n\n"
              + "This removes the player record from the Players table.\n"
              + "Any tournament sign-ups they've made will remain but won't\n"
              + "be linked to a Player row anymore.\n\n"
              + "This can't be undone."
            );
            if (!ok) return;
            _spSetStatus("Deleting…", false);
            fetch(FH_API.url("/api/players"), {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-admin-key": getKey() },
              body: JSON.stringify({ action: "delete", id: p4.id })
            })
              .then(function (r) { return r.json().catch(function () { return {}; }); })
              .then(function (j) {
                if (!j || !j.ok) { _spSetStatus((j && j.error) || "Delete failed.", true); return; }
                // Remove from local cache and close detail
                _spAll = _spAll.filter(function (x) { return x.id !== p4.id; });
                var spCount = document.getElementById("spCount");
                if (spCount) spCount.textContent = _spAll.length ? "(" + _spAll.length + ")" : "";
                _spDetail.hidden = true; _spDetail.innerHTML = ""; _spSelectedId = "";
                var input = document.getElementById("spInput");
                if (input) { input.value = ""; input.focus(); }
                var hint = document.getElementById("spHint");
                if (hint) hint.textContent = "Deleted. " + _spAll.length + " people remain.";
              })
              .catch(function () { _spSetStatus("Network error.", true); });
            return;
          }
        });
      }
      var _spInput = document.getElementById("spInput");
      if (_spInput) {
        _spInput.addEventListener("input", function () {
          if (!_spLoaded) loadSearchPeople();
          spRenderResults(this.value);
        });
        _spInput.addEventListener("focus", function () { if (!_spLoaded) loadSearchPeople(); });
      }
      var _spResults = document.getElementById("spResults");
      if (_spResults) {
        _spResults.addEventListener("click", function (e) {
          var btn = e.target && e.target.closest ? e.target.closest(".sp-result") : null;
          if (!btn) return;
          var id = btn.getAttribute("data-id"); if (!id) return;
          spOpenDetail(id);
        });
      }
      // Close results dropdown when clicking outside.
      document.addEventListener("click", function (e) {
        var host = document.getElementById("spResults");
        var input = document.getElementById("spInput");
        if (!host || host.hidden) return;
        if (!e.target || (e.target !== input && !host.contains(e.target) && !input.contains(e.target))) {
          host.hidden = true;
        }
      });

      // ==== Send invites (preview + per-recipient send) ====================
      // Wired to every non-past tournament card via .tm-inv click delegation
      // on the #tmYears container. The API template lives in
      // api/calcutta-receipt.js (template: "invite") and bakes in the
      // deadlines (7-day payment, unpaid → replaced, no refunds within 72h).
      var _invModal = document.getElementById("inviteModal");
      var _invStatus = document.getElementById("invStatus");
      var _invMeta = document.getElementById("invMeta");
      var _invPreview = document.getElementById("invPreview");
      var _invSend = document.getElementById("invSend");
      var _invSendStatus = document.getElementById("invSendStatus");
      var _invTitle = document.getElementById("invTitle");
      var _invRecipients = [];
      var _invCtx = null;

      function _invClose() {
        if (!_invModal) return;
        _invModal.hidden = true; _invModal.setAttribute("aria-hidden", "true");
        _invRecipients = []; _invCtx = null;
        if (_invSend) { _invSend.disabled = true; _invSend.textContent = "Send to 0 recipients"; }
        if (_invSendStatus) { _invSendStatus.textContent = ""; _invSendStatus.style.color = "var(--muted)"; }
        if (_invPreview) _invPreview.srcdoc = "";
      }
      if (_invModal) {
        Array.prototype.forEach.call(_invModal.querySelectorAll("[data-inv-close]"), function (el) {
          el.addEventListener("click", _invClose);
        });
      }

      // Parse a team-name display string ("Peterson / Smith", "Jones & Doe",
      // "A, B and C") into individual person names. Best-effort — used only
      // to fuzzy-match into the canonical Players table by lowercase name.
      function _splitTeam(str) {
        return String(str || "")
          .split(/\s*(?:\/|&|,|\band\b|\+)\s*/i)
          .map(function (s) { return s.trim(); })
          .filter(Boolean);
      }

      function openInvitesModal(key) {
        if (!_invModal || !key) return;
        _invModal.hidden = false; _invModal.setAttribute("aria-hidden", "false");
        var info = splitName(key);
        var T = window.FH_TMETA || {};
        var meta = T[key] || {};
        var displayName = meta.displayName || info.name;
        var tournamentDate = info.date || "";
        var year = meta.end ? Number(meta.end.slice(0, 4)) : (new Date().getFullYear() + 1);
        _invTitle.textContent = "Send invites — " + displayName + (tournamentDate ? " (" + tournamentDate + ")" : "");
        _invStatus.textContent = "Building recipient list…";
        _invStatus.style.color = "var(--muted)";
        _invMeta.textContent = "";
        _invPreview.srcdoc = "";
        _invSend.disabled = true;
        _invSend.textContent = "Send to 0 recipients";
        _invSendStatus.textContent = "";

        // Current signups for this KEY: Player Name + Email straight off the
        // signup record. Signups without an email are dropped silently.
        var current = (_touRecords || [])
          .filter(function (r) { return r.fields && r.fields["Tournament"] === key; })
          .map(function (r) { return { name: String(r.fields["Player Name"] || "").trim(), email: String(r.fields["Email"] || "").trim() }; })
          .filter(function (p) { return p.email && p.name; });

        // Historical / last-year lane: pull archives that match this
        // tournament NAME (splitName strips the date suffix so 2025's
        // "(Aug 23)" archive matches the 2026 "(Aug 22)" card), extract
        // every team-name string from the leaderboard, split into
        // individual player names, then look each up in the Players table
        // for an email. Best-effort — anyone the Players table doesn't
        // have on file is silently skipped (they'll join via current
        // signups going forward). Archives with a future "roster" array
        // are used verbatim when present.
        var tourneyBase = info.name;
        var pArchives = fetch(FH_API.url("/api/tournament-signups?archives=1"), { headers: { "x-admin-key": getKey() } })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .catch(function () { return {}; });
        var pPlayers = fetch(FH_API.url("/api/players"), { headers: { "x-admin-key": getKey() } })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .catch(function () { return {}; });

        Promise.all([pArchives, pPlayers]).then(function (out) {
          var archives = ((out[0] && out[0].records) || []).filter(function (rec) {
            var nm = String((rec.fields || {}).Name || "").trim();
            return nm && nm.toLowerCase() === tourneyBase.toLowerCase();
          });
          var byLName = {};
          ((out[1] && out[1].records) || []).forEach(function (p) {
            var nm = String((p.fields || {}).Name || "").trim();
            var em = String((p.fields || {}).Email || "").trim();
            if (nm && em) byLName[nm.toLowerCase()] = { name: nm, email: em };
          });

          var historical = [];
          archives.forEach(function (rec) {
            var snap = null;
            try { snap = JSON.parse((rec.fields || {}).Snapshot || "null"); } catch (e) { snap = null; }
            if (!snap) return;
            // Future-proof: if a snapshot carries a roster with {name,email},
            // trust it verbatim.
            if (Array.isArray(snap.roster)) {
              snap.roster.forEach(function (p) {
                var em = String((p && p.email) || "").trim();
                var nm = String((p && p.name) || "").trim();
                if (em && nm) historical.push({ name: nm, email: em });
              });
            }
            // Today's snapshots only have leaderboard team-name strings.
            // Split each into individual names and look up in Players.
            if (Array.isArray(snap.leaderboard)) {
              snap.leaderboard.forEach(function (row) {
                _splitTeam(row && row.name).forEach(function (nm) {
                  var hit = byLName[nm.toLowerCase()];
                  if (hit) historical.push(hit);
                });
              });
            }
          });

          // Dedup by lowercase email; current signups win when both lanes
          // agree (their name is the freshly-typed spelling).
          var byEmail = {};
          historical.forEach(function (p) { var k = p.email.toLowerCase(); if (!byEmail[k]) byEmail[k] = p; });
          current.forEach(function (p) { var k = p.email.toLowerCase(); byEmail[k] = p; });
          _invRecipients = Object.keys(byEmail).map(function (k) { return byEmail[k]; });

          if (!_invRecipients.length) {
            _invStatus.textContent = "No recipients found — no current signups have an email, and no past-year players were matched in the Players directory.";
            _invStatus.style.color = "var(--red-deep)";
            _invMeta.textContent = "";
            _invSend.disabled = true;
            _invSend.textContent = "Send to 0 recipients";
            return;
          }

          _invStatus.textContent = "Ready to send.";
          _invStatus.style.color = "var(--primary-green)";
          _invMeta.innerHTML = "<strong>" + _invRecipients.length + "</strong> recipient" + (_invRecipients.length === 1 ? "" : "s") + " · "
            + current.length + " current signup" + (current.length === 1 ? "" : "s") + " · "
            + (historical.length ? historical.length + " past-year lookup" + (historical.length === 1 ? "" : "s") : "0 past-year matches");

          _invSend.textContent = "Send to " + _invRecipients.length + " recipient" + (_invRecipients.length === 1 ? "" : "s");

          _invCtx = {
            tournamentName: displayName,
            tournamentYear: year,
            tournamentDate: tournamentDate,
            format: meta.format || "",
            signupUrl: "https://fandhgolf.com/tournaments.html?t=" + encodeURIComponent(key) + "#signup"
          };
          var sample = _invRecipients[0];
          var body = Object.assign({ template: "invite", preview: true, playerName: sample.name, to: sample.email }, _invCtx);
          fetch(FH_API.url("/api/calcutta-receipt"), {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-admin-key": getKey() },
            body: JSON.stringify(body)
          })
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (j) {
              if (j && j.ok && j.html) {
                _invPreview.srcdoc = j.html;
                _invSend.disabled = false;
              } else {
                _invStatus.textContent = "Preview failed: " + esc((j && j.error) || "unknown error");
                _invStatus.style.color = "var(--red-deep)";
              }
            })
            .catch(function () {
              _invStatus.textContent = "Preview failed — network error.";
              _invStatus.style.color = "var(--red-deep)";
            });
        });
      }

      if (_invSend) {
        _invSend.addEventListener("click", function () {
          if (!_invRecipients.length || !_invCtx) return;
          _invSend.disabled = true;
          var total = _invRecipients.length;
          var sent = 0, failed = 0;
          _invSendStatus.style.color = "var(--muted)";
          _invSendStatus.textContent = "Sending 0 / " + total + "…";
          var i = 0;
          function next() {
            if (i >= total) {
              _invSendStatus.textContent = "Done — " + sent + " sent" + (failed ? ", " + failed + " failed" : "") + ".";
              _invSendStatus.style.color = failed ? "var(--red-deep)" : "var(--primary-green)";
              _invSend.textContent = "Sent";
              return;
            }
            var p = _invRecipients[i++];
            var body = Object.assign({ template: "invite", playerName: p.name, to: p.email }, _invCtx);
            fetch(FH_API.url("/api/calcutta-receipt"), {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-admin-key": getKey() },
              body: JSON.stringify(body)
            })
              .then(function (r) { return r.json().catch(function () { return {}; }); })
              .then(function (j) {
                if (j && j.ok) sent++; else failed++;
              })
              .catch(function () { failed++; })
              .then(function () {
                _invSendStatus.textContent = "Sending " + (sent + failed) + " / " + total + "…";
                // Small stagger to keep Resend's rate limits happy on
                // long recipient lists (60+ people is plausible).
                setTimeout(next, 120);
              });
          }
          next();
        });
      }

      if (tmYears) {
        tmYears.addEventListener("click", function (e) {
          var btn = e.target && e.target.closest && e.target.closest(".tm-inv");
          if (!btn) return;
          var key = btn.getAttribute("data-key");
          if (key) openInvitesModal(key);
        });
      }

      // ---- Format-config overrides for the tournament cards -----------
      // The tournament cards on the Staff Portal are seeded from a hard-
      // coded metadata block in js/tournaments.js (FH_TMETA). That block
      // pre-dates the Format tab; when Format saves a Team Cap / Display
      // Name / Play Style / Players Per Team, those should override the
      // seed on the cards so the portal reads what the operator actually
      // configured — not stale defaults from a year ago.
      //
      // Fetch all Tournament Config rows once, patch FH_TMETA in place,
      // then re-run buildManager so the cards render with the fresh caps.
      function loadTournamentConfigs() {
        var T = window.FH_TMETA || {}; if (!Object.keys(T).length) return;
        fetch(FH_API.url("/api/tournament-signups?config=1"), { cache: "no-store" })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (j) {
            if (!j || !j.ok || !Array.isArray(j.records)) return;
            j.records.forEach(function (rec) {
              var f = (rec && rec.fields) || {};
              var key = String(f.Tournament || "").trim();
              if (!key || !T[key]) return;
              var m = T[key];
              // Team Cap of 0 = unlimited (Format tab convention); anything
              // > 0 replaces the hardcoded cap.
              var cap = Number(f["Team Cap"]);
              if (isFinite(cap) && cap > 0) m.cap = cap;
              // Display Name overrides the "Player Name → date parsed name"
              // that splitName() derives from the KEY string.
              if (typeof f["Name"] === "string" && f["Name"].trim()) m.displayName = f["Name"].trim();
              // Play Style is the human "3-man scramble" / "2-lady scramble"
              // text; when Format sets it we prefer that over m.format so
              // the card reflects what the operator picked.
              if (typeof f["Play Style"] === "string" && f["Play Style"].trim()) m.format = f["Play Style"].trim();
              // Players Per Team drives the team-size line under the card.
              var ppt = Number(f["Players Per Team"]);
              if (isFinite(ppt) && ppt > 0) m.team = ppt;
            });
            try { if (typeof loadTournaments === "function") loadTournaments(); else buildManager([]); } catch (e) {}
          })
          .catch(function () {});
      }

      // ---- Course carts (shared across every tournament) --------------
      // Stored server-side as a Tournament Config row named "__course__" so
      // we can reuse the existing config-write endpoint. Every tournament
      // workbook's Check-In cart dropdown reads from the same row.
      var COURSE_CONFIG_KEY = "__course__";
      function ccStatus(msg, kind) {
        var s = document.getElementById("courseCartsStatus"); if (!s) return;
        s.textContent = msg || "";
        s.style.color = kind === "error" ? "var(--red-deep)" : kind === "ok" ? "var(--primary-green)" : "var(--muted)";
      }
      function ccBuildCartCard(c) {
        c = c || {};
        var card = document.createElement("div");
        card.className = "fmt-cart";
        card.setAttribute("role", "listitem");
        card.innerHTML = ''
          + '<div class="fmt-cart__grid">'
          +   '<label class="fmt-row"><span>Member name</span><input type="text" data-k="name" maxlength="120" /></label>'
          +   '<label class="fmt-row"><span>Shed #</span><input type="text" data-k="shed" maxlength="20" /></label>'
          +   '<label class="fmt-row"><span>Spot #</span><input type="text" data-k="spot" maxlength="20" /></label>'
          +   '<label class="fmt-row"><span>Power</span><select data-k="power"><option value="">—</option><option>Electric</option><option>Gas</option></select></label>'
          + '</div>'
          + '<label class="fmt-row"><span>Special instructions</span><textarea data-k="notes" rows="2" placeholder="Key in the console. Charger in the shed."></textarea></label>'
          + '<div class="fmt-cart__ft"><button type="button" class="btn btn--solid fmt-cart__rm" title="Remove this member cart">Remove</button></div>';
        var set = function (k, v) { var el = card.querySelector('[data-k="' + k + '"]'); if (el) el.value = v || ""; };
        set("name", c.name); set("shed", c.shed); set("spot", c.spot); set("power", c.power); set("notes", c.notes);
        card.querySelector(".fmt-cart__rm").addEventListener("click", function () {
          if (card.parentNode) card.parentNode.removeChild(card);
        });
        return card;
      }
      function ccRenderCarts(carts) {
        var list = document.getElementById("ccMemberList"); if (!list) return;
        list.innerHTML = "";
        (carts || []).forEach(function (c) { list.appendChild(ccBuildCartCard(c)); });
      }
      function ccCollectCarts() {
        var list = document.getElementById("ccMemberList");
        if (!list) return [];
        var out = [];
        Array.prototype.forEach.call(list.querySelectorAll(".fmt-cart"), function (card) {
          var pick = function (k) { var el = card.querySelector('[data-k="' + k + '"]'); return el ? String(el.value || "").trim() : ""; };
          var entry = { name: pick("name"), shed: pick("shed"), spot: pick("spot"), power: pick("power"), notes: pick("notes") };
          // Drop entries where every field is blank — leftover from an
          // accidental "+ Add" click.
          if (entry.name || entry.shed || entry.spot || entry.power || entry.notes) out.push(entry);
        });
        return out;
      }
      function loadCourseCarts() {
        var rc = document.getElementById("ccRentalCount"); if (!rc) return;
        ccStatus("Loading…");
        fetch(FH_API.url("/api/tournament-signups?config=" + encodeURIComponent(COURSE_CONFIG_KEY)))
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (j) {
            var fields = (j && j.record && j.record.fields) || {};
            rc.value = fields["Rental Carts"] != null ? String(fields["Rental Carts"]) : "";
            var arr = [];
            try { arr = JSON.parse(fields["Member Carts JSON"] || "[]"); if (!Array.isArray(arr)) arr = []; } catch (e) { arr = []; }
            // Legacy string entries (from before the structured card) parse
            // to {name, notes} so nobody loses data across the schema bump.
            var carts = arr.map(function (entry) {
              if (typeof entry === "string") {
                var parts = entry.split(/\s+[—-]\s+/);
                return { name: (parts[0] || "").trim(), shed: "", spot: "", power: "", notes: (parts.slice(1).join(" — ") || "").trim() };
              }
              entry = entry || {};
              var pw = String(entry.power || "").toLowerCase();
              return {
                name: String(entry.name || "").trim(),
                shed: String(entry.shed || "").trim(),
                spot: String(entry.spot || "").trim(),
                power: pw === "gas" ? "Gas" : (pw === "electric" ? "Electric" : ""),
                notes: String(entry.notes || "").trim(),
              };
            });
            ccRenderCarts(carts);
            ccStatus(j && j.record ? "Loaded ✓" : "No course carts saved yet — add some below.", "ok");
          })
          .catch(function () { ccStatus("Couldn't load course carts.", "error"); });
      }
      function saveCourseCarts() {
        var rc = document.getElementById("ccRentalCount"); if (!rc) return;
        var payload = {};
        var raw = String(rc.value || "").trim();
        if (raw !== "") { var n = Number(raw); if (isFinite(n) && n >= 0) payload["Rental Carts"] = Math.floor(n); }
        payload["Member Carts JSON"] = JSON.stringify(ccCollectCarts());
        ccStatus("Saving…");
        fetch(FH_API.url("/api/tournament-signups"), {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-admin-key": getKey() },
          body: JSON.stringify({ action: "config-write", tournament: COURSE_CONFIG_KEY, fields: payload }),
        })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; }); })
          .then(function (res) {
            if (res.j && res.j.ok) { ccStatus("Saved ✓ — every tournament will pick up the new pool.", "ok"); }
            else { ccStatus((res.j && res.j.error) || "Save failed.", "error"); }
          })
          .catch(function () { ccStatus("Network error saving.", "error"); });
      }

      // ---- Tournament Manager: one card per tournament, grouped by year ----
      var tmYears = document.getElementById("tmYears");
      var tmCount = document.getElementById("tmCount");
      var tmRefresh = document.getElementById("tmRefresh");

      function splitName(key) {
        var mm = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(key);
        return mm ? { name: mm[1], date: mm[2] } : { name: key, date: "" };
      }
      function isPastEnd(end) {
        if (!end) return false;
        var today = new Date(); today.setHours(0, 0, 0, 0);
        return new Date(end + "T00:00:00") < today;
      }

      // Persisted season pick — remembered so the operator lands on the
      // same season next visit. "" means "All seasons".
      var _tmSeasonKey = "fh:tmSeason";
      var _tmRecords = [];
      function _tmReadSeason() { try { return localStorage.getItem(_tmSeasonKey) || ""; } catch (e) { return ""; } }
      function _tmWriteSeason(v) { try { localStorage.setItem(_tmSeasonKey, v || ""); } catch (e) {} }

      function buildManager(records) {
        if (!tmYears) return;
        // Keep the last fetched records so the season picker can re-render
        // without re-hitting the API.
        if (records && records.length) _tmRecords = records;
        else if (!records) records = _tmRecords || [];
        var T = window.FH_TMETA || {};
        var keys = Object.keys(T);
        if (!keys.length) { tmYears.innerHTML = '<p class="noms__msg">Tournament list unavailable.</p>'; return; }

        var counts = {}, emails = {};
        (records || []).forEach(function (rec) {
          var f = rec.fields || {}, t = f["Tournament"] || "Other";
          counts[t] = (counts[t] || 0) + 1;
          if (f["Email"]) (emails[t] = emails[t] || []).push(f["Email"]);
        });

        var years = {};
        keys.forEach(function (k) {
          var m = T[k];
          // TBD placeholders (reserve-my-spot flow) — bucket by the year
          // parsed out of the KEY suffix ("(TBD 2027)" → 2027) so they
          // appear alongside their season, not under "Season-long".
          var y;
          if (m.end) y = m.end.slice(0, 4);
          else if (m.tbd) { var mm = /\(\s*TBD\s+(\d{4})\s*\)/i.exec(k); y = mm ? mm[1] : "Season-long"; }
          else y = "Season-long";
          (years[y] = years[y] || []).push(k);
        });
        var ynames = Object.keys(years).sort(function (a, b) {
          if (a === "Season-long") return 1; if (b === "Season-long") return -1;
          return b.localeCompare(a);
        });

        // Populate the season dropdown. Default to the current year if the
        // operator has never picked one and it's a real season we know
        // about; otherwise fall back to the most recent one.
        var seasonSel = document.getElementById("tmSeason");
        if (seasonSel) {
          var picked = _tmReadSeason();
          var thisYear = String(new Date().getFullYear());
          if (!picked) {
            picked = ynames.indexOf(thisYear) !== -1
              ? thisYear
              : (ynames.filter(function (y) { return y !== "Season-long"; })[0] || ynames[0] || "");
          }
          var opts = ['<option value="">All seasons</option>'].concat(ynames.map(function (y) {
            var lbl = y === "Season-long" ? "Season-long events" : (y + " Season");
            var count = (years[y] || []).length;
            return '<option value="' + esc(y) + '"' + (y === picked ? " selected" : "") + '>' + esc(lbl) + " (" + count + ")</option>";
          }));
          seasonSel.innerHTML = opts.join("");
          // Filter the render to just the picked season.
          if (picked) ynames = ynames.filter(function (y) { return y === picked; });
        }

        // Count reflects the CURRENTLY-SHOWN cards, so "(6)" matches what
        // the operator sees on screen instead of the raw TMETA total.
        var shownCount = ynames.reduce(function (n, y) { return n + (years[y] || []).length; }, 0);
        tmCount.textContent = "(" + shownCount + ")";
        tmYears.innerHTML = ynames.map(function (y) {
          var items = years[y].slice().sort(function (a, b) {
            return (T[a].end || "9999").localeCompare(T[b].end || "9999");
          });
          var cards = items.map(function (k) {
            var m = T[k], info = splitName(k), n = counts[k] || 0;
            var past = isPastEnd(m.end);
            var capText = m.cap ? (n + " / " + m.cap + " " + (m.unit || "spots")) : (n + " signed up");
            var full = m.cap && n >= m.cap;
            var fmt = m.format || (m.team ? m.team + "-player team" : "");
            var elist = emails[k] || [];
            var mailBtn = elist.length
              ? '<a class="btn btn--solid tm__btn" href="mailto:?bcc=' + encodeURIComponent(elist.join(",")) + "&subject=" + encodeURIComponent("F&H — " + info.name) + '">Email (' + elist.length + ")</a>"
              : '<span class="tm__btn tm__btn--off">No emails yet</span>';
            // "Send invites" is a Resend-driven pre-tournament blast with
            // baked-in deadlines (payment 7 days out, unpaid → replaced,
            // no refunds inside 72 hrs). Hidden on past tournaments — the
            // window for invites has already closed.
            var invBtn = past ? ""
              : '<button type="button" class="btn btn--solid tm__btn tm-inv" data-key="' + esc(k) + '">Send invites</button>';
            return '<article class="tm-card' + (past ? " is-past" : "") + '">'
              + '<div class="tm-card__head"><h4 class="tm-card__name">' + esc(info.name) + "</h4>"
              + (info.date ? '<span class="tm-card__date">' + esc(info.date) + "</span>" : "") + "</div>"
              + (fmt ? '<p class="tm-card__fmt">' + esc(fmt) + "</p>" : "")
              + '<p class="tm-card__count' + (full ? " is-full" : "") + '">' + esc(capText)
              + (past ? ' · <strong>Completed</strong>' : "") + "</p>"
              + '<div class="tm-card__chips"><span>Roster</span><span>Flights</span><span>Scorecards</span><span>Leaderboard</span></div>'
              + '<div class="tm-card__actions">'
              + '<a class="btn btn--primary tm__btn" href="tournament-admin.html?t=' + encodeURIComponent(k) + '">Open &rarr;</a>'
              + mailBtn + invBtn + "</div></article>";
          }).join("");
          return '<div class="tm-year"><h4 class="tm-year__label">' + esc(y) + (y !== "Season-long" ? " Season" : "") + '</h4><div class="tm-grid">' + cards + "</div></div>";
        }).join("");
      }

      function show(authed) {
        gate.hidden = authed;
        panel.hidden = !authed;
        if (logout) logout.hidden = !authed;
        if (authed) { buildManager([]); loadNominations(); loadTournaments(); loadCourseCarts(); loadTournamentConfigs(); loadSiteStats(); loadSearchPeople(); }
      }
      show(_readAuth(FLAG) === "1");

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (input.value === PASS) {
          _writeAuth(FLAG, "1");
          _writeAuth(KEYK, input.value);
          err.textContent = "";
          show(true);
        } else {
          err.textContent = "Incorrect password.";
          input.select();
        }
      });

      if (refresh) refresh.addEventListener("click", loadNominations);
      if (touRefresh) touRefresh.addEventListener("click", loadTournaments);
      if (tmRefresh) tmRefresh.addEventListener("click", loadTournaments);
      var statsRefresh = document.getElementById("statsRefresh");
      if (statsRefresh) statsRefresh.addEventListener("click", loadSiteStats);
      // Season picker — swap which year's cards are shown from the cached
      // record set (no re-fetch needed).
      var tmSeason = document.getElementById("tmSeason");
      if (tmSeason) tmSeason.addEventListener("change", function () {
        _tmWriteSeason(tmSeason.value);
        buildManager(_tmRecords);
      });

      var ccSave = document.getElementById("ccSave");
      if (ccSave) ccSave.addEventListener("click", saveCourseCarts);
      var ccAddCart = document.getElementById("ccAddCart");
      if (ccAddCart) ccAddCart.addEventListener("click", function () {
        var list = document.getElementById("ccMemberList"); if (!list) return;
        var card = ccBuildCartCard({});
        list.appendChild(card);
        var firstInput = card.querySelector('[data-k="name"]'); if (firstInput) firstInput.focus();
      });

      if (logout) logout.addEventListener("click", function (e) {
        e.preventDefault();
        _clearAuth();
        input.value = "";
        show(false);
      });
    })();
