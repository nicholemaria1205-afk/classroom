/* ==========================================================================
   Doodle Desk — student portfolios (portfolio.html)
   One page per student, gathered from what the teacher already keeps:
     · attendance — from the attendance book (attendance-core.js)
     · grades, poll answers and saved desks — from the Doodle Drawer
       (grade lists, polls and snapshots, including partner desks)
     · stars this week — from the rooms in this browser
   Names are matched the way attendance matches them: the same name, or a
   first name only one student in the class has ("Ava" ↔ "Ava Brown").

     portfolio.html?class=<id>&student=<id>
   ========================================================================== */
(function () {
  "use strict";

  var net = window.DoodleNet;
  var A = window.DoodleAttendance;
  var Drawer = window.DoodleDrawer;
  if (!net || !A) return;

  if (!net.teacher()) {
    window.location.href = "login.html";
    return;
  }

  var params = new URLSearchParams(location.search);
  var classId = params.get("class") || "";
  var studentId = params.get("student") || "";
  var $ = function (sel) { return document.querySelector(sel); };
  var sheet = $("[data-pf-sheet]");
  var allRooms = $("[data-pf-allrooms]");
  var pads = null;        /* the Drawer's grade lists, polls and snapshots, opened */
  var loading = null;

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function norm(n) { return String(n || "").trim().replace(/\s+/g, " ").toLowerCase(); }
  function first(n) { return norm(n).split(" ")[0]; }
  function day(t) { return new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }); }

  function currentClass() {
    var list = A.classes();
    var c = list.filter(function (x) { return x.id === classId; })[0] || list[0] || null;
    classId = c ? c.id : "";
    return c;
  }

  /* Does a name in a record belong to this student? */
  function matcher(c, sid) {
    var me = c.students[sid];
    var mine = norm(me.name);
    var myFirst = first(me.name);
    var sameFirst = c.order.filter(function (id) { return first(c.students[id].name) === myFirst; }).length;
    return function (name) {
      var n = norm(name);
      if (!n) return false;
      if (n === mine) return true;
      /* "Ava" in a record, "Ava Brown" on the list — only if she's the only Ava */
      return sameFirst === 1 && (n === myFirst || first(n) === myFirst && n.indexOf(" ") < 0);
    };
  }

  /* Rooms whose saved work counts for this class */
  function roomNames(c) {
    var names = {};
    names[norm(c.name)] = true;
    A.roomsFor(c.id).forEach(function (r) { names[norm(r.name)] = true; });
    return names;
  }

  /* ---- The Drawer --------------------------------------------------------------- */
  function loadPads() {
    if (pads) return Promise.resolve(pads);
    if (loading) return loading;
    if (!Drawer) return Promise.resolve([]);
    loading = Drawer.list().then(function (r) {
      var wanted = (r.pads || []).filter(function (p) { return p.kind === "grades" || p.kind === "poll" || p.kind === "snapshot"; })
        .slice(0, 60);
      /* Open them a few at a time */
      var out = [];
      var i = 0;
      function next() {
        var batch = wanted.slice(i, i + 4);
        i += 4;
        if (!batch.length) return Promise.resolve(out);
        return Promise.all(batch.map(function (p) {
          return Drawer.get(p.id).then(function (g) { if (g.ok && g.pad) out.push(g.pad); });
        })).then(next);
      }
      return next();
    }).then(function (list) {
      pads = list;
      loading = null;
      return pads;
    });
    return loading;
  }

  /* ---- Lists ------------------------------------------------------------------------ */
  function renderClasses() {
    var list = A.classes();
    $("[data-pf-empty]").hidden = list.length > 0;
    $("[data-pf-main]").hidden = !list.length;
    if (!list.length) return;
    var c = currentClass();
    $("[data-pf-classes]").innerHTML = list.map(function (x) {
      return '<button class="chip" type="button" data-pf-class="' + x.id + '" aria-pressed="' + String(x.id === c.id) + '">' +
        esc(x.name) + " <b>" + x.order.length + "</b></button>";
    }).join("");
    renderStudents();
  }

  function renderStudents() {
    var c = currentClass();
    if (!c) return;
    var q = norm($("[data-pf-search]").value);
    var ids = c.order.filter(function (id) { return !q || norm(c.students[id].name).indexOf(q) >= 0; });
    $("[data-pf-students]").innerHTML = ids.map(function (id) {
      return '<li><button class="pf-student" type="button" data-pf-student="' + id + '" aria-current="' + String(id === studentId) + '">' +
        esc(c.students[id].name) + "</button></li>";
    }).join("") || '<li class="muted small">' + (c.order.length ? "Nobody by that name." : "No students in this class yet.") + "</li>";
  }

  /* ---- One student ------------------------------------------------------------------- */
  function gather(c, sid) {
    var isMe = matcher(c, sid);
    var rooms = roomNames(c);
    var everywhere = allRooms.checked;
    var mine = { grades: [], polls: [], desks: [] };

    (pads || []).forEach(function (p) {
      var d = p.data || {};
      if (!everywhere && d.roomName && !rooms[norm(d.roomName)]) return;
      if (p.kind === "grades") {
        ((d.run && d.run.rows) || []).forEach(function (row) {
          if (isMe(row.name)) mine.grades.push({ title: (d.run.title || p.title).replace(/^✨\s*/, ""), at: d.run.at || p.createdAt, got: row.got, of: row.of, pct: row.pct, room: d.roomName });
        });
      } else if (p.kind === "poll") {
        var label = {};
        (d.options || []).forEach(function (o) { label[o.key] = o.label + (o.text ? " — " + o.text : ""); });
        (d.answers || []).forEach(function (a) {
          if (isMe(a.name)) mine.polls.push({ q: d.q || "Quick poll", a: d.type === "text" ? a.a : (label[a.a] || a.a), at: a.at || d.at || p.createdAt });
        });
      } else if (p.kind === "snapshot") {
        (d.students || []).forEach(function (s) {
          if (!s.img) return;
          var hit = isMe(s.name);
          /* Partner desks are saved as "Group 1 — Ava & Sam" */
          if (!hit && / — /.test(s.name)) {
            hit = s.name.split(" — ").slice(1).join(" — ").split(/\s*&\s*/).some(isMe);
          }
          if (hit) mine.desks.push({ img: s.img, at: d.at || p.createdAt, title: d.prompt === "Partner desks" ? s.name.split(" — ")[0] + " (partner desk)" : (d.prompt || p.title) });
        });
      }
    });
    mine.grades.sort(function (a, b) { return b.at - a.at; });
    mine.polls.sort(function (a, b) { return b.at - a.at; });
    mine.desks.sort(function (a, b) { return b.at - a.at; });
    return mine;
  }

  function attendanceOf(c, sid) {
    var days = (A.book().records[c.id]) || {};
    var t = { p: 0, l: 0, a: 0 };
    var recent = [];
    Object.keys(days).sort().forEach(function (d) {
      var m = days[d][sid];
      if (m && m.s) {
        t[m.s]++;
        recent.push({ d: d, s: m.s });
      }
    });
    var taken = t.p + t.l + t.a;
    return { t: t, pct: taken ? Math.round(((t.p + t.l) / taken) * 100) : null, recent: recent.slice(-15) };
  }

  /* Stars this week, from the rooms in this browser that fill this class */
  function starsOf(c, sid) {
    var S = window.DoodleActivities && window.DoodleActivities.stars;
    if (!S) return 0;
    var isMe = matcher(c, sid);
    var rooms = roomNames(c);
    var total = 0;
    net.listRooms().forEach(function (r) {
      if (!allRooms.checked && !rooms[norm(r.name)] && r.attendance !== c.id) return;
      var s = r.stars;
      if (!s || s.week !== S.weekKey()) return;
      Object.keys(s.points || {}).forEach(function (k) { if (isMe(s.points[k].name)) total += s.points[k].n; });
    });
    return total;
  }

  function noteKey(sid) { return "doodle-pf-note-" + sid; }

  function renderSheet() {
    var c = currentClass();
    if (!c || !studentId || !c.students[studentId]) {
      sheet.innerHTML = '<p class="muted">Pick a student to see their portfolio.</p>';
      return;
    }
    var st = c.students[studentId];
    var att = attendanceOf(c, studentId);
    var stars = starsOf(c, studentId);
    var note = "";
    try { note = localStorage.getItem(noteKey(studentId)) || ""; } catch (e) {}

    var head = '<div class="pf-head"><div><h2 class="pf-name">' + esc(st.name) + '</h2><p class="small muted mb-0">' + esc(c.name) +
      " · portfolio made " + day(Date.now()) + "</p></div>" +
      '<button class="btn btn--sun" type="button" data-pf-print>🖨️ Print / PDF</button></div>';

    var attHTML = '<section class="pf-sec"><h3>📋 Attendance</h3><div class="att-totals">' +
      '<span class="att-pill" data-s="p">✅ Present <b>' + att.t.p + "</b></span>" +
      '<span class="att-pill" data-s="l">⏰ Late <b>' + att.t.l + "</b></span>" +
      '<span class="att-pill" data-s="a">❌ Absent <b>' + att.t.a + "</b></span>" +
      '<span class="att-pill">Attended <b>' + (att.pct == null ? "—" : att.pct + "%") + "</b></span>" +
      (stars ? '<span class="att-pill pf-stars">⭐ <b>' + stars + "</b> this week</span>" : "") +
      "</div>" + (att.recent.length ? '<div class="pf-days" aria-label="Recent days">' + att.recent.map(function (r) {
        var d = r.d.split("-");
        return '<span class="att-cell pf-day" data-s="' + r.s + '" title="' + esc(r.d) + '">' + (+d[1]) + "/" + (+d[2]) + "<b>" + r.s.toUpperCase() + "</b></span>";
      }).join("") + "</div>" : '<p class="small muted mb-0">No attendance taken yet.</p>') + "</section>";

    sheet.innerHTML = head + attHTML + '<div data-pf-drawer><p class="muted">Gathering grades, polls and saved desks from your Doodle Drawer…</p></div>' +
      '<section class="pf-sec"><h3><label for="pf-note">✏️ Conference notes</label></h3>' +
      '<textarea class="cp__input pf-note" id="pf-note" rows="4" placeholder="Strengths, goals, things to share with family… (saved on this computer)" data-pf-note>' + esc(note) + "</textarea></section>";

    loadPads().then(function () {
      if (!studentId || !c.students[studentId]) return;
      var box = sheet.querySelector("[data-pf-drawer]");
      if (!box) return;
      var mine = gather(c, studentId);
      var graded = mine.grades.filter(function (g) { return g.pct != null; });
      var avg = graded.length ? Math.round(graded.reduce(function (n, g) { return n + g.pct; }, 0) / graded.length) : null;

      box.innerHTML =
        '<section class="pf-sec"><h3>📝 Grades' + (avg != null ? ' <span class="act__sub">average ' + avg + "%</span>" : "") + "</h3>" +
          (mine.grades.length ? '<div class="grade-table-wrap"><table class="grade-table pf-table"><thead><tr><th>Assignment</th><th>Date</th><th>Score</th><th>%</th></tr></thead><tbody>' +
            mine.grades.map(function (g) {
              return "<tr><td>" + esc(g.title) + "</td><td>" + day(g.at) + "</td><td>" + (g.of ? g.got + " / " + g.of : "—") + "</td><td><strong>" + (g.pct == null ? "—" : g.pct + "%") + "</strong></td></tr>";
            }).join("") + "</tbody></table></div>"
            : '<p class="small muted mb-0">No saved grade lists with ' + esc(st.name) + " yet. Grade with AI, then “Save to Doodle Drawer”.</p>") +
        "</section>" +
        '<section class="pf-sec"><h3>📊 Polls &amp; exit tickets</h3>' +
          (mine.polls.length ? '<ul class="pf-polls">' + mine.polls.map(function (p) {
            return '<li><span class="small muted">' + day(p.at) + "</span><strong>" + esc(p.q) + "</strong><span>" + esc(p.a) + "</span></li>";
          }).join("") + "</ul>" : '<p class="small muted mb-0">No saved polls with an answer from ' + esc(st.name) + " yet.</p>") +
        "</section>" +
        '<section class="pf-sec"><h3>📸 Saved desks</h3>' +
          (mine.desks.length ? '<div class="pf-desks">' + mine.desks.map(function (d) {
            return '<figure class="pf-desk"><img src="' + d.img + '" alt="' + esc(st.name) + "’s desk — " + esc(d.title) + '" loading="lazy"><figcaption><strong>' +
              esc(d.title) + "</strong> · " + day(d.at) + "</figcaption></figure>";
          }).join("") + "</div>" : '<p class="small muted mb-0">No saved snapshots with ' + esc(st.name) + "’s desk yet.</p>") +
        "</section>";
      box.setAttribute("data-ready", "true");
    });
  }

  /* ---- Print ---------------------------------------------------------------------------- */
  function print() {
    var copy = sheet.cloneNode(true);
    copy.querySelectorAll("[data-pf-print]").forEach(function (b) { b.remove(); });
    var ta = copy.querySelector("textarea");
    if (ta) {
      var p = document.createElement("p");
      p.className = "pf-note-print";
      p.textContent = sheet.querySelector("textarea").value || "—";
      ta.replaceWith(p);
    }
    var frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    var doc = frame.contentWindow.document;
    doc.open();
    doc.write("<!doctype html><html><head><meta charset='utf-8'><title>Portfolio</title><style>" +
      "@page{margin:14mm}body{font-family:Nunito,'Segoe UI',Arial,sans-serif;color:#241a3d;font-size:10.5pt}" +
      "h2{font-size:20pt;margin:0}h3{font-size:12.5pt;margin:6mm 0 2mm;border-bottom:1px solid #ddd;padding-bottom:1mm}" +
      ".pf-head{margin-bottom:3mm}.small,.muted{color:#6b5f86;font-size:9pt}.att-totals{display:flex;gap:3mm;flex-wrap:wrap}" +
      ".att-pill{border:1px solid #ccc;border-radius:3mm;padding:1mm 2.5mm}.pf-days{display:flex;gap:1.5mm;flex-wrap:wrap;margin-top:2mm}" +
      ".pf-day{border:1px solid #ccc;border-radius:1.5mm;padding:1mm;font-size:8pt;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
      ".pf-day b{display:block}.pf-day[data-s=p]{background:#d6f5ea}.pf-day[data-s=l]{background:#fff1c7}.pf-day[data-s=a]{background:#ffe0d8}" +
      "table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:1.6mm;border-bottom:1px solid #ddd}" +
      ".pf-polls{list-style:none;padding:0;margin:0}.pf-polls li{display:grid;grid-template-columns:24mm 1fr 1fr;gap:3mm;padding:1.4mm 0;border-bottom:1px solid #eee}" +
      ".pf-desks{display:grid;grid-template-columns:1fr 1fr;gap:4mm}.pf-desk{margin:0;break-inside:avoid}.pf-desk img{width:100%;border:1px solid #ccc;border-radius:2mm}" +
      ".pf-desk figcaption{font-size:8.5pt;color:#6b5f86}.pf-note-print{white-space:pre-wrap;border:1px solid #ddd;border-radius:2mm;padding:3mm;min-height:20mm}" +
      ".act__sub{font-weight:600;color:#6b5f86;font-size:10pt}</style></head><body>" + copy.innerHTML + "</body></html>");
    doc.close();
    setTimeout(function () {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(function () { frame.remove(); }, 60000);
    }, 400);
  }

  /* ---- Events ------------------------------------------------------------------------------ */
  $("[data-pf-classes]").addEventListener("click", function (e) {
    var b = e.target.closest("[data-pf-class]");
    if (!b) return;
    classId = b.getAttribute("data-pf-class");
    studentId = "";
    renderClasses();
    renderSheet();
  });

  $("[data-pf-students]").addEventListener("click", function (e) {
    var b = e.target.closest("[data-pf-student]");
    if (!b) return;
    studentId = b.getAttribute("data-pf-student");
    history.replaceState(null, "", "portfolio.html?class=" + classId + "&student=" + studentId);
    renderStudents();
    renderSheet();
    if (window.innerWidth < 860) sheet.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("[data-pf-search]").addEventListener("input", renderStudents);
  allRooms.addEventListener("change", renderSheet);

  sheet.addEventListener("click", function (e) { if (e.target.closest("[data-pf-print]")) print(); });
  sheet.addEventListener("input", function (e) {
    if (e.target.matches("[data-pf-note]")) {
      try { localStorage.setItem(noteKey(studentId), e.target.value); } catch (err) {}
    }
  });

  A.onChange(function () {
    if (document.activeElement && document.activeElement.matches("[data-pf-note], [data-pf-search]")) return;
    renderClasses();
  });

  renderClasses();
  renderSheet();
  A.load().then(function () { renderClasses(); if (studentId) renderSheet(); });
  loadPads();
})();
