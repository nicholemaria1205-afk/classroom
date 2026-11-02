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

  /* Keep the room open while teaching from here: this browser is the room's
     host, so it goes on letting students join (or rejoin after a wobble)
     and keeps the class list up to date, just like the room page does. */
  if (room) {
    net.updateRoom(room.code, { openedAt: Date.now() });
    net.host();
    net.watch(room.code, "teacher");
    /* …and takes attendance as they join */
    if (window.DoodleAttendance) window.DoodleAttendance.listen();

    net.on("present-request", function (p) {
      if (p.code !== room.code || p.cancel) return;
      var s = (net.getStudents(room.code).filter(function (x) { return x.id === p.studentId; })[0]) || p.student || {};
      if (!document.documentElement.classList.contains("presenting")) {
        window.doodleToast("🙋 " + (s.name || "A student") + " would like to present — open the room to choose");
      }
    });
  }

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

  /* ---- Timer and name picker (for a room) ------------------------------------
     The same class timer as the room page — it shows on every student's desk
     and here on the stage, so it's in the shared screen too. */
  var Act = window.DoodleActivities;
  if (room && Act) {
    document.querySelectorAll("[data-teach-acts], [data-acts-only]").forEach(function (el) { el.hidden = false; });

    var stagePill = Act.timerPill(document.querySelector("[data-stage-timer]"), { hideAfter: 6000 });
    var pop = document.querySelector("[data-timer-pop]");
    var popStart = document.querySelector("[data-pop-start]");
    var popRunning = document.querySelector("[data-pop-running]");
    var popPause = document.querySelector("[data-pop-pause]");

    var showTeachTimer = function () {
      var t = Act.timers.current(net, room.code);
      stagePill.set(t);
      var running = !!t && Act.timerLeft(t) > 0;
      popStart.hidden = running;
      popRunning.hidden = !running;
      if (t) popPause.textContent = t.pausedLeft != null ? "▶️ Resume" : "⏸️ Pause";
    };

    var setPop = function (open) {
      pop.hidden = !open;
      document.querySelectorAll("[data-open-timer]").forEach(function (b) { b.setAttribute("aria-expanded", String(open)); });
      if (open) showTeachTimer();
    };

    document.querySelectorAll("[data-open-timer]").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        setPop(pop.hidden);
      });
    });
    pop.addEventListener("click", function (e) {
      e.stopPropagation();
      var b;
      if ((b = e.target.closest("[data-pop-min]"))) {
        Act.timers.start(net, room.code, +b.getAttribute("data-pop-min") * 60000, "");
        setPop(false);
      } else if (e.target.closest("[data-pop-pause]")) {
        Act.timers.toggle(net, room.code);
      } else if (e.target.closest("[data-pop-add]")) {
        Act.timers.addMinute(net, room.code);
      } else if (e.target.closest("[data-pop-stop]")) {
        Act.timers.stop(net, room.code);
        setPop(false);
      }
      showTeachTimer();
    });
    document.addEventListener("click", function () { if (!pop.hidden) setPop(false); });
    window.addEventListener("storage", function (e) { if (e.key === "doodle-rooms") showTeachTimer(); });
    showTeachTimer();

    /* The picker shows big on the stage, so the class sees the spin */
    var pickBox = document.querySelector("[data-stage-pick]");
    var pickName = document.querySelector("[data-stage-pick-name]");
    var pickHide = null;
    var picking = false;
    document.querySelectorAll("[data-teach-pick]").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        if (picking) return;
        var choice = Act.picker.choose(net, room.code, { onlineOnly: true, noRepeat: true });
        if (!choice) return window.doodleToast("No students are here right now", "warn");
        if (choice.fresh) window.doodleToast("Everyone has had a turn today — starting fresh 🔄");
        clearTimeout(pickHide);
        picking = true;
        pickBox.hidden = false;
        Act.spin(pickName, choice.names, choice.winner.name, function () {
          picking = false;
          Act.picker.done(net, room.code, choice.winner, true);
          pickHide = setTimeout(function () { pickBox.hidden = true; }, 6000);
        });
      });
    });
    pickBox.addEventListener("click", function () {
      if (picking) return;
      clearTimeout(pickHide);
      pickBox.hidden = true;
    });
  }

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
