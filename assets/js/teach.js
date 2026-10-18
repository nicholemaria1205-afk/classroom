/* ==========================================================================
   Doodle Desk — the teacher's own teaching desk (teach.html)
   A big desk to teach on, with every pen, shape and lesson page. Present
   mode fills the screen with just the desk: menus, names and buttons
   disappear, and a small toolbar fades in only while the mouse moves — so
   when a teacher shares their screen, students see nothing but the work.

     teach.html                 a teaching desk of your own
     teach.html?code=SUN-42B    the teaching desk for that room
     ...&present=1              open straight into Present mode
   ========================================================================== */
(function () {
  "use strict";

  var net = window.DoodleNet;
  if (!net || !window.DoodleBoard) return;

  if (!net.teacher()) {
    window.location.href = "login.html";
    return;
  }

  var params = new URLSearchParams(location.search);
  var code = (params.get("code") || "").toUpperCase();
  var room = code ? net.getRoom(code) : null;
  var SAVE_KEY = "doodle-teach-" + (room ? room.code : "mine");

  if (room) {
    document.title = "Teaching desk · " + room.name + " — Doodle Desk";
    document.querySelector("[data-teach-sub]").innerHTML =
      "For <strong>" + escape(room.name) + "</strong>. Press <strong>Present</strong> before you share your screen — every menu disappears.";
  }

  function escape(t) {
    return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---- The desk ------------------------------------------------------------ */
  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(board.getItems())); } catch (e) {}
    }, 300);
  }

  var ui;
  var board = window.DoodleBoard(document.getElementById("teach-board"), {
    author: "teacher",
    background: room && room.template ? room.template : "lined",
    onStrokeEnd: function () { if (ui) ui.refresh(); save(); }
  });

  try {
    var saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "[]");
    if (saved.length) board.setItems(saved);
    else if (room && room.template) board.setBackground(room.template, true);
  } catch (e) {}

  /* Lesson pages from the Doodle Drawer join the paper list */
  var paper = document.querySelector("[data-background]");
  function fillPaper() {
    var pages = [];
    var seen = {};
    if (window.DoodleDrawer) {
      window.DoodleDrawer.cached().forEach(function (pad) {
        if (pad.kind !== "worksheet") return;
        (pad.pages || []).forEach(function (p) {
          if (!seen[p.id]) { seen[p.id] = true; pages.push(p); }
        });
      });
    }
    paper.innerHTML = window.DoodleTemplates.optionsHTML(board.getBackground(), pages);
    paper.value = board.getBackground();
  }
  fillPaper();

  ui = window.DoodleBoardUI(board, document, {
    filename: (room ? room.name + "-" : "") + "teaching-desk",
    printTitle: room ? "Teaching desk — " + room.name : "Teaching desk",
    onChange: save
  });
  board.setTool("pen");
  if (window.DoodleDrawer) window.DoodleDrawer.list().then(fillPaper);

  /* ---- Present mode ---------------------------------------------------------- */
  var root = document.documentElement;
  var stage = document.querySelector("[data-stage]");
  var bar = document.querySelector("[data-present-bar]");
  var idleTimer = null;

  function wake() {
    if (!root.classList.contains("presenting")) return;
    root.classList.add("present-awake");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      /* Keep the bar up while the pointer rests on it */
      if (!bar.matches(":hover")) root.classList.remove("present-awake");
    }, 2500);
  }

  function present() {
    root.classList.add("presenting");
    window.scrollTo(0, 0);
    var go = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (go) {
      try {
        var p = go.call(stage);
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    }
    wake();
  }

  function leave() {
    root.classList.remove("presenting", "present-awake");
    clearTimeout(idleTimer);
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) try { exit.call(document); } catch (e) {}
    }
  }

  document.querySelector("[data-present]").addEventListener("click", present);
  document.querySelector("[data-present-exit]").addEventListener("click", leave);

  /* Leaving full screen with the browser's own Esc also leaves Present mode */
  ["fullscreenchange", "webkitfullscreenchange"].forEach(function (ev) {
    document.addEventListener(ev, function () {
      if (!(document.fullscreenElement || document.webkitFullscreenElement)) {
        root.classList.remove("presenting", "present-awake");
      }
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && root.classList.contains("presenting")) {
      var tag = (document.activeElement || {}).tagName;
      if (tag !== "TEXTAREA") leave();
    }
  });

  ["mousemove", "pointerdown", "touchstart", "keydown"].forEach(function (ev) {
    stage.addEventListener(ev, wake, { passive: true });
  });
  bar.addEventListener("mouseleave", wake);

  if (params.get("present") === "1") {
    /* Browsers only allow full screen after a click, so show a big start button */
    var start = document.createElement("button");
    start.className = "btn btn--primary btn--lg present-start";
    start.type = "button";
    start.textContent = "🖥️ Start presenting";
    start.addEventListener("click", function () { start.remove(); present(); });
    stage.appendChild(start);
  }
})();
