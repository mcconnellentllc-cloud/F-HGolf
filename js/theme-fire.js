/* F&H Golf Course — Haxtun Fire Dept tournament theme.
   Self-contained module: any public page that includes this script picks
   up the fire theme when the URL's `?t=` param matches Haxtun Fire. On
   every other tournament (or when there's no `?t=` at all) the script
   silently does nothing — no theme class, no injected DOM, no CSS.

   How it works:
   1. Parse ?t= as early as possible so we can flip the class before the
      first paint (no flash of default styling).
   2. Add `theme-fire` to <html> immediately (since <body> may not exist
      yet on head-loaded scripts). At DOMContentLoaded we mirror it onto
      <body> too so existing `body.theme-fire` selectors still hit.
   3. Inject a single <style> block with the red / black / white palette
      overrides. Everything is scoped under `.theme-fire` so it can't
      leak to other pages. The palette overrides existing CSS variables
      (--bg, --gold, etc.) already used by every public page.
   4. Inject an inline <svg><symbol id="fireBadge"> so any page can drop
      <svg class="fire-badge"><use href="#fireBadge"></use></svg> and get
      a maltese-cross fire badge without loading an image asset.
   5. Optionally inject the "Supporting Our Local Heroes" strip below
      the page's hero — controlled by the caller with `data-fire-strip`
      on a container element, or via FH_FIRE.injectStrip(el).

   Public API on window.FH_FIRE:
     · isFire  — boolean flag exposed for pages that want to branch
                 rendering (e.g. skip certain sections on non-Fire).
     · injectStrip(anchor, opts) — insert the tagline strip AFTER anchor.
                 Opts: { label: "…", side: "before"|"after" (default) }.
     · badge()  — returns the SVG markup string for a badge chip. */
