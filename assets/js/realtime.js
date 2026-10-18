/* ==========================================================================
   Doodle Desk — rooms and live sync (DoodleNet)

   Two ways to run, chosen automatically when a page loads:

   LIVE (across devices) — when the site is hosted with the token function in
   netlify/functions/ and an ABLY_API_KEY set, messages travel over Ably. A
   teacher's laptop and students' own devices can be in the same room.

   LOCAL (this browser only) — anywhere else (GitHub Pages, a file on disk, a
   Netlify site with no key yet). Rooms live in localStorage and messages go
   over a BroadcastChannel, so the whole app still works across tabs of one
   browser, with no server. This is how the app worked before live sync.

   Every page talks to this module and nothing else. Page code waits for
   `DoodleNet.ready` only where it has to ask a question of another device.

   How live mode is laid out
   -------------------------
   The teacher's browser is the host: it keeps the room, its students and their
   thumbnails in its own localStorage, exactly as before. Each room gets two
   Ably channels:

     doodle:<CODE>:up    students -> teacher   (join, leave, presence, board,
                                                status, full-reply, room-query,
                                                present-request/item/live)
     doodle:<CODE>:down  teacher -> students   (room-info, prompt, freeze,
                                                template, lock, remove-student,
                                                present-start/stop/decline,
                                                present-permission,
                                                clear-board, teacher-mark,
                                                full-request, room-closed)

   Students only listen to `down`, so a student never receives the other
   students' thumbnails. That keeps bandwidth and Ably's message count roughly
   proportional to the class size instead of its square.

   A student joining asks `room-query` on `up`; any teacher tab hosting that
   room answers `room-info` on `down`. If nobody answers, the room isn't open.

   Teacher accounts
   -----------------
   signup()/login() create or check a real account (handled by
   netlify/functions/auth-signup.js and auth-login.js) and keep a signed
   session token in this browser. That token rides along on every request
   for an Ably token (see fetchTokenRequest below), and ably-token.js only
   hands out full teacher access to a browser that can show a valid one —
   everyone else gets a student-only pass. If a site hasn't set JWT_SECRET
   yet, none of this is enforced and every browser keeps the old open pass,
   so existing sites don't need to do anything to keep working.
   ========================================================================== */
