/* Resolves where the API lives.

   The public site is served from GitHub Pages (fandhgolf.com), which is a
   static host and cannot run the /api serverless functions — a POST there
   returns 405. Those functions only exist on Vercel. So when we're NOT on
   Vercel (or localhost), point API calls at the Vercel deployment; otherwise
   use a same-origin relative path. */
(function () {
  var h = location.hostname;
  var sameOrigin = /(^|\.)vercel\.app$/.test(h) || h === "localhost" || h === "127.0.0.1";
  var base = sameOrigin ? "" : "https://f-h-golf.vercel.app";
  window.FH_API = {
    base: base,
    url: function (path) { return base + path; },
    /* Public duplicate-player check for a signup form. Sends the tournament
       key + a list of names, resolves to a list of matches:
           [{ name, role, teamNumber, alternate, captainName, otherPlayers }]
       Empty names are dropped by the server. Network / server errors resolve
       to [] so the caller can proceed rather than block a signup on a
       hiccup. */
    dupCheck: function (tournament, names) {
      var t = String(tournament || "").trim();
      var list = (names || []).map(function (n) { return String(n || "").trim(); }).filter(Boolean);
      if (!t || !list.length) return Promise.resolve([]);
      var qs = "?dupCheck=" + encodeURIComponent(t) + "&names=" + encodeURIComponent(list.join("||"));
      return fetch(base + "/api/tournament-signups" + qs, { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : { ok: false }; })
        .then(function (j) { return (j && j.ok && Array.isArray(j.matches)) ? j.matches : []; })
        .catch(function () { return []; });
    }
  };

  /* Course's Deposyt hosted card-payment form (feeType=amount → payer enters the
     amount). Shared by the Rates "Pay for Play" block and tournament sign-ups. */
  window.FH_PAY_URL = "https://deposytdashboard.com/gateway/public/form?data=eyJkYmFJZCI6Ijg5MjY2IiwidGVybWluYWxJZCI6Ijc5MjcwMSIsInRocmVlZHMiOiJEaXNhYmxlZCIsInJldHVyblVybCI6IiIsInJldHVyblVybE5hdmlnYXRpb24iOiJ0b3AiLCJsb2dvIjpudWxsLCJ2aXNpYmxlTm90ZSI6bnVsbCwicmVxdWVzdENvbnRhY3RJbmZvIjoiWWVzIiwicmVxdWVzdEJpbGxpbmdJbmZvIjpudWxsLCJyZXF1ZXN0U2hpcHBpbmdJbmZvIjpudWxsLCJzZW5kUmVjZWlwdCI6IlllcyIsIm9yaWdpbiI6Ikhvc3RlZEZvcm0iLCJoYXNoIjoiZmZjYzliNTM2YWYwOTNlY2RkZjMxYmI4NjY1YTM5NGYiLCJjb250YWN0SW5mbyI6eyJjb250YWN0TmFtZSI6IiIsImNvbnRhY3RFbWFpbCI6IiIsImNvbnRhY3RQaG9uZSI6IiJ9fQ%3D%3D&feeType=amount";
})();
