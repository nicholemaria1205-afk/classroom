/* ==========================================================================
   Doodle Desk — shared site behaviour
   Progressive enhancement only: every page reads fine with JS switched off.
   ========================================================================== */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- Theme (light / dark), remembered between visits ------------------ */
  var THEME_KEY = "doodle-theme";

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      btn.textContent = theme === "dark" ? "☀️" : "🌙";
      btn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    });
  }

  function storedTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (e) {
      return null;
    }
  }

  var startTheme = storedTheme();
  if (!startTheme) {
    startTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  applyTheme(startTheme);

  document.addEventListener("click", function (e) {
    var toggle = e.target.closest("[data-theme-toggle]");
    if (!toggle) return;
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (err) {
      /* private browsing — the choice just won't stick */
    }
  });

  /* ---- Mobile navigation ------------------------------------------------ */
  var burger = document.querySelector("[data-burger]");
  var navLinks = document.getElementById("nav-links");

  if (burger && navLinks) {
    burger.addEventListener("click", function () {
      var open = navLinks.getAttribute("data-open") === "true";
      navLinks.setAttribute("data-open", String(!open));
      burger.setAttribute("aria-expanded", String(!open));
      burger.textContent = open ? "☰" : "✕";
    });

    navLinks.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        navLinks.setAttribute("data-open", "false");
        burger.setAttribute("aria-expanded", "false");
        burger.textContent = "☰";
      }
    });
  }

  /* ---- Reveal-on-scroll ------------------------------------------------- */
  var revealables = document.querySelectorAll(".reveal");

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealables.forEach(function (el) { el.setAttribute("data-seen", "true"); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.setAttribute("data-seen", "true");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -60px 0px" });

    revealables.forEach(function (el, i) {
      el.style.transitionDelay = (i % 4) * 70 + "ms";
      observer.observe(el);
    });
  }

  /* ---- Confetti --------------------------------------------------------- */
  var CONFETTI_COLOURS = ["#7c3aed", "#ff4d9d", "#ffc93c", "#16c79a", "#38bdf8", "#ff7a5c"];

  window.doodleConfetti = function (count) {
    if (reduceMotion) return;
    var n = count || 70;
    var frag = document.createDocumentFragment();

    for (var i = 0; i < n; i++) {
      var bit = document.createElement("span");
      bit.className = "confetti-bit";
      bit.style.left = Math.random() * 100 + "vw";
      bit.style.background = CONFETTI_COLOURS[i % CONFETTI_COLOURS.length];
      bit.style.animationDuration = 2.2 + Math.random() * 1.8 + "s";
      bit.style.animationDelay = Math.random() * 0.5 + "s";
      if (i % 3 === 0) bit.style.borderRadius = "50%";
      frag.appendChild(bit);
      (function (node) {
        node.addEventListener("animationend", function () { node.remove(); });
      })(bit);
    }
    document.body.appendChild(frag);
  };

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-confetti]")) window.doodleConfetti(90);
  });

  /* ---- Hero board doodles ----------------------------------------------- */
  /* Cycles the little emoji on the fake student boards so the hero feels
     like a room where something is actually happening. */
  var boards = document.querySelectorAll("[data-board-cycle] .board span");
  if (boards.length && !reduceMotion) {
    var DOODLES = ["✏️", "🔢", "🌍", "🧪", "🎨", "📐", "🎵", "⭐", "🦖", "🍎", "🚀", "💡"];
    setInterval(function () {
      var target = boards[Math.floor(Math.random() * boards.length)];
      target.textContent = DOODLES[Math.floor(Math.random() * DOODLES.length)];
      target.style.animation = "none";
      void target.offsetWidth; /* restart the pop-in */
      target.style.animation = "";
    }, 1400);
  }

  /* ---- Toast ------------------------------------------------------------ */
  var toastTimer;
  window.doodleToast = function (message, tone) {
    var el = document.querySelector("[data-toast]");
    if (!el) return;
    el.textContent = message;
    el.style.background = tone === "warn" ? "var(--sunny)" : tone === "bad" ? "var(--coral)" : "var(--mint)";
    el.setAttribute("data-show", "true");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.setAttribute("data-show", "false"); }, 2600);
  };

  /* ---- Footer year & newsletter ----------------------------------------- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  document.querySelectorAll("[data-newsletter]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = form.querySelector("input[type=email]");
      var msg = form.parentElement.querySelector("[data-newsletter-msg]");
      if (!input.value || input.validity.typeMismatch) {
        if (msg) msg.textContent = "That email looks a bit wonky — try again?";
        return;
      }
      if (msg) msg.textContent = "You're on the list! Check your inbox for a hello. 👋";
      form.reset();
      window.doodleConfetti(40);
    });
  });
})();