window.DoodleNet = (function () {
  "use strict";

  var STORE_KEY = "doodle-rooms";
  var SESSION_KEY = "doodle-teacher-session";
  var BUS_KEY = "doodle-bus";
  var PROTOCOL = 1;

  var cfg = (window.DOODLE && window.DOODLE.SYNC) || {};

  /* Ably allows 64 KiB per message; stay well inside it. */
  var MAX_BYTES = 60000;
  var CHUNK_BYTES = 40000;

  /* How long a teacher's browser keeps listening for a room it hosts */
  var HOST_WINDOW_MS = 72 * 3600 * 1000;
  var HOST_MAX_ROOMS = 20;

  /* One id per tab, so a tab never reacts to its own broadcasts */
  var clientId = Math.random().toString(36).slice(2, 10);

  /* "connecting" until the page has decided; then "remote" or "local" */
  var mode = "connecting";

  function cleanCode(code) {
    return String(code || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16);
  }

  /* ---- Storage ---------------------------------------------------------- */
  /* The teacher's browser applies a stream of updates from students. Parsing
     and rewriting the whole store for every one would be wasteful, so reads
     are cached against the raw string and live-mode writes are coalesced. */
  var cacheRaw = null;
  var cacheState = null;
  var flushTimer = null;

  function readStore() {
    if (flushTimer && cacheState) return cacheState; /* newer than storage */
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) {}
    if (raw !== null && raw === cacheRaw && cacheState) return cacheState;
    try {
      cacheState = raw ? JSON.parse(raw) : { rooms: {} };
    } catch (e) {
      cacheState = { rooms: {} };
    }
    if (!cacheState || !cacheState.rooms) cacheState = { rooms: {} };
    cacheRaw = raw;
    return cacheState;
  }

  function persist(state) {
    var json;
    try {
      json = JSON.stringify(state);
      localStorage.setItem(STORE_KEY, json);
      cacheRaw = json;
      return true;
    } catch (e) {
      /* Almost always the quota, and thumbnails are the bulky part — drop
         them and keep the rooms themselves rather than losing everything. */
      try {
        Object.keys(state.rooms).forEach(function (code) {
          var students = state.rooms[code].students || {};
          Object.keys(students).forEach(function (id) { delete students[id].thumb; });
        });
        json = JSON.stringify(state);
        localStorage.setItem(STORE_KEY, json);
        cacheRaw = json;
        return true;
      } catch (err) {
        return false;
      }
    }
  }

  function writeStore(state, deferred) {
    cacheState = state;
    if (deferred) {
      if (!flushTimer) {
        flushTimer = setTimeout(function () {
          flushTimer = null;
          persist(cacheState);
        }, 300);
      }
      return true;
    }
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    return persist(state);
  }

  window.addEventListener("pagehide", function () {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; persist(cacheState); }
  });

  /* ---- How long things are kept ------------------------------------------
     Shared by rooms and by Doodle Pads in the Doodle Drawer. keepUntil() turns
     a choice into a date (null = until the teacher deletes it). */
  var KEEP = {
    day: { label: "1 day", days: 1 },
    week: { label: "1 week", days: 7 },
    month: { label: "1 month", days: 30 },
    three: { label: "3 months", days: 91 },
    schoolyear: { label: "Until the end of the school year" },
    year: { label: "1 year", days: 365 },
    forever: { label: "Until I delete it" }
  };

  function keepUntil(choice, from) {
    var start = from || Date.now();
    var k = KEEP[choice] || KEEP.month;
    if (choice === "forever") return null;
    if (choice === "schoolyear") {
      /* The next June 30th, end of the day */
      var d = new Date(start);
      var end = new Date(d.getFullYear(), 5, 30, 23, 59, 59);
      if (end.getTime() <= start) end = new Date(d.getFullYear() + 1, 5, 30, 23, 59, 59);
      return end.getTime();
    }
    return start + k.days * 864e5;
  }

  function keepLabel(until) {
    if (!until) return "Kept until you delete it";
    var left = until - Date.now();
    var date = new Date(until).toLocaleDateString([], { month: "short", day: "numeric", year: new Date(until).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
    if (left <= 0) return "Expired";
    if (left < 864e5) return "Ends today";
    if (left < 3 * 864e5) return "Ends in " + Math.ceil(left / 864e5) + " days (" + date + ")";
    return "Kept until " + date;
  }

  function keepOptionsHTML(choices, selected) {
    return choices.map(function (c) {
      return '<option value="' + c + '"' + (c === selected ? " selected" : "") + ">" + KEEP[c].label + "</option>";
    }).join("");
  }

  /* ---- Room codes ------------------------------------------------------- */
  /* Short, sayable, and easy to copy off a board from the back of the room */
  var WORDS = ["SUN", "CAT", "DOG", "SKY", "FOX", "OWL", "BEE", "ELK", "JAM",
               "PIE", "MAP", "KEY", "BUS", "OAK", "ICE", "FIG", "YAK", "POD"];
  var LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ"; /* no I/O/Q — they read as 1/0 */

  function makeCode(existing) {
    for (var tries = 0; tries < 200; tries++) {
      var code = WORDS[Math.floor(Math.random() * WORDS.length)] + "-" +
        Math.floor(10 + Math.random() * 90) +
        LETTERS[Math.floor(Math.random() * LETTERS.length)];
      if (!existing[code]) return code;
    }
    return "ROOM-" + Date.now().toString(36).toUpperCase();
  }

  /* ---- Rooms (the teacher's side) --------------------------------------- */
  function createRoom(details) {
    var state = readStore();
    var room = {
      code: makeCode(state.rooms),
      name: (details.name || "Untitled room").slice(0, 60),
      subject: details.subject || "✏️ General",
      prompt: (details.prompt || "").slice(0, 160),
      template: details.template || "",
      keep: KEEP[details.keep] ? details.keep : "month",
      keepUntil: keepUntil(KEEP[details.keep] ? details.keep : "month"),
      teacher: (details.teacher || "Teacher").slice(0, 40),
      frozen: false,
      createdAt: Date.now(),
      students: {}
    };
    state.rooms[room.code] = room;
    writeStore(state);
    watch(room.code, "teacher");
    return room;
  }

  function getRoom(code) {
    if (!code) return null;
    return readStore().rooms[String(code).toUpperCase()] || null;
  }

  function listRooms() {
    var rooms = readStore().rooms;
    return Object.keys(rooms).map(function (c) { return rooms[c]; })
      .sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  function updateRoom(code, patch) {
    var state = readStore();
    var room = state.rooms[code];
    if (!room) return null;
    Object.keys(patch).forEach(function (k) { room[k] = patch[k]; });
    writeStore(state);
    return room;
  }

  function deleteRoom(code) {
    var state = readStore();
    delete state.rooms[code];
    writeStore(state);
    send("room-closed", { code: code });
    forgetRoomData(code);
  }

  /* A closed or expired room takes its saved grades and snapshots with it
     (anything saved to the Doodle Drawer stays, on its own timer). */
  function forgetRoomData(code) {
    try { localStorage.removeItem("doodle-grades-" + code); } catch (e) {}
    try {
      if (!window.indexedDB) return;
      var req = indexedDB.open("doodle-desk", 1);
      req.onupgradeneeded = function () {
        var store = req.result.createObjectStore("snapshots", { keyPath: "id" });
        store.createIndex("code", "code");
      };
      req.onsuccess = function () {
        var db = req.result;
        var t = db.transaction("snapshots", "readwrite");
        var idx = t.objectStore("snapshots").index("code");
        idx.openCursor(IDBKeyRange.only(code)).onsuccess = function (e) {
          var cur = e.target.result;
          if (cur) { cur.delete(); cur.continue(); }
        };
      };
    } catch (e) {}
  }

  /* Close rooms whose keep-until date has passed. Returns the ones tidied. */
  function tidyRooms() {
    var now = Date.now();
    return listRooms().filter(function (r) {
      if (r.keepUntil && r.keepUntil < now) {
        deleteRoom(r.code);
        return true;
      }
      return false;
    });
  }

  /* What a student is allowed to know about a room */
  function publicRoom(room) {
    return {
      code: room.code,
      name: room.name,
      subject: room.subject,
      prompt: room.prompt || "",
      frozen: !!room.frozen,
      template: room.template || "",
      keepUntil: room.keepUntil || null,
      allowPresent: !!room.allowPresent,
      teacher: room.teacher,
      createdAt: room.createdAt
    };
  }

  /* ---- Students --------------------------------------------------------- */
  /* Only the teacher's browser (or a browser that happens to hold the room)
     has the room in storage. On a student's own device these are harmless
     no-ops, and the same facts reach the teacher as messages instead. */
  function setStudent(code, id, patch) {
    var state = readStore();
    var room = state.rooms[code];
    if (!room || !room.students[id]) return null;
    Object.keys(patch).forEach(function (k) { room.students[id][k] = patch[k]; });
    room.students[id].lastSeen = Date.now();
    writeStore(state);
    return room.students[id];
  }

  function removeStudent(code, id) {
    var state = readStore();
    var room = state.rooms[code];
    if (room) {
      delete room.students[id];
      if (room.notes) delete room.notes[id];
      writeStore(state);
    }
    send("leave", { code: code, studentId: id });
  }

  function getStudents(code) {
    var room = getRoom(code);
    if (!room) return [];
    return Object.keys(room.students).map(function (id) { return room.students[id]; })
      .sort(function (a, b) { return a.joinedAt - b.joinedAt; });
  }

  function newStudent(name) {
    return {
      id: "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: (name || "Student").slice(0, 24),
      status: "working",
      joinedAt: Date.now(),
      lastSeen: Date.now(),
      marks: 0,
      thumb: ""
    };
  }

  /* ---- Students (the student's side) ------------------------------------ */
  /* The room as this tab last saw it — lets a refresh restore the board even
     if the teacher's browser is momentarily unreachable. */
  function mirrorRoom(code, room) {
    try { sessionStorage.setItem("doodle-room-" + code, JSON.stringify(room)); } catch (e) {}
  }

  function cachedRoom(code) {
    try {
      return JSON.parse(sessionStorage.getItem("doodle-room-" + cleanCode(code))) || null;
    } catch (e) {
      return null;
    }
  }

  /* Resolves with the room, or null if there is no such room open right now */
  function fetchRoom(code) {
    code = cleanCode(code);
    if (!code) return Promise.resolve(null);

    return ready.then(function () {
      if (mode !== "remote") return getRoom(code);

      return watch(code, "student").then(function () {
        return new Promise(function (resolve) {
          var settled = false;
          var retry = null;
          var giveUp = null;
          var off = on("room-info", function (p) {
            if (p.code !== code || p.asker !== clientId || !p.room) return;
            finish(p.room);
          });

          function finish(room) {
            if (settled) return;
            settled = true;
            clearTimeout(retry);
            clearTimeout(giveUp);
            off();
            if (room) mirrorRoom(code, room);
            resolve(room);
          }

          function ask() { send("room-query", { code: code, asker: clientId }); }
          ask();
          retry = setTimeout(ask, 2000);
          giveUp = setTimeout(function () { finish(null); }, 5000);
        });
      });
    });
  }

  /* Resolves { ok, student, room } or { ok:false, error }. Pass `existing` to
     re-join as a student this tab already was, e.g. after a refresh. */
  function joinRoom(code, name, existing) {
    code = cleanCode(code);
    return fetchRoom(code).then(function (room) {
      if (!room) {
        return {
          ok: false,
          error: mode === "remote"
            ? "We can't find that room. Is your teacher's room open?"
            : "We can't find a room with that code."
        };
      }

      var student = existing || newStudent(name);

      if (mode !== "remote") {
        var state = readStore();
        var local = state.rooms[code];
        if (!local) return { ok: false, error: "We can't find a room with that code." };
        /* Re-joining: the stored copy has the freshest board, so keep it */
        if (local.students[student.id]) student = local.students[student.id];
        else local.students[student.id] = student;
        writeStore(state);
        room = local;
      }

      send("join", { code: code, student: student });
      return { ok: true, student: student, room: room };
    });
  }

  /* ---- Teacher sessions --------------------------------------------------
     A real account (see the file header). The session is a signed token
     plus the name/email to show in the UI — no password is ever stored. */
  function decodeJwtPayload(token) {
    try {
      var part = String(token).split(".")[1];
      if (!part) return null;
      var b64 = part.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      return JSON.parse(atob(b64));
    } catch (e) {
      return null;
    }
  }

  function session() {
    var raw;
    try {
      raw = JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch (e) {
      return null;
    }
    if (!raw || !raw.token) return null;

    var payload = decodeJwtPayload(raw.token);
    if (payload && typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
      logout();
      return null;
    }
    return raw;
  }

  function setSession(data) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch (e) {}
    return data;
  }

  function logout() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  /* What page code asks for — just enough to greet the teacher and know
     they're signed in. null means "not signed in". */
  function teacher() {
    var s = session();
    return s ? { name: s.name, email: s.email, pro: !!s.pro } : null;
  }

  /* Ask the server whether this teacher is on Teacher Pro right now — the
     Pro list can change after they logged in. Resolves to the teacher, with
     `pro`, or null if they aren't logged in (or the server can't be reached,
     in which case the last known answer is kept). */
  function account() {
    var s = session();
    if (!s || !s.token) return Promise.resolve(null);
    return fetch("/.netlify/functions/account", { headers: { "Authorization": "Bearer " + s.token } })
      .then(function (res) {
        if (res.status === 401) return null;
        return res.json().then(function (json) {
          if (json && json.teacher) {
            s.pro = !!json.teacher.pro;
            setSession({ token: s.token, name: s.name, email: s.email, pro: s.pro });
          }
          return teacher();
        });
      }, function () { return teacher(); });
  }

  /* Store one worksheet page (a data: URL image) on the server. Teacher Pro.
     Resolves { ok, id } or { ok:false, error, pro } */
  function uploadPage(image, name) {
    var s = session();
    if (!s || !s.token) return Promise.resolve({ ok: false, error: "Log in as a teacher to upload files." });
    return fetch("/.netlify/functions/asset-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + s.token },
      body: JSON.stringify({ image: image, name: name || "" })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (res.ok && json.id) return { ok: true, id: json.id };
        return { ok: false, error: json.error || "Upload failed (" + res.status + ").", pro: json.pro };
      });
    }, function () {
      return { ok: false, error: "Could not reach the server. Check your connection and try again." };
    });
  }

  function authCall(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        return { ok: res.ok, status: res.status, body: json || {} };
      });
    });
  }

  function afterAuth(call) {
    return call.then(function (r) {
      if (!r.ok || !r.body || !r.body.token) {
        return { ok: false, error: (r.body && r.body.error) || "Something went wrong. Try again." };
      }
      setSession({ token: r.body.token, name: r.body.teacher.name, email: r.body.teacher.email, pro: !!r.body.teacher.pro });
      return { ok: true, teacher: r.body.teacher };
    }, function () {
      return { ok: false, error: "Could not reach the server. Check your connection and try again." };
    });
  }

  /* Create a brand-new teacher account and sign in as it. */
  function signup(email, password, name) {
    return afterAuth(authCall("/.netlify/functions/auth-signup", { email: email, password: password, name: name }));
  }

  /* Check an existing teacher account and sign in as it. */
  function login(email, password) {
    return afterAuth(authCall("/.netlify/functions/auth-login", { email: email, password: password }));
  }

  /* Per-tab, so opening three tabs gives you three students to test with */
  function me(code) {
    try {
      return JSON.parse(sessionStorage.getItem("doodle-me-" + code)) || null;
    } catch (e) {
      return null;
    }
  }

  function setMe(code, student) {
    try { sessionStorage.setItem("doodle-me-" + code, JSON.stringify(student)); } catch (e) {}
  }

  function forgetMe(code) {
    try {
      sessionStorage.removeItem("doodle-me-" + code);
      sessionStorage.removeItem("doodle-room-" + code);
    } catch (e) {}
  }

  /* A student's own full board, kept per tab so a refresh restores it */
  function saveMyBoard(code, id, items) {
    try {
      sessionStorage.setItem("doodle-board-" + code + "-" + id, JSON.stringify(items));
    } catch (e) {}
  }

  function loadMyBoard(code, id) {
    try {
      return JSON.parse(sessionStorage.getItem("doodle-board-" + code + "-" + id)) || [];
    } catch (e) {
      return [];
    }
  }

  /* ---- Message bus ------------------------------------------------------ */
  var handlers = {};
  var channel = null;   /* local mode: the BroadcastChannel, if there is one */
  var ably = null;      /* live mode: the Ably client */
  var queue = [];       /* sends made before the transport was chosen */
  var connListeners = [];

  function dispatch(msg) {
    (handlers[msg.type] || []).forEach(function (fn) {
      try { fn(msg.payload || {}, msg); } catch (e) { /* one bad handler shouldn't stop the rest */ }
    });
    (handlers["*"] || []).forEach(function (fn) {
      try { fn(msg.payload || {}, msg); } catch (e) {}
    });
  }

  function deliver(msg) {
    if (!msg || msg.v !== PROTOCOL || msg.from === clientId) return;
    if (mode === "remote") {
      msg = reassemble(msg);
      if (!msg) return;
      applyToStore(msg);
      answerQuery(msg);
    }
    if (hosting) handleNotes(msg);
    dispatch(msg);
  }

  /* ---- Notes on a student's desk -----------------------------------------
     Every mark a teacher leaves on a student's desk is kept here until that
     desk says it got it. So a student who was offline — or closed the tab
     and comes back another day under the same name — finds the note waiting.
     Whichever teacher page is hosting the room (the room page or the
     teaching desk) hands them over. */
  var hosting = false;
  var noteSentAt = {};

  function noteId() {
    return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function getNotes(code, studentId) {
    var room = getRoom(code);
    var n = room && room.notes && room.notes[studentId];
    return (n && n.items) || [];
  }

  /* Replace what's waiting for one student (an empty list clears it) */
  function setNotes(code, studentId, items, name) {
    var state = readStore();
    var room = state.rooms[code];
    if (!room) return [];
    room.notes = room.notes || {};
    var old = room.notes[studentId] || {};
    var s = room.students[studentId];
    items = (items || []).filter(function (i) { return i && i.type !== "bg"; });
    items.forEach(function (i) { if (!i.nid) i.nid = noteId(); });
    if (items.length) {
      room.notes[studentId] = { name: name || (s && s.name) || old.name || "", items: items, at: Date.now() };
    } else {
      delete room.notes[studentId];
    }
    writeStore(state);
    return items;
  }

  /* Add marks for a student and try to hand them over straight away */
  function leaveNote(code, studentId, items) {
    setNotes(code, studentId, getNotes(code, studentId).concat(items || []));
    sendNotes(code, studentId, true);
  }

  function sendNotes(code, studentId, live) {
    var items = getNotes(code, studentId);
    if (!items.length) return;
    var key = code + ":" + studentId;
    if (!live && Date.now() - (noteSentAt[key] || 0) < 4000) return;
    noteSentAt[key] = Date.now();
    send("teacher-mark", { code: code, studentId: studentId, items: items, later: !live });
  }

  function sameName(a, b) {
    return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  }

  function handleNotes(msg) {
    var p = msg.payload || {};
    var room = p.code && getRoom(p.code);
    if (!room) return;

    if (msg.type === "teacher-mark-got") {
      var got = {};
      (p.nids || []).forEach(function (n) { got[n] = true; });
      var left = getNotes(room.code, p.studentId).filter(function (i) { return !got[i.nid]; });
      setNotes(room.code, p.studentId, left);
      return;
    }

    if (["join", "presence", "board", "status"].indexOf(msg.type) < 0) return;
    var id = p.studentId || (p.student && p.student.id);
    if (!id || (room.removed && room.removed[id])) return;

    /* Back in a new tab (or on another day) with a new id but the same name:
       the notes left for their old, now-offline desk follow them. */
    var notes = room.notes || {};
    if (!notes[id] && p.student && p.student.name) {
      Object.keys(notes).forEach(function (oldId) {
        if (oldId === id || !sameName(notes[oldId].name, p.student.name)) return;
        var old = room.students[oldId];
        if (old && isOnline(old)) return;
        setNotes(room.code, id, getNotes(room.code, id).concat(notes[oldId].items), p.student.name);
        setNotes(room.code, oldId, []);
      });
    }
    sendNotes(room.code, id, false);
  }

  function send(type, payload) {
    var msg = { v: PROTOCOL, type: type, from: clientId, at: Date.now(), payload: payload || {} };
    if (mode === "connecting") {
      queue.push(msg);
      return msg;
    }
    transmit(msg);
    return msg;
  }

  function transmit(msg) {
    if (mode === "remote") return transmitRemote(msg);
    if (channel) {
      channel.postMessage(msg);
    } else {
      try {
        localStorage.setItem(BUS_KEY, JSON.stringify(msg));
      } catch (e) {}
    }
  }

  function on(type, fn) {
    (handlers[type] = handlers[type] || []).push(fn);
    return function off() {
      handlers[type] = handlers[type].filter(function (f) { return f !== fn; });
    };
  }

  /* ---- Live transport (Ably) -------------------------------------------- */
  var UP_TYPES = { "join": 1, "leave": 1, "presence": 1, "board": 1, "status": 1,
                   "full-reply": 1, "room-query": 1, "teacher-mark-got": 1,
                   "present-request": 1, "present-item": 1, "present-live": 1 };

  var subscribed = {};
  var assembling = {};

  function channelName(code, dir) {
    return "doodle:" + cleanCode(code) + ":" + dir;
  }

  function quiet(result) {
    if (result && typeof result.catch === "function") result.catch(function () {});
  }

  function publish(ch, msg) {
    var size = JSON.stringify(msg).length;
    /* A thumbnail is the only thing that can be dropped and still be useful */
    if (size > MAX_BYTES && msg.payload && msg.payload.thumb) {
      msg.payload.thumb = "";
      size = JSON.stringify(msg).length;
    }
    if (size > MAX_BYTES) {
      if (window.console) console.warn("[DoodleNet] dropped an oversized '" + msg.type + "' message (" + size + " bytes)");
      return;
    }
    quiet(ch.publish(msg.type, msg));
  }

  function transmitRemote(msg) {
    var code = msg.payload && msg.payload.code;
    if (!code || !ably) return;
    var ch = ably.channels.get(channelName(code, UP_TYPES[msg.type] ? "up" : "down"));
    if (msg.type === "full-reply") return publishInParts(ch, msg);
    publish(ch, msg);
  }

  /* A long lesson's full board can outgrow one message, so it travels in
     parts and is put back together before any page code sees it. */
  function publishInParts(ch, msg) {
    var p = msg.payload;
    var items = p.items || [];
    var parts = [];
    var cur = [];
    var size = 0;

    items.forEach(function (item) {
      var n = JSON.stringify(item).length + 1;
      if (cur.length && size + n > CHUNK_BYTES) {
        parts.push(cur);
        cur = [];
        size = 0;
      }
      cur.push(item);
      size += n;
    });
    parts.push(cur);

    var xid = clientId + "-" + Date.now().toString(36);
    parts.forEach(function (chunk, i) {
      publish(ch, {
        v: msg.v, type: msg.type, from: msg.from, at: msg.at,
        payload: { code: p.code, studentId: p.studentId, items: chunk, part: i, parts: parts.length, xid: xid }
      });
    });
  }

  function reassemble(msg) {
    var p = msg.payload;
    if (!p || !p.parts || p.parts < 2) return msg;

    var now = Date.now();
    Object.keys(assembling).forEach(function (k) {
      if (now - assembling[k].t > 30000) delete assembling[k];
    });

    var slot = assembling[p.xid] || (assembling[p.xid] = { got: 0, chunks: [], t: now });
    if (!slot.chunks[p.part]) {
      slot.chunks[p.part] = p.items || [];
      slot.got++;
    }
    if (slot.got < p.parts) return null;

    delete assembling[p.xid];
    return {
      v: msg.v, type: msg.type, from: msg.from, at: msg.at,
      payload: { code: p.code, studentId: p.studentId, items: [].concat.apply([], slot.chunks) }
    };
  }

  /* Subscribe to one direction of a room. Teachers listen to `up`, students
     to `down`. Resolves once attached (or straight away in local mode). */
  function watch(code, role) {
    code = cleanCode(code);
    if (role === "teacher") hosting = true;
    return ready.then(function () {
      if (mode !== "remote" || !code) return;

      var dir = role === "teacher" ? "up" : "down";
      var key = code + ":" + dir;
      if (subscribed[key]) return subscribed[key];

      var ch = ably.channels.get(channelName(code, dir));
      subscribed[key] = Promise.resolve(ch.subscribe(function (m) { deliver(m.data); }))
        .catch(function (err) {
          delete subscribed[key];
          if (window.console) console.warn("[DoodleNet] couldn't listen to " + key, err);
        });
      return subscribed[key];
    });
  }

  /* Teacher pages call this: listen for students joining any room this
     browser has open. Rooms older than a few days are left alone. */
  function host() {
    hosting = true;
    return ready.then(function () {
      if (mode !== "remote") return;
      var cutoff = Date.now() - HOST_WINDOW_MS;
      /* Rooms opened lately — a room kept for a month still works when its
         teacher comes back to it */
      var rooms = listRooms().filter(function (r) { return (r.openedAt || r.createdAt) >= cutoff; })
        .slice(0, HOST_MAX_ROOMS);
      return Promise.all(rooms.map(function (r) { return watch(r.code, "teacher"); }));
    });
  }

  /* The teacher's browser is the source of truth. On live messages it applies
     them to the stored room, then page handlers read the store as they always
     did. Times come from this clock, not the student's, so "online" can't be
     thrown off by a device with the wrong time. */
  function upsertStudent(room, incoming, thumbGiven) {
    if (!incoming || !incoming.id) return false;
    var old = room.students[incoming.id];
    if (!old && !incoming.name) return false;

    var merged = {};
    if (old) Object.keys(old).forEach(function (k) { merged[k] = old[k]; });
    Object.keys(incoming).forEach(function (k) {
      if (k === "thumb" && !thumbGiven) return;
      merged[k] = incoming[k];
    });
    merged.joinedAt = (old && old.joinedAt) || incoming.joinedAt || Date.now();
    merged.lastSeen = Date.now();
    room.students[incoming.id] = merged;
    return true;
  }

  function applyToStore(msg) {
    var p = msg.payload || {};
    if (!p.code) return;

    var state = readStore();
    var room = state.rooms[p.code];
    if (!room) return;

    var dirty = false;
    switch (msg.type) {
      case "join":
      case "presence":
        dirty = upsertStudent(room, p.student, false);
        break;

      case "leave":
        if (room.students[p.studentId]) {
          delete room.students[p.studentId];
          dirty = true;
        }
        break;

      case "status":
      case "board":
        var s = p.student || { id: p.studentId };
        if (p.status) s.status = p.status;
        if (typeof p.marks === "number") s.marks = p.marks;
        if (p.thumb !== undefined) s.thumb = p.thumb;
        dirty = upsertStudent(room, s, p.thumb !== undefined);
        break;
    }

    if (dirty) writeStore(state, true);
  }

  function answerQuery(msg) {
    if (msg.type !== "room-query") return;
    var p = msg.payload || {};
    var room = getRoom(p.code);
    if (!room) return;
    send("room-info", { code: room.code, asker: p.asker, room: publicRoom(room) });
  }

  function notifyConnection(state) {
    connListeners.forEach(function (fn) {
      try { fn(state); } catch (e) {}
    });
  }

  function onConnection(fn) {
    connListeners.push(fn);
    return function off() {
      connListeners = connListeners.filter(function (f) { return f !== fn; });
    };
  }

  /* ---- Choosing a transport --------------------------------------------- */
  function withTimeout(promise, ms, what) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error(what + " timed out")); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); },
                   function (e) { clearTimeout(t); reject(e); });
    });
  }

  function fetchTokenRequest() {
    var opts = { cache: "no-store" };
    var s = session();
    if (s && s.token) opts.headers = { "Authorization": "Bearer " + s.token };

    return fetch(cfg.TOKEN_URL, opts).then(function (res) {
      if (!res.ok) throw new Error("token endpoint answered " + res.status);
      return res.json();
    }).then(function (json) {
      if (!json || !json.keyName || !json.mac) throw new Error("token endpoint gave no token request");
      return json;
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.Ably) return resolve();
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("could not load " + src)); };
      document.head.appendChild(s);
    });
  }

  function connectAbly() {
    return new Promise(function (resolve, reject) {
      if (!window.Ably || !window.Ably.Realtime) return reject(new Error("the Ably library did not load"));

      var client = new window.Ably.Realtime({
        authCallback: function (params, callback) {
          fetchTokenRequest().then(function (t) { callback(null, t); },
                                   function (e) { callback(e, null); });
        },
        echoMessages: false
      });

      var settled = false;
      var timer = setTimeout(function () { finish(new Error("connecting timed out")); }, 8000);

      function finish(err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          try { client.close(); } catch (e) {}
          return reject(err);
        }
        ably = client;
        client.connection.on(function (change) { notifyConnection(change.current); });
        resolve();
      }

      client.connection.on(function (change) {
        if (settled) return;
        if (change.current === "connected") finish();
        else if (change.current === "failed" || change.current === "suspended" || change.current === "closed") {
          finish(new Error("connection " + change.current));
        }
      });
      if (client.connection.state === "connected") finish();
    });
  }

  function useLocal() {
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel("doodle-desk");
      channel.addEventListener("message", function (e) { deliver(e.data); });
    } else {
      /* Fallback: a localStorage key others see change. The writing tab does
         not get its own storage event, which is exactly what we want. */
      window.addEventListener("storage", function (e) {
        if (e.key !== BUS_KEY || !e.newValue) return;
        try { deliver(JSON.parse(e.newValue)); } catch (err) {}
      });
    }
    return "local";
  }

  function chooseTransport() {
    if (!cfg.TOKEN_URL || !cfg.SDK_URL || location.protocol === "file:") {
      return Promise.resolve(useLocal());
    }
    return withTimeout(fetchTokenRequest(), 4000, "the token endpoint")
      .then(function () { return loadScript(cfg.SDK_URL); })
      .then(connectAbly)
      .then(function () { return "remote"; })
      .catch(function (err) {
        if (window.console) console.info("[DoodleNet] live sync isn't available here, so rooms stay in this browser:", err && err.message);
        return useLocal();
      });
  }

  /* ---- Helpers ---------------------------------------------------------- */
  function joinUrl(code) {
    var base = location.href.replace(/[^/]*$/, "");
    return base + "board.html?code=" + encodeURIComponent(code);
  }

  function isOnline(student) {
    return Date.now() - (student.lastSeen || 0) < 20000;
  }

  /* Kept last: choosing a transport touches everything declared above. */
  var ready = chooseTransport().then(function (chosen) {
    mode = chosen;
    queue.splice(0).forEach(transmit);
    return chosen;
  });

  return {
    clientId: clientId,
    ready: ready,
    mode: function () { return mode; },
    onConnection: onConnection,
    createRoom: createRoom,
    getRoom: getRoom,
    listRooms: listRooms,
    updateRoom: updateRoom,
    deleteRoom: deleteRoom,
    tidyRooms: tidyRooms,
    KEEP: KEEP,
    keepUntil: keepUntil,
    keepLabel: keepLabel,
    keepOptionsHTML: keepOptionsHTML,
    host: host,
    watch: watch,
    fetchRoom: fetchRoom,
    cachedRoom: cachedRoom,
    joinRoom: joinRoom,
    setStudent: setStudent,
    removeStudent: removeStudent,
    getStudents: getStudents,
    teacher: teacher,
    account: account,
    uploadPage: uploadPage,
    session: session,
    signup: signup,
    login: login,
    logout: logout,
    me: me,
    setMe: setMe,
    forgetMe: forgetMe,
    saveMyBoard: saveMyBoard,
    loadMyBoard: loadMyBoard,
    send: send,
    on: on,
    joinUrl: joinUrl,
    isOnline: isOnline,
    getNotes: getNotes,
    setNotes: setNotes,
    leaveNote: leaveNote
  };
})();
