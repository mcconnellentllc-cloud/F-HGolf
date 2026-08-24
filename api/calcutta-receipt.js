// Send a Calcutta buyer receipt via Resend, from the site's own address
// (clubhouse@fandhgolf.com by default). Replaces the mailto: flow so
// every receipt goes out with a consistent From regardless of which
// operator's laptop the workbook is open on.
//
// Env: RESEND_API_KEY, ADMIN_KEY,
//      RESEND_FROM_CALCUTTA (optional, defaults to
//        "F&H Golf Course <clubhouse@fandhgolf.com>"),
//      RESEND_REPLY_TO_CALCUTTA (optional, defaults to
//        "clubhouse@fandhgolf.com").
//
// Body: {
//   to: "buyer@example.com",       // required — buyer's email
//   buyerName: "Justin Stone",     // required — display name
//   tournamentName: "2026 F&H Founders Tournament", // optional label
//   teams: [                       // required — one row per bought team
//     { tag: "T-24", team: "O. Szabo / T. Kuntz", amount: 600, won: 0 },
//     { tag: "T-61", team: "K. Ham / D. Ham",     amount: 275, won: 0 }
//   ],
//   totalSpent: 875,               // required — dollars
//   totalWon: 0,                   // required — dollars
//   paidMethod: "Cash" | null,     // if truthy, receipt shows "paid via <method>"
//   buyInDue: 875 | null,          // if paidMethod is falsy and this > 0, show "due"
//   preview: false                 // optional — if true, return HTML/text without sending
// }

module.exports = async (req, res) => {
  if (require("./_cors")(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { RESEND_API_KEY } = process.env;
  const _auth = require("./_auth")(req);
  if (!_auth) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const preview = !!body.preview;
  // Only enforce RESEND_API_KEY when we're actually about to send.
  // Preview mode returns the rendered HTML without hitting Resend, so
  // the operator can still see the email even before the key is set.
  if (!preview && !RESEND_API_KEY) {
    return res.status(500).json({ ok: false, error: "Email sending is not configured (RESEND_API_KEY missing). Add it in Vercel → Settings → Environment Variables (Production) and redeploy." });
  }
  const template = String(body.template || "calcuttaReceipt");

  // ---- thankYou template: post-tournament thank-you email ----
  // Every field except playerName is per-tournament. `isFounders: true`
  // adds the Founders-specific "reserve your spot for next year" block
  // (deadlines, first-come/first-served copy). Any other tournament
  // sends a clean thanks + link to the leaderboard, no reserve CTA.
  if (template === "thankYou") {
    const to = String(body.to || "").trim();
    const playerName = String(body.playerName || "").trim();
    const tournamentName = String(body.tournamentName || "F&H Tournament").trim();
    const tournamentYear = Number(body.tournamentYear) || new Date().getFullYear();
    const nextYear = tournamentYear + 1;
    const leaderboardUrl = String(body.leaderboardUrl || "https://fandhgolf.com/tournaments.html").trim();
    const signupUrl = String(body.signupUrl || "https://fandhgolf.com/tournaments.html").trim();
    const isFounders = body.isFounders === true;
    const apology = body.apology === true;
    if (!playerName) return res.status(400).json({ ok: false, error: "playerName is required." });
    if (!preview && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ ok: false, error: "A valid player email is required." });
    }
    const firstName = playerName.split(/\s+/)[0] || playerName;
    const ctx = { firstName, playerName, tournamentName, tournamentYear, nextYear, leaderboardUrl, signupUrl, isFounders, apology };
    const subject = buildThankYouSubject(ctx);
    const html = buildThankYouHtml(ctx);
    const text = buildThankYouText(ctx);
    if (preview) return res.status(200).json({ ok: true, subject, html, text });
    return sendViaResend({ to, subject, html, text, res });
  }

  // ---- invite template: pre-tournament invite + deadline reminders ----
  // Sent from the Staff Portal tournament card. Recipients are the union
  // of last year's players (via the archive) + the current signup roster,
  // deduped by email upstream. Body carries the F&H standard deadlines:
  // payment required 7 days out; unpaid teams get replaced by paying
  // players; no refunds within 72 hours.
  if (template === "invite") {
    const to = String(body.to || "").trim();
    const playerName = String(body.playerName || "Golfer").trim();
    const tournamentName = String(body.tournamentName || "F&H Tournament").trim();
    const tournamentYear = Number(body.tournamentYear) || new Date().getFullYear();
    const tournamentDate = String(body.tournamentDate || "").trim();
    const format = String(body.format || "").trim();
    const signupUrl = String(body.signupUrl || "https://fandhgolf.com/tournaments.html").trim();
    if (!playerName) return res.status(400).json({ ok: false, error: "playerName is required." });
    if (!preview && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ ok: false, error: "A valid player email is required." });
    }
    const firstName = playerName.split(/\s+/)[0] || playerName;
    const ctx = { firstName, playerName, tournamentName, tournamentYear, tournamentDate, format, signupUrl };
    const subject = buildInviteSubject(ctx);
    const html = buildInviteHtml(ctx);
    const text = buildInviteText(ctx);
    if (preview) return res.status(200).json({ ok: true, subject, html, text });
    return sendViaResend({ to, subject, html, text, res });
  }

  // ---- calcuttaReceipt template (default, existing behavior) ----
  const to = String(body.to || "").trim();
  const buyerName = String(body.buyerName || "").trim();
  const tournamentName = String(body.tournamentName || "2026 F&H Founders Tournament").trim();
  const teams = Array.isArray(body.teams) ? body.teams : [];
  const totalSpent = Number(body.totalSpent) || 0;
  const totalWon = Number(body.totalWon) || 0;
  const paidMethod = body.paidMethod ? String(body.paidMethod) : "";
  const buyInDue = Number(body.buyInDue) || 0;

  if (!buyerName) return res.status(400).json({ ok: false, error: "buyerName is required." });
  if (!teams.length) return res.status(400).json({ ok: false, error: "At least one team is required." });
  if (!preview && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return res.status(400).json({ ok: false, error: "A valid buyer email is required." });
  }

  const net = totalWon - totalSpent;
  const firstName = buyerName.split(/\s+/)[0] || buyerName;
  const subject = buildSubject({ buyerName, totalSpent, totalWon, net });
  const html = buildHtml({ firstName, buyerName, tournamentName, teams, totalSpent, totalWon, net, paidMethod, buyInDue });
  const text = buildText({ firstName, buyerName, tournamentName, teams, totalSpent, totalWon, net, paidMethod, buyInDue });

  if (preview) return res.status(200).json({ ok: true, subject, html, text });
  return sendViaResend({ to, subject, html, text, res });
};

