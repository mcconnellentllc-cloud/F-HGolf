// Shared CORS handling. The public site (fandhgolf.com on GitHub Pages) calls
// these functions cross-origin, so we must allow it and answer the browser's
// preflight OPTIONS request. Files starting with "_" are not routed by Vercel.
//
// Returns true if the request was a preflight that we've already answered — the
// caller should `return` immediately in that case.
module.exports = function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
};
