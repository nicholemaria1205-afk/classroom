/* ==========================================================================
   Doodle Desk — AI worksheet maker (Teacher Pro)

     DoodleAI.generate({ topic, grade, kind, count, notes })
        -> Promise<{ ok, worksheet, left } | { ok:false, error, pro }>
     DoodleAI.render(worksheet)
        -> Promise<[dataURL, ...]>  board-shaped page images
     DoodleAI.answerKeyImage(worksheet) -> dataURL (for printing)

   The AI only writes the content (see netlify/functions/ai-worksheet.js).
   The layout happens here, drawn to the board's own wide shape, so a made
   worksheet fills the board instead of shrinking like a portrait page.
   ========================================================================== */
window.DoodleAI = (function () {
  "use strict";

  var net = window.DoodleNet;

  var PW = 1800;
  var PH = Math.round(PW * 740 / 1200);   /* 1110 — same shape as a board */
  var MARGIN = 56;
  var GUTTER = 64;
  var COL_W = (PW - MARGIN * 2 - GUTTER) / 2;
  var FONT = "Nunito, 'Segoe UI', Arial, sans-serif";
  var INK = "#241a3d";
  var SOFT = "#6b5f86";
  var LINE = "#b9aee0";
  var ACCENT = "#7c3aed";

  function generate(params) {
    var s = net.session && net.session();
    if (!s || !s.token) return Promise.resolve({ ok: false, error: "Log in as a teacher to use the AI maker." });
    return fetch("/.netlify/functions/ai-worksheet", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + s.token },
      body: JSON.stringify(params)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (res.ok && json.worksheet) return { ok: true, worksheet: json.worksheet, left: json.left };
        var msg = json.error || (res.status === 504 || res.status === 502
          ? "The AI took too long to answer. Try again, or ask for fewer questions."
          : "Something went wrong (" + res.status + "). Try again.");
        return { ok: false, error: msg, pro: json.pro };
      });
    }, function () {
      return { ok: false, error: "Could not reach the server. Check your connection and try again." };
    });
  }

  /* Grade one board picture against a key (teacher only — see ai-grade.js).
     Resolves { ok, results, note } or { ok:false, error, pro } */
  function grade(params) {
    var s = net.session && net.session();
    if (!s || !s.token) return Promise.resolve({ ok: false, error: "Log in as a teacher to grade with AI." });
    return fetch("/.netlify/functions/ai-grade", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + s.token },
      body: JSON.stringify(params)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (res.ok && json.results) return { ok: true, results: json.results, note: json.note || "" };
        return { ok: false, error: json.error || (res.status >= 500 ? "The AI took too long on this board." : "Couldn't grade this board (" + res.status + ")."), pro: json.pro };
      });
    }, function () {
      return { ok: false, error: "Could not reach the server." };
    });
  }

  /* ---- Layout ----------------------------------------------------------- */
  function wrap(c, text, maxW) {
    var out = [];
    String(text || "").split("\n").forEach(function (para) {
      var line = "";
      para.split(" ").forEach(function (word) {
        var test = line ? line + " " + word : word;
        if (line && c.measureText(test).width > maxW) {
          out.push(line);
          line = word;
        } else {
          line = test;
        }
      });
      out.push(line);
    });
    return out;
  }

  var PROMPT_SIZE = 30, PROMPT_LH = 40, ANSWER_LH = 56;

  /* How tall an item is, and how to draw it at (x, y) in a column */
  function measure(c, item, index) {
    var textW = COL_W - 60;
    c.font = (item.type === "passage" ? "600 " : "700 ") + (item.type === "passage" ? 27 : PROMPT_SIZE) + "px " + FONT;
    var lines = wrap(c, item.prompt, item.type === "passage" ? COL_W : textW);
    var lh = item.type === "passage" ? 36 : PROMPT_LH;
    var h = lines.length * lh + 14;
    if (item.type === "short_answer" || item.type === "long_answer") h += (item.lines || 2) * ANSWER_LH;
    else if (item.type === "multiple_choice") h += (item.choices || []).length * 48 + 6;
    else if (item.type === "true_false") h += 56;
    else if (item.type === "draw") h += 250;
    else if (item.type === "fill_blank") h += 10;
    return { h: h + 30, lines: lines, lh: lh, index: index };
  }

  function bubble(c, x, y) {
    c.beginPath();
    c.arc(x, y, 13, 0, Math.PI * 2);
    c.stroke();
  }

  function drawItem(c, item, m, x, y, number) {
    c.save();
    c.textBaseline = "top";
    var tx = x;
    if (item.type !== "passage") {
      /* Number badge */
      c.fillStyle = ACCENT;
      c.beginPath();
      c.arc(x + 20, y + 18, 20, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#ffffff";
      c.font = "800 22px " + FONT;
      c.textAlign = "center";
      c.fillText(String(number), x + 20, y + 6);
      c.textAlign = "left";
      tx = x + 56;
    }
    c.fillStyle = INK;
    c.font = (item.type === "passage" ? "600 27px " : "700 " + PROMPT_SIZE + "px ") + FONT;
    m.lines.forEach(function (l, i) { c.fillText(l, tx, y + i * m.lh); });
    var cy = y + m.lines.length * m.lh + 14;

    c.strokeStyle = LINE;
    c.lineWidth = 2.5;
    if (item.type === "short_answer" || item.type === "long_answer") {
      for (var i = 1; i <= (item.lines || 2); i++) {
        var ly = cy + i * ANSWER_LH - 8;
        c.beginPath();
        c.moveTo(tx, ly);
        c.lineTo(x + COL_W, ly);
        c.stroke();
      }
    } else if (item.type === "multiple_choice") {
      c.font = "600 27px " + FONT;
      (item.choices || []).forEach(function (choice, k) {
        var by = cy + k * 48 + 18;
        bubble(c, tx + 14, by);
        c.fillStyle = INK;
        c.fillText(String.fromCharCode(65 + k) + ".  " + choice, tx + 40, by - 15);
      });
    } else if (item.type === "true_false") {
      c.font = "700 27px " + FONT;
      bubble(c, tx + 14, cy + 22);
      c.fillText("True", tx + 40, cy + 7);
      bubble(c, tx + 174, cy + 22);
      c.fillText("False", tx + 200, cy + 7);
    } else if (item.type === "draw") {
      c.setLineDash([12, 10]);
      c.strokeRect(tx, cy + 6, x + COL_W - tx, 232);
      c.setLineDash([]);
    }
    c.restore();
  }

  function newPage(ws, pageNo) {
    var canvas = document.createElement("canvas");
    canvas.width = PW;
    canvas.height = PH;
    var c = canvas.getContext("2d");
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, PW, PH);
    c.textBaseline = "top";

    var top = MARGIN;
    if (pageNo === 1) {
      c.fillStyle = INK;
      c.font = "800 50px " + FONT;
      c.fillText(ws.title, MARGIN, top);
      c.font = "700 26px " + FONT;
      c.fillStyle = SOFT;
      var nameLabel = "Name: ______________________";
      c.fillText(nameLabel, PW - MARGIN - c.measureText(nameLabel).width, top + 14);
      top += 68;
      if (ws.instructions) {
        c.font = "600 28px " + FONT;
        var lines = wrap(c, ws.instructions, PW - MARGIN * 2 - 240);
        lines.forEach(function (l, i) { c.fillText(l, MARGIN, top + i * 36); });
        top += lines.length * 36 + 8;
      }
    } else {
      c.font = "700 26px " + FONT;
      c.fillStyle = SOFT;
      c.fillText(ws.title + " (continued)", MARGIN, top);
      top += 44;
    }
    c.strokeStyle = "#e4dcf7";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(MARGIN, top + 6);
    c.lineTo(PW - MARGIN, top + 6);
    c.stroke();
    return { canvas: canvas, c: c, top: top + 30, divider: top + 6 };
  }

  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load("700 30px Nunito"),
      document.fonts.load("800 50px Nunito"),
      document.fonts.load("600 27px Nunito")
    ]).catch(function () {});
  }

  /* Pack items into two columns per page, as many pages as needed */
  function render(ws) {
    return fontsReady().then(function () {
      var pages = [];
      var page = newPage(ws, 1);
      var col = 0;
      var y = page.top;
      var number = 0;
      /* Keep clear of the hint strip along the bottom of the board */
      var bottom = PH - 110;

      (ws.items || []).forEach(function (item, i) {
        var m = measure(page.c, item, i);
        if (y + m.h > bottom && y > page.top) {
          if (col === 0) {
            col = 1;
          } else {
            pages.push(page);
            page = newPage(ws, pages.length + 1);
            col = 0;
          }
          y = page.top;
        }
        if (item.type !== "passage") number++;
        drawItem(page.c, item, m, MARGIN + col * (COL_W + GUTTER), y, number);
        y += m.h;
      });
      pages.push(page);

      return pages.map(function (pg, i) {
        var c = pg.c;
        if (pages.length > 1) {
          c.font = "700 22px " + FONT;
          c.fillStyle = SOFT;
          c.textAlign = "right";
          c.textBaseline = "bottom";
          c.fillText("Page " + (i + 1) + " of " + pages.length, PW - MARGIN, pg.divider - 8);
        }
        return pg.canvas.toDataURL("image/jpeg", 0.88);
      });
    });
  }

  /* The answer key, for the teacher only — one page, printed, never sent */
  function answerKeyImage(ws) {
    return fontsReady().then(function () {
      var canvas = document.createElement("canvas");
      canvas.width = 1700;
      canvas.height = 2200;
      var c = canvas.getContext("2d");
      c.fillStyle = "#fff";
      c.fillRect(0, 0, 1700, 2200);
      c.textBaseline = "top";
      c.fillStyle = INK;
      c.font = "800 52px " + FONT;
      c.fillText("Answer key — " + ws.title, 90, 90);
      var y = 190, n = 0;
      (ws.items || []).forEach(function (item) {
        if (item.type === "passage") return;
        n++;
        c.font = "700 30px " + FONT;
        var lines = wrap(c, n + ". " + (item.answer || "—"), 1520);
        lines.forEach(function (l) { if (y < 2120) c.fillText(l, 90, y); y += 42; });
        y += 14;
      });
      if (ws.teacher_notes && y < 2000) {
        c.font = "600 28px " + FONT;
        c.fillStyle = SOFT;
        wrap(c, "Teacher notes: " + ws.teacher_notes, 1520).forEach(function (l) { c.fillText(l, 90, y + 20); y += 38; });
      }
      return canvas.toDataURL("image/png");
    });
  }

  return { generate: generate, grade: grade, render: render, answerKeyImage: answerKeyImage };
})();
