/* ==========================================================================
   Doodle Desk — the student's board (board.html)
   Joins a room by code, draws, and publishes a thumbnail so the teacher's
   grid stays live. Receives the task, the freeze, and the teacher's marks.
   ========================================================================== */
(function () {
  "use strict";

  var net = window.DoodleNet;
  if (!net || !window.DoodleBoard) return;

  var params = new URLSearchParams(location.search);
  var code = (params.get("code") || "").toUpperCase().trim();
  var nameFromUrl = (params.get("name") || "").trim();

  var joinPanel = document.querySelector("[data-join-panel]");
  var boardPanel = document.querySelector("[data-board-panel]");
  var gonePanel = document.querySelector("[data-room-gone]");
  var joinForm = document.getElementById("board-join");

  var room = null;
  var me = null;
  var board = null;
  var ui = null;
  var heartbeat = null;

  /* ---- Join ------------------------------------------------------------- */
  function showJoin(message) {
    joinPanel.hidden = false;
    boardPanel.hidden = true;
    if (code) joinForm.elements.code.value = code;
    if (nameFromUrl) joinForm.elements.nickname.value = nameFromUrl;
    if (message) {
      var field = joinForm.elements.code.closest(".field");
      field.classList.add("field--error");
      field.querySelector(".err").textContent = message;
    }
  }

  function setError(input, message) {
    var field = input.closest(".field");
    field.classList.toggle("field--error", Boolean(message));
    field.querySelector(".err").textContent = message || "";
    return !message;
  }

  joinForm.elements.code.addEventListener("input", function (e) {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 8);
  });

  joinForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var codeInput = joinForm.elements.code;
    var nameInput = joinForm.elements.nickname;

    var ok = setError(codeInput, codeInput.value.trim().length >= 5 ? "" : "Room codes look like SUN-42B.");
    ok = setError(nameInput, nameInput.value.trim().length >= 2 ? "" : "Pop your first name in.") && ok;
    if (!ok) return;

    var submit = joinForm.querySelector('[type="submit"]');
    var label = submit.textContent;
    submit.disabled = true;
    submit.textContent = "Looking for your room…";

    net.joinRoom(codeInput.value.trim(), nameInput.value.trim()).then(function (result) {
      submit.disabled = false;
      submit.textContent = label;
      if (!result.ok) return setError(codeInput, result.error);

      code = result.room.code;
      net.setMe(code, result.student);
      history.replaceState(null, "", "board.html?code=" + code);
      start(result.room, result.student);
    });
  });

  /* ---- Board ------------------------------------------------------------ */
  function start(theRoom, student) {
    room = theRoom;
    me = student;

    joinPanel.hidden = true;
    gonePanel.hidden = true;
    boardPanel.hidden = false;

    document.querySelector("[data-hello]").textContent = me.name + "'s board";
    var roomBadge = document.querySelector("[data-room-badge]");
    roomBadge.hidden = false;
    roomBadge.textContent = room.code;
    document.querySelector("[data-room-name-badge]").textContent = room.subject + " · " + room.name;
    document.title = me.name + "'s board — " + room.name;

    showPrompt(room.prompt);
    setFrozen(room.frozen);

    board = window.DoodleBoard(document.getElementById("board"), {
      author: "student",
      onStrokeEnd: function (item, items) {
        if (ui) ui.refresh();
        publish(items);
      },
      onDrawing: function (items) { publish(items, true); }
    });

    ui = window.DoodleBoardUI(board, document, {
      filename: me.name + "-board",
      onChange: function () { publish(board.getItems()); }
    });
    board.setTool("pen");

    /* A refresh in this tab shouldn't lose the lesson */
    var saved = net.loadMyBoard(code, me.id);
    if (saved.length) {
      board.setItems(saved);
      ui.refresh();
      publish(saved);
    }

    /* Across devices a quiet teacher isn't a closed room — only an explicit
       "room-closed" ends the session. In one browser we can simply look. */
    heartbeat = setInterval(function () {
      if (net.mode() === "local" && !net.getRoom(code)) return roomClosed();
      net.setStudent(code, me.id, {});
      net.send("presence", { code: code, studentId: me.id, student: summary() });
    }, 6000);
  }

  /* Thumbnails go to the teacher; the full board stays in this tab */
  var lastPublish = 0;

  /* The bits of me the teacher's grid needs. Sent with updates so a teacher
     whose browser was closed and reopened can rebuild the class list. */
  function summary() {
    return { id: me.id, name: me.name, status: me.status || "working", marks: me.marks || 0, joinedAt: me.joinedAt };
  }

  function publish(items, throttled) {
    if (!board || !me) return;
    /* A whole class drawing at once shares one channel, so across devices
       keep mid-stroke updates well apart; the finished stroke always goes. */
    var gap = net.mode() === "remote" ? 1500 : 400;
    if (throttled && Date.now() - lastPublish < gap) return;
    lastPublish = Date.now();

    var thumb = board.toThumb(300);
    me.marks = items.length;
    net.setStudent(code, me.id, { thumb: thumb, marks: items.length });
    net.saveMyBoard(code, me.id, items);

    var payload = { code: code, studentId: me.id, marks: items.length, student: summary() };
    /* In one browser the thumbnail is already in shared storage; across
       devices it has to travel with the message. */
    if (net.mode() === "remote") payload.thumb = thumb;
    net.send("board", payload);
  }

  function showPrompt(text) {
    var banner = document.querySelector("[data-prompt]");
    banner.hidden = !text;
    if (text) document.querySelector("[data-prompt-text]").textContent = text;
  }

  function setFrozen(frozen) {
    document.querySelector("[data-frozen]").setAttribute("data-on", String(!!frozen));
    var canvas = document.getElementById("board");
    canvas.style.pointerEvents = frozen ? "none" : "";
  }

  function roomClosed() {
    clearInterval(heartbeat);
    boardPanel.hidden = true;
    joinPanel.hidden = true;
    gonePanel.hidden = false;
    net.forgetMe(code);
  }

  /* ---- Status buttons --------------------------------------------------- */
  document.querySelectorAll("[data-status]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!me) return;
      var status = btn.getAttribute("data-status");
      document.querySelectorAll("[data-status]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === btn));
      });
      me.status = status;
      net.setStudent(code, me.id, { status: status });
      net.send("status", { code: code, studentId: me.id, status: status, student: summary() });
      window.doodleToast(
        status === "stuck" ? "Hand up — your teacher can see 🤔"
          : status === "done" ? "Nice work ✅" : "Back to it ✏️"
      );
    });
  });

  document.querySelector("[data-leave]").addEventListener("click", function () {
    if (!me || !window.confirm("Leave this room? Your board goes with you.")) return;
    net.removeStudent(code, me.id);
    net.forgetMe(code);
    window.location.href = "login.html";
  });

  /* ---- Messages from the teacher ---------------------------------------- */
  net.on("prompt", function (p) {
    if (p.code !== code) return;
    showPrompt(p.prompt);
    if (p.prompt) window.doodleToast("New task from your teacher 📌");
  });

  net.on("freeze", function (p) {
    if (p.code === code) setFrozen(p.frozen);
  });

  net.on("clear-board", function (p) {
    if (p.code !== code || !me || !board) return;
    if (p.studentId !== "all" && p.studentId !== me.id) return;
    board.clear(true);
    if (ui) ui.refresh();
    publish([]);
    window.doodleToast("Your teacher cleared the board 🧹", "warn");
  });

  net.on("teacher-mark", function (p) {
    if (p.code !== code || !me || !board || p.studentId !== me.id) return;
    board.addItems(p.items || []);
    if (ui) ui.refresh();
    publish(board.getItems());
    window.doodleToast("Your teacher left you a hint 💡");
  });

  /* The teacher opened your board — send them everything you've drawn */
  net.on("full-request", function (p) {
    if (p.code !== code || !me || !board || p.studentId !== me.id) return;
    net.send("full-reply", { code: code, studentId: me.id, items: board.getItems() });
  });

  net.on("room-closed", function (p) {
    if (p.code === code && me) roomClosed();
  });

  /* ---- Boot ------------------------------------------------------------- */
  function boot() {
    if (!code) return showJoin();

    /* Already joined in this tab? Pick up where we left off. */
    var mine = net.me(code);
    if (mine) {
      return net.joinRoom(code, mine.name, mine).then(function (result) {
        if (result.ok) return start(result.room, result.student);

        /* The teacher's device didn't answer. If we were in this room a moment
           ago, keep the board on screen — it reconnects by itself — rather
           than throwing away a lesson over a wobbly connection. */
        var cached = net.mode() === "remote" ? net.cachedRoom(code) : null;
        if (cached) return start(cached, mine);
        net.forgetMe(code);
        showJoin(result.error);
      });
    }

    if (nameFromUrl) {
      return net.joinRoom(code, nameFromUrl).then(function (result) {
        if (result.ok) {
          net.setMe(code, result.student);
          return start(result.room, result.student);
        }
        showJoin(result.error);
      });
    }

    /* Just a code: check it's real so a typo shows up straight away */
    net.fetchRoom(code).then(function (room) {
      showJoin(room ? "" : (net.mode() === "remote"
        ? "We can't find that room. Is your teacher's room open?"
        : "We can't find a room with that code."));
    });
  }

  net.ready.then(boot);
})();
