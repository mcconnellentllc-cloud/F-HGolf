// Vercel serverless function — accepts a tournament sign-up and writes it to the
// Airtable "Tournament Signups" table. If the tournament is at/over its cap,
// the record is flagged Alternate:true (standby list) and the response returns
// { ok:true, alternate:true } so the page can show the right message.
//
// Env: AIRTABLE_TOKEN (data.records:read+write), AIRTABLE_BASE_ID,
//      TOURNAMENTS_TABLE (defaults to "Tournament Signups"),
//      RESEND_API_KEY (optional — sends confirmation/alternate email if present),
//      RESEND_FROM (optional, defaults to "F&H Golf <noreply@fandhgolf.com>").

// Caps mirror js/tournaments.js. Keep both files in sync when a cap changes.
const CAPS = {
  "Par 4 the Future (May 16)": 22,
  "Haxtun Daycare (June 6)": 22,
  "John Everitt Memorial (June 13)": 22,
  "Couple's Tournament (June 27)": 24,
  "Red, White & Blue (July 4)": 22,
  "Adult/Child Tournament (July 12)": 22,
  "Junior Golf Camp (July 15–17)": 50,
  "2-Lady Scramble (July 23)": 22,
  "Haxtun Bulldog (July 25)": 22,
  "Founder's Tournament (Aug 8–9)": 64,
  "Couple's Tournament (Aug 22)": 24,
  "Haxtun Fire (Sept 19)": 22,
  "Cornfest Tournament (Sept 27)": 22,
};

async function countFieldEntries(baseId, table, token, tournament) {
  const filter = `AND({Tournament}="${tournament.replace(/"/g, '\\"')}", {Status}!="Cancelled", NOT({Alternate}))`;
  let total = 0, offset = "";
  for (let guard = 0; guard < 10; guard++) {
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=Status` + (offset ? `&offset=${encodeURIComponent(offset)}` : "");
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`count ${r.status}`);
    const data = await r.json();
    total += (data.records || []).length;
    if (!data.offset) break;
    offset = data.offset;
  }
  return total;
}

async function sendConfirmationEmail({ email, name, tournament, alternate }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !email) return false;
  const from = process.env.RESEND_FROM || "F&H Golf <noreply@fandhgolf.com>";
  const subject = alternate
    ? `You're on the alternate list — ${tournament}`
    : `You're signed up — ${tournament}`;
  const displayName = (name || "there").split(/\s+/)[0];
  const html = alternate
    ? `<p>Hi ${escapeHtml(displayName)},</p>
<p>Thanks for signing up for <strong>${escapeHtml(tournament)}</strong>. The field is full, so you're on our <strong>alternate list</strong> — not in the tournament yet.</p>
<p>If a spot opens up, we'll text or email you right away. You don't need to pay your entry fee until you're confirmed.</p>
<p>Questions? Call the course at (970) 774-6362.</p>
<p>— F&amp;H Golf</p>`
    : `<p>Hi ${escapeHtml(displayName)},</p>
<p>You're signed up for <strong>${escapeHtml(tournament)}</strong>. See you at the course.</p>
<p>You can pay your entry fee online at <a href="https://fandhgolf.com/tournaments.html">fandhgolf.com/tournaments</a> or settle up at the course.</p>
<p>Questions? Call (970) 774-6362.</p>
<p>— F&amp;H Golf</p>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject, html }),
    });
    if (!r.ok) { console.error("resend send failed", r.status, await r.text()); return false; }
    return true;
  } catch (e) {
    console.error("resend send error", e);
    return false;
  }
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

module.exports = async (req, res) => {
  if (require("./_cors")(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  const TABLE = process.env.TOURNAMENTS_TABLE || "Tournament Signups";
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return res.status(500).json({ ok: false, error: "Sign-ups aren't configured yet. Please call (970) 774-6362." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  if (body.company) return res.status(200).json({ ok: true }); // honeypot

  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = clean(body.name, 120);
  const tournament = clean(body.tournament, 120);
  if (!name || !tournament) {
    return res.status(400).json({ ok: false, error: "Please choose a tournament and enter your name." });
  }

  const fields = { "Player Name": name, "Tournament": tournament, "Status": "New" };
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 60);
  const team = clean(body.team, 500);
  const notes = clean(body.notes, 2000);
  const extraMeals = parseInt(body.extraMeals, 10);
  const cartPlan = clean(body.cartPlan, 20); // "Rental" | "Owned" | "None" | ""
  if (email) fields["Email"] = email;
  if (phone) fields["Phone"] = phone;
  if (team) fields["Team / Partners"] = team;
  // Cart plan at signup drives rental-cart inventory; per-player billing
  // happens on the workbook check-in card.
  if (cartPlan) fields["Cart Type"] = cartPlan;
  // How many extra meals this signup wants — kitchen head count.
  if (!isNaN(extraMeals) && extraMeals >= 0) fields["Extra Meals"] = extraMeals;
  if (notes) fields["Notes"] = notes;

  // Cap check — if the field is full, this signup goes on the alternate list.
  // Missing cap (invitational, raffle) → treat as unlimited.
  let alternate = false;
  const cap = CAPS[tournament];
  if (cap) {
    try {
      const count = await countFieldEntries(AIRTABLE_BASE_ID, TABLE, AIRTABLE_TOKEN, tournament);
      if (count >= cap) { alternate = true; fields["Alternate"] = true; }
    } catch (e) {
      console.error("cap check failed — proceeding without alternate flag", e);
    }
  }

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}`;
  const post = (f) => fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields: f }], typecast: true }),
  });

  try {
    let working = { ...fields };
    for (let attempt = 0; attempt < 8; attempt++) {
      const r = await post(working);
      if (r.ok) {
        // Fire-and-forget confirmation email — don't block the response on it.
        sendConfirmationEmail({ email, name, tournament, alternate }).catch(() => {});
        return res.status(200).json({ ok: true, alternate });
      }
      const detail = await r.text();
      let msg = detail;
      try { msg = (JSON.parse(detail).error || {}).message || detail; } catch (e) {}
      const m = /Unknown field name:?\s*"?([^"]+?)"?$/i.exec(String(msg).trim());
      if (m && working.hasOwnProperty(m[1]) && Object.keys(working).length > 2) {
        delete working[m[1]];
        continue;
      }
      console.error("Airtable tournament signup error", r.status, detail);
      return res.status(502).json({ ok: false, error: "Could not save your sign-up right now. Please try again, or call (970) 774-6362." });
    }
    return res.status(502).json({ ok: false, error: "Could not save your sign-up. Please call (970) 774-6362." });
  } catch (e) {
    console.error("tournament-signup error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong. Please try again, or call (970) 774-6362." });
  }
};
