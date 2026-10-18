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
  net.tidyRooms();
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
  if (room.frozen) freezeBtn.textContent = "❄️ Frozen — click to release";

  document.querySelector("[data-teach-link]").href = "teach.html?code=" + room.code;

  /* ---- How long this room is kept ---------------------------------------- */
  net.updateRoom(room.code, { openedAt: Date.now() });
  var keepSel = document.querySelector("[data-room-keep]");
  var keepLabelEl = document.querySelector("[data-room-keep-label]");
  keepSel.innerHTML = net.keepOptionsHTML(["day", "week", "month", "schoolyear", "forever"], room.keep || (room.keepUntil ? "month" : "forever"))
    .replace("Until I delete it", "Until I close it");
  function showKeep() {
    var r = net.getRoom(room.code) || room;
    keepLabelEl.textContent = r.keepUntil ? net.keepLabel(r.keepUntil) : "";
  }
  showKeep();
  keepSel.addEventListener("change", function () {
    /* Counted from when the room was opened, so "1 week" means its first week */
    var until = net.keepUntil(keepSel.value, keepSel.value === "schoolyear" || keepSel.value === "forever" ? Date.now() : room.createdAt);
    if (until && until < Date.now() + 36e5) until = net.keepUntil(keepSel.value);
    net.updateRoom(room.code, { keep: keepSel.value, keepUntil: until });
    showKeep();
    window.doodleToast("🗓️ " + net.keepLabel(until));
  });

  /* ---- Tool tabs (Class / Pages & worksheets / Review & grades) ---------- */
  var cpTabs = Array.prototype.slice.call(document.querySelectorAll("[data-cp-tab]"));

  function showTab(name, focus) {
    cpTabs.forEach(function (tab) {
      var on = tab.getAttribute("data-cp-tab") === name;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    });
    document.querySelectorAll("[data-cp-panel]").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-cp-panel") !== name;
    });
    try { localStorage.setItem("doodle-room-tab", name); } catch (e) {}
  }

  cpTabs.forEach(function (tab, i) {
    tab.addEventListener("click", function () { showTab(tab.getAttribute("data-cp-tab")); });
    tab.addEventListener("keydown", function (e) {
      var step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      showTab(cpTabs[(i + step + cpTabs.length) % cpTabs.length].getAttribute("data-cp-tab"), true);
    });
  });

  try {
    var savedTab = localStorage.getItem("doodle-room-tab");
    if (savedTab && document.querySelector('[data-cp-panel="' + savedTab + '"]')) showTab(savedTab);
  } catch (e) {}

  /* The side menu (and links like room.html#pages) can open a tab */
  window.doodleRoomTab = showTab;
  var hashTab = location.hash.replace("#", "");
  if (hashTab && document.querySelector('[data-cp-panel="' + hashTab + '"]')) showTab(hashTab);

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

  /* A little sticky note on a card: a note is waiting for that student */
  function noteBadge(s) {
    return net.getNotes(room.code, s.id).length
      ? '<span class="pupil__note sticky" title="A note is waiting for ' + escape(s.name) + '" role="img" aria-label="Note waiting"></span>'
      : "";
  }

  function render() {
    var students = net.getStudents(room.code);
    var shown = students.filter(matchesFilter);

    waiting.hidden = students.length > 0;
    renderCounts(students);

    grid.innerHTML = shown.map(function (s) {
      var status = statusOf(s);
      var shot = s.thumb
        ? '<img class="pupil__shot" src="' + s.thumb + '" alt="' + escape(s.name) + '’s desk">'
        : '<div class="pupil__empty">blank desk</div>';

      return '<button class="pupil" type="button" data-student="' + s.id + '"' +
        ' data-status="' + status + '" data-offline="' + String(!net.isOnline(s)) + '">' +
        shot +
        '<span class="pupil__foot">' +
          '<span class="dot" data-status="' + status + '"></span>' +
          '<span class="pupil__name">' + (s.locked ? '<span title="Desk paused" aria-label="Desk paused">🔒 </span>' : "") + escape(s.name) + "</span>" +
          noteBadge(s) +
          '<span class="pupil__marks">' + (s.marks || 0) + " marks</span>" +
        "</span>" +
        "</button>";
    }).join("");

    renderRoster(students);
  }

  /* ---- Class list ------------------------------------------------------- */
  function ago(t) {
    if (!t) return "—";
    var s = Math.round((Date.now() - t) / 1000);
    if (s < 15) return "just now";
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    return Math.round(s / 3600) + " h ago";
  }

  var STATUS_LABEL = { working: "✏️ Working", stuck: "🤔 Stuck", done: "✅ Done", offline: "💤 Offline" };

  function renderRoster(students) {
    var online = students.filter(net.isOnline).length;
    document.querySelector("[data-roster-summary]").textContent =
      students.length ? online + " of " + students.length + " connected" : "";
    document.querySelector("[data-roster-empty]").hidden = students.length > 0;
    document.querySelector("[data-roster-table]").hidden = students.length === 0;
    document.querySelector("[data-roster-rows]").innerHTML = students.map(function (s) {
      var status = statusOf(s);
      return "<tr>" +
        '<td><span class="dot" data-status="' + status + '"></span> <strong>' + escape(s.name) + "</strong>" +
          (s.locked ? ' <span class="small muted">· paused</span>' : "") + "</td>" +
        "<td>" + STATUS_LABEL[status] + "</td>" +
        '<td class="small muted">' + ago(s.lastSeen) + "</td>" +
        '<td class="roster__actions">' +
          '<button class="chip" type="button" data-lock-student="' + s.id + '" aria-pressed="' + String(!!s.locked) + '">' +
            (s.locked ? "▶️ Let them draw" : "🔒 Pause") + "</button>" +
          '<button class="chip" type="button" data-view-student="' + s.id + '">👀 Open</button>' +
          '<button class="chip" type="button" data-present-student="' + s.id + '">🖥️ Present</button>' +
          '<button class="chip chip--danger" type="button" data-remove-student="' + s.id + '">✕ Remove</button>' +
        "</td></tr>";
    }).join("");
  }

  document.querySelector("[data-roster-rows]").addEventListener("click", function (e) {
    var lock = e.target.closest("[data-lock-student]");
    var view = e.target.closest("[data-view-student]");
    var remove = e.target.closest("[data-remove-student]");
    var presentIt = e.target.closest("[data-present-student]");
    if (presentIt) return startPresenting(presentIt.getAttribute("data-present-student"));
    if (lock) {
      var id = lock.getAttribute("data-lock-student");
      setLock(id, lock.getAttribute("aria-pressed") !== "true");
    } else if (view) {
      openFocus(view.getAttribute("data-view-student"));
    } else if (remove) {
      removeStudent(remove.getAttribute("data-remove-student"));
    }
  });

  /* ---- Per-student controls ---------------------------------------------- */
  var lockSentAt = {};

  function findStudent(id) {
    return net.getStudents(room.code).filter(function (x) { return x.id === id; })[0];
  }

  function setLock(id, locked) {
    var s = findStudent(id);
    if (!s) return;
    net.setStudent(room.code, id, { locked: locked });
    net.send("lock", { code: room.code, studentId: id, locked: locked });
    lockSentAt[id] = Date.now();
    if (focusId === id) showFocusLock(locked);
    render();
    window.doodleToast(locked ? s.name + "'s desk is paused 🔒" : s.name + " can draw again ✏️", locked ? "warn" : "good");
  }

  function removedList() {
    return (net.getRoom(room.code) || {}).removed || {};
  }

  function removeStudent(id) {
    var s = findStudent(id);
    if (!s || !window.confirm("Take " + s.name + " out of this room? They can join again with the code.")) return;
    var removed = removedList();
    removed[id] = Date.now();
    net.updateRoom(room.code, { removed: removed });
    net.send("remove-student", { code: room.code, studentId: id });
    net.removeStudent(room.code, id);
    if (focusId === id) closeFocus();
    render();
    window.doodleToast(s.name + " was removed from the room", "warn");
  }

  /* A paused or removed student whose tab reloaded hasn't heard the news —
     tell them again when they check in. */
  function remind(studentId) {
    if (removedList()[studentId]) {
      net.send("remove-student", { code: room.code, studentId: studentId });
      net.removeStudent(room.code, studentId);
      render();
      return true;
    }
    var s = findStudent(studentId);
    if (s && s.locked && Date.now() - (lockSentAt[studentId] || 0) > 15000) {
      lockSentAt[studentId] = Date.now();
      net.send("lock", { code: room.code, studentId: studentId, locked: true });
    }
    return false;
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
    if (!!card.querySelector(".pupil__note") !== !!noteBadge(s)) return render();

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
    window.doodleToast(frozen ? "Desks frozen — eyes front ❄️" : "Desks released ✏️", frozen ? "warn" : "good");
  });

  /* ---- Lesson pages ----------------------------------------------------- */
  var templateSelect = document.querySelector("[data-template-select]");

  /* A teacher's uploaded worksheets follow them from room to room in this
     browser: [{ name, at, pages: [{ id: "img:…", name }] }] */
  function uploadsKey() {
    var t = net.teacher();
    return "doodle-uploads-" + (t && t.email ? t.email.toLowerCase() : "guest");
  }

  function myUploads() {
    try { return JSON.parse(localStorage.getItem(uploadsKey()) || "[]"); } catch (e) { return []; }
  }

  function saveUpload(entry) {
    var all = myUploads().filter(function (u) { return u.name !== entry.name; });
    all.unshift(entry);
    try { localStorage.setItem(uploadsKey(), JSON.stringify(all.slice(0, 30))); } catch (e) {}

    /* Every worksheet also goes into the teacher's Doodle Drawer, so it's
       there next year and on any computer */
    if (window.DoodleDrawer && entry.pages && entry.pages.length) {
      window.DoodleDrawer.save({
        kind: "worksheet",
        title: String(entry.name || "Worksheet").replace(/^✨\s*/, ""),
        keep: "forever",
        keepUntil: null,
        count: entry.pages.length,
        data: { pages: entry.pages, key: entry.key || null, source: entry.ai ? "ai" : "upload" }
      }).then(function (r) {
        if (r.ok) window.doodleToast("Saved to your Doodle Drawer 🗄️", "good");
      });
    }
  }

  /* Pages to offer in the Lesson page list: this browser's recent uploads
     plus every worksheet in the Doodle Drawer */
  function uploadedPages() {
    var pages = [];
    var seen = {};
    function add(p) {
      if (!p || seen[p.id]) return;
      seen[p.id] = true;
      pages.push(p);
    }
    myUploads().forEach(function (u) { u.pages.forEach(add); });
    if (window.DoodleDrawer) {
      window.DoodleDrawer.cached().forEach(function (pad) {
        if (pad.kind === "worksheet") (pad.pages || []).forEach(add);
      });
    }
    return pages;
  }

  function fillTemplates(selected) {
    templateSelect.innerHTML = '<option value="">Choose a page…</option>' +
      window.DoodleTemplates.optionsHTML(selected || "", uploadedPages());
    if (selected) templateSelect.value = selected;
  }
  fillTemplates(room.template || "");

  /* Coming from the Doodle Drawer with a page to use? Have it ready to send */
  var pageFromDrawer = new URLSearchParams(location.search).get("page");
  if (window.DoodleDrawer) {
    window.DoodleDrawer.list().then(function () {
      fillTemplates(pageFromDrawer || templateSelect.value || room.template || "");
      if (pageFromDrawer && templateSelect.value === pageFromDrawer) {
        showTab("pages");
        note("📄 <strong>" + escape(templateSelect.options[templateSelect.selectedIndex].textContent) +
          "</strong> from your Doodle Drawer is ready. Press <strong>Send to every desk</strong> when the class is ready.", "good");
        history.replaceState(null, "", "room.html?code=" + room.code);
      }
    });
  }

  document.querySelector("[data-send-template]").addEventListener("click", function () {
    var id = templateSelect.value;
    if (!id) {
      templateSelect.focus();
      return window.doodleToast("Pick a lesson page first 📄", "warn");
    }
    net.updateRoom(room.code, { template: id });
    net.send("template", { code: room.code, template: id });
    var label = templateSelect.options[templateSelect.selectedIndex].textContent;
    window.doodleToast(label + " sent to every desk 📄");
  });

  /* ---- Uploads & Google Drive (Teacher Pro) ------------------------------ */
  var uploadNote = document.querySelector("[data-upload-note]");
  var fileBtn = document.querySelector("[data-upload-file]");
  var driveBtn = document.querySelector("[data-upload-drive]");
  var fileInput = document.querySelector("[data-upload-input]");
  var uploading = false;
  var isPro = !!(net.teacher() || {}).pro;

  function note(html, kind) {
    uploadNote.hidden = !html;
    uploadNote.setAttribute("data-kind", kind || "info");
    uploadNote.innerHTML = html || "";
  }

  function proGate() {
    var t = net.teacher();
    if (!t) {
      note('Uploading worksheets needs a teacher account. <a href="login.html">Log in</a> and come back to this room.', "warn");
      return false;
    }
    if (!isPro) {
      note('✨ The AI worksheet maker, AI grading, uploading worksheets and Google Drive import are part of <strong>Teacher Pro</strong>. ' +
        '<a href="pricing.html">See Teacher Pro</a>', "pro");
      return false;
    }
    return true;
  }

  function busy(on, label) {
    uploading = on;
    fileBtn.disabled = on;
    driveBtn.disabled = on;
    if (on) note("⏳ " + label, "info");
  }

  function finished(result) {
    busy(false);
    saveUpload({ name: result.name, at: Date.now(), pages: result.pages });
    fillTemplates(result.pages[0].id);
    var many = result.pages.length > 1;
    note("✅ <strong>" + escape(result.name) + "</strong> is ready" +
      (many ? " (" + result.pages.length + " pages — pick one in the Lesson page list)" : "") +
      (result.truncated ? ". Only the first 20 pages were kept" : "") +
      '. Press <strong>Send to every desk</strong> when you want students to see it.', "good");
  }

  function failed(err) {
    busy(false);
    if (!err || err.message === "cancelled") return note("");
    if (err.pro === false) {
      isPro = false;
      return proGate();
    }
    note("⚠️ " + escape(err.message || "That didn't work. Try again."), "warn");
  }

  fileBtn.addEventListener("click", function () {
    if (uploading || !proGate()) return;
    note("");
    fileInput.value = "";
    fileInput.click();
  });

  fileInput.addEventListener("change", function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    busy(true, "Getting your file ready…");
    window.DoodleUploads.fromFile(file, function (msg) { note("⏳ " + escape(msg), "info"); })
      .then(finished, failed);
  });

  driveBtn.addEventListener("click", function () {
    if (uploading || !proGate()) return;
    busy(true, "Opening Google Drive…");
    window.DoodleUploads.fromDrive(function (msg) { note("⏳ " + escape(msg), "info"); })
      .then(finished, failed);
  });

  /* Check Pro with the server (the Pro list may have changed since login),
     and get Google's scripts ready so the Drive button opens instantly. */
  net.account().then(function (t) {
    isPro = !!(t && t.pro);
    document.querySelectorAll(".pro-tag").forEach(function (tag) { tag.hidden = isPro; });
    if (isPro && window.DoodleUploads) window.DoodleUploads.prepareDrive();
  });

  /* ---- AI worksheet maker (Teacher Pro) --------------------------------- */
  var aiDialog = document.querySelector("[data-ai]");
  var aiForm = document.querySelector("[data-ai-form]");
  var aiPreview = document.querySelector("[data-ai-preview]");
  var aiStatus = document.querySelector("[data-ai-status]");
  var aiGo = document.querySelector("[data-ai-go]");
  var aiPagesBox = document.querySelector("[data-ai-pages]");
  var aiEditList = document.querySelector("[data-ai-edit-list]");
  var aiSaveStatus = document.querySelector("[data-ai-save-status]");
  var aiWorksheet = null;
  var aiPages = [];
  var aiLastAsk = null;
  var aiBusy = false;

  function openAI() {
    if (!proGate()) return;
    note("");
    aiDialog.setAttribute("data-open", "true");
    document.body.style.overflow = "hidden";
    if (!aiWorksheet) showAIForm();
    setTimeout(function () { (aiWorksheet ? aiPreview : aiForm).querySelector("button, input").focus(); }, 50);
  }

  function closeAI() {
    aiDialog.setAttribute("data-open", "false");
    document.body.style.overflow = "";
  }

  function showAIForm() {
    aiForm.hidden = false;
    aiPreview.hidden = true;
  }

  function setAIBusy(on, label) {
    aiBusy = on;
    aiGo.disabled = on;
    aiDialog.querySelectorAll("[data-ai-again], [data-ai-save], [data-ai-send]").forEach(function (b) { b.disabled = on; });
    aiStatus.textContent = label || "";
  }

  function readAsk() {
    var f = aiForm.elements;
    return {
      topic: f.topic.value.trim(),
      kind: f.kind.value,
      grade: f.grade.value,
      count: f.count.value,
      notes: f.notes.value.trim()
    };
  }

  function runAI(ask) {
    if (aiBusy) return;
    aiLastAsk = ask;
    setAIBusy(true, "✨ Writing your worksheet… this takes a few seconds.");
    showAIForm();
    window.DoodleAI.generate(ask).then(function (r) {
      if (!r.ok) {
        setAIBusy(false, "");
        if (r.pro === false) { isPro = false; closeAI(); return proGate(); }
        aiStatus.textContent = "⚠️ " + r.error;
        return;
      }
      aiWorksheet = r.worksheet;
      document.querySelector("[data-ai-left]").textContent =
        typeof r.left === "number" ? r.left + " AI worksheets left today" : "";
      return renderAI().then(function () {
        setAIBusy(false, "");
        aiForm.hidden = true;
        aiPreview.hidden = false;
        aiSaveStatus.textContent = "";
        fillAIEditors();
      });
    }).catch(function () {
      setAIBusy(false, "⚠️ Something went wrong drawing the pages. Try again.");
    });
  }

  function renderAI() {
    return window.DoodleAI.render(aiWorksheet).then(function (pages) {
      aiPages = pages;
      aiPagesBox.innerHTML = pages.map(function (src, i) {
        return '<img src="' + src + '" alt="Worksheet page ' + (i + 1) + ' preview">';
      }).join("");
      var key = document.querySelector("[data-ai-key]");
      key.innerHTML = aiWorksheet.items.filter(function (it) { return it.type !== "passage"; }).map(function (it) {
        return "<li>" + escape(it.answer || "—") + "</li>";
      }).join("");
      document.querySelector("[data-ai-notes]").textContent =
        aiWorksheet.teacher_notes ? "Tip: " + aiWorksheet.teacher_notes : "";
    });
  }

  /* Small edits without asking the AI again — the pages redraw as you type */
  var rerender = null;
  function fillAIEditors() {
    var html = '<div class="field"><label>Title</label><input type="text" data-ai-field="title" maxlength="70" value="' +
      escape(aiWorksheet.title) + '"></div>' +
      '<div class="field"><label>Instructions</label><input type="text" data-ai-field="instructions" maxlength="240" value="' +
      escape(aiWorksheet.instructions || "") + '"></div>';
    var n = 0;
    aiWorksheet.items.forEach(function (it, i) {
      var label = it.type === "passage" ? "Reading passage" : "Question " + (++n);
      html += '<div class="field ai-q"><label>' + label + "</label>" +
        '<textarea rows="' + (it.type === "passage" ? 5 : 2) + '" data-ai-item="' + i + '" data-ai-part="prompt">' + escape(it.prompt) + "</textarea>";
      if (it.type === "multiple_choice") {
        html += '<input type="text" data-ai-item="' + i + '" data-ai-part="choices" value="' +
          escape((it.choices || []).join(" | ")) + '" aria-label="Choices for ' + label + ', separated by |">' +
          '<small>Choices, separated by |</small>';
      }
      if (it.type !== "passage") {
        html += '<input type="text" data-ai-item="' + i + '" data-ai-part="answer" value="' + escape(it.answer || "") +
          '" aria-label="Answer for ' + label + '" placeholder="Answer (only you see this)">';
      }
      html += "</div>";
    });
    aiEditList.innerHTML = html;
  }

  aiEditList.addEventListener("input", function (e) {
    var el = e.target;
    if (el.hasAttribute("data-ai-field")) {
      aiWorksheet[el.getAttribute("data-ai-field")] = el.value;
    } else if (el.hasAttribute("data-ai-item")) {
      var it = aiWorksheet.items[+el.getAttribute("data-ai-item")];
      var part = el.getAttribute("data-ai-part");
      if (part === "choices") it.choices = el.value.split("|").map(function (c) { return c.trim(); }).filter(Boolean);
      else it[part] = el.value;
    }
    aiSaveStatus.textContent = "";
    clearTimeout(rerender);
    rerender = setTimeout(renderAI, 450);
  });

  function saveAI(send) {
    if (!aiWorksheet || aiBusy) return;
    clearTimeout(rerender);
    setAIBusy(true);
    aiSaveStatus.textContent = "Saving…";
    renderAI().then(function () {
      var name = (aiWorksheet.title || "AI worksheet").slice(0, 60);
      var ids = [];
      var chain = Promise.resolve();
      aiPages.forEach(function (src, i) {
        chain = chain.then(function () {
          aiSaveStatus.textContent = "Saving page " + (i + 1) + " of " + aiPages.length + "…";
          return net.uploadPage(src, name + (aiPages.length > 1 ? " p" + (i + 1) : "")).then(function (r) {
            if (!r.ok) throw new Error(r.error);
            ids.push(r.id);
          });
        });
      });
      return chain.then(function () {
        var pages = ids.map(function (id, i) {
          return { id: "img:" + id, name: "✨ " + name + (ids.length > 1 ? " — page " + (i + 1) : "") };
        });
        saveUpload({ name: "✨ " + name, at: Date.now(), pages: pages, ai: true,
                     /* The answer key, kept for "Grade with AI" — teacher only */
                     key: aiWorksheet.items.filter(function (it) { return it.type !== "passage"; }).map(function (it) {
                       return { question: it.prompt, answer: it.answer || "" };
                     }) });
        fillTemplates(pages[0].id);
        setAIBusy(false);
        if (send) {
          net.updateRoom(room.code, { template: pages[0].id });
          net.send("template", { code: room.code, template: pages[0].id });
          window.doodleToast("“" + name + "” sent to every desk 📤", "good");
          closeAI();
        } else {
          aiSaveStatus.textContent = "✅ Saved — it's in the Lesson page list.";
        }
        if (ids.length > 1) {
          note("✅ <strong>" + escape(name) + "</strong> has " + ids.length +
            " pages — choose the next page in the Lesson page list when the class is ready.", "good");
        }
      });
    }).catch(function (err) {
      setAIBusy(false);
      aiSaveStatus.textContent = "⚠️ " + (err && err.message ? err.message : "Couldn't save. Try again.");
    });
  }

  document.querySelector("[data-ai-open]").addEventListener("click", openAI);
  document.querySelector("[data-ai-close]").addEventListener("click", closeAI);
  aiDialog.addEventListener("click", function (e) { if (e.target === aiDialog) closeAI(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && aiDialog.getAttribute("data-open") === "true") closeAI();
  });

  aiForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var ask = readAsk();
    var field = aiForm.elements.topic.closest(".field");
    var bad = ask.topic.length < 3;
    field.classList.toggle("field--error", bad);
    field.querySelector(".err").textContent = bad ? "Tell the AI what the worksheet is about." : "";
    if (bad) return aiForm.elements.topic.focus();
    runAI(ask);
  });

  document.querySelector("[data-ai-back]").addEventListener("click", showAIForm);
  document.querySelector("[data-ai-again]").addEventListener("click", function () {
    if (aiLastAsk) runAI(aiLastAsk);
  });
  document.querySelector("[data-ai-save]").addEventListener("click", function () { saveAI(false); });
  document.querySelector("[data-ai-send]").addEventListener("click", function () { saveAI(true); });
  document.querySelector("[data-ai-print]").addEventListener("click", function () {
    if (!aiWorksheet) return;
    window.DoodleAI.answerKeyImage(aiWorksheet).then(function (key) {
      var pages = aiPages.map(function (src) { return { src: src }; });
      pages.push({ src: key });
      window.doodlePrint(pages, aiWorksheet.title);
    });
  });

  document.querySelector("[data-clear-all]").addEventListener("click", function () {
    if (!window.confirm("Wipe every desk in this room? This can't be undone.")) return;
    net.getStudents(room.code).forEach(function (s) {
      net.setStudent(room.code, s.id, { thumb: "", marks: 0 });
    });
    net.send("clear-board", { code: room.code, studentId: "all" });
    render();
    window.doodleToast("All desks cleared 🧹", "warn");
  });

  /* ---- Focus view ------------------------------------------------------- */
  var focus = document.querySelector("[data-focus]");
  var focusCanvas = document.getElementById("focus-board");
  var focusBoard = null;
  var focusUI = null;
  var focusId = null;
  var focusLockBtn = document.querySelector("[data-focus-lock]");

  function showFocusLock(locked) {
    focusLockBtn.setAttribute("aria-pressed", String(!!locked));
    focusLockBtn.textContent = locked ? "▶️ Let them draw" : "🔒 Pause their desk";
  }

  focusLockBtn.addEventListener("click", function () {
    if (focusId) setLock(focusId, focusLockBtn.getAttribute("aria-pressed") !== "true");
  });
  var replyTimer = null;

  function openFocus(studentId) {
    var s = net.getStudents(room.code).filter(function (x) { return x.id === studentId; })[0];
    if (!s) return;

    focusId = studentId;
    var online = net.isOnline(s);

    document.querySelector("[data-focus-name]").textContent = s.name;
    document.querySelector("[data-focus-status]").textContent = statusOf(s);
    document.querySelector("[data-focus-dot]").setAttribute("data-status", statusOf(s));
    document.querySelector("[data-focus-note]").innerHTML = online
      ? "Fetching their desk…"
      : '<span class="sticky" aria-hidden="true"></span> ' + escape(s.name) +
        " is offline — write a note on their desk and it'll be waiting for them when they come back.";

    /* Every mark is kept until their desk says it arrived, so nothing is lost
       if they drop off mid-lesson. Offline, you write over their last picture
       and can change your note (undo, clear) until they're back. */
    if (focusBoard) focusBoard.destroy();
    focusBoard = window.DoodleBoard(focusCanvas, {
      author: "teacher",
      underlay: online ? null : (s.thumb || null),
      background: room.template || "lined",
      onStrokeEnd: function (item) {
        if (!focusId) return;
        if (!online) {
          net.setNotes(room.code, focusId, focusBoard.getItems());
          updateOne(focusId);
          return;
        }
        /* Send only the new mark — the student already has everything else */
        if (item) net.leaveNote(room.code, focusId, [item]);
      }
    });
    if (!online) focusBoard.setItems(net.getNotes(room.code, studentId));

    if (focusUI) focusUI.destroy();
    focusUI = window.DoodleBoardUI(focusBoard, focus.querySelector(".focus__panel"), {
      filename: s.name + "-board",
      printTitle: s.name + "'s desk — " + room.name
    });
    focusBoard.setColour("#ff4d9d").setSize(6).setTool("pen");
    focus.querySelectorAll("[data-tool]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-tool") === "pen"));
    });
    showFocusLock(s.locked);

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
    if (focusUI) { focusUI.destroy(); focusUI = null; }
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
    if (!window.confirm("Clear this student's desk?")) return;
    net.send("clear-board", { code: room.code, studentId: focusId });
    net.setNotes(room.code, focusId, []);
    net.setStudent(room.code, focusId, { thumb: "", marks: 0 });
    if (focusBoard) focusBoard.clear(true);
    render();
    window.doodleToast("Desk cleared 🧹", "warn");
  });

  /* ---- Snapshots ---------------------------------------------------------
     A snapshot keeps every student's board at one moment so a lesson can be
     looked at, printed or saved as a PDF later. Online students are asked for
     their full board (drawn sharp); anyone who doesn't answer in time is kept
     from their latest thumbnail. Stored in this browser's IndexedDB, which has
     far more room than localStorage. */
  var SnapStore = (function () {
    var dbp = null;
    function db() {
      if (dbp) return dbp;
      dbp = new Promise(function (resolve, reject) {
        if (!window.indexedDB) return reject(new Error("no IndexedDB"));
        var req = indexedDB.open("doodle-desk", 1);
        req.onupgradeneeded = function () {
          var store = req.result.createObjectStore("snapshots", { keyPath: "id" });
          store.createIndex("code", "code");
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
      return dbp;
    }
    function tx(mode, fn) {
      return db().then(function (d) {
        return new Promise(function (resolve, reject) {
          var t = d.transaction("snapshots", mode);
          var result = fn(t.objectStore("snapshots"));
          t.oncomplete = function () { resolve(result && result.result !== undefined ? result.result : result); };
          t.onerror = function () { reject(t.error); };
        });
      });
    }
    return {
      put: function (snap) { return tx("readwrite", function (s) { s.put(snap); }); },
      remove: function (id) { return tx("readwrite", function (s) { s.delete(id); }); },
      list: function (code) {
        return tx("readonly", function (s) { return s.index("code").getAll(code); })
          .then(function (all) { return (all || []).sort(function (a, b) { return b.at - a.at; }); });
      }
    };
  })();

  var pendingSnap = null;
  var snapBtn = document.querySelector("[data-snapshot]");

  /* Draw a student's full board off-screen — waiting for an uploaded
     worksheet page to load first, so it isn't missing from the snapshot. */
  function renderFull(items, width, quality) {
    var c = document.createElement("canvas");
    var b = window.DoodleBoard(c, { readOnly: true });
    b.setItems(items || []);
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 5000); });
    return Promise.race([b.ready(), timeout]).then(function () {
      var img = b.toThumb(width || 900, quality || 0.8);
      b.destroy();
      return img;
    });
  }

  function snapshotReply(p) {
    if (!pendingSnap || !pendingSnap.waiting[p.studentId]) return;
    var snap = pendingSnap;
    delete snap.waiting[p.studentId];
    snap.rendering++;
    renderFull(p.items).then(function (img) {
      snap.images[p.studentId] = img;
      snap.rendering--;
      if (pendingSnap === snap && !Object.keys(snap.waiting).length && !snap.rendering) finishSnapshot();
    });
  }

  function finishSnapshot() {
    if (!pendingSnap) return;
    var snap = pendingSnap;
    pendingSnap = null;
    clearTimeout(snap.timer);
    snapBtn.disabled = false;
    snapBtn.querySelector("strong").textContent = "Save snapshot";

    var students = net.getStudents(room.code).filter(function (s) { return snap.ids.indexOf(s.id) !== -1; });
    var record = {
      id: room.code + "-" + snap.at,
      code: room.code,
      at: snap.at,
      roomName: room.name,
      prompt: (net.getRoom(room.code) || room).prompt || "",
      students: students.map(function (s) {
        return { name: s.name, status: statusOf(s), marks: s.marks || 0, img: snap.images[s.id] || s.thumb || "" };
      })
    };
    SnapStore.put(record).then(function () {
      window.doodleToast("Snapshot saved — " + record.students.length + " desks 📸", "good");
    }, function () {
      window.doodleToast("Couldn't save the snapshot in this browser.", "warn");
    });
  }

  snapBtn.addEventListener("click", function () {
    if (pendingSnap) return;
    var students = net.getStudents(room.code);
    if (!students.length) return window.doodleToast("Nobody has joined yet — nothing to save.", "warn");

    pendingSnap = { at: Date.now(), ids: students.map(function (s) { return s.id; }), waiting: {}, images: {}, timer: null, rendering: 0 };
    snapBtn.disabled = true;
    snapBtn.querySelector("strong").textContent = "Saving…";

    var online = students.filter(net.isOnline);
    /* Ask one student at a time, a moment apart, so a big class doesn't all
       answer in the same instant. */
    online.forEach(function (s, i) {
      pendingSnap.waiting[s.id] = true;
      setTimeout(function () {
        if (pendingSnap) net.send("full-request", { code: room.code, studentId: s.id, asker: net.clientId });
      }, i * 150);
    });
    if (!online.length) return finishSnapshot();
    pendingSnap.timer = setTimeout(finishSnapshot, 4000 + online.length * 150);
  });

  /* The snapshot browser */
  var snapDialog = document.querySelector("[data-snapshots]");
  var snapList = document.querySelector("[data-snap-list]");
  var snapGallery = document.querySelector("[data-snap-gallery]");
  var snapPrint = document.querySelector("[data-snap-print]");
  var snapBack = document.querySelector("[data-snap-back]");
  var snapTitle = document.querySelector("[data-snap-title]");
  var openSnap = null;
  var snapCache = [];
  var snapDrawerWrap = document.querySelector("[data-snap-drawer-wrap]");
  var snapDrawerBtn = document.querySelector("[data-snap-drawer]");
  var snapKeep = document.querySelector("[data-snap-keep]");
  if (window.DoodleDrawer) snapKeep.innerHTML = window.DoodleDrawer.keepSelectHTML("schoolyear");

  /* Keep a snapshot for good: smaller pictures so a whole class fits */
  snapDrawerBtn.addEventListener("click", function () {
    if (!openSnap) return;
    var snap = openSnap;
    snapDrawerBtn.disabled = true;
    snapDrawerBtn.textContent = "Saving…";
    Promise.all(snap.students.map(function (st) {
      return window.DoodleDrawer.shrink(st.img, 760, 0.72).then(function (img) {
        return { name: st.name, status: st.status, marks: st.marks, img: img };
      });
    })).then(function (students) {
      var cover = students.filter(function (st) { return st.img; })[0];
      return (cover ? window.DoodleDrawer.shrink(cover.img, 320, 0.7) : Promise.resolve("")).then(function (coverImg) {
        return window.DoodleDrawer.save({
          kind: "snapshot",
          title: snap.roomName + " — " + when(snap.at),
          keep: snapKeep.value,
          keepUntil: net.keepUntil(snapKeep.value),
          count: students.length,
          cover: coverImg,
          data: { roomName: snap.roomName, prompt: snap.prompt, at: snap.at, students: students }
        });
      });
    }).then(function (r) {
      snapDrawerBtn.textContent = r.ok ? "✅ In your Doodle Drawer" : "🗄️ Save to Doodle Drawer";
      snapDrawerBtn.disabled = !!r.ok;
      window.doodleToast(r.ok ? "Snapshot saved to your Doodle Drawer 🗄️" : r.error, r.ok ? "good" : "warn");
    });
  });

  function when(t) {
    return new Date(t).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function showSnapList() {
    openSnap = null;
    snapGallery.hidden = true;
    snapList.hidden = false;
    snapPrint.hidden = true;
    snapBack.hidden = true;
    snapDrawerWrap.hidden = true;
    snapTitle.textContent = "Saved snapshots";
    snapList.innerHTML = '<p class="small muted">Loading…</p>';
    SnapStore.list(room.code).then(function (all) {
      snapCache = all;
      snapList.innerHTML = all.length ? all.map(function (s) {
        return '<div class="snap-row">' +
          '<div><strong>' + escape(when(s.at)) + "</strong>" +
          '<span class="small muted"> · ' + s.students.length + " desks" + (s.prompt ? " · " + escape(s.prompt) : "") + "</span></div>" +
          '<div class="snap-row__actions">' +
            '<button class="btn" type="button" data-snap-view="' + escape(s.id) + '">👀 Open</button>' +
            '<button class="btn" type="button" data-snap-delete="' + escape(s.id) + '">🗑️ Delete</button>' +
          "</div></div>";
      }).join("") : '<div class="empty"><span>📸</span><p><strong>No snapshots yet.</strong><br>Press “Save snapshot” during a lesson to keep every desk.</p></div>';
    }, function () {
      snapList.innerHTML = '<p class="small muted">Snapshots aren’t available in this browser.</p>';
    });
  }

  function showSnap(id) {
    var s = snapCache.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    openSnap = s;
    snapList.hidden = true;
    snapGallery.hidden = false;
    snapPrint.hidden = false;
    snapBack.hidden = false;
    snapDrawerWrap.hidden = !window.DoodleDrawer || !net.teacher();
    snapDrawerBtn.disabled = false;
    snapDrawerBtn.textContent = "🗄️ Save to Doodle Drawer";
    snapTitle.textContent = when(s.at);
    snapGallery.innerHTML = s.students.map(function (st) {
      return '<figure class="pupil snap-card">' +
        (st.img ? '<img class="pupil__shot" src="' + st.img + '" alt="' + escape(st.name) + '’s desk">' : '<div class="pupil__empty">blank desk</div>') +
        '<figcaption class="pupil__foot"><span class="dot" data-status="' + st.status + '"></span>' +
        '<span class="pupil__name">' + escape(st.name) + '</span><span class="pupil__marks">' + st.marks + " marks</span></figcaption></figure>";
    }).join("");
  }

  document.querySelector("[data-open-snapshots]").addEventListener("click", function () {
    snapDialog.setAttribute("data-open", "true");
    document.body.style.overflow = "hidden";
    showSnapList();
  });

  function closeSnaps() {
    snapDialog.setAttribute("data-open", "false");
    document.body.style.overflow = "";
  }

  document.querySelector("[data-snap-close]").addEventListener("click", closeSnaps);
  snapBack.addEventListener("click", showSnapList);
  snapDialog.addEventListener("click", function (e) {
    if (e.target === snapDialog) return closeSnaps();
    var view = e.target.closest("[data-snap-view]");
    var del = e.target.closest("[data-snap-delete]");
    if (view) showSnap(view.getAttribute("data-snap-view"));
    if (del && window.confirm("Delete this snapshot? This can't be undone.")) {
      SnapStore.remove(del.getAttribute("data-snap-delete")).then(showSnapList);
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && snapDialog.getAttribute("data-open") === "true") closeSnaps();
  });

  snapPrint.addEventListener("click", function () {
    if (!openSnap) return;
    window.doodlePrint(openSnap.students.filter(function (s) { return s.img; }).map(function (s) {
      return { src: s.img, caption: s.name + " — " + openSnap.roomName + " · " + when(openSnap.at) };
    }), openSnap.roomName + " — " + when(openSnap.at));
  });

  /* ---- Grade with AI (Teacher Pro, teacher only) --------------------------
     Collects every student's full board, sends each picture (no names) with
     the answer key to ai-grade.js, and shows the teacher a grade list they
     can check, change, download or print. Nothing here is ever sent to a
     student. Gradings are kept in this browser, per room. */
  var fullCollectors = [];

  /* Ask online students for their full boards; offline ones fall back to
     their last thumbnail (marked lowres). Resolves { id: { img, lowres } } */
  function collectBoards(students, width, onProgress) {
    return new Promise(function (resolve) {
      var out = {}, waiting = {}, rendering = 0, done = false, timer = null;
      var online = students.filter(net.isOnline);
      var total = online.length, got = 0;

      function finish() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fullCollectors = fullCollectors.filter(function (f) { return f !== handler; });
        students.forEach(function (s) {
          if (!out[s.id]) out[s.id] = s.thumb ? { img: s.thumb, lowres: true } : null;
        });
        resolve(out);
      }

      function handler(p) {
        if (!waiting[p.studentId]) return;
        delete waiting[p.studentId];
        rendering++;
        renderFull(p.items, width, 0.85).then(function (img) {
          out[p.studentId] = { img: img, lowres: false };
          rendering--;
          got++;
          if (onProgress) onProgress(got, total);
          if (!Object.keys(waiting).length && !rendering) finish();
        });
      }

      fullCollectors.push(handler);
      online.forEach(function (s, i) {
        waiting[s.id] = true;
        setTimeout(function () {
          if (!done) net.send("full-request", { code: room.code, studentId: s.id, asker: net.clientId });
        }, i * 150);
      });
      if (!online.length) return finish();
      timer = setTimeout(finish, 5000 + online.length * 150);
    });
  }

  var gradeDialog = document.querySelector("[data-grade]");
  var gradeSetup = document.querySelector("[data-grade-setup]");
  var gradeWorking = document.querySelector("[data-grade-working]");
  var gradeResults = document.querySelector("[data-grade-results]");
  var gradeKeyBox = document.querySelector("[data-grade-key]");
  var gradeStatus = document.querySelector("[data-grade-status]");
  var gradeRows = document.querySelector("[data-grade-rows]");
  var gradeRunsSel = document.querySelector("[data-grade-runs]");
  var gradeRun = null;          /* the grading on screen */
  var gradeImages = {};         /* row index -> board picture (this visit only) */
  var gradeKeyPrefill = "";
  var gradeAIKey = null;
  var openRow = -1;

  var POINTS = { correct: 1, partial: 0.5, incorrect: 0, blank: 0 };
  var MARK = { correct: "✓", partial: "½", incorrect: "✗", blank: "–", not_on_page: "" };
  var MARK_LABEL = { correct: "Correct", partial: "Partly right", incorrect: "Not right", blank: "Left blank", not_on_page: "Not on this page" };

  function runsKey() { return "doodle-grades-" + room.code; }
  function loadRuns() {
    try { return JSON.parse(localStorage.getItem(runsKey()) || "[]"); } catch (e) { return []; }
  }
  function saveRuns(runs) {
    for (var keep = runs.length; keep > 0; keep--) {
      try {
        localStorage.setItem(runsKey(), JSON.stringify(runs.slice(0, keep)));
        return;
      } catch (e) { /* storage full — drop the oldest and try again */ }
    }
  }
  function storeRun(run) {
    var runs = loadRuns().filter(function (r) { return r.at !== run.at; });
    runs.unshift(run);
    saveRuns(runs.slice(0, 15));
  }

  function keysStoreKey() {
    var t = net.teacher();
    return "doodle-keys-" + (t && t.email ? t.email.toLowerCase() : "guest");
  }
  function typedKeys() {
    try { return JSON.parse(localStorage.getItem(keysStoreKey()) || "{}"); } catch (e) { return {}; }
  }
  function rememberKey(page, text) {
    if (!page) return;
    var all = typedKeys();
    all[page] = text;
    try { localStorage.setItem(keysStoreKey(), JSON.stringify(all)); } catch (e) {}
  }

  function currentPage() { return (net.getRoom(room.code) || room).template || ""; }

  function pageLabel(page) {
    if (!page) return "the desks as they are now";
    var hit = uploadedPages().filter(function (p) { return p.id === page; })[0];
    return hit ? hit.name : window.DoodleTemplates.nameOf(page);
  }

  /* The AI maker saved its answer key with the worksheet — use it */
  function aiKeyFor(page) {
    var entry = myUploads().filter(function (u) {
      return u.key && u.pages.some(function (p) { return p.id === page; });
    })[0];
    return entry ? entry.key : null;
  }

  function parseKey(text) {
    return String(text || "").split("\n").map(function (line) {
      return line.replace(/^\s*\(?\d+[.):-]?\s*/, "").trim();
    }).filter(Boolean);
  }

  function scoreOf(row) {
    var counted = (row.results || []).filter(function (r) { return r.status !== "not_on_page"; });
    var got = counted.reduce(function (sum, r) { return sum + (POINTS[r.status] || 0); }, 0);
    return { got: got, of: counted.length, pct: counted.length ? Math.round((got / counted.length) * 100) : null };
  }

  function needsCheck(row) {
    if (row.checked) return false;
    if (row.lowres || row.error) return true;
    return (row.results || []).some(function (r) { return r.status !== "not_on_page" && !r.confident; });
  }

  function fmt(n) { return String(Math.round(n * 10) / 10); }

  function openGrading() {
    if (!proGate()) return;
    note("");
    gradeDialog.setAttribute("data-open", "true");
    document.body.style.overflow = "hidden";
    fillRunPicker();
    var runs = loadRuns();
    if (gradeRun) showResults();
    else if (runs.length && runs[0].page === currentPage()) { gradeRun = runs[0]; gradeImages = {}; showResults(); }
    else showSetup();
  }

  function closeGrading() {
    gradeDialog.setAttribute("data-open", "false");
    document.body.style.overflow = "";
  }

  function showSetup() {
    gradeSetup.hidden = false;
    gradeWorking.hidden = true;
    gradeResults.hidden = true;
    gradeStatus.textContent = "";
    var page = currentPage();
    document.querySelector("[data-grade-page]").textContent = pageLabel(page);
    var students = net.getStudents(room.code);
    var online = students.filter(net.isOnline).length;
    document.querySelector("[data-grade-who]").textContent = students.length
      ? students.length + " student" + (students.length === 1 ? "" : "s") + " · " + online + " online" +
        (online < students.length ? " (desks of students who have left are graded from a small preview — those get flagged)" : "")
      : "Nobody has joined this room yet.";

    gradeAIKey = aiKeyFor(page);
    var typed = typedKeys()[page];
    if (typed != null) {
      gradeKeyBox.value = typed;
    } else if (gradeAIKey) {
      gradeKeyBox.value = gradeAIKey.map(function (k, i) { return (i + 1) + ". " + k.answer; }).join("\n");
    } else {
      gradeKeyBox.value = "";
    }
    gradeKeyPrefill = gradeKeyBox.value;
    document.querySelector("[data-grade-key-hint]").textContent = gradeAIKey
      ? "Filled in from the AI worksheet's answer key — change anything that's wrong."
      : "Leave it empty and the AI will work out the answers itself — every mark is then flagged for you to check.";

    /* A worksheet from the Doodle Drawer may carry its answer key */
    if (!gradeAIKey && typed == null && window.DoodleDrawer) {
      var pad = window.DoodleDrawer.cached().filter(function (p) {
        return p.kind === "worksheet" && p.hasKey && (p.pages || []).some(function (pg) { return pg.id === page; });
      })[0];
      if (pad) {
        window.DoodleDrawer.get(pad.id).then(function (r) {
          var key = r.ok && r.pad && r.pad.data && r.pad.data.key;
          if (!key || !key.length || gradeKeyBox.value.trim() || currentPage() !== page) return;
          gradeAIKey = key;
          gradeKeyBox.value = key.map(function (k, i) { return (i + 1) + ". " + k.answer; }).join("\n");
          gradeKeyPrefill = gradeKeyBox.value;
          document.querySelector("[data-grade-key-hint]").textContent =
            "Filled in from the answer key saved in your Doodle Drawer — change anything that's wrong.";
        });
      }
    }
  }

  function progress(text, fraction) {
    document.querySelector("[data-grade-progress-text]").textContent = text;
    document.querySelector("[data-grade-bar]").style.width = Math.round(Math.max(0.03, fraction) * 100) + "%";
  }

  function startGrading() {
    var students = net.getStudents(room.code);
    if (!students.length) { gradeStatus.textContent = "Nobody has joined yet — nothing to grade."; return; }

    var page = currentPage();
    var answers = parseKey(gradeKeyBox.value);
    rememberKey(page, gradeKeyBox.value);
    /* Keep the AI worksheet's question text with each answer — it helps the
       AI find the right spot on the page */
    var key = answers.map(function (a, i) {
      return { question: gradeAIKey && gradeAIKey[i] ? gradeAIKey[i].question : "", answer: a };
    });
    var title = pageLabel(page);

    gradeSetup.hidden = true;
    gradeWorking.hidden = false;
    progress("Collecting desks…", 0.02);

    collectBoards(students, 1600, function (got, total) {
      progress("Collecting desks… " + got + " of " + total, 0.25 * got / Math.max(total, 1));
    }).then(function (boards) {
      var run = { at: Date.now(), page: page, title: title, keyCount: key.length, rows: [] };
      gradeImages = {};
      students.forEach(function (s, i) {
        var b = boards[s.id];
        run.rows.push({ id: s.id, name: s.name, lowres: !!(b && b.lowres), blankBoard: !s.marks, results: [], note: "" });
        if (b) gradeImages[i] = b.img;
      });

      var queue = run.rows.map(function (row, i) { return i; });
      var finished = 0;
      var fatal = null;

      function next() {
        if (fatal || !queue.length) return Promise.resolve();
        var i = queue.shift();
        var row = run.rows[i];
        var job;
        if (row.blankBoard || !gradeImages[i]) {
          /* Nothing on the board — no need to ask the AI */
          row.results = key.map(function (k, n) { return { n: n + 1, status: "blank", read: "", note: "Nothing written", confident: true }; });
          if (!key.length) row.note = "Blank desk";
          job = Promise.resolve();
        } else {
          job = window.DoodleAI.grade({ image: gradeImages[i], key: key, title: title, count: key.length || 10 }).then(function (r) {
            if (r.ok) {
              /* One mark per answer-key line, no more */
              row.results = key.length ? r.results.slice(0, key.length) : r.results;
              row.note = r.note || "";
            } else {
              row.error = r.error;
              if (r.pro === false || /switched on|limit|graded \d+/i.test(r.error)) fatal = r;
            }
          });
        }
        return job.then(function () {
          finished++;
          progress("Grading " + finished + " of " + run.rows.length + "…", 0.25 + 0.75 * finished / run.rows.length);
          return next();
        });
      }

      return Promise.all([next(), next(), next()]).then(function () {
        if (fatal && run.rows.every(function (r) { return !r.results.length || r.error; })) {
          gradeWorking.hidden = true;
          gradeSetup.hidden = false;
          if (fatal.pro === false) { isPro = false; closeGrading(); return proGate(); }
          gradeStatus.textContent = "⚠️ " + fatal.error;
          return;
        }
        gradeRun = run;
        storeRun(run);
        fillRunPicker();
        showResults();
      });
    });
  }

  function chipHTML(r) {
    if (r.status === "not_on_page") return "";
    return '<span class="mark" data-mark="' + r.status + '" title="' + (r.n) + ": " + MARK_LABEL[r.status] + '">' +
      MARK[r.status] + (r.confident ? "" : "<sup>?</sup>") + "</span>";
  }

  function showResults() {
    gradeSetup.hidden = true;
    gradeWorking.hidden = true;
    gradeResults.hidden = false;
    var run = gradeRun;
    var scored = run.rows.map(scoreOf).filter(function (s) { return s.pct != null; });
    var avg = scored.length ? Math.round(scored.reduce(function (a, s) { return a + s.pct; }, 0) / scored.length) : null;
    var flagged = run.rows.filter(needsCheck).length;
    document.querySelector("[data-grade-summary]").innerHTML =
      "<div><strong>" + escape(run.title) + "</strong><span class=\"small muted\"> · graded " +
      escape(new Date(run.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) + "</span></div>" +
      '<div class="grade-stats"><span>Class average <b>' + (avg == null ? "—" : avg + "%") + "</b></span>" +
      "<span>" + run.rows.length + " students</span>" +
      (flagged ? '<span class="grade-flag">🔎 ' + flagged + " to check</span>" : "<span>✅ All checked</span>") + "</div>";

    gradeRows.innerHTML = run.rows.map(function (row, i) {
      var sc = scoreOf(row);
      var main = '<tr class="grade-row" data-row="' + i + '" tabindex="0" aria-expanded="' + String(openRow === i) + '">' +
        "<td><strong>" + escape(row.name) + "</strong>" + (row.error ? ' <span class="small muted">· couldn’t grade</span>' : "") + "</td>" +
        "<td>" + (sc.of ? fmt(sc.got) + " / " + sc.of : "—") + "</td>" +
        "<td>" + (sc.pct == null ? "—" : sc.pct + "%") + "</td>" +
        '<td><div class="marks">' + (row.results || []).map(chipHTML).join("") + (row.note && !row.results.length ? '<span class="small muted">' + escape(row.note) + "</span>" : "") + "</div></td>" +
        "<td>" + (needsCheck(row) ? '<span class="grade-flag" title="Worth a look">🔎</span>' : "") + "</td></tr>";
      if (openRow !== i) return main;
      return main + '<tr class="grade-detail"><td colspan="5">' + detailHTML(row, i) + "</td></tr>";
    }).join("");
  }

  function detailHTML(row, i) {
    var html = '<div class="grade-detail__wrap">';
    if (gradeImages[i]) {
      html += '<img class="grade-detail__img" src="' + gradeImages[i] + '" alt="' + escape(row.name) + '’s desk">';
    }
    html += "<div>";
    if (row.lowres) html += '<p class="small muted">Graded from a small preview (the student had left), so marks may be off.</p>';
    if (row.error) html += '<p class="small">⚠️ ' + escape(row.error) + "</p>";
    if (row.note && row.results.length) html += '<p class="small muted">' + escape(row.note) + "</p>";
    html += (row.results || []).map(function (r, k) {
      return '<div class="grade-q"><span class="grade-q__n">' + r.n + ".</span>" +
        '<select class="paper-select" data-edit-row="' + i + '" data-edit-q="' + k + '" aria-label="Mark for question ' + r.n + '">' +
        ["correct", "partial", "incorrect", "blank", "not_on_page"].map(function (st) {
          return '<option value="' + st + '"' + (st === r.status ? " selected" : "") + ">" + (MARK[st] ? MARK[st] + " " : "") + MARK_LABEL[st] + "</option>";
        }).join("") + "</select>" +
        '<span class="small">' + (r.read ? "Read: “" + escape(r.read) + "”" : "") +
        (r.note ? ' <span class="muted">— ' + escape(r.note) + "</span>" : "") +
        (r.confident ? "" : ' <span class="grade-flag">🔎 unsure</span>') + "</span></div>";
    }).join("");
    html += '<div class="ai-actions"><button class="btn" type="button" data-checked-row="' + i + '">' +
      (row.checked ? "✅ Checked" : "✔ Mark as checked") + "</button></div>";
    return html + "</div></div>";
  }

  gradeRows.addEventListener("click", function (e) {
    var checked = e.target.closest("[data-checked-row]");
    if (checked) {
      var row = gradeRun.rows[+checked.getAttribute("data-checked-row")];
      row.checked = !row.checked;
      storeRun(gradeRun);
      return showResults();
    }
    var tr = e.target.closest("[data-row]");
    if (!tr) return;
    var i = +tr.getAttribute("data-row");
    openRow = openRow === i ? -1 : i;
    showResults();
  });
  gradeRows.addEventListener("keydown", function (e) {
    var tr = e.target.closest("[data-row]");
    if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); tr.click(); }
  });
  gradeRows.addEventListener("change", function (e) {
    var sel = e.target.closest("[data-edit-row]");
    if (!sel) return;
    var r = gradeRun.rows[+sel.getAttribute("data-edit-row")].results[+sel.getAttribute("data-edit-q")];
    r.status = sel.value;
    r.confident = true;   /* the teacher has decided */
    r.note = r.note ? r.note : "Changed by teacher";
    storeRun(gradeRun);
    showResults();
  });

  function fillRunPicker() {
    var runs = loadRuns();
    gradeRunsSel.hidden = runs.length < 2;
    gradeRunsSel.innerHTML = runs.map(function (r) {
      return '<option value="' + r.at + '"' + (gradeRun && gradeRun.at === r.at ? " selected" : "") + ">" +
        escape(new Date(r.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " — " + r.title) + "</option>";
    }).join("");
  }

  gradeRunsSel.addEventListener("change", function () {
    var run = loadRuns().filter(function (r) { return String(r.at) === gradeRunsSel.value; })[0];
    if (!run) return;
    gradeRun = run;
    gradeImages = {};
    openRow = -1;
    showResults();
  });

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function downloadCSV() {
    var run = gradeRun;
    var qCount = run.rows.reduce(function (m, r) { return Math.max(m, (r.results || []).length); }, 0);
    var head = ["Student", "Score", "Out of", "Percent"];
    for (var q = 1; q <= qCount; q++) head.push("Q" + q);
    head.push("Needs checking", "Notes");
    var lines = [head.map(csvCell).join(",")];
    run.rows.forEach(function (row) {
      var sc = scoreOf(row);
      var cells = [row.name, sc.of ? fmt(sc.got) : "", sc.of || "", sc.pct == null ? "" : sc.pct + "%"];
      for (var k = 0; k < qCount; k++) {
        var r = (row.results || [])[k];
        cells.push(!r || r.status === "not_on_page" ? "" : r.status === "correct" ? 1 : r.status === "partial" ? 0.5 : 0);
      }
      cells.push(needsCheck(row) ? "yes" : "", row.error || row.note || "");
      lines.push(cells.map(csvCell).join(","));
    });
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (room.name + " - " + run.title + " - grades")
      .replace(/[^\w\s.()-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 100) + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function printGrades() {
    var run = gradeRun;
    var rows = run.rows.map(function (row) {
      var sc = scoreOf(row);
      return "<tr><td>" + escape(row.name) + "</td><td>" + (sc.of ? fmt(sc.got) + " / " + sc.of : "—") + "</td><td>" +
        (sc.pct == null ? "—" : sc.pct + "%") + "</td><td>" + (row.results || []).map(function (r) {
          return r.status === "not_on_page" ? "" : MARK[r.status];
        }).join(" ") + "</td><td>" + (needsCheck(row) ? "check" : "") + "</td></tr>";
    }).join("");
    var frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    var doc = frame.contentWindow.document;
    doc.open();
    doc.write("<!doctype html><html><head><meta charset='utf-8'><title>" + escape(run.title) + " — grades</title><style>" +
      "body{font-family:Nunito,'Segoe UI',Arial,sans-serif;color:#241a3d;margin:16mm}h1{font-size:18pt;margin:0 0 2mm}" +
      "p{margin:0 0 6mm;color:#6b5f86}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:2.2mm;border-bottom:1px solid #ccc}" +
      "th{font-size:10pt;color:#6b5f86}</style></head><body><h1>" + escape(room.name + " — " + run.title) + "</h1><p>Graded " +
      escape(new Date(run.at).toLocaleString()) + " · for the teacher only</p><table><thead><tr><th>Student</th><th>Score</th><th>%</th><th>Questions</th><th></th></tr></thead><tbody>" +
      rows + "</tbody></table></body></html>");
    doc.close();
    setTimeout(function () {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(function () { frame.remove(); }, 60000);
    }, 200);
  }

  document.querySelector("[data-grade-open]").addEventListener("click", openGrading);
  document.querySelector("[data-grade-close]").addEventListener("click", closeGrading);
  gradeDialog.addEventListener("click", function (e) { if (e.target === gradeDialog) closeGrading(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && gradeDialog.getAttribute("data-open") === "true") closeGrading();
  });
  document.querySelector("[data-grade-go]").addEventListener("click", startGrading);
  document.querySelector("[data-grade-again]").addEventListener("click", function () {
    gradeRun = null;
    openRow = -1;
    showSetup();
  });
  document.querySelector("[data-grade-csv]").addEventListener("click", downloadCSV);

  /* Keep a grade list in the Doodle Drawer (still teacher-only) */
  var gradeKeep = document.querySelector("[data-grade-keep]");
  var gradeDrawerBtn = document.querySelector("[data-grade-drawer]");
  if (window.DoodleDrawer) gradeKeep.innerHTML = window.DoodleDrawer.keepSelectHTML("schoolyear");
  else gradeDrawerBtn.parentNode.hidden = true;
  gradeDrawerBtn.addEventListener("click", function () {
    if (!gradeRun) return;
    var run = gradeRun;
    var scored = run.rows.map(scoreOf).filter(function (x) { return x.pct != null; });
    var avg = scored.length ? Math.round(scored.reduce(function (a, x) { return a + x.pct; }, 0) / scored.length) : null;
    gradeDrawerBtn.disabled = true;
    gradeDrawerBtn.textContent = "Saving…";
    window.DoodleDrawer.save({
      kind: "grades",
      title: room.name + " — " + String(run.title).replace(/^✨\s*/, ""),
      keep: gradeKeep.value,
      keepUntil: net.keepUntil(gradeKeep.value),
      count: run.rows.length,
      data: {
        roomName: room.name,
        average: avg,
        run: {
          at: run.at, page: run.page, title: run.title, keyCount: run.keyCount,
          rows: run.rows.map(function (row) {
            var sc = scoreOf(row);
            return { name: row.name, results: row.results, note: row.note, error: row.error,
                     got: sc.got, of: sc.of, pct: sc.pct, check: needsCheck(row) };
          })
        }
      }
    }).then(function (r) {
      gradeDrawerBtn.disabled = false;
      gradeDrawerBtn.textContent = r.ok ? "✅ Saved — save again" : "🗄️ Save to Doodle Drawer";
      window.doodleToast(r.ok ? "Grade list saved to your Doodle Drawer 🗄️ (only you can see it)" : r.error, r.ok ? "good" : "warn");
    });
  });
  document.querySelector("[data-grade-print]").addEventListener("click", printGrades);

  /* ---- A student presents their desk -----------------------------------------
     Only with the teacher's say-so: either the teacher picks a desk to show
     (focus view or class list), or — when "Let students ask to present" is on
     — a student asks and the teacher taps Present now. The student's desk
     then fills the teacher's screen (which the teacher is sharing), live:
     finished marks arrive as they're made and the mark being drawn is shown
     as it happens. Menus disappear, like Present mode on the teaching desk. */
  var allowBox = document.querySelector("[data-allow-present]");
  var requestsBox = document.querySelector("[data-present-requests]");
  var presentRoom = document.querySelector("[data-present-room]");
  var presentStage = document.querySelector("[data-present-stage]");
  var presentBar = document.querySelector("[data-present-room-bar]");
  var presentNameEl = document.querySelector("[data-present-name]");
  var nameToggle = document.querySelector("[data-present-name-toggle]");
  var presentBoard = null;
  var presentingId = null;
  var presentRequests = {};      /* studentId -> { name, at } */
  var presentIdle = null;
  var htmlEl = document.documentElement;

  allowBox.checked = !!room.allowPresent;
  allowBox.addEventListener("change", function () {
    net.updateRoom(room.code, { allowPresent: allowBox.checked });
    net.send("present-permission", { code: room.code, allow: allowBox.checked });
    if (!allowBox.checked) { presentRequests = {}; renderRequests(); }
    window.doodleToast(allowBox.checked
      ? "Students can now ask to present their desk 🙋"
      : "Asking to present is turned off");
  });

  function renderRequests() {
    var ids = Object.keys(presentRequests);
    requestsBox.hidden = !ids.length;
    requestsBox.innerHTML = ids.map(function (id) {
      var r = presentRequests[id];
      return '<div class="present-request"><span class="present-request__who">🙋 <strong>' + escape(r.name) +
        "</strong> would like to present their desk</span>" +
        '<span class="present-request__actions">' +
        '<button class="btn btn--primary" type="button" data-present-yes="' + id + '">🖥️ Present now</button>' +
        '<button class="btn" type="button" data-present-no="' + id + '">Not now</button></span></div>';
    }).join("");
  }

  requestsBox.addEventListener("click", function (e) {
    var yes = e.target.closest("[data-present-yes]");
    var no = e.target.closest("[data-present-no]");
    if (yes) startPresenting(yes.getAttribute("data-present-yes"));
    if (no) {
      var id = no.getAttribute("data-present-no");
      delete presentRequests[id];
      net.send("present-decline", { code: room.code, studentId: id });
      renderRequests();
    }
  });

  function presentWake() {
    if (!presentingId) return;
    htmlEl.classList.add("present-awake");
    clearTimeout(presentIdle);
    presentIdle = setTimeout(function () {
      if (!presentBar.matches(":hover")) htmlEl.classList.remove("present-awake");
    }, 2500);
  }

  function showName(on) {
    presentNameEl.hidden = !on;
    nameToggle.setAttribute("aria-pressed", String(on));
    nameToggle.textContent = on ? "🙈 Hide name" : "👀 Show name";
  }

  function startPresenting(studentId) {
    var s = findStudent(studentId);
    if (!s) return;
    /* Switching presenters: tell the last one they're done, stay on screen */
    if (presentingId && presentingId !== studentId) net.send("present-stop", { code: room.code, studentId: presentingId });
    var alreadyOn = Boolean(presentingId);
    delete presentRequests[studentId];
    renderRequests();
    if (focus.getAttribute("data-open") === "true") closeFocus();

    presentingId = studentId;
    presentNameEl.textContent = s.name + "’s desk";
    document.querySelector("[data-present-who]").textContent = "📺 " + s.name + " is presenting";
    showName(true);

    if (presentBoard) presentBoard.destroy();
    presentBoard = window.DoodleBoard(document.getElementById("present-board"), { readOnly: true });
    presentRoom.hidden = false;
    htmlEl.classList.add("presenting");
    var go = presentStage.requestFullscreen || presentStage.webkitRequestFullscreen;
    if (go && !alreadyOn) {
      try {
        var pr = go.call(presentStage);
        if (pr && pr.catch) pr.catch(function () {});
      } catch (e) {}
    }
    presentWake();

    /* The thumbnail shows right away; the full desk replaces it in a moment */
    net.send("present-start", { code: room.code, studentId: studentId });
    if (!net.isOnline(s)) window.doodleToast(s.name + " looks offline — showing their last saved desk", "warn");
  }

  function stopPresenting(quiet) {
    if (!presentingId) return;
    net.send("present-stop", { code: room.code, studentId: presentingId });
    presentingId = null;
    presentRoom.hidden = true;
    htmlEl.classList.remove("presenting", "present-awake");
    clearTimeout(presentIdle);
    if (presentBoard) { presentBoard.destroy(); presentBoard = null; }
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) try { exit.call(document); } catch (e) {}
    }
    if (!quiet) window.doodleToast("Presenting finished 🌟");
  }

  document.querySelector("[data-present-stop]").addEventListener("click", function () { stopPresenting(); });
  nameToggle.addEventListener("click", function () { showName(presentNameEl.hidden); });
  ["mousemove", "pointerdown", "touchstart"].forEach(function (ev) {
    presentStage.addEventListener(ev, presentWake, { passive: true });
  });
  presentBar.addEventListener("mouseleave", presentWake);
  ["fullscreenchange", "webkitfullscreenchange"].forEach(function (ev) {
    document.addEventListener(ev, function () {
      if (presentingId && !(document.fullscreenElement || document.webkitFullscreenElement)) stopPresenting();
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && presentingId) stopPresenting();
  });

  document.querySelector("[data-focus-present]").addEventListener("click", function () {
    if (focusId) startPresenting(focusId);
  });

  net.on("present-request", function (p) {
    if (p.code !== room.code) return;
    if (p.cancel || !allowBox.checked) {
      delete presentRequests[p.studentId];
    } else {
      var s = findStudent(p.studentId) || p.student || {};
      presentRequests[p.studentId] = { name: s.name || "A student", at: Date.now() };
      window.doodleToast("🙋 " + (s.name || "A student") + " would like to present");
    }
    renderRequests();
  });

  net.on("present-item", function (p) {
    if (p.code === room.code && p.studentId === presentingId && presentBoard) presentBoard.addItems(p.items || []);
  });

  net.on("present-live", function (p) {
    if (p.code === room.code && p.studentId === presentingId && presentBoard) presentBoard.setGhost(p.stroke);
  });

  /* ---- Live updates ----------------------------------------------------- */
  net.on("join", function (p) {
    if (p.code !== room.code) return;
    if (p.student) lockSentAt[p.student.id] = 0;
    if (p.student && remind(p.student.id)) return;
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
    if (p.code !== room.code) return;
    if (remind(p.studentId)) return;
    updateOne(p.studentId);
  });

  net.on("full-reply", function (p) {
    if (p.code === room.code) {
      snapshotReply(p);
      fullCollectors.slice().forEach(function (fn) { fn(p); });
      if (p.studentId === presentingId && presentBoard) presentBoard.setItems(p.items || []);
    }
    if (p.code !== room.code || p.studentId !== focusId || !focusBoard) return;
    focusBoard.setItems(p.items || []);
    document.querySelector("[data-focus-note]").textContent =
      "Draw here to leave a hint — it appears on their desk straight away.";
  });

  /* Across devices: start listening for this room's students. In one-browser
     mode this does nothing. */
  net.host();
  net.watch(room.code, "teacher");

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
