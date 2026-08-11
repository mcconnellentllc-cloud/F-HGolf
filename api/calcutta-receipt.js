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

  const { RESEND_API_KEY, ADMIN_KEY } = process.env;
  if (!ADMIN_KEY || (req.headers["x-admin-key"] || "") !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  if (!RESEND_API_KEY) {
    return res.status(500).json({ ok: false, error: "Email sending is not configured (RESEND_API_KEY missing)." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const to = String(body.to || "").trim();
  const buyerName = String(body.buyerName || "").trim();
  const tournamentName = String(body.tournamentName || "2026 F&H Founders Tournament").trim();
  const teams = Array.isArray(body.teams) ? body.teams : [];
  const totalSpent = Number(body.totalSpent) || 0;
  const totalWon = Number(body.totalWon) || 0;
  const paidMethod = body.paidMethod ? String(body.paidMethod) : "";
  const buyInDue = Number(body.buyInDue) || 0;
  const preview = !!body.preview;

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

  if (preview) {
    return res.status(200).json({ ok: true, subject, html, text });
  }

  const from = process.env.RESEND_FROM_CALCUTTA || "F&H Golf Course <clubhouse@fandhgolf.com>";
  const replyTo = process.env.RESEND_REPLY_TO_CALCUTTA || "clubhouse@fandhgolf.com";

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject, html, text }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error("resend calcutta send failed", r.status, detail);
      return res.status(502).json({ ok: false, error: "Email service refused the send. Try again in a minute." });
    }
    const j = await r.json().catch(() => ({}));
    return res.status(200).json({ ok: true, id: j.id || null });
  } catch (e) {
    console.error("calcutta-receipt error", e);
    return res.status(500).json({ ok: false, error: "Something went wrong sending the receipt." });
  }
};

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
  lines.push("F&H Golf Course · Fleming, Colorado");
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
          <div style="font:600 13px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#c7dbcf;text-transform:uppercase;letter-spacing:0.14em;">F&amp;H Golf Course · Fleming, CO</div>
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
            <strong style="color:${ink};">F&amp;H Golf Course</strong> · Fleming, Colorado<br>
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
