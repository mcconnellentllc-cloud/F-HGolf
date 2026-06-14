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

  /* Course's Deposyt hosted card-payment form (feeType=amount → payer enters the
     amount). Shared by the Rates "Pay for Play" block and tournament sign-ups. */
  window.FH_PAY_URL = "https://deposytdashboard.com/gateway/public/form?data=eyJkYmFJZCI6Ijg5MjY2IiwidGVybWluYWxJZCI6Ijc5MjcwMSIsInRocmVlZHMiOiJEaXNhYmxlZCIsInJldHVyblVybCI6IiIsInJldHVyblVybE5hdmlnYXRpb24iOiJ0b3AiLCJsb2dvIjpudWxsLCJ2aXNpYmxlTm90ZSI6bnVsbCwicmVxdWVzdENvbnRhY3RJbmZvIjoiWWVzIiwicmVxdWVzdEJpbGxpbmdJbmZvIjpudWxsLCJyZXF1ZXN0U2hpcHBpbmdJbmZvIjpudWxsLCJzZW5kUmVjZWlwdCI6IlllcyIsIm9yaWdpbiI6Ikhvc3RlZEZvcm0iLCJoYXNoIjoiZmZjYzliNTM2YWYwOTNlY2RkZjMxYmI4NjY1YTM5NGYiLCJjb250YWN0SW5mbyI6eyJjb250YWN0TmFtZSI6IiIsImNvbnRhY3RFbWFpbCI6IiIsImNvbnRhY3RQaG9uZSI6IiJ9fQ%3D%3D&feeType=amount";
})();
