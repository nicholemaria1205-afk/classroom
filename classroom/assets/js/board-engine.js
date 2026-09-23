/* ==========================================================================
   Doodle Desk — board engine
   The drawing core, shared by the marketing demo, the student board and the
   teacher's focus view. Marks are kept as data (not pixels) so undo, replay,
   thumbnails and sending a board over the wire all work on the same objects.

     var board = DoodleBoard(canvasEl, { author: "student", onStrokeEnd: fn });

   An item is one of:
     { type:"stroke", colour, width, alpha, mode:"draw"|"erase", author, points:[{x,y}] }
     { type:"stamp",  emoji, x, y, size, author }
   ========================================================================== */
window.DoodleBoard = function (canvas, options) {
  "use strict";

  var opts = Object.assign({
    width: 1200,
    height: 740,
    guides: true,        /* faint ruled lines, like a real classroom board */
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

  /* Committed marks live on an offscreen canvas so a long lesson doesn't get
     slower with every stroke — each frame is one blit plus the live stroke. */
  var base = document.createElement("canvas");
  base.width = W;
  base.height = H;
  var bctx = base.getContext("2d");

  var items = [];
  var current = null;
  var tool = "pen";
  var colour = "#7c3aed";
  var size = 8;
  var stamp = null;
  var lastDrawingPing = 0;

  /* ---- Painting --------------------------------------------------------- */
  function strokeOn(c, s) {
    c.save();
    c.globalAlpha = s.alpha;
    c.strokeStyle = s.mode === "erase" ? "#ffffff" : s.colour;
    c.fillStyle = s.mode === "erase" ? "#ffffff" : s.colour;
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

  function drawItem(c, item) {
    if (item.type === "stamp") stampOn(c, item);
    else strokeOn(c, item);
  }

  function paintBackground(c) {
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, W, H);
    if (!opts.guides) return;
    c.save();
    c.strokeStyle = "rgba(124, 58, 237, 0.10)";
    c.lineWidth = 2;
    for (var y = 74; y < H; y += 74) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(W, y);
      c.stroke();
    }
    c.restore();
  }

  /* Full rebuild — only needed after undo, clear or a wholesale setItems */
  function rebuild() {
    paintBackground(bctx);
    items.forEach(function (item) { drawItem(bctx, item); });
  }

  function paint() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(base, 0, 0);
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

  function onDown(e) {
    if (opts.readOnly) return;
    canvas.setPointerCapture(e.pointerId);
    var p = pos(e);

    if (tool === "stamp" && stamp) {
      commit({ type: "stamp", emoji: stamp, x: p.x, y: p.y, size: size * 7, author: opts.author });
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
    current.points.push(pos(e));
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
    commit(finished);
  }

  function commit(item) {
    items.push(item);
    drawItem(bctx, item);  /* incremental — no full rebuild */
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

  rebuild();
  paint();

  /* ---- Public API ------------------------------------------------------- */
  var api = {
    setTool: function (t) {
      tool = t;
      if (t !== "stamp") stamp = null;
      canvas.style.cursor = t === "stamp" ? "copy" : "crosshair";
      return api;
    },
    getTool: function () { return tool; },
    setColour: function (c) { colour = c; return api; },
    setSize: function (s) { size = s; return api; },
    setStamp: function (emoji) { stamp = emoji; tool = "stamp"; canvas.style.cursor = "copy"; return api; },

    /* Undo removes this board's own last mark, so a student can't rub out
       the hint their teacher just drew. */
    undo: function () {
      for (var i = items.length - 1; i >= 0; i--) {
        if (items[i].author === opts.author) {
          items.splice(i, 1);
          rebuild();
          paint();
          if (opts.onStrokeEnd) opts.onStrokeEnd(null, items);
          return true;
        }
      }
      return false;
    },

    clear: function (silent) {
      items = [];
      rebuild();
      paint();
      if (!silent && opts.onStrokeEnd) opts.onStrokeEnd(null, items);
      return api;
    },

    /* Marks arriving from someone else — a teacher's hint, say */
    addItems: function (incoming) {
      if (!incoming || !incoming.length) return api;
      incoming.forEach(function (item) {
        items.push(item);
        drawItem(bctx, item);
      });
      paint();
      return api;
    },

    setItems: function (next) {
      items = (next || []).slice();
      rebuild();
      paint();
      return api;
    },

    getItems: function () { return items.slice(); },
    count: function () { return items.length; },
    isEmpty: function () { return items.length === 0; },

    toPNG: function () { return canvas.toDataURL("image/png"); },

    /* Small JPEG for the teacher's live grid — cheap to send and to store */
    toThumb: function (width) {
      var w = width || 320;
      var h = Math.round(w * (H / W));
      var t = document.createElement("canvas");
      t.width = w;
      t.height = h;
      var tc = t.getContext("2d");
      tc.fillStyle = "#ffffff";
      tc.fillRect(0, 0, w, h);
      tc.drawImage(canvas, 0, 0, w, h);
      return t.toDataURL("image/jpeg", 0.6);
    },

    destroy: function () {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onUp);
    }
  };

  return api;
};
