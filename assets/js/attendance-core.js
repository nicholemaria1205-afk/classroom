/* ==========================================================================
   Doodle Desk — attendance (shared by the attendance page, the room page and
   the teaching desk)

   The teacher's "attendance book": their classes (names and seating order)
   and every day's marks. Kept in this browser straight away, and saved to
   their account (netlify/functions/attendance.js) so it follows them to any
   computer.

   Students take their own attendance: while a room page or the teaching
   desk is open, anyone who joins is marked present in the class linked to
   that room — added to the list first if they're new. The teacher's own
   marks always win: a student marked absent stays absent until the teacher
   changes it.

   Marks: "p" present · "l" late · "a" absent · "" (or nothing) not marked.

     DoodleAttendance.load()                 -> Promise (merges the account copy)
     DoodleAttendance.book()                 -> the whole book (a fresh copy)
     DoodleAttendance.classes()              -> live classes, oldest first
     DoodleAttendance.getClass(id)
     DoodleAttendance.createClass(name, names[])  -> id
     DoodleAttendance.renameClass / deleteClass
     DoodleAttendance.addStudent(cid, name)  -> id
     DoodleAttendance.renameStudent / removeStudent / moveStudent
     DoodleAttendance.mark(cid, date, sid, s)
     DoodleAttendance.day(cid, date)         -> { sid: { s, at, auto, joinedAt } }
     DoodleAttendance.classForRoom(room, create)
     DoodleAttendance.linkRoom(code, classId | "off" | "")
     DoodleAttendance.listen()               -> hosting pages: mark students who join
     DoodleAttendance.onChange(fn)
     DoodleAttendance.status()               -> "saved" | "saving" | "local" | "offline"
     DoodleAttendance.today() / dateKey(d)
   ========================================================================== */
