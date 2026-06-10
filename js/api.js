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
    url: function (path) { return base + path; }
  };
})();