// Shared Resend send used by every template branch above. Same From
// and Reply-To so any reply routes to the clubhouse mailbox.
async function sendViaResend({ to, subject, html, text, res }) {
  const from = process.env.RESEND_FROM_CALCUTTA || "F&H Golf Course <clubhouse@fandhgolf.com>";
  const replyTo = process.env.RESEND_REPLY_TO_CALCUTTA || "clubhouse@fandhgolf.com";
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject, html, text }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error("resend send failed", r.status, detail);
      return res.status(502).json({ ok: false, error: "Email service refused the send. Try again in a minute." });
    }
    const j = await r.json().catch(() => ({}));
    return res.status(200).json({ ok: true, id: j.id || null });
  } catch (e) {
    console.error("resend send error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong sending the email." });
  }
}

function money(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? "-" : "";
  return sign + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function buildSubject({ totalSpent, totalWon, net }) {
  let tag;
  if (net > 0) tag = "won " + money(net);
  else if (net < 0) tag = "owes " + money(-net);
  else tag = money(totalSpent);
  return "F&H Founders 2026 — Calcutta receipt (" + tag + ")";
}

// The plain-text alternative. Some mail clients (and screen readers) fall
// back to this; keep it clean and human-readable.
function buildText({ firstName, tournamentName, teams, totalSpent, totalWon, net, paidMethod, buyInDue }) {
  const lines = [];
  lines.push(`Hi ${firstName},`);
  lines.push("");
  lines.push(`Thank you so much for supporting the ${tournamentName} Calcutta.`);
  lines.push("Your buy-in keeps the tournament — and the course — running strong.");
  lines.push("");
  lines.push("Your receipt:");
  lines.push("");
  teams.forEach((t) => {
    const tag = (t.tag || "—").padEnd(6);
    const team = String(t.team || "");
    const amt = money(Number(t.amount) || 0);
    const won = Number(t.won) || 0;
    const wonTxt = won > 0 ? "   won " + money(won) : "";
    lines.push(`  ${tag} ${team}   ${amt}${wonTxt}`);
  });
  lines.push("");
  lines.push("─────────────────────────────");
  lines.push("  Total spent: " + money(totalSpent));
  lines.push("  Total won:   " + money(totalWon));
  if (net > 0) lines.push("  Net:         +" + money(net) + " (payable to you)");
  else if (net < 0) lines.push("  Net:         −" + money(-net) + " (balance to F&H)");
  else lines.push("  Net:         even");
  lines.push("─────────────────────────────");
  lines.push("");
  if (paidMethod) {
    lines.push(`Buy-in paid via ${paidMethod} — you're all set. Thank you!`);
  } else if (buyInDue > 0) {
    lines.push(`Calcutta buy-in due: ${money(buyInDue)}`);
    lines.push("Please make checks payable to F&H Golf Course.");
  }
  lines.push("");
  lines.push("Thanks again for being part of the Founders Tournament.");
  lines.push("It wouldn't be the same weekend without you.");
  lines.push("");
  lines.push("— The F&H Golf Course crew");
  lines.push("F&H Golf Course");
  lines.push("(970) 774-6362 · fandhgolf.com");
  return lines.join("\n");
}

// HTML template. Uses tables + inline styles for maximum email-client
// compatibility (Outlook, Gmail, Apple Mail, iOS Mail all render these
// reliably). Max width 600px, mobile-friendly.
function buildHtml({ firstName, buyerName, tournamentName, teams, totalSpent, totalWon, net, paidMethod, buyInDue }) {
  // Brand palette — F&H green ties to the course. Kept subtle for print.
  const brand = "#1f5c3a";
  const brandLight = "#e9f2ec";
  const ink = "#1a1a1a";
  const muted = "#5b5b5b";
  const border = "#e2e2e2";

  const teamRows = teams.map((t, i) => {
    const zebra = i % 2 === 1 ? "#fafafa" : "#ffffff";
    const won = Number(t.won) || 0;
    const wonCell = won > 0
      ? `<td align="right" style="padding:12px 14px;border-bottom:1px solid ${border};font:15px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand};font-weight:600;">+${esc(money(won))}</td>`
      : `<td align="right" style="padding:12px 14px;border-bottom:1px solid ${border};font:15px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${muted};">—</td>`;
    return `<tr style="background:${zebra};">
      <td style="padding:12px 14px;border-bottom:1px solid ${border};font:600 15px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand};white-space:nowrap;">${esc(t.tag || "—")}</td>
      <td style="padding:12px 14px;border-bottom:1px solid ${border};font:15px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ink};">${esc(t.team || "")}</td>
      <td align="right" style="padding:12px 14px;border-bottom:1px solid ${border};font:15px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ink};white-space:nowrap;">${esc(money(Number(t.amount) || 0))}</td>
      ${wonCell}
    </tr>`;
  }).join("");

  const netLabel = net > 0
    ? `<span style="color:${brand};font-weight:700;">+${esc(money(net))}</span> <span style="color:${muted};font-size:13px;">(payable to you)</span>`
    : net < 0
      ? `<span style="color:#8a1c1c;font-weight:700;">−${esc(money(-net))}</span> <span style="color:${muted};font-size:13px;">(balance to F&amp;H)</span>`
      : `<span style="color:${ink};font-weight:700;">Even</span>`;

  const statusBlock = paidMethod
    ? `<tr><td style="padding:20px 28px 4px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${brandLight};border:1px solid #cfe0d4;border-radius:8px;">
          <tr><td style="padding:16px 18px;font:15px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ink};">
            <strong style="color:${brand};">Paid in full via ${esc(paidMethod)}.</strong> You&rsquo;re all set — thank you!
          </td></tr>
        </table>
      </td></tr>`
    : buyInDue > 0
      ? `<tr><td style="padding:20px 28px 4px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff8e5;border:1px solid #f0d999;border-radius:8px;">
            <tr><td style="padding:16px 18px;font:15px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ink};">
              <div style="font-size:13px;color:${muted};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">Calcutta buy-in due</div>
              <div style="font-size:22px;font-weight:700;color:${ink};">${esc(money(buyInDue))}</div>
              <div style="font-size:13px;color:${muted};margin-top:6px;">Please make checks payable to F&amp;H Golf Course.</div>
            </td></tr>
          </table>
        </td></tr>`
      : "";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(tournamentName)} Calcutta receipt</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
      <tr>
        <td style="background:${brand};padding:28px 28px 22px 28px;">
          <div style="font:600 13px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#c7dbcf;text-transform:uppercase;letter-spacing:0.14em;">F&amp;H Golf Course</div>
          <div style="font:700 22px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:4px;">${esc(tournamentName)}</div>
          <div style="font:15px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#c7dbcf;margin-top:2px;">Calcutta receipt</div>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 28px 8px 28px;">
          <div style="font:700 30px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ink};line-height:1.2;">Thank you, ${esc(firstName)}!</div>
          <p style="font:16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ink};margin:14px 0 0 0;">
            Your buy-in on the ${esc(tournamentName)} Calcutta helps make this weekend what it is — and keeps the course in good shape for the next round. We&rsquo;re grateful.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px 6px 28px;">
          <div style="font:600 12px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${muted};text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">Teams you bought</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${border};border-radius:8px;overflow:hidden;">
            <thead>
              <tr style="background:#fafafa;">
                <th align="left" style="padding:10px 14px;font:600 12px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${muted};text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid ${border};">Team</th>
                <th align="left" style="padding:10px 14px;font:600 12px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${muted};text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid ${border};">Players</th>
                <th align="right" style="padding:10px 14px;font:600 12px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${muted};text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid ${border};">Bought</th>
                <th align="right" style="padding:10px 14px;font:600 12px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${muted};text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid ${border};">Won</th>
              </tr>
            </thead>
            <tbody>${teamRows}</tbody>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 28px 4px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td width="33%" align="center" style="padding:14px 8px;background:#fafafa;border-radius:8px 0 0 8px;border:1px solid ${border};border-right:none;">
                <div style="font:600 11px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${muted};text-transform:uppercase;letter-spacing:0.1em;">Total spent</div>
                <div style="font:700 20px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ink};margin-top:4px;">${esc(money(totalSpent))}</div>
              </td>
              <td width="33%" align="center" style="padding:14px 8px;background:#fafafa;border-top:1px solid ${border};border-bottom:1px solid ${border};">
                <div style="font:600 11px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${muted};text-transform:uppercase;letter-spacing:0.1em;">Total won</div>
                <div style="font:700 20px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ink};margin-top:4px;">${esc(money(totalWon))}</div>
              </td>
              <td width="34%" align="center" style="padding:14px 8px;background:#fafafa;border-radius:0 8px 8px 0;border:1px solid ${border};border-left:none;">
                <div style="font:600 11px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${muted};text-transform:uppercase;letter-spacing:0.1em;">Net</div>
                <div style="font:16px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin-top:6px;">${netLabel}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      ${statusBlock}
      <tr>
        <td style="padding:26px 28px 8px 28px;">
          <p style="font:16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ink};margin:0;">
            Thanks again, ${esc(firstName)} — really. It wouldn&rsquo;t be the same weekend without you.
          </p>
          <p style="font:16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ink};margin:10px 0 0 0;">
            See you at the course.
          </p>
          <p style="font:600 16px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand};margin:14px 0 0 0;">— The F&amp;H Golf Course crew</p>
        </td>
      </tr>
      <tr>
        <td style="padding:22px 28px 26px 28px;border-top:1px solid ${border};margin-top:12px;">
          <div style="font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${muted};line-height:1.55;">
            <strong style="color:${ink};">F&amp;H Golf Course</strong><br>
            <a href="tel:+19707746362" style="color:${brand};text-decoration:none;">(970) 774-6362</a> ·
            <a href="https://fandhgolf.com" style="color:${brand};text-decoration:none;">fandhgolf.com</a><br>
            Reply to this email to reach the clubhouse — <a href="mailto:clubhouse@fandhgolf.com" style="color:${brand};text-decoration:none;">clubhouse@fandhgolf.com</a>.
          </div>
        </td>
      </tr>
    </table>
    <div style="font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${muted};padding:14px 12px 0 12px;max-width:600px;text-align:center;">
      Receipt for the ${esc(buyerName)} Calcutta buy-in. Keep for your records.
    </div>
  </td></tr>
</table>
</body></html>`;
}

// ---- Thank-you + save-your-spot template ---------------------------------
// Sent when the operator commits the tournament to History. One email per
// player with an email on file. Copy is generic enough to work year over
// year — dates read "July 25, <nextYear>" and "August 1, <nextYear>" so
// no code changes are needed for the next tournament.

function buildThankYouSubject({ tournamentYear, tournamentName, nextYear, isFounders, apology }) {
  const base = isFounders
    ? "Thanks for playing the " + tournamentYear + " " + tournamentName + " — save your spot for " + nextYear
    : "Thanks for playing the " + tournamentYear + " " + tournamentName;
  return apology ? "[Corrected] " + base : base;
}

function buildThankYouText({ firstName, tournamentName, tournamentYear, nextYear, leaderboardUrl, signupUrl, isFounders, apology }) {
  const L = [];
  L.push(`Hi ${firstName},`);
  L.push("");
  if (apology) {
    L.push("A quick note first: an earlier email went out with the wrong");
    L.push(`tournament information. Please disregard that one — this is the`);
    L.push(`correct writeup for the ${tournamentYear} ${tournamentName}.`);
    L.push("Sorry for the confusion.");
    L.push("");
    L.push("— — —");
    L.push("");
  }
  L.push(`Thanks for coming out to play the ${tournamentYear} ${tournamentName} — it`);
  L.push("wouldn't have been the same without you.");
  L.push("");
  L.push("Final results are up on the leaderboard:");
  L.push(`  ${leaderboardUrl}`);
  L.push("");
  if (isFounders) {
    L.push(`SAVE YOUR SPOT FOR ${nextYear}`);
    L.push("");
    L.push("Signups are open now. Payment secures your slot, and slots fill up.");
    L.push("A few things to know:");
    L.push("");
    L.push(`  • Signup + payment deadline: July 25, ${nextYear}`);
    L.push("  • Signups and payments are taken in order — first-come, first-served.");
    L.push(`  • After August 1, ${nextYear}, paid participants take precedent over`);
    L.push("    unpaid entrants for any remaining spots.");
    L.push("");
    L.push("Reserve your spot:");
    L.push(`  ${signupUrl}`);
    L.push("");
  } else {
    L.push("Keep an eye on the tournaments page for what's next this season:");
    L.push(`  ${signupUrl}`);
    L.push("");
  }
  L.push("Thanks again for being part of it. See you at the next one.");
  L.push("");
  L.push("— The F&H Golf Course crew");
  L.push("F&H Golf Course");
  L.push("(970) 774-6362 · fandhgolf.com");
  return L.join("\n");
}

function buildThankYouHtml({ firstName, playerName, tournamentName, tournamentYear, nextYear, leaderboardUrl, signupUrl, isFounders, apology }) {
  const brand = "#1f5c3a";
  const brandDeep = "#12402a";
  const gold = "#c9a04b";
  const goldSoft = "#f6ecd4";
  const cream = "#f6f1e6";
  const ink = "#1a1a1a";
  const inkSoft = "#3d3d3d";
  const muted = "#6c6c6c";
  const line = "#e6e0d1";
  const serif = `Georgia, 'Times New Roman', serif`;
  const sans = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Thanks for playing the ${esc(String(tournamentYear))} ${esc(tournamentName)}</title>
</head>
<body style="margin:0;padding:0;background:${cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${cream};">
  ${esc(firstName)}, thanks for playing the ${esc(String(tournamentYear))} ${esc(tournamentName)}. ${isFounders ? `Save your spot for ${esc(String(nextYear))} — signups + payment due July 25.` : "See you at the next one."}
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${cream};">
  <tr><td align="center" style="padding:28px 12px 40px 12px;">
    <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 6px rgba(20,40,25,0.08);border:1px solid ${line};">
      <tr>
        <td style="background:${brand};background:linear-gradient(180deg,${brand} 0%,${brandDeep} 100%);padding:28px 32px 26px 32px;">
          <div style="font:600 12px ${sans};color:${gold};text-transform:uppercase;letter-spacing:0.22em;">F&amp;H Golf Course</div>
          <div style="font:italic 400 13px ${serif};color:#e8dfc6;margin-top:2px;letter-spacing:0.02em;">Est. 1961</div>
          <div style="font:400 22px ${serif};color:#ffffff;margin-top:14px;">${esc(String(tournamentYear))} ${esc(tournamentName)}</div>
          <div style="font:600 12px ${sans};color:${gold};margin-top:8px;text-transform:uppercase;letter-spacing:0.18em;">That&rsquo;s a wrap</div>
        </td>
      </tr>
      <tr><td style="background:${gold};height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>
      ${apology ? `<tr><td style="padding:20px 32px 0 32px;">
        <div style="background:#fff5f2;border:1px solid #f0bfae;border-left:4px solid #b3391c;border-radius:8px;padding:16px 18px;">
          <div style="font:700 12px ${sans};color:#b3391c;text-transform:uppercase;letter-spacing:0.14em;margin-bottom:6px;">A quick correction</div>
          <p style="font:15px/1.55 ${sans};color:${ink};margin:0;">
            An earlier email went out with the wrong tournament information. Please disregard that one &mdash; <b>this</b> is the correct writeup for the ${esc(String(tournamentYear))} ${esc(tournamentName)}. Sorry for the confusion.
          </p>
        </div>
      </td></tr>` : ""}
      <tr>
        <td style="padding:36px 32px 6px 32px;">
          <h1 style="font:400 32px/1.15 ${serif};color:${ink};margin:0 0 12px 0;letter-spacing:-0.005em;">Thanks for playing, ${esc(firstName)}.</h1>
          <p style="font:16px/1.65 ${sans};color:${inkSoft};margin:0;">
            The ${esc(String(tournamentYear))} ${esc(tournamentName)} is one for the books. Thank you for making the trip out, for the good golf, and for the good company — it wouldn&rsquo;t have been the same without you.
          </p>
        </td>
      </tr>
      <tr><td style="padding:26px 32px 6px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${cream};border:1px solid ${line};border-radius:10px;">
          <tr><td style="padding:22px 24px;">
            <div style="font:600 11px ${sans};color:${muted};text-transform:uppercase;letter-spacing:0.14em;margin-bottom:6px;">Final results</div>
            <div style="font:400 18px/1.4 ${serif};color:${ink};margin-bottom:14px;">See where you finished on the live leaderboard.</div>
            <a href="${esc(leaderboardUrl)}" style="display:inline-block;background:${brand};color:#ffffff;text-decoration:none;font:600 14px ${sans};padding:12px 22px;border-radius:8px;letter-spacing:0.01em;">See the final leaderboard &rarr;</a>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:28px 32px 8px 32px;">
        <div style="font:600 11px ${sans};color:${gold};text-transform:uppercase;letter-spacing:0.16em;margin-bottom:8px;">Save your spot for ${esc(String(nextYear))}</div>
        <h2 style="font:400 26px/1.2 ${serif};color:${ink};margin:0 0 12px 0;">${isFounders ? "Come back next August." : `Reserve your ${esc(String(nextYear))} spot now.`}</h2>
        <p style="font:16px/1.65 ${sans};color:${inkSoft};margin:0 0 14px 0;">
          ${isFounders
            ? "Signups are open now. Payment secures your slot, and slots fill up. A few things to know:"
            : `Reserve your team for the ${esc(String(nextYear))} ${esc(tournamentName)}. Signups + payment are collected in order — first-come, first-served — and paid entries hold the field ahead of unpaid ones.`}
        </p>
        ${isFounders ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${goldSoft};border:1px solid #e5d8ac;border-radius:10px;">
          <tr><td style="padding:18px 22px;">
            <ul style="margin:0;padding:0;list-style:none;font:15px/1.7 ${sans};color:${ink};">
              <li style="padding:4px 0;"><b style="color:${brand};">Signup + payment deadline:</b> July 25, ${esc(String(nextYear))}</li>
              <li style="padding:4px 0;"><b style="color:${brand};">Order:</b> Signups and payments are taken in order — first-come, first-served.</li>
              <li style="padding:4px 0;"><b style="color:${brand};">After August 1, ${esc(String(nextYear))}:</b> Paid participants take precedent over unpaid entrants for any remaining spots.</li>
              <li style="padding:4px 0;font-size:13px;color:${muted};padding-top:8px;">These same dates apply every year, so it&rsquo;s easy to plan around.</li>
            </ul>
          </td></tr>
        </table>` : ""}
      </td></tr>

      <tr><td style="padding:22px 32px 8px 32px;" align="center">
        <a href="${esc(signupUrl)}" style="display:inline-block;background:${brand};color:#ffffff;text-decoration:none;font:700 16px ${sans};padding:14px 30px;border-radius:8px;letter-spacing:0.01em;">Reserve my spot for ${esc(String(nextYear))} &rarr;</a>
      </td></tr>

      <tr><td style="padding:22px 32px 6px 32px;">
        <p style="font:15px/1.65 ${sans};color:${inkSoft};margin:0;">
          Keep an eye on your inbox and on <a href="https://fandhgolf.com" style="color:${brand};text-decoration:none;">fandhgolf.com</a> — we&rsquo;ll post pairings, format notes, and any changes as they come together.
        </p>
      </td></tr>

      <tr><td style="padding:22px 32px 8px 32px;">
        <p style="font:16px/1.65 ${sans};color:${inkSoft};margin:0;">
          Thanks again for being part of it. See you next year.
        </p>
        <p style="font:400 18px ${serif};color:${brand};margin:16px 0 0 0;font-style:italic;">— The F&amp;H Golf Course crew</p>
      </td></tr>

      <tr><td style="padding:22px 32px 30px 32px;border-top:1px solid ${line};">
        <div style="font:13px/1.6 ${sans};color:${muted};">
          <strong style="color:${ink};font:600 13px ${sans};">F&amp;H Golf Course</strong><br>
          <a href="tel:+19707746362" style="color:${brand};text-decoration:none;">(970) 774-6362</a> · <a href="https://fandhgolf.com" style="color:${brand};text-decoration:none;">fandhgolf.com</a><br>
          Reply to this email to reach the clubhouse — <a href="mailto:clubhouse@fandhgolf.com" style="color:${brand};text-decoration:none;">clubhouse@fandhgolf.com</a>.
        </div>
      </td></tr>
    </table>
    <div style="max-width:620px;font:12px ${sans};color:${muted};padding:14px 12px 0 12px;text-align:center;">Sent to ${esc(playerName)}</div>
  </td></tr>