window.DoodleAttendance = (function () {
  "use strict";

  var net = window.DoodleNet;
  var URL_ = "/.netlify/functions/attendance";
  var listeners = [];
  var syncTimer = null;
  var syncing = false;
  var again = false;
  var state = "saved";

  /* ---- Little helpers ---------------------------------------------------- */
  function newId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function dateKey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function today() { return dateKey(new Date()); }

  function norm(name) {
    return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function firstWord(name) { return norm(name).split(" ")[0]; }

  function token() {
    var s = net && net.session && net.session();
    return s && s.token ? s.token : null;
  }

  function who() {
    var t = net && net.teacher && net.teacher();
    return t && t.email ? t.email.toLowerCase() : "guest";
  }

  function cacheKey() { return "doodle-attendance-" + who(); }
  function dirtyKey() { return "doodle-attendance-dirty-" + who(); }

  function emptyBook() { return { classes: {}, records: {} }; }

  /* ---- This browser's copy ------------------------------------------------ */
  /* Always read fresh from storage, so a room tab and the attendance tab
     open side by side never overwrite each other's marks. */
  function read() {
    try {
      var b = JSON.parse(localStorage.getItem(cacheKey()) || "null");
      if (b && b.classes && b.records) return b;
    } catch (e) {}
    return emptyBook();
  }

  function write(book) {
    try { localStorage.setItem(cacheKey(), JSON.stringify(book)); } catch (e) {}
  }

  function setDirty(on) {
    try {
      if (on) localStorage.setItem(dirtyKey(), "1");
      else localStorage.removeItem(dirtyKey());
    } catch (e) {}
  }

  function isDirty() {
    try { return localStorage.getItem(dirtyKey()) === "1"; } catch (e) { return false; }
  }

  function notify() {
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  /* Change the book: read the latest, apply, save here, then to the account */
  function change(fn) {
    var book = read();
    var result = fn(book);
    write(book);
    setDirty(true);
    scheduleSync();
    notify();
    return result;
  }

  /* Same rules as the server: newest class version, newest mark per day */
  function merge(a, b) {
    var out = emptyBook();
    [a, b].forEach(function (src) {
      if (!src) return;
      Object.keys(src.classes || {}).forEach(function (id) {
        var c = src.classes[id];
        var have = out.classes[id];
        if (c && (!have || (c.updatedAt || 0) >= (have.updatedAt || 0))) out.classes[id] = JSON.parse(JSON.stringify(c));
      });
      Object.keys(src.records || {}).forEach(function (cid) {
        var days = src.records[cid] || {};
        Object.keys(days).forEach(function (date) {
          var marks = days[date] || {};
          Object.keys(marks).forEach(function (sid) {
            var m = marks[sid];
            if (!m) return;
            var day = ((out.records[cid] = out.records[cid] || {})[date] = out.records[cid][date] || {});
            var old = day[sid];
            var copy = { s: m.s || "", at: m.at || 0 };
            if (m.auto) copy.auto = true;
            if (m.joinedAt) copy.joinedAt = m.joinedAt;
            if (!old || copy.at >= old.at) {
              if (old && old.joinedAt && (!copy.joinedAt || old.joinedAt < copy.joinedAt)) copy.joinedAt = old.joinedAt;
              day[sid] = copy;
            } else if (copy.joinedAt && (!old.joinedAt || copy.joinedAt < old.joinedAt)) {
              old.joinedAt = copy.joinedAt;
            }
          });
        });
      });
    });
    Object.keys(out.classes).forEach(function (id) {
      if (out.classes[id].deleted) delete out.records[id];
    });
    return out;
  }

  /* ---- The account copy ---------------------------------------------------- */
  function call(method, body) {
    var t = token();
    if (!t) return Promise.resolve({ ok: false, status: 401 });
    var opts = { method: method, headers: { "Authorization": "Bearer " + t } };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(URL_, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        json.ok = res.ok;
        json.status = res.status;
        return json;
      });
    }, function () { return { ok: false, status: 0 }; });
  }

  function setState(s) {
    if (state === s) return;
    state = s;
    notify();
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    setState("saving");
    syncTimer = setTimeout(sync, 1200);
  }

  function sync() {
    if (syncing) { again = true; return Promise.resolve(); }
    syncing = true;
    var sent = read();
    return call("POST", { book: sent }).then(function (r) {
      syncing = false;
      if (r.ok && r.book) {
        /* Anything changed here while we were saving is merged back in */
        write(merge(read(), r.book));
        if (!again) setDirty(false);
        setState("saved");
        notify();
      } else {
        setState(r.status === 0 ? "offline" : "local");
      }
      if (again) { again = false; scheduleSync(); }
    });
  }

  function load() {
    return call("GET").then(function (r) {
      if (r.ok && r.book) {
        write(merge(r.book, read()));
        notify();
        if (isDirty()) return sync();
        setState("saved");
      } else {
        setState(r.status === 0 ? "offline" : "local");
      }
    });
  }

  /* Another tab changed the book (a student just joined the room, say) */
  window.addEventListener("storage", function (e) {
    if (e.key === cacheKey()) notify();
  });
  window.addEventListener("online", function () { if (isDirty()) scheduleSync(); });

  /* ---- Classes and students ---------------------------------------------- */
  function live(book, id) {
    var c = book.classes[id];
    return c && !c.deleted ? c : null;
  }

  function classes() {
    var book = read();
    return Object.keys(book.classes).map(function (id) { return book.classes[id]; })
      .filter(function (c) { return !c.deleted; })
      .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0) || a.name.localeCompare(b.name); });
  }

  function getClass(id) { return live(read(), id); }

  function addTo(c, name, joined) {
    var id = newId("s");
    c.students[id] = { id: id, name: String(name || "").trim().slice(0, 40) || "Student", addedAt: Date.now() };
    if (joined) c.students[id].joined = true;
    c.order.push(id);
    return id;
  }

  function createClass(name, names) {
    return change(function (book) {
      var id = newId("c");
      var c = { id: id, name: String(name || "").trim().slice(0, 60) || "My class",
                createdAt: Date.now(), updatedAt: Date.now(), students: {}, order: [] };
      (names || []).forEach(function (n) { if (String(n).trim()) addTo(c, n); });
      book.classes[id] = c;
      return id;
    });
  }

  function editClass(cid, fn) {
    return change(function (book) {
      var c = live(book, cid);
      if (!c) return null;
      var out = fn(c, book);
      c.updatedAt = Date.now();
      return out;
    });
  }

  function renameClass(cid, name) {
    editClass(cid, function (c) { c.name = String(name || "").trim().slice(0, 60) || c.name; });
  }

  function deleteClass(cid) {
    change(function (book) {
      var c = book.classes[cid];
      if (!c) return;
      book.classes[cid] = { id: cid, name: c.name, deleted: true, createdAt: c.createdAt, updatedAt: Date.now(), students: {}, order: [] };
      delete book.records[cid];
    });
    /* Rooms that filled this class go back to finding one by name */
    if (net) net.listRooms().forEach(function (r) {
      if (r.attendance === cid) net.updateRoom(r.code, { attendance: "" });
    });
  }

  function addStudent(cid, name) {
    return editClass(cid, function (c) { return addTo(c, name); });
  }

  function renameStudent(cid, sid, name) {
    editClass(cid, function (c) {
      var s = c.students[sid];
      if (!s) return;
      s.name = String(name || "").trim().slice(0, 40) || s.name;
      delete s.joined;   /* the teacher has checked this name */
    });
  }

  /* Off the list, but their past days stay in the history */
  function removeStudent(cid, sid) {
    editClass(cid, function (c) {
      if (!c.students[sid]) return;
      c.students[sid].left = true;
      c.order = c.order.filter(function (x) { return x !== sid; });
    });
  }

  function moveStudent(cid, from, to) {
    editClass(cid, function (c) {
      if (from < 0 || from >= c.order.length || to < 0 || to >= c.order.length) return;
      var moved = c.order.splice(from, 1)[0];
      c.order.splice(to, 0, moved);
    });
  }

  function confirmStudent(cid, sid) {
    editClass(cid, function (c) { if (c.students[sid]) delete c.students[sid].joined; });
  }

  /* ---- Marks ---------------------------------------------------------------- */
  function day(cid, date) {
    var book = read();
    return ((book.records[cid] || {})[date]) || {};
  }

  function mark(cid, date, sid, s) {
    change(function (book) {
      var d = ((book.records[cid] = book.records[cid] || {})[date] = book.records[cid][date] || {});
      var old = d[sid] || {};
      d[sid] = { s: s || "", at: Date.now() };
      if (old.joinedAt) d[sid].joinedAt = old.joinedAt;
    });
  }

  /* Several at once (everyone else present, clear the day…) */
  function markMany(cid, date, sids, s) {
    change(function (book) {
      var d = ((book.records[cid] = book.records[cid] || {})[date] = book.records[cid][date] || {});
      var now = Date.now();
      sids.forEach(function (sid) {
        var old = d[sid] || {};
        d[sid] = { s: s || "", at: now };
        if (old.joinedAt) d[sid].joinedAt = old.joinedAt;
      });
    });
  }

  /* ---- Rooms → classes ------------------------------------------------------ */
  /* A room fills the class it's linked to. Not linked yet: the class with the
     same name as the room — made the first time a student joins. */
  function classForRoom(room, create) {
    if (!room || room.attendance === "off") return null;
    if (room.attendance && getClass(room.attendance)) return getClass(room.attendance);
    var match = classes().filter(function (c) { return norm(c.name) === norm(room.name); })[0];
    if (!match && create) match = getClass(createClass(room.name, []));
    if (match && net) net.updateRoom(room.code, { attendance: match.id });
    return match || null;
  }

  function linkRoom(code, value) {
    if (net) net.updateRoom(code, { attendance: value || "" });
    notify();
  }

  function roomsFor(cid) {
    if (!net) return [];
    return net.listRooms().filter(function (r) { return r.attendance === cid; });
  }

  /* Which student on the list is this? Same name, or — if only one student
     has it — the same first name ("Ava" joins, "Ava Brown" is on the list). */
  function findStudent(c, name) {
    var n = norm(name);
    if (!n) return null;
    var ids = c.order;
    var exact = ids.filter(function (id) { return norm(c.students[id].name) === n; });
    if (exact.length) return exact[0];
    var f = firstWord(name);
    var firsts = ids.filter(function (id) { return firstWord(c.students[id].name) === f; });
    return firsts.length === 1 ? firsts[0] : null;
  }

  var seen = {};   /* "code|studentId|date" -> true, so heartbeats stay cheap */

  function studentJoined(code, student) {
    if (!student || !student.name || !net) return;
    var room = net.getRoom(code);
    if (!room) return;
    if (room.removed && room.removed[student.id]) return;
    var date = today();
    var key = code + "|" + student.id + "|" + date;
    if (seen[key]) return;

    var c = classForRoom(room, true);
    if (!c) return;
    seen[key] = true;

    var sid = findStudent(c, student.name);
    change(function (book) {
      var cls = live(book, c.id);
      if (!cls) return;
      if (!sid) {
        /* New to this class — add them, flagged so the teacher can check the name */
        sid = addTo(cls, student.name, true);
        cls.updatedAt = Date.now();
      }
      var d = ((book.records[cls.id] = book.records[cls.id] || {})[date] = book.records[cls.id][date] || {});
      var old = d[sid];
      var now = Date.now();
      if (!old || !old.s) {
        d[sid] = { s: "p", at: now, auto: true, joinedAt: (old && old.joinedAt) || now };
      } else if (!old.joinedAt) {
        old.joinedAt = now;   /* the teacher's own mark stays as it is */
      }
    });
  }

  var listening = false;
  function listen() {
    if (listening || !net) return;
    listening = true;
    ["join", "presence"].forEach(function (type) {
      net.on(type, function (p) {
        if (p && p.code && p.student) studentJoined(p.code, p.student);
      });
    });
    load();
  }

  /* ---- The old tracker ------------------------------------------------------- */
  /* The first time, bring over class and student names typed into the old
     attendance tracker (its marks had no dates, so they stay behind). */
  function bringOverOld() {
    var DONE = "doodle-attendance-imported";
    try {
      if (localStorage.getItem(DONE)) return 0;
      var old = JSON.parse(localStorage.getItem("classroomData") || "null");
      localStorage.setItem(DONE, "1");
      if (!old || !Array.isArray(old.classes)) return 0;
      var made = 0;
      old.classes.forEach(function (list, i) {
        var names = (list || []).map(function (s) { return s && s.name; })
          .filter(function (n) { return n && !/^Student \d+$/.test(String(n).trim()); });
        if (!names.length) return;
        var name = (old.classNames && old.classNames[i]) || "Class " + (i + 1);
        createClass(name, names);
        made++;
      });
      return made;
    } catch (e) {
      return 0;
    }
  }

  return {
    load: load,
    book: read,
    classes: classes,
    getClass: getClass,
    createClass: createClass,
    renameClass: renameClass,
    deleteClass: deleteClass,
    addStudent: addStudent,
    renameStudent: renameStudent,
    removeStudent: removeStudent,
    moveStudent: moveStudent,
    confirmStudent: confirmStudent,
    mark: mark,
    markMany: markMany,
    day: day,
    classForRoom: classForRoom,
    linkRoom: linkRoom,
    roomsFor: roomsFor,
    listen: listen,
    bringOverOld: bringOverOld,
    onChange: function (fn) { listeners.push(fn); },
    status: function () { return state; },
    today: today,
    dateKey: dateKey
  };
})();
