/* ==========================================================================
   Doodle Desk — the attendance page (attendance.html)
   Take attendance for a class on any day, look back over a date range,
   download it for the school, and keep the class list tidy.

     attendance.html              your first class, today
     attendance.html?class=<id>   that class
   ========================================================================== */
(function () {
  "use strict";

  var net = window.DoodleNet;
  var A = window.DoodleAttendance;
  if (!net || !A) return;

  if (!net.teacher()) {
    window.location.href = "login.html";
    return;
  }

  var params = new URLSearchParams(location.search);
  var VIEW_KEY = "doodle-att-view";
  var CLASS_KEY = "doodle-att-class";

  var currentId = params.get("class") || remembered(CLASS_KEY) || "";
  var view = "take";
  var date = A.today();
  var range = "month";

  var $ = function (sel) { return document.querySelector(sel); };
  var chipsEl = $("[data-class-chips]");
  var emptyEl = $("[data-empty]");
  var panelEl = $("[data-panel]");
  var gridEl = $("[data-grid]");
  var dateEl = $("[data-date]");
  var totalsEl = $("[data-totals]");
  var hintEl = $("[data-hint]");
  var syncEl = $("[data-sync]");
  var fromEl = $("[data-from]");
  var toEl = $("[data-to]");
  var historyEl = $("[data-history]");
  var listEl = $("[data-list]");

  function remembered(key) {
    try { return localStorage.getItem(key) || ""; } catch (e) { return ""; }
  }

  function remember(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function current() {
    var list = A.classes();
    var c = list.filter(function (x) { return x.id === currentId; })[0] || list[0] || null;
    currentId = c ? c.id : "";
    return c;
  }

  /* ---- Dates --------------------------------------------------------------- */
  function parse(key) {
    var p = key.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function shift(key, days) {
    var d = parse(key);
    d.setDate(d.getDate() + days);
    return A.dateKey(d);
  }

  function nice(key, long) {
    return parse(key).toLocaleDateString(undefined, long
      ? { weekday: "long", month: "long", day: "numeric", year: "numeric" }
      : { weekday: "short", month: "numeric", day: "numeric" });
  }

  function timeOf(ms) {
    return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  /* ---- Sync badge ------------------------------------------------------------ */
  var SYNC = {
    saved: "☁️ Saved to your account",
    saving: "Saving…",
    local: "💾 Saved on this computer",
    offline: "💾 Offline — saved on this computer, will sync when you're back"
  };

  function renderSync() {
    var s = A.status();
    syncEl.textContent = SYNC[s] || "";
    syncEl.setAttribute("data-state", s);
  }

  /* ---- Everything -------------------------------------------------------------- */
  function render() {
    renderSync();
    var list = A.classes();
    var c = current();

    chipsEl.innerHTML = list.map(function (x) {
      return '<button class="chip" type="button" data-class="' + x.id + '" aria-pressed="' + String(x.id === currentId) + '">' +
        esc(x.name) + " <b>" + x.order.length + "</b></button>";
    }).join("");
    $(".att-classes").hidden = !list.length;
    emptyEl.hidden = list.length > 0;
    panelEl.hidden = !c;
    if (!c) return;

    remember(CLASS_KEY, c.id);
    $("[data-class-name]").textContent = c.name;
    var rooms = A.roomsFor(c.id);
    $("[data-class-rooms]").textContent = rooms.length
      ? "Filled in from " + rooms.map(function (r) { return r.name + " (" + r.code + ")"; }).join(", ") + " when students join"
      : "Not linked to a room — set one in Edit class to mark students present when they join";

    document.querySelectorAll("[data-view]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === view));
      b.setAttribute("aria-selected", String(b.getAttribute("data-view") === view));
    });
    document.querySelectorAll("[data-pane]").forEach(function (p) {
      p.hidden = p.getAttribute("data-pane") !== view;
    });

    if (view === "take") renderTake(c);
    if (view === "history") renderHistory(c);
    if (view === "edit") renderEdit(c);
  }

  /* ---- Take attendance ------------------------------------------------------------ */
  var LABEL = { p: "Present", l: "Late", a: "Absent" };
  var ICON = { p: "✅", l: "⏰", a: "❌" };

  function renderTake(c) {
    dateEl.value = date;
    var marks = A.day(c.id, date);
    var counts = { p: 0, l: 0, a: 0, none: 0 };

    gridEl.innerHTML = c.order.map(function (sid, i) {
      var st = c.students[sid];
      var m = marks[sid] || {};
      var s = m.s || "";
      counts[s || "none"]++;
      var note = "";
      if (m.joinedAt) note = "Joined at " + timeOf(m.joinedAt) + (m.auto && s === "p" ? " · marked for you" : "");
      return '<div class="att-card" data-s="' + (s || "none") + '" data-sid="' + sid + '">' +
        '<div class="att-card__top"><span class="att-card__num">' + (i + 1) + "</span>" +
          '<span class="att-card__name">' + esc(st.name) + "</span>" +
          (st.joined ? '<button class="att-new" type="button" data-confirm="' + sid + '" title="Added when they joined a room — tap once you have checked the name">New ✓</button>' : "") +
        "</div>" +
        '<div class="att-seg" role="group" aria-label="' + esc(st.name) + '">' +
          ["p", "l", "a"].map(function (k) {
            return '<button type="button" class="att-seg__btn" data-mark="' + k + '" aria-pressed="' + String(s === k) + '">' +
              '<span aria-hidden="true">' + ICON[k] + "</span> " + LABEL[k] + "</button>";
          }).join("") +
        "</div>" +
        '<p class="att-card__note">' + esc(note) + "</p>" +
      "</div>";
    }).join("") || '<p class="muted">No students in this class yet — add some in <strong>Edit class</strong>, or they\'ll appear as they join your room.</p>';

    totalsEl.innerHTML =
      '<span class="att-pill" data-s="p">✅ Present <b>' + counts.p + "</b></span>" +
      '<span class="att-pill" data-s="l">⏰ Late <b>' + counts.l + "</b></span>" +
      '<span class="att-pill" data-s="a">❌ Absent <b>' + counts.a + "</b></span>" +
      '<span class="att-pill" data-s="none">Not marked <b>' + counts.none + "</b></span>";

    var isToday = date === A.today();
    hintEl.textContent = (isToday ? "Today, " : "") + nice(date, true) +
      " · tap a mark again to clear it. Students marked absent stay absent even if they join later — you decide." +
      (c.order.some(function (sid) { return c.students[sid].joined; })
        ? " “New” means they were added when they joined a room — tap it once you've checked the name." : "");
    $("[data-today]").hidden = isToday;
    $("[data-day='1']").disabled = isToday;
  }

  gridEl.addEventListener("click", function (e) {
    var c = current();
    if (!c) return;
    var confirmBtn = e.target.closest("[data-confirm]");
    if (confirmBtn) {
      A.confirmStudent(c.id, confirmBtn.getAttribute("data-confirm"));
      return;
    }
    var btn = e.target.closest("[data-mark]");
    if (!btn) return;
    var sid = btn.closest("[data-sid]").getAttribute("data-sid");
    var k = btn.getAttribute("data-mark");
    A.mark(c.id, date, sid, btn.getAttribute("aria-pressed") === "true" ? "" : k);
  });

  document.querySelectorAll("[data-rest]").forEach(function (b) {
    b.addEventListener("click", function () {
      var c = current();
      if (!c) return;
      var marks = A.day(c.id, date);
      var rest = c.order.filter(function (sid) { return !(marks[sid] && marks[sid].s); });
      if (!rest.length) return window.doodleToast("Everyone already has a mark");
      A.markMany(c.id, date, rest, b.getAttribute("data-rest"));
      window.doodleToast(rest.length + " marked " + LABEL[b.getAttribute("data-rest")].toLowerCase());
    });
  });

  $("[data-clear-day]").addEventListener("click", function () {
    var c = current();
    if (!c) return;
    var marks = A.day(c.id, date);
    var marked = Object.keys(marks).filter(function (sid) { return marks[sid].s; });
    if (!marked.length) return;
    if (!window.confirm("Clear every mark for " + nice(date, true) + "?")) return;
    A.markMany(c.id, date, marked, "");
  });

  dateEl.addEventListener("change", function () {
    if (!dateEl.value) return;
    date = dateEl.value > A.today() ? A.today() : dateEl.value;
    render();
  });
  document.querySelectorAll("[data-day]").forEach(function (b) {
    b.addEventListener("click", function () {
      var next = shift(date, +b.getAttribute("data-day"));
      if (next > A.today()) return;
      date = next;
      render();
    });
  });
  $("[data-today]").addEventListener("click", function () { date = A.today(); render(); });
  dateEl.max = A.today();

  /* ---- History ------------------------------------------------------------------ */
  function setRange(name) {
    range = name;
    var now = new Date();
    var t = A.today();
    if (name === "week") {
      var d = new Date(now);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   /* back to Monday */
      fromEl.value = A.dateKey(d);
      toEl.value = t;
    } else if (name === "month") {
      fromEl.value = A.dateKey(new Date(now.getFullYear(), now.getMonth(), 1));
      toEl.value = t;
    } else if (name === "last") {
      fromEl.value = A.dateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      toEl.value = A.dateKey(new Date(now.getFullYear(), now.getMonth(), 0));
    } else if (name === "all") {
      fromEl.value = "";
      toEl.value = "";
    }
    document.querySelectorAll("[data-range]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-range") === name));
    });
  }

  /* Rows of students, columns of days that have at least one mark */
  function historyData(c) {
    var days = (A.book().records[c.id]) || {};
    var from = fromEl.value || "0000-00-00";
    var to = toEl.value || "9999-99-99";
    var dates = Object.keys(days).filter(function (d) {
      if (d < from || d > to) return false;
      var marks = days[d];
      return Object.keys(marks).some(function (sid) { return marks[sid].s; });
    }).sort();

    /* Everyone on the list, then anyone taken off it who has marks here */
    var ids = c.order.slice();
    Object.keys(c.students).forEach(function (sid) {
      if (ids.indexOf(sid) >= 0) return;
      var has = dates.some(function (d) { return days[d][sid] && days[d][sid].s; });
      if (has) ids.push(sid);
    });

    var rows = ids.map(function (sid) {
      var st = c.students[sid];
      var tally = { p: 0, l: 0, a: 0 };
      var cells = dates.map(function (d) {
        var m = days[d][sid];
        var s = (m && m.s) || "";
        if (s) tally[s]++;
        return s;
      });
      var taken = tally.p + tally.l + tally.a;
      return {
        name: st ? st.name : "Student",
        left: !!(st && st.left),
        cells: cells,
        tally: tally,
        pct: taken ? Math.round(((tally.p + tally.l) / taken) * 100) : null
      };
    });
    return { dates: dates, rows: rows };
  }

  function renderHistory(c) {
    var h = historyData(c);
    if (!h.dates.length) {
      historyEl.innerHTML = '<p class="muted att-none">No attendance taken ' +
        (fromEl.value || toEl.value ? "between those dates" : "for this class yet") + ".</p>";
      return;
    }
    var perDay = h.dates.map(function (d, i) {
      return h.rows.filter(function (r) { return r.cells[i] === "p" || r.cells[i] === "l"; }).length;
    });
    historyEl.innerHTML =
      '<table class="grade-table att-table"><thead><tr><th scope="col">Student</th>' +
      h.dates.map(function (d) {
        var p = nice(d).split(", ");
        return '<th scope="col" class="att-table__day"><span>' + esc(p[0]) + "</span>" + esc(p[1] || "") + "</th>";
      }).join("") +
      '<th scope="col" class="att-table__sum">Present</th><th scope="col" class="att-table__sum">Late</th>' +
      '<th scope="col" class="att-table__sum">Absent</th><th scope="col" class="att-table__sum">Attended</th></tr></thead><tbody>' +
      h.rows.map(function (r) {
        return "<tr><th scope=\"row\">" + esc(r.name) + (r.left ? ' <span class="small muted">(off the list)</span>' : "") + "</th>" +
          r.cells.map(function (s) {
            return '<td class="att-cell" data-s="' + (s || "none") + '">' + (s ? s.toUpperCase() : "") + "</td>";
          }).join("") +
          '<td class="att-table__sum">' + r.tally.p + '</td><td class="att-table__sum">' + r.tally.l +
          '</td><td class="att-table__sum">' + r.tally.a + '</td><td class="att-table__sum"><strong>' +
          (r.pct == null ? "—" : r.pct + "%") + "</strong></td></tr>";
      }).join("") +
      '</tbody><tfoot><tr><th scope="row">Here each day</th>' +
      perDay.map(function (n) { return '<td class="att-cell">' + n + "</td>"; }).join("") +
      '<td colspan="4"></td></tr></tfoot></table>';
  }

  function rangeLabel() {
    if (!fromEl.value && !toEl.value) return "all dates";
    return (fromEl.value ? nice(fromEl.value) : "the start") + " to " + (toEl.value ? nice(toEl.value) : "today");
  }

  function fileName(c, ext) {
    return (c.name + " attendance " + (fromEl.value || "") + (toEl.value ? " to " + toEl.value : ""))
      .replace(/[^\w\s.()-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 100) + "." + ext;
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  $("[data-csv]").addEventListener("click", function () {
    var c = current();
    if (!c) return;
    var h = historyData(c);
    if (!h.dates.length) return window.doodleToast("No attendance to download for those dates", "warn");
    var head = ["Student"].concat(h.dates, ["Present", "Late", "Absent", "Attendance %"]);
    var lines = [head.map(csvCell).join(",")];
    h.rows.forEach(function (r) {
      lines.push([r.name].concat(r.cells.map(function (s) { return s.toUpperCase(); }),
        [r.tally.p, r.tally.l, r.tally.a, r.pct == null ? "" : r.pct + "%"]).map(csvCell).join(","));
    });
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName(c, "csv");
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });

  $("[data-print]").addEventListener("click", function () {
    var c = current();
    if (!c) return;
    var h = historyData(c);
    if (!h.dates.length) return window.doodleToast("No attendance to print for those dates", "warn");
    var t = net.teacher() || {};
    var colour = { p: "#d6f5ea", l: "#fff1c7", a: "#ffe0d8" };
    var frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    var doc = frame.contentWindow.document;
    doc.open();
    doc.write("<!doctype html><html><head><meta charset='utf-8'><title>" + esc(c.name) + " — attendance</title><style>" +
      "@page{size:landscape;margin:12mm}body{font-family:Nunito,'Segoe UI',Arial,sans-serif;color:#241a3d}" +
      "h1{font-size:17pt;margin:0 0 1mm}p{margin:0 0 5mm;color:#6b5f86;font-size:10pt}" +
      "table{border-collapse:collapse;width:100%;font-size:9pt}th,td{border:1px solid #cfc6e0;padding:1.4mm 1.6mm;text-align:center}" +
      "th:first-child,td:first-child{text-align:left;white-space:nowrap}thead th{font-size:8pt;color:#6b5f86}" +
      "td{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body><h1>" + esc(c.name) + " — attendance</h1><p>" +
      esc(rangeLabel()) + (t.name ? " · " + esc(t.name) : "") + " · P present, L late, A absent</p><table><thead><tr><th>Student</th>" +
      h.dates.map(function (d) { return "<th>" + esc(nice(d)) + "</th>"; }).join("") +
      "<th>P</th><th>L</th><th>A</th><th>%</th></tr></thead><tbody>" +
      h.rows.map(function (r) {
        return "<tr><td>" + esc(r.name) + "</td>" + r.cells.map(function (s) {
          return "<td" + (s ? " style='background:" + colour[s] + "'" : "") + ">" + s.toUpperCase() + "</td>";
        }).join("") + "<td>" + r.tally.p + "</td><td>" + r.tally.l + "</td><td>" + r.tally.a + "</td><td>" +
        (r.pct == null ? "—" : r.pct + "%") + "</td></tr>";
      }).join("") + "</tbody></table></body></html>");
    doc.close();
    setTimeout(function () {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(function () { frame.remove(); }, 60000);
    }, 200);
  });

  document.querySelectorAll("[data-range]").forEach(function (b) {
    b.addEventListener("click", function () { setRange(b.getAttribute("data-range")); render(); });
  });
  [fromEl, toEl].forEach(function (el) {
    el.addEventListener("change", function () {
      document.querySelectorAll("[data-range]").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
      render();
    });
  });

  /* ---- Edit class ------------------------------------------------------------------ */
  function renderEdit(c) {
    var rename = $("[data-rename]");
    if (document.activeElement !== rename) rename.value = c.name;

    var link = $("[data-room-link]");
    var rooms = net.listRooms();
    var linked = rooms.filter(function (r) { return r.attendance === c.id; })[0];
    link.innerHTML = '<option value="">— No room —</option>' + rooms.map(function (r) {
      var elsewhere = r.attendance && r.attendance !== c.id && A.getClass(r.attendance);
      return '<option value="' + r.code + '"' + (linked && linked.code === r.code ? " selected" : "") + ">" +
        esc(r.name + " · " + r.code) + (elsewhere ? " (now fills " + esc(elsewhere.name) + ")" : "") + "</option>";
    }).join("");

    listEl.innerHTML = c.order.map(function (sid, i) {
      var st = c.students[sid];
      return '<li class="att-row" draggable="true" data-sid="' + sid + '" data-i="' + i + '">' +
        '<span class="att-row__grip" aria-hidden="true">⠿</span>' +
        '<span class="att-row__num">' + (i + 1) + "</span>" +
        '<input class="cp__input att-row__name" type="text" maxlength="40" value="' + esc(st.name) + '" aria-label="Name of student ' + (i + 1) + '" data-name>' +
        (st.joined ? '<span class="badge badge--sky att-row__tag" title="Added when they joined a room">joined</span>' : "") +
        '<button class="icon-btn" type="button" data-up aria-label="Move ' + esc(st.name) + ' up"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
        '<button class="icon-btn" type="button" data-down aria-label="Move ' + esc(st.name) + ' down"' + (i === c.order.length - 1 ? " disabled" : "") + ">↓</button>" +
        '<button class="chip chip--danger" type="button" data-remove>✕ Remove</button>' +
      "</li>";
    }).join("") || '<li class="muted att-row--empty">No students yet.</li>';
  }

  $("[data-rename]").addEventListener("change", function (e) {
    var c = current();
    if (c && e.target.value.trim()) A.renameClass(c.id, e.target.value);
  });

  $("[data-room-link]").addEventListener("change", function (e) {
    var c = current();
    if (!c) return;
    net.listRooms().forEach(function (r) {
      if (r.attendance === c.id && r.code !== e.target.value) A.linkRoom(r.code, "off");
    });
    if (e.target.value) {
      A.linkRoom(e.target.value, c.id);
      window.doodleToast("Students who join that room will be marked present here ✅");
    }
    render();
  });

  listEl.addEventListener("change", function (e) {
    var c = current();
    var row = e.target.closest("[data-sid]");
    if (c && row && e.target.matches("[data-name]")) A.renameStudent(c.id, row.getAttribute("data-sid"), e.target.value);
  });

  listEl.addEventListener("click", function (e) {
    var c = current();
    var row = e.target.closest("[data-sid]");
    if (!c || !row) return;
    var sid = row.getAttribute("data-sid");
    var i = +row.getAttribute("data-i");
    if (e.target.closest("[data-up]")) A.moveStudent(c.id, i, i - 1);
    if (e.target.closest("[data-down]")) A.moveStudent(c.id, i, i + 1);
    if (e.target.closest("[data-remove]")) {
      var name = c.students[sid].name;
      if (!window.confirm("Take " + name + " off " + c.name + "? Their past attendance stays in the history.")) return;
      A.removeStudent(c.id, sid);
    }
  });

  /* Drag to reorder, like the old tracker */
  var dragFrom = null;
  listEl.addEventListener("dragstart", function (e) {
    var row = e.target.closest("[data-i]");
    if (!row) return;
    dragFrom = +row.getAttribute("data-i");
    row.classList.add("is-dragging");
    try { e.dataTransfer.setData("text/plain", String(dragFrom)); } catch (err) {}
  });
  listEl.addEventListener("dragover", function (e) { if (dragFrom !== null) e.preventDefault(); });
  listEl.addEventListener("drop", function (e) {
    var row = e.target.closest("[data-i]");
    var c = current();
    if (!row || !c || dragFrom === null) return;
    e.preventDefault();
    var to = +row.getAttribute("data-i");
    if (to !== dragFrom) A.moveStudent(c.id, dragFrom, to);
    dragFrom = null;
  });
  listEl.addEventListener("dragend", function () { dragFrom = null; render(); });

  $("[data-add]").addEventListener("click", function () {
    var c = current();
    var box = $("[data-add-text]");
    if (!c) return;
    var names = box.value.split(/\r?\n|,|\t/).map(function (n) { return n.trim(); }).filter(Boolean);
    if (!names.length) return box.focus();
    names.forEach(function (n) { A.addStudent(c.id, n); });
    box.value = "";
    window.doodleToast(names.length === 1 ? names[0] + " added" : names.length + " students added", "good");
  });

  $("[data-delete-class]").addEventListener("click", function () {
    var c = current();
    if (!c) return;
    if (!window.confirm("Delete " + c.name + " and all of its attendance? This can't be undone — download the history first if you need it.")) return;
    A.deleteClass(c.id);
    currentId = "";
    view = "take";
    window.doodleToast(c.name + " was deleted", "warn");
  });

  /* ---- Classes ------------------------------------------------------------------------ */
  chipsEl.addEventListener("click", function (e) {
    var b = e.target.closest("[data-class]");
    if (!b) return;
    currentId = b.getAttribute("data-class");
    render();
  });

  document.querySelectorAll("[data-new-class]").forEach(function (b) {
    b.addEventListener("click", function () {
      var name = window.prompt("What's the class called?", "");
      if (!name || !name.trim()) return;
      currentId = A.createClass(name.trim(), []);
      view = "edit";
      render();
      $("[data-add-text]").focus();
    });
  });

  document.querySelectorAll("[data-view]").forEach(function (b) {
    b.addEventListener("click", function () {
      view = b.getAttribute("data-view");
      remember(VIEW_KEY, view === "edit" ? "take" : view);
      render();
    });
  });

  /* ---- Start ---------------------------------------------------------------------------- */
  view = remembered(VIEW_KEY) === "history" ? "history" : "take";
  setRange("month");
  var brought = A.bringOverOld();
  if (brought) window.doodleToast("Brought over " + brought + (brought === 1 ? " class" : " classes") + " from the old attendance tracker 📋", "good");

  /* Re-draw on changes — but not while typing a name */
  A.onChange(function () {
    var a = document.activeElement;
    if (a && (a.matches("[data-name], [data-rename], [data-add-text]"))) return renderSync();
    render();
  });
  render();
  A.load();
})();
