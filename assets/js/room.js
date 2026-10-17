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
          '<span class="pupil__name">' + (s.locked ? '<span title="Board paused" aria-label="Board paused">🔒 </span>' : "") + escape(s.name) + "</span>" +
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
          '<button class="chip chip--danger" type="button" data-remove-student="' + s.id + '">✕ Remove</button>' +
        "</td></tr>";
    }).join("");
  }

  document.querySelector("[data-roster-rows]").addEventListener("click", function (e) {
    var lock = e.target.closest("[data-lock-student]");
    var view = e.target.closest("[data-view-student]");
    var remove = e.target.closest("[data-remove-student]");
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
    window.doodleToast(locked ? s.name + "'s board is paused 🔒" : s.name + " can draw again ✏️", locked ? "warn" : "good");
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
  }

  function uploadedPages() {
    var pages = [];
    myUploads().forEach(function (u) { pages = pages.concat(u.pages); });
    return pages;
  }

  function fillTemplates(selected) {
    templateSelect.innerHTML = '<option value="">Choose a page…</option>' +
      window.DoodleTemplates.optionsHTML(selected || "", uploadedPages());
    if (selected) templateSelect.value = selected;
  }
  fillTemplates(room.template || "");

  document.querySelector("[data-send-template]").addEventListener("click", function () {
    var id = templateSelect.value;
    if (!id) {
      templateSelect.focus();
      return window.doodleToast("Pick a lesson page first 📄", "warn");
    }
    net.updateRoom(room.code, { template: id });
    net.send("template", { code: room.code, template: id });
    var label = templateSelect.options[templateSelect.selectedIndex].textContent;
    window.doodleToast(label + " sent to every board 📄");
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
      note('✨ The AI worksheet maker, uploading worksheets and Google Drive import are part of <strong>Teacher Pro</strong>. ' +
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
      '. Press <strong>Send to every board</strong> when you want students to see it.', "good");
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
                     answers: aiWorksheet.items.map(function (it) { return it.answer || ""; }) });
        fillTemplates(pages[0].id);
        setAIBusy(false);
        if (send) {
          net.updateRoom(room.code, { template: pages[0].id });
          net.send("template", { code: room.code, template: pages[0].id });
          window.doodleToast("“" + name + "” sent to every board 📤", "good");
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
  var focusUI = null;
  var focusId = null;
  var focusLockBtn = document.querySelector("[data-focus-lock]");

  function showFocusLock(locked) {
    focusLockBtn.setAttribute("aria-pressed", String(!!locked));
    focusLockBtn.textContent = locked ? "▶️ Let them draw" : "🔒 Pause their board";
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

    if (focusUI) focusUI.destroy();
    focusUI = window.DoodleBoardUI(focusBoard, focus.querySelector(".focus__panel"), {
      filename: s.name + "-board",
      printTitle: s.name + "'s board — " + room.name
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
    if (!window.confirm("Clear this student's board?")) return;
    net.send("clear-board", { code: room.code, studentId: focusId });
    net.setStudent(room.code, focusId, { thumb: "", marks: 0 });
    if (focusBoard) focusBoard.clear(true);
    render();
    window.doodleToast("Board cleared 🧹", "warn");
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
  function renderFull(items) {
    var c = document.createElement("canvas");
    var b = window.DoodleBoard(c, { readOnly: true });
    b.setItems(items || []);
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 5000); });
    return Promise.race([b.ready(), timeout]).then(function () {
      var img = b.toThumb(900, 0.8);
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
    snapBtn.textContent = "📸 Save snapshot";

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
      window.doodleToast("Snapshot saved — " + record.students.length + " boards 📸", "good");
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
    snapBtn.textContent = "📸 Saving…";

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

  function when(t) {
    return new Date(t).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function showSnapList() {
    openSnap = null;
    snapGallery.hidden = true;
    snapList.hidden = false;
    snapPrint.hidden = true;
    snapBack.hidden = true;
    snapTitle.textContent = "Saved snapshots";
    snapList.innerHTML = '<p class="small muted">Loading…</p>';
    SnapStore.list(room.code).then(function (all) {
      snapCache = all;
      snapList.innerHTML = all.length ? all.map(function (s) {
        return '<div class="snap-row">' +
          '<div><strong>' + escape(when(s.at)) + "</strong>" +
          '<span class="small muted"> · ' + s.students.length + " boards" + (s.prompt ? " · " + escape(s.prompt) : "") + "</span></div>" +
          '<div class="snap-row__actions">' +
            '<button class="btn" type="button" data-snap-view="' + escape(s.id) + '">👀 Open</button>' +
            '<button class="btn" type="button" data-snap-delete="' + escape(s.id) + '">🗑️ Delete</button>' +
          "</div></div>";
      }).join("") : '<div class="empty"><span>📸</span><p><strong>No snapshots yet.</strong><br>Press “Save snapshot” during a lesson to keep every board.</p></div>';
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
    snapTitle.textContent = when(s.at);
    snapGallery.innerHTML = s.students.map(function (st) {
      return '<figure class="pupil snap-card">' +
        (st.img ? '<img class="pupil__shot" src="' + st.img + '" alt="' + escape(st.name) + '’s board">' : '<div class="pupil__empty">blank board</div>') +
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
    if (p.code === room.code) snapshotReply(p);
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
