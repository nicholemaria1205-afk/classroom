/* ==========================================================================
   Doodle Desk — board engine
   The drawing core, shared by the marketing demo, the student board and the
   teacher's focus view. Marks are kept as data (not pixels) so undo, replay,
   thumbnails and sending a board over the wire all work on the same objects.

     var board = DoodleBoard(canvasEl, { author: "student", onStrokeEnd: fn });

   An item is one of:
     { type:"stroke", colour, width, alpha, mode:"draw"|"erase", author, points:[{x,y}] }
     { type:"stamp",  emoji, x, y, size, author }
     { type:"shape",  shape:"line"|"arrow"|"rect"|"ellipse", colour, width, x1, y1, x2, y2, author }
     { type:"text",   text, x, y, size, colour, author }
     { type:"bg",     name, author:"board" }   (the paper / lesson template)

   The board is drawn in two layers: the paper (lines, grid or a lesson
   template) underneath, and the ink on top. The eraser cuts through the ink
   only, so it never rubs out the template.
   ========================================================================== */

/* ---- Paper and lesson templates ------------------------------------------
   Everything is drawn with code, so a template costs nothing to send — only
   its name travels. */
window.DoodleTemplates = (function () {
  "use strict";

  var LINE = "rgba(124, 58, 237, 0.12)";
  var INK = "#8f84b0";
  var LABEL = "#6b5f86";

  var list = [
    { id: "blank", name: "Blank", group: "Paper" },
    { id: "lined", name: "Lined paper", group: "Paper" },
    { id: "grid", name: "Graph paper", group: "Paper" },
    { id: "dots", name: "Dot paper", group: "Paper" },
    { id: "numberline", name: "Number line 0–20", group: "Math" },
    { id: "coordinate", name: "Coordinate grid", group: "Math" },
    { id: "fractions", name: "Fraction strips", group: "Math" },
    { id: "venn", name: "Venn diagram", group: "Organizers" },
    { id: "tchart", name: "T-chart", group: "Organizers" },
    { id: "kwl", name: "KWL chart", group: "Organizers" },
    { id: "watercycle", name: "Water cycle (label it)", group: "Science" }
  ];

  function line(c, x1, y1, x2, y2) {
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
  }

  function label(c, text, x, y, size, align) {
    c.save();
    c.fillStyle = LABEL;
    c.font = "700 " + (size || 22) + "px Nunito, 'Segoe UI', sans-serif";
    c.textAlign = align || "center";
    c.textBaseline = "middle";
    c.fillText(text, x, y);
    c.restore();
  }

  function arrowHead(c, x1, y1, x2, y2, len) {
    var a = Math.atan2(y2 - y1, x2 - x1);
    c.beginPath();
    c.moveTo(x2, y2);
    c.lineTo(x2 - len * Math.cos(a - 0.45), y2 - len * Math.sin(a - 0.45));
    c.moveTo(x2, y2);
    c.lineTo(x2 - len * Math.cos(a + 0.45), y2 - len * Math.sin(a + 0.45));
    c.stroke();
  }

  function labelBox(c, x, y, w, h) {
    c.save();
    c.setLineDash([10, 8]);
    c.strokeStyle = INK;
    c.lineWidth = 2.5;
    c.strokeRect(x, y, w, h);
    c.restore();
  }

  var draw = {
    blank: function () {},

    lined: function (c, W, H) {
      c.strokeStyle = LINE;
      c.lineWidth = 2;
      for (var y = 74; y < H; y += 74) line(c, 0, y, W, y);
    },

    grid: function (c, W, H) {
      c.strokeStyle = LINE;
      c.lineWidth = 1.5;
      for (var x = 40; x < W; x += 40) line(c, x, 0, x, H);
      for (var y = 40; y < H; y += 40) line(c, 0, y, W, y);
    },

    dots: function (c, W, H) {
      c.fillStyle = "rgba(124, 58, 237, 0.28)";
      for (var x = 40; x < W; x += 40) {
        for (var y = 40; y < H; y += 40) {
          c.beginPath();
          c.arc(x, y, 2.6, 0, Math.PI * 2);
          c.fill();
        }
      }
    },

    numberline: function (c, W, H) {
      var y = H / 2, left = 80, right = W - 80, step = (right - left - 40) / 20;
      c.strokeStyle = INK;
      c.lineWidth = 4;
      line(c, left - 30, y, right + 20, y);
      arrowHead(c, left, y, left - 40, y, 22);
      arrowHead(c, right, y, right + 30, y, 22);
      for (var i = 0; i <= 20; i++) {
        var x = left + 20 + i * step;
        c.lineWidth = i % 5 === 0 ? 4 : 2.5;
        line(c, x, y - (i % 5 === 0 ? 22 : 14), x, y + (i % 5 === 0 ? 22 : 14));
        label(c, String(i), x, y + 50, i % 5 === 0 ? 26 : 21);
      }
    },

    coordinate: function (c) {
      var ox = 130, oy = 670, u = 58;
      c.strokeStyle = LINE;
      c.lineWidth = 2;
      for (var i = 1; i <= 10; i++) {
        line(c, ox + i * u, oy, ox + i * u, oy - 10 * u);
        line(c, ox, oy - i * u, ox + 10 * u, oy - i * u);
      }
      c.strokeStyle = INK;
      c.lineWidth = 4;
      line(c, ox, oy, ox + 10 * u + 30, oy);
      line(c, ox, oy, ox, oy - 10 * u - 30);
      arrowHead(c, ox, oy, ox + 10 * u + 34, oy, 18);
      arrowHead(c, ox, oy, ox, oy - 10 * u - 34, 18);
      for (var n = 0; n <= 10; n++) {
        label(c, String(n), ox + n * u, oy + 28, 19);
        if (n) label(c, String(n), ox - 24, oy - n * u, 19);
      }
      label(c, "x", ox + 10 * u + 54, oy, 26);
      label(c, "y", ox, oy - 10 * u - 52, 26);
    },

    fractions: function (c, W) {
      var rows = [1, 2, 3, 4, 5, 6, 8, 10];
      var left = 110, width = W - 220, top = 40, h = 74, gap = 6;
      c.lineWidth = 3;
      rows.forEach(function (n, r) {
        var y = top + r * (h + gap);
        for (var k = 0; k < n; k++) {
          var x = left + (width / n) * k;
          c.strokeStyle = INK;
          c.strokeRect(x, y, width / n, h);
          label(c, n === 1 ? "1" : "1/" + n, x + width / n / 2, y + h / 2, n > 6 ? 18 : 22);
        }
      });
    },

    venn: function (c, W, H) {
      c.strokeStyle = INK;
      c.lineWidth = 4;
      c.beginPath();
      c.arc(W / 2 - 150, H / 2 + 30, 270, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.arc(W / 2 + 150, H / 2 + 30, 270, 0, Math.PI * 2);
      c.stroke();
      labelBox(c, W / 2 - 400, 22, 220, 50);
      labelBox(c, W / 2 + 180, 22, 220, 50);
      label(c, "Both", W / 2, 70, 22);
    },

    tchart: function (c, W, H) {
      c.strokeStyle = INK;
      c.lineWidth = 4;
      line(c, 60, 130, W - 60, 130);
      line(c, W / 2, 40, W / 2, H - 40);
      labelBox(c, W / 4 - 160, 45, 320, 58);
      labelBox(c, (3 * W) / 4 - 160, 45, 320, 58);
    },

    kwl: function (c, W, H) {
      var heads = ["K — What I Know", "W — What I Wonder", "L — What I Learned"];
      c.strokeStyle = INK;
      c.lineWidth = 4;
      c.strokeRect(40, 30, W - 80, H - 60);
      line(c, 40, 110, W - 40, 110);
      line(c, 40 + (W - 80) / 3, 30, 40 + (W - 80) / 3, H - 30);
      line(c, 40 + (2 * (W - 80)) / 3, 30, 40 + (2 * (W - 80)) / 3, H - 30);
      heads.forEach(function (t, i) {
        label(c, t, 40 + ((W - 80) / 3) * (i + 0.5), 70, 25);
      });
    },

    watercycle: function (c, W, H) {
      c.lineWidth = 4;
      c.strokeStyle = INK;

      /* Sun */
      c.beginPath();
      c.arc(150, 130, 55, 0, Math.PI * 2);
      c.stroke();
      for (var r = 0; r < 12; r++) {
        var a = (Math.PI * 2 * r) / 12;
        line(c, 150 + Math.cos(a) * 70, 130 + Math.sin(a) * 70, 150 + Math.cos(a) * 92, 130 + Math.sin(a) * 92);
      }

      /* Cloud */
      [[760, 140, 50], [820, 110, 62], [890, 135, 55], [950, 150, 42]].forEach(function (b) {
        c.beginPath();
        c.arc(b[0], b[1], b[2], Math.PI * 0.9, Math.PI * 2.1);
        c.stroke();
      });
      line(c, 712, 160, 990, 160);

      /* Mountain */
      c.beginPath();
      c.moveTo(640, 600);
      c.lineTo(860, 330);
      c.lineTo(960, 430);
      c.lineTo(1030, 370);
      c.lineTo(1170, 600);
      c.stroke();

      /* Ocean */
      c.beginPath();
      c.moveTo(30, 610);
      for (var x = 30; x <= 640; x += 40) c.quadraticCurveTo(x + 10, 590, x + 20, 610), c.quadraticCurveTo(x + 30, 630, x + 40, 610);
      c.stroke();
      line(c, 0, 728, W, 728);

      /* The four arrows of the cycle */
      c.lineWidth = 3.5;
      line(c, 300, 560, 640, 210);            /* up from the ocean */
      arrowHead(c, 300, 560, 640, 210, 22);
      line(c, 900, 200, 900, 300);            /* rain on the mountain */
      arrowHead(c, 900, 200, 900, 300, 20);
      line(c, 760, 640, 470, 660);            /* run-off back to the sea */
      arrowHead(c, 760, 640, 470, 660, 20);

      /* Blank boxes for students to label */
      labelBox(c, 150, 330, 200, 52);         /* evaporation */
      labelBox(c, 930, 225, 200, 52);         /* precipitation */
      labelBox(c, 1005, 40, 170, 52);         /* condensation */
      labelBox(c, 515, 668, 200, 48);         /* collection */
      void H;
    }
  };

  function paint(c, id, W, H) {
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, W, H);
    c.save();
    (draw[id] || draw.lined)(c, W, H);
    c.restore();
  }

  function has(id) { return Boolean(draw[id]); }

  function nameOf(id) {
    var t = list.filter(function (x) { return x.id === id; })[0];
    return t ? t.name : id;
  }

  /* <option>s grouped by kind, for any <select data-background> */
  function optionsHTML(selected) {
    var groups = {};
    list.forEach(function (t) { (groups[t.group] = groups[t.group] || []).push(t); });
    return Object.keys(groups).map(function (g) {
      return '<optgroup label="' + g + '">' + groups[g].map(function (t) {
        return '<option value="' + t.id + '"' + (t.id === selected ? " selected" : "") + ">" + t.name + "</option>";
      }).join("") + "</optgroup>";
    }).join("");
  }

  return { list: list, paint: paint, has: has, nameOf: nameOf, optionsHTML: optionsHTML };
})();