</table>
</body></html>`;
}

// ---- Invite template (pre-tournament reminder + signup CTA) --------
// Standard F&H deadlines are baked in — payment 7 days out, unpaid
// replacements, 72-hour no-refund window. Tournament date + format
// come from the caller so every event gets its own copy.
function buildInviteSubject({ tournamentYear, tournamentName, tournamentDate }) {
  const suffix = tournamentDate ? " — " + tournamentDate : "";
  return "You're invited: " + tournamentYear + " " + tournamentName + suffix;
}

function buildInviteText({ firstName, tournamentName, tournamentYear, tournamentDate, format, signupUrl }) {
  const L = [];
  L.push(`Hi ${firstName},`);
  L.push("");
  L.push(`Signups are open for the ${tournamentYear} ${tournamentName}${tournamentDate ? " on " + tournamentDate : ""}.`);
  if (format) L.push(`Format: ${format}.`);
  L.push("");
  L.push("Reserve your spot:");
  L.push(`  ${signupUrl}`);
  L.push("");
  L.push("A few things to know before you sign up:");
  L.push("");
  L.push("  • Payment is required no later than 7 days before the tournament.");
  L.push("  • Any team not paid by that deadline will be replaced by a paying team.");
  L.push("  • No refunds within 72 hours of the tournament.");
  L.push("  • Signups are first-come, first-served — paid entries hold the field.");
  L.push("");
  L.push("Reply to this email with any questions.");
  L.push("");
  L.push("— The F&H Golf Course crew");
  L.push("F&H Golf Course");
  L.push("(970) 774-6362 · fandhgolf.com");
  return L.join("\n");
}

function buildInviteHtml({ firstName, playerName, tournamentName, tournamentYear, tournamentDate, format, signupUrl }) {
  const brand = "#1f5c3a";
  const brandDeep = "#12402a";
  const gold = "#c9a04b";
  const goldSoft = "#f6ecd4";
  const cream = "#f6f1e6";
  const ink = "#1a1a1a";
  const inkSoft = "#3d3d3d";
  const muted = "#6c6c6c";
  const line = "#e6e0d1";
  const serif = `Georgia, 'Times New Roman', serif`;
  const sans = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>You're invited: ${esc(String(tournamentYear))} ${esc(tournamentName)}</title>
</head>
<body style="margin:0;padding:0;background:${cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${cream};">
  ${esc(firstName)}, signups are open for the ${esc(String(tournamentYear))} ${esc(tournamentName)}. Payment due 7 days before the tournament.
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${cream};">
  <tr><td align="center" style="padding:28px 12px 40px 12px;">
    <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 6px rgba(20,40,25,0.08);border:1px solid ${line};">
      <tr>
        <td style="background:${brand};background:linear-gradient(180deg,${brand} 0%,${brandDeep} 100%);padding:28px 32px 26px 32px;">
          <div style="font:600 12px ${sans};color:${gold};text-transform:uppercase;letter-spacing:0.22em;">F&amp;H Golf Course</div>
          <div style="font:italic 400 13px ${serif};color:#e8dfc6;margin-top:2px;letter-spacing:0.02em;">Est. 1961</div>
          <div style="font:400 22px ${serif};color:#ffffff;margin-top:14px;">${esc(String(tournamentYear))} ${esc(tournamentName)}</div>
          <div style="font:600 12px ${sans};color:${gold};margin-top:8px;text-transform:uppercase;letter-spacing:0.18em;">Signups are open</div>
        </td>
      </tr>
      <tr><td style="background:${gold};height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>
      <tr>
        <td style="padding:36px 32px 6px 32px;">
          <h1 style="font:400 30px/1.15 ${serif};color:${ink};margin:0 0 12px 0;letter-spacing:-0.005em;">You're invited, ${esc(firstName)}.</h1>
          <p style="font:16px/1.65 ${sans};color:${inkSoft};margin:0;">
            Reserve your spot for the ${esc(String(tournamentYear))} ${esc(tournamentName)}${tournamentDate ? ` on <b>${esc(tournamentDate)}</b>` : ""}${format ? ` &mdash; ${esc(format)}` : ""}.
          </p>
        </td>
      </tr>

      <tr><td style="padding:26px 32px 8px 32px;" align="center">
        <a href="${esc(signupUrl)}" style="display:inline-block;background:${brand};color:#ffffff;text-decoration:none;font:700 16px ${sans};padding:14px 30px;border-radius:8px;letter-spacing:0.01em;">Reserve my spot &rarr;</a>
      </td></tr>

      <tr><td style="padding:22px 32px 8px 32px;">
        <div style="font:600 11px ${sans};color:${gold};text-transform:uppercase;letter-spacing:0.16em;margin-bottom:6px;">Before you sign up</div>
        <h2 style="font:400 22px/1.2 ${serif};color:${ink};margin:0 0 12px 0;">Deadlines to know.</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${goldSoft};border:1px solid #e5d8ac;border-radius:10px;">
          <tr><td style="padding:16px 20px;">
            <ul style="margin:0;padding:0;list-style:none;font:15px/1.7 ${sans};color:${ink};">
              <li style="padding:4px 0;"><b style="color:${brand};">Payment due:</b> no later than <b>7 days before</b> the tournament.</li>
              <li style="padding:4px 0;"><b style="color:${brand};">Unpaid teams:</b> any team not paid by that deadline is replaced by a paying team.</li>
              <li style="padding:4px 0;"><b style="color:${brand};">No refunds:</b> within <b>72 hours</b> of the tournament.</li>
              <li style="padding:4px 0;"><b style="color:${brand};">Order:</b> first-come, first-served — paid entries hold the field.</li>
            </ul>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:22px 32px 6px 32px;">
        <p style="font:15px/1.65 ${sans};color:${inkSoft};margin:0;">
          Reply to this email with any questions &mdash; we're happy to help. Reserve early to lock in your team.
        </p>
      </td></tr>

      <tr><td style="padding:22px 32px 8px 32px;">
        <p style="font:400 18px ${serif};color:${brand};margin:0;font-style:italic;">&mdash; The F&amp;H Golf Course crew</p>
      </td></tr>

      <tr><td style="padding:22px 32px 30px 32px;border-top:1px solid ${line};">
        <div style="font:13px/1.6 ${sans};color:${muted};">
          <strong style="color:${ink};font:600 13px ${sans};">F&amp;H Golf Course</strong><br>
          <a href="tel:+19707746362" style="color:${brand};text-decoration:none;">(970) 774-6362</a> &middot; <a href="https://fandhgolf.com" style="color:${brand};text-decoration:none;">fandhgolf.com</a><br>
          Reply to this email to reach the clubhouse &mdash; <a href="mailto:clubhouse@fandhgolf.com" style="color:${brand};text-decoration:none;">clubhouse@fandhgolf.com</a>.
        </div>
      </td></tr>
    </table>
    <div style="max-width:620px;font:12px ${sans};color:${muted};padding:14px 12px 0 12px;text-align:center;">Sent to ${esc(playerName)}</div>
  </td></tr>
</table>
</body></html>`;
}