(function () {
  var isFire = false;
  try {
    var p = new URLSearchParams(location.search);
    var t = p.get("t") || "";
    isFire = /^\s*haxtun\s*fire/i.test(t);
  } catch (e) {}

  // Bail out early on non-Fire — the module is a pure no-op then.
  if (!isFire) { window.FH_FIRE = { isFire: false, injectStrip: function () {}, badge: function () { return ""; } }; return; }

  // Flip the class immediately so palette overrides paint on first frame.
  try { document.documentElement.classList.add("theme-fire"); } catch (e) {}
  function ensureBodyClass() {
    if (document.body) document.body.classList.add("theme-fire");
    else document.addEventListener("DOMContentLoaded", ensureBodyClass);
  }
  ensureBodyClass();

  // Palette + shared theme rules. Scoped under .theme-fire so a page
  // that lives on the same origin (e.g. share screenshots inline) can't
  // accidentally pick up the styles. Uses existing CSS vars each page
  // already declares — the override wins because it's declared LATER
  // and has a class-scoped selector one specificity above :root.
  var CSS = ""
    // Palette overrides scoped to `.disp` (the wrapper on every public
    // dark-themed page: leaderboard, recap, tournament-rules, auction).
    // Previously these lived on `.theme-fire { ... }` at the root, which
    // cascaded --ink=#fff / --gold=#fff / --muted=rgba(255,255,255,...)
    // into the workbook body too — where the background is CREAM, so
    // every tab label / table row went white-on-cream and became
    // unreadable. Scoping to .disp keeps the palette flip on the pages
    // that need it and leaves the workbook's normal readable colors.
    // The fire-* vars stay in case anything reads them; they're safe
    // to broadcast because no page uses them as text/background pairs.
    + ".theme-fire { --fire-red: #c8102e; --fire-red-deep: #7a0a1a; }"
    + "body.theme-fire .disp {"
    +   "--bg: #0a0a0a;"
    +   "--bg-2: #1a0505;"
    +   "--panel: rgba(255,255,255,0.05);"
    +   "--line: rgba(255,255,255,0.18);"
    +   "--gold: #ffffff;"
    +   "--ink: #ffffff;"
    +   "--muted: rgba(255,255,255,0.65);"
    +   "--red: #c8102e;"
    +   "--red-deep: #7a0a1a;"
    + "}"
    // Public-page body background — only when .disp is actually in the
    // page (public dark theme). Workbook has no .disp, so it keeps its
    // cream background and readable text.
    + "body.theme-fire:has(.disp) { background: radial-gradient(ellipse at top, #2a0a0a 0%, #0a0a0a 65%); }"

    // Shared hero patterns across recap / rules / leaderboard.
    + "body.theme-fire .disp__hero { background: linear-gradient(180deg, #000 0%, #1a0000 100%) !important; border-bottom: 4px solid #c8102e !important; box-shadow: 0 4px 0 #000, 0 5px 0 #c8102e !important; }"
    + "body.theme-fire .disp__logo { box-shadow: 0 0 0 3px #000, 0 0 0 6px #c8102e !important; }"
    + "body.theme-fire .disp__eyebrow { color: #c8102e !important; display: inline-flex; align-items: center; justify-content: center; gap: 0.75rem; }"
    + "body.theme-fire .disp__title { color: #fff !important; text-shadow: 0 2px 0 #7a0a1a; }"
    + "body.theme-fire .disp__sub { color: rgba(255,255,255,0.85) !important; }"

    + "body.theme-fire .disp__nav { background: #000 !important; border-bottom: 1px solid #7a0a1a !important; }"
    + "body.theme-fire .disp__nav a { background: rgba(200,16,46,0.08) !important; border-color: rgba(200,16,46,0.4) !important; color: #fff !important; }"
    + "body.theme-fire .disp__nav a:hover, body.theme-fire .disp__nav a:focus-visible { background: #c8102e !important; color: #fff !important; border-color: #c8102e !important; }"
    + "body.theme-fire .disp__nav a.is-here { background: rgba(200,16,46,0.28) !important; color: #fff !important; border-color: #c8102e !important; }"

    // Recap page — restyle the article body typography for the theme.
    + "body.theme-fire .recap h1, body.theme-fire .rules h1 { color: #c8102e !important; }"
    + "body.theme-fire .recap h2, body.theme-fire .rules h2, body.theme-fire .rules h4 { color: #fff !important; border-bottom-color: rgba(200,16,46,0.35) !important; }"
    + "body.theme-fire .recap b, body.theme-fire .recap strong, body.theme-fire .rules b, body.theme-fire .rules strong { color: #c8102e !important; }"
    + "body.theme-fire .recap a, body.theme-fire .rules a { color: #c8102e !important; }"
    + "body.theme-fire .recap ul li::before, body.theme-fire .rules li::before { color: #c8102e !important; }"

    // Donor wall — red left border on tiles so the sponsors read Fire-themed.
    + "body.theme-fire .donors__title { color: #c8102e !important; }"
    + "body.theme-fire .donor { border-left: 4px solid #c8102e !important; }"
    + "body.theme-fire .donor__logo--empty { background: #c8102e !important; color: #fff !important; }"

    // Maltese-cross badge (paint colors + sizing) — used both in the
    // eyebrow and in the standalone strip.
    + ".fire-badge { display: inline-block; width: 1.6em; height: 1.6em; vertical-align: middle; flex-shrink: 0; }"
    + ".fire-badge__cross { fill: #c8102e; stroke: #000; stroke-width: 4; }"
    + ".fire-badge__inner { fill: #000; }"
    + ".fire-badge__glyph { fill: #fff; font-family: Fraunces, Georgia, serif; font-weight: 800; font-size: 30px; text-anchor: middle; }"

    // Standalone strip inserted by injectStrip().
    + ".fire-strip { display: flex; align-items: center; justify-content: center; gap: 0.6rem; padding: 0.85rem 1rem 0.35rem; color: #c8102e; letter-spacing: 0.28em; text-transform: uppercase; font: 800 clamp(0.72rem, 1.05vw, 0.9rem)/1.1 -apple-system, 'Segoe UI', Roboto, sans-serif; text-align: center; }"
    + ".fire-strip::before, .fire-strip::after { content: ''; flex: 1 1 auto; max-width: 12rem; height: 3px; background: linear-gradient(90deg, transparent, #c8102e 30%, #c8102e 70%, transparent); border-radius: 2px; }"
    + ".fire-strip .fire-badge { width: 1.9em; height: 1.9em; }"

    // Dedication box — highlighted panel on the recap page that honors
    // the department. Renders whenever an ancestor has `data-fire-note`
    // or a page inserts .fire-dedication directly.
    + ".fire-dedication { max-width: 60rem; margin: 1.5rem auto 0; padding: 1.35rem 1.4rem; border: 1px solid rgba(200,16,46,0.5); border-left: 4px solid #c8102e; border-radius: 12px; background: rgba(200,16,46,0.05); color: #fff; text-align: center; }"
    + ".fire-dedication__eyebrow { color: #c8102e; font-weight: 800; letter-spacing: 0.35em; text-transform: uppercase; font-size: 0.78rem; margin-bottom: 0.4rem; }"
    + ".fire-dedication__body { font-family: Fraunces, Georgia, serif; font-style: italic; font-size: 1.1rem; line-height: 1.45; color: rgba(255,255,255,0.92); }"
    + ".fire-dedication__badge { display: flex; gap: 0.5rem; justify-content: center; margin-top: 0.9rem; }"

    // ---- Workbook (tournament-admin.html) — light theming so staff
    // running the event can tell at a glance that this workbook is the
    // Fire tournament, without touching the mostly-green admin UI. -----
    + "body.theme-fire .hero { position: relative; }"
    + "body.theme-fire .hero::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 6px; background: linear-gradient(90deg, #7a0a1a 0%, #c8102e 50%, #7a0a1a 100%); }"
    + "body.theme-fire .hero__kicker { color: #c8102e !important; }"
    + "body.theme-fire .wb-tab.is-active { border-bottom-color: #c8102e !important; color: #7a0a1a !important; }"

    // ---- Pin Prize print cards — add a Fire badge next to the F&H
    // logo on every card so the stakes stuck at each hole read Fire
    // Dept, and switch the "SUPPORTING OUR LOCAL HEROES" tagline into
    // the rail line for the card. Existing red top-bar already matches. -
    + "body.theme-fire .pcard__rail { color: #7a0a1a; font-weight: 700; }"
    + "body.theme-fire .pcard__rail::after { content: ' \\00a0\\2022 \\00a0 SUPPORTING OUR LOCAL HEROES'; color: #c8102e; font-weight: 800; letter-spacing: 0.1em; }"
    + "body.theme-fire .pcard { border-top-color: #c8102e !important; }"
    ;

  function inject() {
    if (document.getElementById("fh-fire-styles")) return;
    var head = document.head || document.getElementsByTagName("head")[0];
    if (!head) { document.addEventListener("DOMContentLoaded", inject); return; }
    var st = document.createElement("style");
    st.id = "fh-fire-styles";
    st.appendChild(document.createTextNode(CSS));
    head.appendChild(st);
    // SVG symbol lives in <body>. If body isn't ready yet, defer.
    function injectSymbol() {
      if (document.getElementById("fh-fire-symbol")) return;
      if (!document.body) { document.addEventListener("DOMContentLoaded", injectSymbol); return; }
      var svg = document.createElement("div");
      svg.id = "fh-fire-symbol";
      svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
      svg.innerHTML = ''
        + '<svg aria-hidden="true" focusable="false" width="0" height="0">'
        +   '<defs>'
        +     '<symbol id="fireBadge" viewBox="0 0 100 100">'
        // Proper 4-armed Volunteer Fire Department Maltese cross with a
        // helmet silhouette (dome + brim) in the center medallion, in
        // place of the earlier "H" glyph.
        +       '<path class="fire-badge__cross" d="M40 40 L30 5 L50 20 L70 5 L60 40 L95 30 L80 50 L95 70 L60 60 L70 95 L50 80 L30 95 L40 60 L5 70 L20 50 L5 30 Z" />'
        +       '<circle class="fire-badge__inner" cx="50" cy="50" r="16" />'
        +       '<path class="fire-badge__glyph" d="M40 55 Q40 42 50 42 Q60 42 60 55 Z M35 55 L65 55 L65 60 L35 60 Z" />'
        +     '</symbol>'
        +   '</defs>'
        + '</svg>';
      document.body.insertBefore(svg, document.body.firstChild);
    }
    injectSymbol();
  }
  inject();

  function badge() { return '<svg class="fire-badge" aria-hidden="true"><use href="#fireBadge" /></svg>'; }

  function injectStrip(anchor, opts) {
    if (!anchor || !anchor.parentNode) return;
    opts = opts || {};
    var label = opts.label || "Haxtun’s Volunteer Firefighters · Haxtun, Colorado";
    var strip = document.createElement("div");
    strip.className = "fire-strip";
    strip.setAttribute("aria-hidden", "true");
    strip.innerHTML = badge() + '<span>' + String(label).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }) + '</span>' + badge();
    if (opts.side === "before") anchor.parentNode.insertBefore(strip, anchor);
    else if (anchor.nextSibling) anchor.parentNode.insertBefore(strip, anchor.nextSibling);
    else anchor.parentNode.appendChild(strip);
    return strip;
  }

  function injectDedication(anchor, opts) {
    if (!anchor || !anchor.parentNode) return;
    opts = opts || {};
    var body = opts.body
      || "Haxtun is a small town with a big heart, and its Volunteer Fire Department is proof of it &mdash; neighbors who leave dinner, sleep, or the shop to answer the call whenever it comes. Today's play, every dollar raised, and every prize handed out honors that service.";
    var box = document.createElement("aside");
    box.className = "fire-dedication";
    box.innerHTML = ''
      + '<div class="fire-dedication__eyebrow">In Honor of the Haxtun Volunteer Fire Department</div>'
      + '<div class="fire-dedication__body">' + body + '</div>'
      + '<div class="fire-dedication__badge">' + badge() + badge() + badge() + '</div>';
    if (opts.side === "before") anchor.parentNode.insertBefore(box, anchor);
    else if (anchor.nextSibling) anchor.parentNode.insertBefore(box, anchor.nextSibling);
    else anchor.parentNode.appendChild(box);
    return box;
  }

  window.FH_FIRE = { isFire: true, badge: badge, injectStrip: injectStrip, injectDedication: injectDedication };

  // Auto-inject the "Supporting Our Local Heroes" strip right after the
  // most obvious page hero, so pages that just include the script get a
  // baseline theme without any extra wiring. Pages that want custom
  // placement can call FH_FIRE.injectStrip() themselves and set
  // data-fire-strip="skip" on <html> or <body> to opt out of the auto.
  function autoInsert() {
    if (!document.body) { document.addEventListener("DOMContentLoaded", autoInsert); return; }
    var opt = document.body.getAttribute("data-fire-strip") || document.documentElement.getAttribute("data-fire-strip");
    if (opt === "skip") return;
    var anchor = document.querySelector(".disp__nav, .disp__hero, .hero");
    if (anchor && !document.querySelector(".fire-strip")) injectStrip(anchor);
  }
  autoInsert();
})();