window.DoodleBoard = function (canvas, options) {
  "use strict";

  var opts = Object.assign({
    width: 1200,
    height: 740,
    guides: true,        /* faint ruled lines, like a real classroom board */
    background: null,    /* a DoodleTemplates id; overrides `guides` */
    author: "student",   /* undo only ever removes this author's own marks */
    readOnly: false,
    onStrokeEnd: null,   /* (item, allItems) after each finished mark */
    onDrawing: null      /* (allItems) throttled, while a stroke is in progress */
  }, options || {});

  var W = opts.width;
  var H = opts.height;
  canvas.width = W;
  canvas.height = H;

  var ctx = canvas.getContext("2d");

  function layer() {
    var c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    return c;
  }

  /* Paper underneath, committed ink on top. Each frame is two blits plus the
     live mark, so a long lesson doesn't get slower with every stroke. */
  var paper = layer();
  var pctx = paper.getContext("2d");
  var ink = layer();
  var ictx = ink.getContext("2d");
  var scratch = null;   /* only made if someone uses the eraser */

  var defaultBg = opts.background || (opts.guides ? "lined" : "blank");
  var background = defaultBg;
  var bgChosen = false; /* only boards whose paper was picked carry a bg item */

  var items = [];
  var redoStack = [];
  var current = null;
  var tool = "pen";
  var colour = "#7c3aed";
  var size = 8;
  var stamp = null;
  var lastDrawingPing = 0;
  var textBox = null;

  var SHAPES = { line: 1, arrow: 1, rect: 1, ellipse: 1 };

  /* ---- Painting --------------------------------------------------------- */
  function strokeOn(c, s) {
    if (!s.points || !s.points.length) return;
    c.save();
    c.globalAlpha = s.alpha == null ? 1 : s.alpha;
    if (s.mode === "erase") c.globalCompositeOperation = "destination-out";
    c.strokeStyle = s.mode === "erase" ? "#000" : s.colour;
    c.fillStyle = s.mode === "erase" ? "#000" : s.colour;
    c.lineJoin = "round";
    c.lineCap = "round";
    c.lineWidth = s.width;

    if (s.points.length < 2) {
      /* A tap should still leave a dot */
      c.beginPath();
      c.arc(s.points[0].x, s.points[0].y, s.width / 2, 0, Math.PI * 2);
      c.fill();
      c.restore();
      return;
    }

    c.beginPath();
    c.moveTo(s.points[0].x, s.points[0].y);
    /* Quadratic midpoints keep handwriting smooth instead of jagged */
    for (var i = 1; i < s.points.length - 1; i++) {
      var mx = (s.points[i].x + s.points[i + 1].x) / 2;
      var my = (s.points[i].y + s.points[i + 1].y) / 2;
      c.quadraticCurveTo(s.points[i].x, s.points[i].y, mx, my);
    }
    var last = s.points[s.points.length - 1];
    c.lineTo(last.x, last.y);
    c.stroke();
    c.restore();
  }

  function stampOn(c, s) {
    c.save();
    c.font = s.size + "px serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(s.emoji, s.x, s.y);
    c.restore();
  }

  function shapeOn(c, s) {
    c.save();
    c.strokeStyle = s.colour;
    c.lineWidth = s.width;
    c.lineJoin = "round";
    c.lineCap = "round";
    var x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
    var w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
    c.beginPath();
    if (s.shape === "rect") {
      c.rect(x, y, w, h);
    } else if (s.shape === "ellipse") {
      c.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, 1), Math.max(h / 2, 1), 0, 0, Math.PI * 2);
    } else {
      c.moveTo(s.x1, s.y1);
      c.lineTo(s.x2, s.y2);
      if (s.shape === "arrow") {
        var a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
        var len = Math.max(18, s.width * 3.5);
        c.moveTo(s.x2, s.y2);
        c.lineTo(s.x2 - len * Math.cos(a - 0.5), s.y2 - len * Math.sin(a - 0.5));
        c.moveTo(s.x2, s.y2);
        c.lineTo(s.x2 - len * Math.cos(a + 0.5), s.y2 - len * Math.sin(a + 0.5));
      }
    }
    c.stroke();
    c.restore();
  }

  function textOn(c, s) {
    c.save();
    c.fillStyle = s.colour;
    c.font = "700 " + s.size + "px Nunito, 'Segoe UI', sans-serif";
    c.textBaseline = "top";
    c.fillText(s.text, s.x, s.y);
    c.restore();
  }

  function drawItem(c, item) {
    if (!item) return;
    if (item.type === "stamp") stampOn(c, item);
    else if (item.type === "shape") shapeOn(c, item);
    else if (item.type === "text") textOn(c, item);
    else if (item.type === "stroke" || !item.type) strokeOn(c, item);
  }

  function paintPaper() {
    window.DoodleTemplates.paint(pctx, background, W, H);
  }

  /* Full rebuild — only needed after undo, clear or a wholesale setItems */
  function rebuild() {
    ictx.clearRect(0, 0, W, H);
    items.forEach(function (item) { drawItem(ictx, item); });
  }

  function paint() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(paper, 0, 0);
    if (current && current.mode === "erase") {
      /* Show the rub-out live without touching the committed ink */
      if (!scratch) scratch = layer();
      var sc = scratch.getContext("2d");
      sc.clearRect(0, 0, W, H);
      sc.drawImage(ink, 0, 0);
      drawItem(sc, current);
      ctx.drawImage(scratch, 0, 0);
      return;
    }
    ctx.drawImage(ink, 0, 0);
    if (current) drawItem(ctx, current);
  }

  /* ---- Pointer input ---------------------------------------------------- */
  function pos(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - r.left) * (W / r.width)),
      y: Math.round((e.clientY - r.top) * (H / r.height))
    };
  }

  function textSize() { return Math.round(size * 3 + 14); }

  /* Typing goes into a real input laid over the canvas, so phones get their
     keyboard and spelling help; Enter (or tapping away) puts it on the board. */
  function openTextBox(e, p) {
    closeTextBox(true);
    var wrap = canvas.parentElement;
    if (!wrap) return;
    if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";

    var r = canvas.getBoundingClientRect();
    var wr = wrap.getBoundingClientRect();
    var scale = r.width / W;

    var input = document.createElement("input");
    input.type = "text";
    input.maxLength = 120;
    input.className = "board-text-input";
    input.setAttribute("aria-label", "Type your text, then press Enter");
    input.style.left = (r.left - wr.left + p.x * scale) + "px";
    input.style.top = (r.top - wr.top + p.y * scale) + "px";
    input.style.fontSize = Math.max(14, textSize() * scale) + "px";
    input.style.color = colour;
    wrap.appendChild(input);

    textBox = { input: input, x: p.x, y: p.y, size: textSize(), colour: colour, done: false };
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); closeTextBox(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); closeTextBox(false); }
    });
    input.addEventListener("blur", function () { closeTextBox(true); });
    /* Wait a tick so the pointerup that opened it doesn't steal focus back */
    setTimeout(function () { input.focus(); }, 0);
  }

  function closeTextBox(keep) {
    if (!textBox || textBox.done) return;
    var box = textBox;
    box.done = true;
    textBox = null;
    var text = box.input.value.trim();
    if (box.input.parentNode) box.input.parentNode.removeChild(box.input);
    if (keep && text) {
      commit({ type: "text", text: text, x: box.x, y: box.y, size: box.size, colour: box.colour, author: opts.author });
    }
  }

  function onDown(e) {
    if (opts.readOnly) return;
    var p = pos(e);

    if (tool === "text") {
      e.preventDefault();
      openTextBox(e, p);
      return;
    }

    canvas.setPointerCapture(e.pointerId);

    if (tool === "stamp" && stamp) {
      commit({ type: "stamp", emoji: stamp, x: p.x, y: p.y, size: size * 7, author: opts.author });
      return;
    }

    if (SHAPES[tool]) {
      current = { type: "shape", shape: tool, colour: colour, width: Math.max(3, size * 0.75),
                  x1: p.x, y1: p.y, x2: p.x, y2: p.y, author: opts.author };
      paint();
      return;
    }

    current = {
      type: "stroke",
      colour: colour,
      width: tool === "erase" ? size * 3 : tool === "marker" ? size * 3.2 : size,
      alpha: tool === "marker" ? 0.35 : 1,
      mode: tool === "erase" ? "erase" : "draw",
      author: opts.author,
      points: [p]
    };
    paint();
  }

  function onMove(e) {
    if (!current) return;
    var p = pos(e);
    if (current.type === "shape") {
      current.x2 = p.x;
      current.y2 = p.y;
    } else {
      current.points.push(p);
    }
    paint();
    if (opts.onDrawing && Date.now() - lastDrawingPing > 250) {
      lastDrawingPing = Date.now();
      opts.onDrawing(items);
    }
  }

  function onUp() {
    if (!current) return;
    var finished = current;
    current = null;
    /* A click with a shape tool, not a drag — nothing to keep */
    if (finished.type === "shape" && Math.abs(finished.x2 - finished.x1) + Math.abs(finished.y2 - finished.y1) < 6) {
      paint();
      return;
    }
    commit(finished);
  }

  function commit(item, keepRedo) {
    items.push(item);
    if (!keepRedo) redoStack = [];
    drawItem(ictx, item);  /* incremental — no full rebuild */
    paint();
    if (opts.onStrokeEnd) opts.onStrokeEnd(item, items);
  }

  if (!opts.readOnly) {
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onUp);
    canvas.style.touchAction = "none";
  }

  paintPaper();
  rebuild();
  paint();

  function cursorFor(t) {
    if (t === "stamp") return "copy";
    if (t === "text") return "text";
    return "crosshair";
  }

  /* ---- Public API ------------------------------------------------------- */
  var api = {
    setTool: function (t) {
      closeTextBox(true);
      tool = t;
      if (t !== "stamp") stamp = null;
      canvas.style.cursor = cursorFor(t);
      return api;
    },
    getTool: function () { return tool; },
    setColour: function (c) { colour = c; return api; },
    setSize: function (s) { size = s; return api; },
    setStamp: function (emoji) { closeTextBox(true); stamp = emoji; tool = "stamp"; canvas.style.cursor = "copy"; return api; },

    /* Undo removes this board's own last mark, so a student can't rub out
       the hint their teacher just drew. */
    undo: function () {
      for (var i = items.length - 1; i >= 0; i--) {
        if (items[i].author === opts.author) {
          redoStack.push(items.splice(i, 1)[0]);
          rebuild();
          paint();
          if (opts.onStrokeEnd) opts.onStrokeEnd(null, items);
          return true;
        }
      }
      return false;
    },

    redo: function () {
      if (!redoStack.length) return false;
      commit(redoStack.pop(), true);
      return true;
    },

    canRedo: function () { return redoStack.length > 0; },

    /* Clearing wipes the ink but keeps the paper or lesson template */
    clear: function (silent) {
      items = [];
      redoStack = [];
      rebuild();
      paint();
      if (!silent && opts.onStrokeEnd) opts.onStrokeEnd(null, items);
      return api;
    },

    setBackground: function (name, silent) {
      if (!window.DoodleTemplates.has(name)) return api;
      background = name;
      bgChosen = true;
      paintPaper();
      paint();
      if (!silent && opts.onStrokeEnd) opts.onStrokeEnd(null, items);
      return api;
    },

    getBackground: function () { return background; },

    /* Marks arriving from someone else — a teacher's hint, say */
    addItems: function (incoming) {
      if (!incoming || !incoming.length) return api;
      incoming.forEach(function (item) {
        if (item.type === "bg") {
          background = item.name;
          bgChosen = true;
          paintPaper();
          return;
        }
        items.push(item);
        drawItem(ictx, item);
      });
      paint();
      return api;
    },

    setItems: function (next) {
      var list = (next || []).slice();
      var bg = list.filter(function (i) { return i && i.type === "bg"; })[0];
      items = list.filter(function (i) { return i && i.type !== "bg"; });
      redoStack = [];
      background = bg && window.DoodleTemplates.has(bg.name) ? bg.name : defaultBg;
      bgChosen = Boolean(bg);
      paintPaper();
      rebuild();
      paint();
      return api;
    },

    /* Everything needed to rebuild this board elsewhere, paper included */
    getItems: function () {
      var out = items.slice();
      if (bgChosen) out.unshift({ type: "bg", name: background, author: "board" });
      return out;
    },
    count: function () { return items.length; },
    isEmpty: function () { return items.length === 0; },

    toPNG: function () { return canvas.toDataURL("image/png"); },

    /* Small JPEG for the teacher's live grid — cheap to send and to store */
    toThumb: function (width, quality) {
      var w = width || 320;
      var h = Math.round(w * (H / W));
      var t = document.createElement("canvas");
      t.width = w;
      t.height = h;
      var tc = t.getContext("2d");
      tc.fillStyle = "#ffffff";
      tc.fillRect(0, 0, w, h);
      tc.drawImage(canvas, 0, 0, w, h);
      return t.toDataURL("image/jpeg", quality || 0.6);
    },

    destroy: function () {
      closeTextBox(false);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onUp);
    }
  };

  return api;
};

