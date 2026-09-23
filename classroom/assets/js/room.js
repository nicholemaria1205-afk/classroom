/* ==========================================================================
   Doodle Desk — teacher's room view (room.html)
   The live grid of student boards, the class controls, and the focus view
   where a teacher draws a hint straight onto one student's board.
   ========================================================================== */
(function () {
  "use strict";

  var net = window.DoodleNet;
  if (!net) return;

  var code = (new URLSearchParams(location.search).get("code") || "").toUpperCase();
  var room = net.getRoom(code);

  var noRoom = document.querySelector("[data-no-room]");
  var view = document.querySelector("[data-room-view]");

  if (!room) {
    if (noRoom) noRoom.hidden = false;
    return;
  }
  view.hidden = false;

  var grid = document.querySelector("[data-class-grid]");
  var waiting = document.querySelector("[data-waiting]");
  var filter = "all";

  /* ---- Header ----------------------------------------------------------- */
  document.querySelector("[data-room-name]").textContent = room.name;
  document.querySelector("[data-room-meta]").textContent = room.subject + " · your room";
  document.querySelector("[data-room-code]").textContent = room.code;
  document.getElementById("prompt-input").value = room.prompt || "";
  document.title = room.name + " · " + room.code + " — Doodle Desk";

  var freezeBtn = document.querySelector("[data-freeze]");
  freezeBtn.setAttribute("aria-pressed", String(!!room.frozen));

  document.querySelector("[data-copy-link]").addEventListener("click", function () {
    var url = net.joinUrl(room.code);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () {
        window.doodleToast("Join link copied 📋");
      }, function () {
        window.prompt("Copy this link for your class:", url);
      });
    } else {
      window.prompt("Copy this link for your class:", url);
    }
  });

  /* ---- Helpers ---------------------------------------------------------- */
  function escape(text) {
    return String(text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function statusOf(student) {
    if (!net.isOnline(student)) return "offline";
    return student.status || "working";
  }

  function matchesFilter(student) {
    if (filter === "all") return true;
    if (filter === "blank") return !student.marks;
    return statusOf(student) === filter;
  }

  /* ---- Grid ------------------------------------------------------------- */
  /* Kept separate from render() so a single-card update refreshes the tallies
     too — otherwise the chips stay stale until the next full redraw. */
  function renderCounts(students) {
    document.querySelector("[data-count-all]").textContent = students.length;
    document.querySelector("[data-count-working]").textContent =
      students.filter(function (s) { return statusOf(s) === "working"; }).length;
    document.querySelector("[data-count-stuck]").textContent =
      students.filter(function (s) { return statusOf(s) === "stuck"; }).length;
    document.querySelector("[data-count-done]").textContent =
      students.filter(function (s) { return statusOf(s) === "done"; }).length;
    document.querySelector("[data-count-blank]").textContent =
      students.filter(function (s) { return !s.marks; }).length;

    var online = students.filter(net.isOnline).length;
    document.querySelector("[data-online-count]").textContent =
      online + " of " + students.length + " online";
  }

  function render() {
    var students = net.getStudents(room.code);
    var shown = students.filter(matchesFilter);

    waiting.hidden = students.length > 0;
    renderCounts(students);

    grid.innerHTML = shown.map(function (s) {
      var status = statusOf(s);
      var shot = s.thumb
        ? '<img class="pupil__shot" src="' + s.thumb + '" alt="' + escape(s.name) + '’s board">'
        : '<div class="pupil__empty">blank board</div>';

      return '<button class="pupil" type="button" data-student="' + s.id + '"' +
        ' data-status="' + status + '" data-offline="' + String(!net.isOnline(s)) + '">' +
        shot +
        '<span class="pupil__foot">' +
          '<span class="dot" data-status="' + status + '"></span>' +
          '<span class="pupil__name">' + escape(s.name) + "</span>" +
          '<span class="pupil__marks">' + (s.marks || 0) + " marks</span>" +
        "</span>" +
        "</button>";
    }).join("");
  }

  /* A thumbnail arriving shouldn't rebuild the whole grid — swap that one
     image in place so the rest of the class doesn't flicker. */
  function updateOne(studentId) {
    var students = net.getStudents(room.code);
    var s = students.filter(function (x) { return x.id === studentId; })[0];
    if (!s) return render();

    renderCounts(students);

    var card = grid.querySelector('[data-student="' + studentId + '"]');
    if (!card || !matchesFilter(s)) return render();

    var status = statusOf(s);
    card.setAttribute("data-status", status);
    card.setAttribute("data-offline", String(!net.isOnline(s)));
    card.querySelector(".dot").setAttribute("data-status", status);
    card.querySelector(".pupil__marks").textContent = (s.marks || 0) + " marks";

    var img = card.querySelector(".pupil__shot");
    if (s.thumb && img) {
      img.src = s.thumb;
    } else if (s.thumb) {
      render();
    }
  }

  /* ---- Filters ---------------------------------------------------------- */
  document.querySelectorAll("[data-filter]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      filter = chip.getAttribute("data-filter");
      document.querySelectorAll("[data-filter]").forEach(function (c) {
        c.setAttribute("aria-pressed", String(c === chip));
      });
      render();
    });
  });

  /* ---- Class controls --------------------------------------------------- */
  document.querySelector("[data-send-prompt]").addEventListener("click", function () {
    var text = document.getElementById("prompt-input").value.trim();
    net.updateRoom(room.code, { prompt: text });
    net.send("prompt", { code: room.code, prompt: text });
    window.doodleToast(text ? "Task sent to the class ✏️" : "Task cleared");
  });

  freezeBtn.addEventListener("click", function () {
    var frozen = freezeBtn.getAttribute("aria-pressed") !== "true";
    freezeBtn.setAttribute("aria-pressed", String(frozen));
    freezeBtn.textContent = frozen ? "❄️ Frozen — click to release" : "❄️ Freeze";
    net.updateRoom(room.code, { frozen: frozen });
    net.send("freeze", { code: room.code, frozen: frozen });
    window.doodleToast(frozen ? "Boards frozen — eyes front ❄️" : "Boards released ✏️", frozen ? "warn" : "good");
  });

  document.querySelector("[data-clear-all]").addEventListener("click", function () {
    if (!window.confirm("Wipe every board in this room? This can't be undone.")) return;
    net.getStudents(room.code).forEach(function (s) {
      net.setStudent(room.code, s.id, { thumb: "", marks: 0 });
    });
    net.send("clear-board", { code: room.code, studentId: "all" });
    render();
    window.doodleToast("All boards cleared 🧹", "warn");
  });

  /* ---- Focus view ------------------------------------------------------- */
  var focus = document.querySelector("[data-focus]");
  var focusCanvas = document.getElementById("focus-board");
  var focusBoard = null;
  var focusId = null;
  var replyTimer = null;

  function openFocus(studentId) {
    var s = net.getStudents(room.code).filter(function (x) { return x.id === studentId; })[0];
    if (!s) return;

    focusId = studentId;
    var online = net.isOnline(s);

    document.querySelector("[data-focus-name]").textContent = s.name;
    document.querySelector("[data-focus-status]").textContent = statusOf(s);
    document.querySelector("[data-focus-dot]").setAttribute("data-status", statusOf(s));
    document.querySelector("[data-focus-note]").textContent = online
      ? "Fetching their board…"
      : "They're offline right now, so you can look but not mark up.";

    if (focusBoard) focusBoard.destroy();
    focusBoard = window.DoodleBoard(focusCanvas, {
      author: "teacher",
      readOnly: !online,
      onStrokeEnd: function (item) {
        /* Send only the new mark — the student already has everything else */
        if (!item) return;
        net.send("teacher-mark", { code: room.code, studentId: focusId, items: [item] });
      }
    });

    window.DoodleBoardUI(focusBoard, focus.querySelector(".focus__panel"));
    focusBoard.setColour("#ff4d9d").setSize(6).setTool("pen");

    focus.setAttribute("data-open", "true");
    document.body.style.overflow = "hidden";

    if (online) {
      net.send("full-request", { code: room.code, studentId: studentId, asker: net.clientId });
      clearTimeout(replyTimer);
      replyTimer = setTimeout(function () {
        var note = document.querySelector("[data-focus-note]");
        if (note.textContent.indexOf("Fetching") === 0) {
          note.textContent = "No answer from their tab — their marks will still be there when they draw again.";
        }
      }, 2000);
    }
  }

  function closeFocus() {
    focus.setAttribute("data-open", "false");
    document.body.style.overflow = "";
    focusId = null;
    clearTimeout(replyTimer);
    if (focusBoard) { focusBoard.destroy(); focusBoard = null; }
  }

  grid.addEventListener("click", function (e) {
    var card = e.target.closest("[data-student]");
    if (card) openFocus(card.getAttribute("data-student"));
  });

  document.querySelector("[data-focus-close]").addEventListener("click", closeFocus);
  focus.addEventListener("click", function (e) {
    if (e.target === focus) closeFocus();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && focus.getAttribute("data-open") === "true") closeFocus();
  });

  document.querySelector("[data-focus-clear]").addEventListener("click", function () {
    if (!focusId) return;
    if (!window.confirm("Clear this student's board?")) return;
    net.send("clear-board", { code: room.code, studentId: focusId });
    net.setStudent(room.code, focusId, { thumb: "", marks: 0 });
    if (focusBoard) focusBoard.clear(true);
    render();
    window.doodleToast("Board cleared 🧹", "warn");
  });

  /* ---- Live updates ----------------------------------------------------- */
  net.on("join", function (p) {
    if (p.code !== room.code) return;
    render();
    window.doodleToast(p.student.name + " joined 👋");
  });

  net.on("leave", function (p) {
    if (p.code === room.code) render();
  });

  net.on("board", function (p) {
    if (p.code === room.code) updateOne(p.studentId);
  });

  net.on("status", function (p) {
    if (p.code !== room.code) return;
    updateOne(p.studentId);
    if (p.status === "stuck") {
      var s = net.getStudents(room.code).filter(function (x) { return x.id === p.studentId; })[0];
      if (s) window.doodleToast(s.name + " needs a hand 🤔", "warn");
    }
  });

  net.on("presence", function (p) {
    if (p.code === room.code) updateOne(p.studentId);
  });

  net.on("full-reply", function (p) {
    if (p.code !== room.code || p.studentId !== focusId || !focusBoard) return;
    focusBoard.setItems(p.items || []);
    document.querySelector("[data-focus-note]").textContent =
      "Draw here to leave a hint — it appears on their board straight away.";
  });

  /* Across devices: start listening for this room's students. In one-browser
     mode this does nothing. */
  net.host();

  net.ready.then(function (mode) {
    if (mode === "local") {
      window.doodleToast("Live sync is off, so this room only works in this browser.", "warn");
    }
  });

  var wasDown = false;
  net.onConnection(function (state) {
    if (state === "disconnected" || state === "suspended" || state === "failed") {
      wasDown = true;
      window.doodleToast("Connection lost — trying to reconnect…", "warn");
    } else if (state === "connected" && wasDown) {
      wasDown = false;
      window.doodleToast("Back online ✅", "good");
    }
  });

  /* Online/offline is a clock thing, so re-check on a timer too */
  setInterval(render, 6000);
  render();
})();
