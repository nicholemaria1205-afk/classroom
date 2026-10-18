/* ==========================================================================
   Doodle Desk — the teacher's side menu
   Added to every teacher page (My rooms, a room, the teaching desk, the
   Doodle Drawer). Shows every option in one place, tucks down to icons, and
   disappears completely in Present mode. On phones it slides in from ☰.
   ========================================================================== */
(function () {
  "use strict";

  var net = window.DoodleNet;
  if (!net) return;

  var params = new URLSearchParams(location.search);
  var page = (location.pathname.split("/").pop() || "index.html").replace(/\?.*$/, "");
  var code = (params.get("code") || "").toUpperCase();
  var room = code ? net.getRoom(code) : null;
  var KEY = "doodle-side-tucked";

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function item(href, icon, label, opts) {
    opts = opts || {};
    var current = opts.current ? ' aria-current="page"' : "";
    var data = opts.data ? " " + opts.data : "";
    var tag = href ? "a" : "button";
    var attr = href ? ' href="' + href + '"' : ' type="button"';
    return "<" + tag + ' class="side__item"' + attr + current + data + ' title="' + esc(label) + '">' +
      '<span class="side__icon" aria-hidden="true">' + icon + "</span>" +
      '<span class="side__label">' + esc(label) + "</span></" + tag + ">";
  }

  var teachHref = "teach.html" + (room ? "?code=" + room.code : "");
  var html =
    '<aside class="side" data-side aria-label="Teacher menu">' +
      '<button class="side__tuck" type="button" data-side-tuck aria-label="Tuck the menu away" title="Tuck the menu away">' +
        '<span aria-hidden="true">⟨</span></button>' +
      '<nav class="side__nav">' +
        '<p class="side__group">Teach</p>' +
        item("dashboard.html", "🏠", "My rooms", { current: page === "dashboard.html" }) +
        item(teachHref, "🧑‍🏫", "Teaching desk", { current: page === "teach.html" }) +
        item("attendance.html", "📋", "Attendance", { current: page === "attendance.html" }) +
        item("drawer.html", "🗄️", "Doodle Drawer", { current: page === "drawer.html" }) +
        item("demo.html", "🖍️", "Practice desk") +
        (room ?
          '<p class="side__group">' + esc(room.name) + " · " + esc(room.code) + "</p>" +
          item(page === "room.html" ? null : "room.html?code=" + room.code + "#class", "📣", "Class", { data: 'data-side-tab="class"', current: false }) +
          item(page === "room.html" ? null : "room.html?code=" + room.code + "#pages", "📄", "Pages & worksheets", { data: 'data-side-tab="pages"' }) +
          item(page === "room.html" ? null : "room.html?code=" + room.code + "#review", "📝", "Review & grades", { data: 'data-side-tab="review"' }) +
          item("teach.html?code=" + room.code + "&present=1", "🖥️", "Present") : "") +
        '<p class="side__group">You</p>' +
        item("pricing.html", "⭐", "Plan") +
        item(null, "🌗", "Light / dark", { data: "data-side-theme" }) +
        item(null, "🚪", "Log out", { data: "data-side-logout" }) +
      "</nav>" +
    "</aside>" +
    '<div class="side__scrim" data-side-scrim></div>';

  document.body.insertAdjacentHTML("afterbegin", html);
  document.documentElement.classList.add("has-side");

  /* A ☰ button in the top bar opens it on phones */
  var actions = document.querySelector(".nav__actions");
  if (actions) {
    actions.insertAdjacentHTML("beforeend",
      '<button class="icon-btn side__open" type="button" data-side-open aria-label="Open the teacher menu">☰</button>');
  }

  var root = document.documentElement;
  function setTucked(on) {
    root.classList.toggle("side-tucked", on);
    var b = document.querySelector("[data-side-tuck]");
    b.setAttribute("aria-label", on ? "Show the full menu" : "Tuck the menu away");
    b.title = b.getAttribute("aria-label");
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {}
  }
  try { if (localStorage.getItem(KEY) === "1") setTucked(true); } catch (e) {}

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-side-tuck]")) return setTucked(!root.classList.contains("side-tucked"));
    if (e.target.closest("[data-side-open]")) return root.classList.add("side-open");
    if (e.target.closest("[data-side-scrim]")) return root.classList.remove("side-open");

    var tab = e.target.closest("[data-side-tab]");
    if (tab && !tab.getAttribute("href") && window.doodleRoomTab) {
      window.doodleRoomTab(tab.getAttribute("data-side-tab"));
      var panel = document.querySelector("[data-cp]");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
      root.classList.remove("side-open");
      return;
    }
    if (e.target.closest("[data-side-theme]")) {
      var t = document.querySelector(".nav [data-theme-toggle]");
      if (t) t.click();
      return;
    }
    if (e.target.closest("[data-side-logout]")) {
      if (!window.confirm("Log out of Doodle Desk on this computer?")) return;
      net.logout();
      window.location.href = "login.html";
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") root.classList.remove("side-open");
  });
})();
