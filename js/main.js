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
});
