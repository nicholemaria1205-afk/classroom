/* ==========================================================================
   Doodle Desk — class activities, shared by the room page, the teaching
   desk and the student desk: the countdown timer, quick polls and the name
   picker.

   Timer — kept on the teacher's room as { total, endsAt, pausedLeft, label }
   using the teacher's clock. On the wire it travels as { total, left,
   running, label } so a student's clock being off doesn't matter: each desk
   counts down from "left" when the message arrives.

     DoodleActivities.timerWire(timer)       -> wire form (or null)
     DoodleActivities.timerFromWire(wire)    -> local form, on this clock
     DoodleActivities.timerLeft(timer)       -> ms left
     DoodleActivities.fmt(ms)                -> "4:05"
     DoodleActivities.timerPill(el)          -> { set(timer) } a live countdown
     DoodleActivities.chime()

   Polls — { id, q, type, options, showResults, startedAt }
     DoodleActivities.POLL_TYPES, pollOptions(type, custom), counts(poll)

   Name picker
     DoodleActivities.spin(el, names, winner, done)
   ========================================================================== */
window.DoodleActivities = (function () {
  "use strict";

  /* ---- Timer -------------------------------------------------------------- */
  function timerLeft(t) {
    if (!t) return 0;
    if (t.pausedLeft != null) return Math.max(0, t.pausedLeft);
    return Math.max(0, (t.endsAt || 0) - Date.now());
  }

  function timerWire(t) {
    if (!t) return null;
    return { id: t.id, total: t.total, left: timerLeft(t), running: t.pausedLeft == null, label: t.label || "" };
  }

  function timerFromWire(w) {
    if (!w) return null;
    var t = { id: w.id, total: w.total, label: w.label || "" };
    if (w.running) t.endsAt = Date.now() + (w.left || 0);
    else t.pausedLeft = w.left || 0;
    return t;
  }

  function fmt(ms) {
    var s = Math.ceil(ms / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  /* A soft three-note chime — no sound file needed */
  function chime() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = chime.ctx || (chime.ctx = new Ctx());
      if (ctx.state === "suspended") ctx.resume();
      [659.25, 783.99, 1046.5].forEach(function (f, i) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        var at = ctx.currentTime + i * 0.22;
        o.type = "sine";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(at);
        o.stop(at + 1);
      });
    } catch (e) {}
  }

  /* A countdown pill: ⏱️ Work time 4:05. Goes sunny in the last minute and
     coral in the last ten seconds; "Time's up!" with a chime at zero. */
  function timerPill(el, opts) {
    opts = opts || {};
    var timer = null;
    var tick = null;
    var rang = null;
    var hideAt = 0;

    function draw() {
      if (!timer) {
        el.hidden = true;
        clearInterval(tick);
        tick = null;
        return;
      }
      var left = timerLeft(timer);
      var paused = timer.pausedLeft != null;
      var state = left <= 0 ? "done" : left <= 10000 ? "end" : left <= 60000 ? "soon" : "on";
      el.hidden = false;
      el.setAttribute("data-state", paused && left > 0 ? "paused" : state);
      el.innerHTML = left <= 0
        ? '<span aria-hidden="true">⏰</span> <strong>Time\'s up!</strong>'
        : '<span aria-hidden="true">' + (paused ? "⏸️" : "⏱️") + "</span> " +
          (timer.label ? '<span class="timer-pill__label">' + esc(timer.label) + "</span> " : "") +
          '<strong class="timer-pill__time">' + fmt(left) + "</strong>" +
          (paused ? ' <span class="timer-pill__label">paused</span>' : "");
      el.setAttribute("aria-label", left <= 0 ? "Time's up" : (timer.label ? timer.label + ", " : "") + fmt(left) + " left" + (paused ? ", paused" : ""));

      if (left <= 0 && rang !== timer.id) {
        rang = timer.id;
        hideAt = Date.now() + (opts.hideAfter || 8000);
        if (opts.sound !== false) chime();
        if (opts.onDone) opts.onDone();
      }
      if (left <= 0 && hideAt && Date.now() > hideAt) {
        timer = null;
        draw();
      }
    }

    return {
      set: function (t) {
        /* A timer that ended long ago isn't shown again */
        if (t && timerLeft(t) <= 0 && t.pausedLeft == null && Date.now() - (t.endsAt || 0) > 8000) t = null;
        if (t && (!timer || t.id !== timer.id)) { rang = null; hideAt = 0; }
        timer = t;
        if (timer && !tick) tick = setInterval(draw, 250);
        draw();
      },
      get: function () { return timer; }
    };
  }

  /* ---- Polls ---------------------------------------------------------------- */
  var POLL_TYPES = {
    choice: { label: "A B C D", icon: "🔤" },
    yesno: { label: "Yes / No", icon: "👍" },
    thumbs: { label: "1–5 scale", icon: "🖐️" },
    text: { label: "Short answer", icon: "✍️" }
  };

  var THUMBS = [
    { key: "1", label: "1", emoji: "😟" },
    { key: "2", label: "2", emoji: "🙁" },
    { key: "3", label: "3", emoji: "😐" },
    { key: "4", label: "4", emoji: "🙂" },
    { key: "5", label: "5", emoji: "😄" }
  ];

  /* [{ key, label, emoji? }] for a poll type ("text" has none) */
  function pollOptions(type, custom) {
    if (type === "yesno") return [{ key: "yes", label: "Yes", emoji: "👍" }, { key: "no", label: "No", emoji: "👎" }];
    if (type === "thumbs") return THUMBS.slice();
    if (type === "choice") {
      var letters = "ABCDEF";
      return (custom && custom.length ? custom : ["", "", "", ""]).slice(0, 6).map(function (text, i) {
        return { key: letters[i], label: letters[i], text: String(text || "").slice(0, 80) };
      });
    }
    return [];
  }

  function counts(poll, answers) {
    var out = {};
    (poll.options || []).forEach(function (o) { out[o.key] = 0; });
    Object.keys(answers || {}).forEach(function (id) {
      var a = answers[id] && answers[id].a;
      if (a != null && out[a] != null) out[a]++;
    });
    return out;
  }

  /* ---- Name picker ------------------------------------------------------------ */
  /* Flicks through names, slowing down, and lands on the winner */
  function spin(el, names, winner, done) {
    var list = names.length ? names : [winner];
    var steps = 18 + Math.floor(Math.random() * 6);
    var i = Math.floor(Math.random() * list.length);
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.setAttribute("data-state", "spinning");
    if (reduce) steps = 1;

    (function step(n) {
      if (n >= steps) {
        el.textContent = winner;
        el.setAttribute("data-state", "picked");
        if (done) done();
        return;
      }
      i = (i + 1) % list.length;
      el.textContent = list[i];
      setTimeout(function () { step(n + 1); }, 45 + Math.pow(n / steps, 3) * 320);
    })(0);
  }

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---- Running the timer and the picker (teacher pages) -------------------------
     The room page and the teaching desk share these, so either can start,
     pause or stop the class timer, or pick a name. */
  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function setTimer(net, code, t) {
    net.updateRoom(code, { timer: t });
    net.send("timer", { code: code, timer: timerWire(t) });
    return t;
  }

  var timers = {
    start: function (net, code, ms, label) {
      ms = Math.max(5000, Math.min(90 * 60000, Math.round(ms)));
      return setTimer(net, code, { id: newId(), total: ms, endsAt: Date.now() + ms, label: String(label || "").slice(0, 30) });
    },
    toggle: function (net, code) {
      var t = (net.getRoom(code) || {}).timer;
      if (!t || timerLeft(t) <= 0) return null;
      if (t.pausedLeft != null) {
        t.endsAt = Date.now() + t.pausedLeft;
        delete t.pausedLeft;
      } else {
        t.pausedLeft = timerLeft(t);
        delete t.endsAt;
      }
      return setTimer(net, code, t);
    },
    addMinute: function (net, code) {
      var t = (net.getRoom(code) || {}).timer;
      if (!t) return null;
      if (t.pausedLeft != null) t.pausedLeft += 60000;
      else t.endsAt = Math.max(t.endsAt, Date.now()) + 60000;
      t.total += 60000;
      return setTimer(net, code, t);
    },
    stop: function (net, code) { return setTimer(net, code, null); },
    /* The room's timer, unless it finished a while ago */
    current: function (net, code) {
      var t = (net.getRoom(code) || {}).timer;
      if (t && t.pausedLeft == null && timerLeft(t) <= 0 && Date.now() - t.endsAt > 8000) return null;
      return t || null;
    }
  };

  function norm(n) { return String(n || "").trim().toLowerCase(); }

  function pickedKey(code) {
    var d = new Date();
    return "doodle-picked-" + code + "-" + d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  var picker = {
    picked: function (code) {
      try { return JSON.parse(localStorage.getItem(pickedKey(code)) || "[]"); } catch (e) { return []; }
    },
    reset: function (code) {
      try { localStorage.setItem(pickedKey(code), "[]"); } catch (e) {}
    },
    pool: function (net, code, onlineOnly) {
      var all = net.getStudents(code);
      return onlineOnly ? all.filter(net.isOnline) : all;
    },
    /* -> { winner, names, fresh } or null when there's nobody to pick */
    choose: function (net, code, opts) {
      opts = opts || {};
      var all = picker.pool(net, code, opts.onlineOnly !== false);
      if (!all.length) return null;
      var done = picker.picked(code);
      var choices = all;
      var fresh = false;
      if (opts.noRepeat !== false) {
        choices = all.filter(function (s) { return done.indexOf(norm(s.name)) < 0; });
        if (!choices.length) { picker.reset(code); choices = all; fresh = true; }
      }
      return { winner: choices[Math.floor(Math.random() * choices.length)], names: all.map(function (s) { return s.name; }), fresh: fresh };
    },
    /* After the spin: remember them, and tell the class if asked */
    done: function (net, code, winner, tell) {
      var done = picker.picked(code);
      if (done.indexOf(norm(winner.name)) < 0) done.push(norm(winner.name));
      try { localStorage.setItem(pickedKey(code), JSON.stringify(done)); } catch (e) {}
      if (tell !== false) net.send("picked", { code: code, studentId: winner.id, name: winner.name });
    },
    norm: norm
  };

  /* ---- Class stars ---------------------------------------------------------------
     Stars this week, by name (a student who comes back tomorrow in a new tab
     keeps theirs). Kept on the room as
       stars: { week: "2026-10-26", points: { "ava": { name, n } }, goal: { n, reward } }
     A new week starts on Monday with everyone back at zero; the goal stays. */
  function weekKey(d) {
    d = d ? new Date(d) : new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getFullYear() + "-" + (d.getMonth() + 1 < 10 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate();
  }

  var stars = {
    weekKey: weekKey,
    /* The room's stars for this week (starting a fresh week if needed) */
    get: function (net, code) {
      var r = net.getRoom(code) || {};
      var s = r.stars || {};
      if (s.week !== weekKey()) {
        s = { week: weekKey(), points: {}, goal: s.goal || null, lastWeek: s.week ? stars.total(s) : null };
        if (r.code) net.updateRoom(code, { stars: s });
      }
      s.points = s.points || {};
      return s;
    },
    total: function (s) {
      return Object.keys((s && s.points) || {}).reduce(function (n, k) { return n + (s.points[k].n || 0); }, 0);
    },
    count: function (s, name) {
      var p = s && s.points && s.points[norm(name)];
      return p ? p.n : 0;
    },
    /* What a desk needs: the class total, the goal, and everyone's count by name */
    wire: function (s) {
      if (!s) return null;
      var byName = {};
      Object.keys(s.points || {}).forEach(function (k) { byName[k] = s.points[k].n; });
      return { week: s.week, total: stars.total(s), goal: s.goal || null, byName: byName };
    },
    /* +1 (or -1) for some students; tells the class */
    give: function (net, code, students, delta) {
      var s = stars.get(net, code);
      delta = delta || 1;
      students.forEach(function (st) {
        var k = norm(st.name);
        if (!k) return;
        var p = s.points[k] || { name: st.name, n: 0 };
        p.name = st.name;
        p.n = Math.max(0, p.n + delta);
        s.points[k] = p;
      });
      net.updateRoom(code, { stars: s });
      net.send("stars", {
        code: code,
        to: delta > 0 ? students.map(function (st) { return norm(st.name); }) : [],
        all: students.length > 1,
        stars: stars.wire(s)
      });
      return s;
    },
    setGoal: function (net, code, n, reward) {
      var s = stars.get(net, code);
      s.goal = n > 0 ? { n: Math.min(9999, Math.round(n)), reward: String(reward || "").slice(0, 60) } : null;
      net.updateRoom(code, { stars: s });
      net.send("stars", { code: code, to: [], stars: stars.wire(s) });
      return s;
    },
    reset: function (net, code) {
      var s = stars.get(net, code);
      s.points = {};
      net.updateRoom(code, { stars: s });
      net.send("stars", { code: code, to: [], stars: stars.wire(s) });
      return s;
    }
  };

  /* ---- Partner desks: what changed on a shared desk ----------------------------
     A tracker remembers each mark (by its gid) as it was last sent, so after
     any change it can say exactly what's new, edited or gone. */
  function deskTracker() {
    var seen = {};   /* gid -> JSON of the mark; "bg" -> paper name */
    function gidOf() { return "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
    return {
      /* Forget the past and treat these as already shared */
      reset: function (items) {
        seen = {};
        (items || []).forEach(function (i) {
          if (i.type === "bg") seen.bg = i.name;
          else if (i.gid) seen[i.gid] = JSON.stringify(i);
        });
      },
      /* -> ops for everything that changed since last time */
      diff: function (items) {
        var ops = [];
        var now = {};
        var bg = null;
        (items || []).forEach(function (i) {
          if (i.type === "bg") { bg = i.name; return; }
          if (!i.gid) i.gid = gidOf();
          var json = JSON.stringify(i);
          now[i.gid] = json;
          if (seen[i.gid] !== json) ops.push({ t: "up", item: i });
        });
        Object.keys(seen).forEach(function (g) {
          if (g !== "bg" && !now[g]) ops.push({ t: "rm", gid: g });
        });
        if (bg && bg !== seen.bg) ops.push({ t: "bg", name: bg });
        if (bg) now.bg = bg;
        seen = now;
        return ops;
      }
    };
  }

  return {
    timers: timers,
    picker: picker,
    stars: stars,
    deskTracker: deskTracker,
    timerLeft: timerLeft,
    timerWire: timerWire,
    timerFromWire: timerFromWire,
    fmt: fmt,
    chime: chime,
    timerPill: timerPill,
    POLL_TYPES: POLL_TYPES,
    pollOptions: pollOptions,
    counts: counts,
    spin: spin,
    esc: esc
  };
})();
