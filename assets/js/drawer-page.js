/* ==========================================================================
   Doodle Desk — the Doodle Drawer page (drawer.html)
   Browse, search, open, print, reuse, rename and delete Doodle Pads, and
   choose how long each one is kept.
   ========================================================================== */
(function () {
  "use strict";

  var net = window.DoodleNet;
  var Drawer = window.DoodleDrawer;
  if (!net || !Drawer) return;

  var who = net.teacher();
  if (!who) {
    window.location.href = "login.html";
    return;
  }

  var badge = document.querySelector("[data-teacher-badge]");
  if (badge) {
    badge.hidden = false;
    badge.textContent = "👩‍🏫 " + who.name;
  }

  var grid = document.querySelector("[data-pads]");
  var noteEl = document.querySelector("[data-drawer-note]");
  var search = document.querySelector("[data-search]");
  var pads = [];
  var kind = "all";
  var KIND = {
    worksheet: { label: "Worksheet", icon: "📄" },
    snapshot: { label: "Snapshot", icon: "📸" },
    grades: { label: "Grade list", icon: "📝" }
  };

  function escape(text) {
    return String(text == null ? "" : text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function day(t) {
    return new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }

  function note(html, k) {
    noteEl.hidden = !html;
    noteEl.setAttribute("data-kind", k || "info");
    noteEl.innerHTML = html || "";
  }

  function coverHTML(p) {
    if (p.kind === "worksheet" && p.pages && p.pages[0]) {
      var m = /^img:([a-f0-9]{32})$/.exec(p.pages[0].id);
      if (m) return '<img src="' + window.DoodleTemplates.assetUrl(m[1]) + '" alt="" loading="lazy">';
    }
    if (p.cover) return '<img src="' + p.cover + '" alt="" loading="lazy">';
    return '<span class="pad__emoji" aria-hidden="true">' + KIND[p.kind].icon + "</span>";
  }

  function render() {
    var q = search.value.trim().toLowerCase();
    ["all", "worksheet", "snapshot", "grades"].forEach(function (k) {
      document.querySelector('[data-count="' + k + '"]').textContent =
        pads.filter(function (p) { return k === "all" || p.kind === k; }).length;
    });

    var shown = pads.filter(function (p) {
      return (kind === "all" || p.kind === kind) && (!q || String(p.title).toLowerCase().indexOf(q) !== -1);
    });

    if (!pads.length) {
      grid.innerHTML = '<div class="empty drawer-empty"><span>🗄️</span><p><strong>Your Doodle Drawer is empty — for now!</strong><br>' +
        "Make a worksheet with ✨ Make with AI or upload one, and it lands here by itself. " +
        "Snapshots and grade lists have a “Save to Doodle Drawer” button.</p>" +
        '<a class="btn btn--primary" href="dashboard.html">Go to my rooms</a></div>';
      return;
    }
    if (!shown.length) {
      grid.innerHTML = '<div class="empty drawer-empty"><span>🔎</span><p><strong>Nothing matches that.</strong><br>Try another word, or show everything.</p></div>';
      return;
    }

    grid.innerHTML = shown.map(function (p) {
      var k = KIND[p.kind];
      var count = p.kind === "worksheet" ? p.count + (p.count === 1 ? " page" : " pages")
        : p.count + (p.count === 1 ? " student" : " students");
      var actions = p.kind === "worksheet"
        ? '<button class="btn btn--primary" type="button" data-use="' + p.id + '">📤 Use in a room</button>' +
          '<button class="btn" type="button" data-open-pad="' + p.id + '">👀 Open</button>'
        : '<button class="btn btn--primary" type="button" data-open-pad="' + p.id + '">👀 Open</button>';
      return '<article class="pad" data-pad="' + p.id + '">' +
        '<div class="pad__cover">' + coverHTML(p) + '<span class="badge pad__kind" data-kind="' + p.kind + '">' + k.icon + " " + k.label + "</span></div>" +
        '<div class="pad__body">' +
          '<h3 class="pad__title">' + escape(p.title) + "</h3>" +
          '<p class="small muted mb-0">' + count + " · saved " + day(p.createdAt) +
            (p.hasKey ? " · 🔑 answer key" : "") + "</p>" +
          '<label class="pad__keep"><span>🗓️</span><select class="paper-select" data-keep="' + p.id + '" aria-label="Keep ' + escape(p.title) + ' for">' +
            Drawer.keepSelectHTML(p.keep || "forever") + "</select></label>" +
          '<p class="small muted pad__until">' + escape(net.keepLabel(p.keepUntil)) + "</p>" +
          '<div class="pad__actions">' + actions +
            '<button class="btn btn--ghost" type="button" data-rename="' + p.id + '" aria-label="Rename">✏️</button>' +
            '<button class="btn btn--ghost" type="button" data-delete="' + p.id + '" aria-label="Delete">🗑️</button>' +
          "</div>" +
        "</div></article>";
    }).join("");
  }

  function load() {
    grid.innerHTML = '<p class="muted">Opening your Doodle Drawer…</p>';
    Drawer.list().then(function (r) {
      pads = r.pads || [];
      if (!r.ok) note("⚠️ " + escape(r.error) + (pads.length ? " Showing what this computer remembers." : ""), "warn");
      render();
    });
  }

  function find(id) { return pads.filter(function (p) { return p.id === id; })[0]; }

  /* ---- Filters & search ----------------------------------------------------- */
  document.querySelectorAll("[data-kind]").forEach(function (chip) {
    if (!chip.classList.contains("chip")) return;
    chip.addEventListener("click", function () {
      kind = chip.getAttribute("data-kind");
      document.querySelectorAll(".chip[data-kind]").forEach(function (c) {
        c.setAttribute("aria-pressed", String(c === chip));
      });
      render();
    });
  });
  search.addEventListener("input", render);

  /* ---- Card actions ----------------------------------------------------------- */
  grid.addEventListener("change", function (e) {
    var sel = e.target.closest("[data-keep]");
    if (!sel) return;
    var id = sel.getAttribute("data-keep");
    var until = net.keepUntil(sel.value);
    Drawer.update(id, { keep: sel.value, keepUntil: until }).then(function (r) {
      if (!r.ok) return window.doodleToast(r.error, "warn");
      pads = pads.map(function (p) { return p.id === id ? r.pad : p; });
      render();
      window.doodleToast("🗓️ " + net.keepLabel(until));
    });
  });

  grid.addEventListener("click", function (e) {
    var b;
    if ((b = e.target.closest("[data-open-pad]"))) return openPad(b.getAttribute("data-open-pad"));
    if ((b = e.target.closest("[data-use]"))) return useIn(b.getAttribute("data-use"));
    if ((b = e.target.closest("[data-rename]"))) {
      var p = find(b.getAttribute("data-rename"));
      var name = window.prompt("New name for this Doodle Pad:", p.title);
      if (!name || !name.trim()) return;
      return Drawer.update(p.id, { title: name.trim() }).then(function (r) {
        if (!r.ok) return window.doodleToast(r.error, "warn");
        pads = pads.map(function (x) { return x.id === p.id ? r.pad : x; });
        render();
      });
    }
    if ((b = e.target.closest("[data-delete]"))) {
      var d = find(b.getAttribute("data-delete"));
      if (!window.confirm("Delete “" + d.title + "” from your Doodle Drawer? This can't be undone.")) return;
      return Drawer.remove(d.id).then(function (r) {
        if (!r.ok) return window.doodleToast(r.error, "warn");
        pads = pads.filter(function (x) { return x.id !== d.id; });
        render();
        window.doodleToast("Deleted 🗑️");
      });
    }
  });

  /* ---- Use a worksheet in a room --------------------------------------------- */
  var useDialog = document.querySelector("div[data-use]");
  function openDialog(el) { el.setAttribute("data-open", "true"); document.body.style.overflow = "hidden"; }
  function closeDialog(el) { el.setAttribute("data-open", "false"); document.body.style.overflow = ""; }

  function useIn(id) {
    var p = find(id);
    if (!p || !p.pages || !p.pages.length) return;
    var rooms = net.listRooms();
    document.querySelector("[data-use-what]").innerHTML = "Pick the room for <strong>" + escape(p.title) + "</strong>" +
      (p.pages.length > 1 ? " — it starts on page 1, and the other pages are in the room's Lesson page list." : ".");
    document.querySelector("[data-use-rooms]").innerHTML = rooms.length ? rooms.map(function (r) {
      return '<a class="cp__tile" href="room.html?code=' + r.code + "&page=" + encodeURIComponent(p.pages[0].id) + '">' +
        '<span class="cp__tile-icon" aria-hidden="true">🚪</span>' +
        '<span class="cp__tile-text"><strong>' + escape(r.name) + "</strong><small>" + escape(r.subject) + " · " + r.code + "</small></span></a>";
    }).join("") : '<p>You don’t have any rooms open. <a href="dashboard.html">Open a room</a> first, then come back.</p>';
    openDialog(useDialog);
  }
  document.querySelector("[data-use-close]").addEventListener("click", function () { closeDialog(useDialog); });
  useDialog.addEventListener("click", function (e) { if (e.target === useDialog) closeDialog(useDialog); });

  /* ---- Open a Doodle Pad --------------------------------------------------------- */
  var view = document.querySelector("[data-pad-view]");
  var body = document.querySelector("[data-pad-body]");
  var printBtn = document.querySelector("[data-pad-print]");
  var csvBtn = document.querySelector("[data-pad-csv]");
  var openFull = null;

  var MARK = { correct: "✓", partial: "½", incorrect: "✗", blank: "–", not_on_page: "" };

  function openPad(id) {
    var p = find(id);
    document.querySelector("[data-pad-title]").textContent = p.title;
    document.querySelector("[data-pad-kind]").textContent = KIND[p.kind].icon + " " + KIND[p.kind].label;
    document.querySelector("[data-pad-meta]").textContent = "Saved " + day(p.createdAt) + " · " + net.keepLabel(p.keepUntil);
    csvBtn.hidden = p.kind !== "grades";
    body.innerHTML = '<p class="muted">Opening…</p>';
    openFull = null;
    openDialog(view);
    Drawer.get(id).then(function (r) {
      if (!r.ok) { body.innerHTML = "<p>⚠️ " + escape(r.error) + "</p>"; return; }
      openFull = r.pad;
      var d = r.pad.data || {};
      if (r.pad.kind === "worksheet") {
        body.innerHTML = '<div class="ai-pages">' + (d.pages || []).map(function (pg) {
          var m = /^img:([a-f0-9]{32})$/.exec(pg.id);
          return m ? '<img src="' + window.DoodleTemplates.assetUrl(m[1]) + '" alt="' + escape(pg.name) + '">' : "";
        }).join("") + "</div>" +
          (d.key && d.key.length ? '<details class="card ai-edit" open><summary>🔑 Answer key <span class="small muted">— only you see this</span></summary><ol class="ai-key">' +
            d.key.map(function (k) { return "<li>" + escape(k.answer || "—") + "</li>"; }).join("") + "</ol></details>" : "");
      } else if (r.pad.kind === "snapshot") {
        body.innerHTML = (d.prompt ? '<p class="small"><strong>Task:</strong> ' + escape(d.prompt) + "</p>" : "") +
          '<div class="class-grid">' + (d.students || []).map(function (st) {
            return '<figure class="pupil snap-card">' +
              (st.img ? '<img class="pupil__shot" src="' + st.img + '" alt="' + escape(st.name) + '’s desk">' : '<div class="pupil__empty">blank desk</div>') +
              '<figcaption class="pupil__foot"><span class="pupil__name">' + escape(st.name) + '</span><span class="pupil__marks">' + (st.marks || 0) + " marks</span></figcaption></figure>";
          }).join("") + "</div>";
      } else {
        var run = d.run || { rows: [] };
        body.innerHTML = '<p class="small muted">Class average <strong>' + (d.average == null ? "—" : d.average + "%") + "</strong> · only you can see this</p>" +
          '<div class="grade-table-wrap"><table class="grade-table"><thead><tr><th>Student</th><th>Score</th><th>%</th><th>Questions</th></tr></thead><tbody>' +
          run.rows.map(function (row) {
            return "<tr><td><strong>" + escape(row.name) + "</strong>" + (row.check ? " 🔎" : "") + "</td><td>" +
              (row.of ? row.got + " / " + row.of : "—") + "</td><td>" + (row.pct == null ? "—" : row.pct + "%") + '</td><td><div class="marks">' +
              (row.results || []).map(function (q) {
                return q.status === "not_on_page" ? "" : '<span class="mark" data-mark="' + q.status + '">' + MARK[q.status] + "</span>";
              }).join("") + "</div></td></tr>";
          }).join("") + "</tbody></table></div>";
      }
    });
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  csvBtn.addEventListener("click", function () {
    if (!openFull || openFull.kind !== "grades") return;
    var run = openFull.data.run;
    var qCount = run.rows.reduce(function (m, r) { return Math.max(m, (r.results || []).length); }, 0);
    var head = ["Student", "Score", "Out of", "Percent"];
    for (var q = 1; q <= qCount; q++) head.push("Q" + q);
    head.push("Needs checking", "Notes");
    var lines = [head.map(csvCell).join(",")].concat(run.rows.map(function (row) {
      var cells = [row.name, row.of ? row.got : "", row.of || "", row.pct == null ? "" : row.pct + "%"];
      for (var k = 0; k < qCount; k++) {
        var r = (row.results || [])[k];
        cells.push(!r || r.status === "not_on_page" ? "" : r.status === "correct" ? 1 : r.status === "partial" ? 0.5 : 0);
      }
      cells.push(row.check ? "yes" : "", row.error || row.note || "");
      return cells.map(csvCell).join(",");
    }));
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = String(openFull.title).replace(/[^\w\s.()-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 100) + " - grades.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });

  printBtn.addEventListener("click", function () {
    if (!openFull) return;
    var d = openFull.data || {};
    if (openFull.kind === "worksheet") {
      window.doodlePrint((d.pages || []).map(function (pg) {
        var m = /^img:([a-f0-9]{32})$/.exec(pg.id);
        return { src: m ? window.DoodleTemplates.assetUrl(m[1]) : "" };
      }).filter(function (x) { return x.src; }), openFull.title);
    } else if (openFull.kind === "snapshot") {
      window.doodlePrint((d.students || []).filter(function (s) { return s.img; }).map(function (s) {
        return { src: s.img, caption: s.name + " — " + openFull.title };
      }), openFull.title);
    } else {
      /* A clean grade sheet, for the teacher */
      var frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
      document.body.appendChild(frame);
      var doc = frame.contentWindow.document;
      doc.open();
      doc.write("<!doctype html><html><head><meta charset='utf-8'><title>" + escape(openFull.title) + "</title><style>" +
        "body{font-family:Nunito,'Segoe UI',Arial,sans-serif;color:#241a3d;margin:16mm}h1{font-size:18pt}" +
        "table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:2.2mm;border-bottom:1px solid #ccc}" +
        ".marks{display:flex;gap:4px}.mark{display:inline-block;min-width:16px;font-weight:800}</style></head><body><h1>" +
        escape(openFull.title) + "</h1>" + body.innerHTML + "</body></html>");
      doc.close();
      setTimeout(function () {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setTimeout(function () { frame.remove(); }, 60000);
      }, 200);
    }
  });

  document.querySelector("[data-pad-close]").addEventListener("click", function () { closeDialog(view); });
  view.addEventListener("click", function (e) { if (e.target === view) closeDialog(view); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    closeDialog(view);
    closeDialog(useDialog);
  });

  load();
})();
