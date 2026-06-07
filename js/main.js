/* ============================================================
   F&H Golf Course — main.js
   - Mobile hamburger toggle
   - Smooth-scroll on nav clicks (with fallback) + close menu
   ============================================================ */

document.addEventListener("DOMContentLoaded", function () {
  var toggle = document.getElementById("navToggle");
  var links = document.getElementById("navLinks");

  // ---- Hamburger toggle ----
  function setMenu(open) {
    links.classList.toggle("is-open", open);
    toggle.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  toggle.addEventListener("click", function () {
    var isOpen = links.classList.contains("is-open");
    setMenu(!isOpen);
  });

  // ---- Smooth scroll + close menu on link click ----
  var navAnchors = links.querySelectorAll('a[href^="#"]');
  navAnchors.forEach(function (anchor) {
    anchor.addEventListener("click", function (e) {
      var targetId = anchor.getAttribute("href");
      var target = document.querySelector(targetId);

      if (target) {
        e.preventDefault();
        // Native smooth scroll (scroll-padding-top in CSS offsets the sticky nav)
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        history.pushState(null, "", targetId);
      }

      // Close the mobile menu after a selection
      setMenu(false);
    });
  });

  // ---- Nav elevation on scroll ----
  var nav = document.querySelector(".nav");
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // ---- Facebook Page Plugin (optional enhancement, fails silently) ----
  // Only runs on pages that actually contain the plugin markup, so the SDK
  // is never loaded elsewhere (e.g. story.html). The live feed stays hidden
  // unless a real iframe mounts with a sensible height within a few seconds.
  var fbPage = document.querySelector(".fb-page");
  var feed = document.getElementById("fbFeed");
  if (fbPage && feed) {
    if (!document.getElementById("fb-root")) {
      var root = document.createElement("div");
      root.id = "fb-root";
      document.body.insertBefore(root, document.body.firstChild);
    }

    var revealed = false;
    function revealFeedIfRendered() {
      if (revealed) return;
      var iframe = fbPage.querySelector("iframe");
      if (iframe && iframe.offsetHeight > 120) {
        feed.classList.add("is-ready");
        feed.setAttribute("aria-hidden", "false");
        revealed = true;
      }
    }

    window.fbAsyncInit = function () {
      try {
        FB.init({ xfbml: true, version: "v19.0" });
        FB.Event.subscribe("xfbml.render", revealFeedIfRendered);
      } catch (e) { /* leave feed hidden */ }
    };

    // Load the SDK asynchronously so it never blocks the page.
    (function (d, s, id) {
      if (d.getElementById(id)) return;
      var js = d.createElement(s);
      js.id = id; js.async = true; js.defer = true;
      js.src = "https://connect.facebook.net/en_US/sdk.js";
      var fjs = d.getElementsByTagName(s)[0];
      fjs.parentNode.insertBefore(js, fjs);
    })(document, "script", "facebook-jssdk");

    // Bounded polling fallback (~4s). If nothing valid mounts, stay hidden.
    var tries = 0;
    var poll = setInterval(function () {
      tries++;
      revealFeedIfRendered();
      if (revealed || tries >= 8) clearInterval(poll);
    }, 500);
  }
});