/* Print one or more board images — the browser's print dialog also offers
   "Save as PDF". Uses a hidden frame so no pop-up blocker gets in the way. */
window.doodlePrint = function (pages, title) {
  "use strict";
  var frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);

  function esc(t) {
    return String(t || "").replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  var html = "<!doctype html><html><head><meta charset='utf-8'><title>" + esc(title || "Doodle Desk") + "</title>" +
    "<style>@page{size:landscape;margin:12mm}body{margin:0;font-family:Nunito,'Segoe UI',sans-serif;color:#241a3d}" +
    ".page{page-break-after:always;break-after:page;text-align:center}.page:last-child{page-break-after:auto;break-after:auto}" +
    "h2{font-size:16pt;margin:0 0 6mm}img{max-width:100%;max-height:165mm;border:1px solid #ccc}</style></head><body>" +
    pages.map(function (p) {
      return "<div class='page'>" + (p.caption ? "<h2>" + esc(p.caption) + "</h2>" : "") + "<img src='" + p.src + "' alt=''></div>";
    }).join("") + "</body></html>";

  var doc = frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  var imgs = doc.images;
  var left = imgs.length;
  function go() {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(function () { frame.remove(); }, 60000);
  }
  if (!left) return go();
  Array.prototype.forEach.call(imgs, function (img) {
    if (img.complete) { if (--left === 0) go(); return; }
    img.onload = img.onerror = function () { if (--left === 0) go(); };
  });
};
