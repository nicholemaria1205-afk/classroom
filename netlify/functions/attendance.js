/* ==========================================================================
   Doodle Desk — attendance, kept in the teacher's account

   Every request needs the teacher's session (Bearer token). One document per
   teacher holds their classes (names, seating order) and every day's marks,
   so attendance follows them to any computer.

   GET                         -> { book }
   POST { book }               -> { book }   (merged with what's stored)

   A book looks like
     { classes: { <classId>: { id, name, order: [studentId…],
                               students: { <id>: { id, name, addedAt, joined? } },
                               updatedAt, deleted? } },
       records: { <classId>: { "2026-10-19": { <studentId>: { s, at, auto?, joinedAt? } } } } }
   where s is "p" (present), "l" (late), "a" (absent) or "" (cleared).

   Two computers can be marking at once, so saving merges rather than
   overwrites: each class keeps its newest version, and each student's mark
   on each day keeps its newest change.
   ========================================================================== */
"use strict";

const crypto = require("crypto");
const { teacherFrom } = require("./_lib/teacher.js");

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_CLASSES = 40;
const MAX_STUDENTS = 80;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9]{4,32}$/;
const STATUS = { p: 1, l: 1, a: 1, "": 1 };

function respond(statusCode, body) {
  return { statusCode: statusCode, headers: headers, body: JSON.stringify(body) };
}

function clean(text, max) {
  return String(text == null ? "" : text).replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max);
}

function num(n) {
  n = Number(n);
  return isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function keyFor(email) {
  return crypto.createHash("sha256").update(String(email).toLowerCase()).digest("hex").slice(0, 32) + "/book";
}

/* Keep only well-formed parts of whatever the browser sent */
function tidyClass(c) {
  if (!c || !ID.test(String(c.id || ""))) return null;
  var out = { id: c.id, name: clean(c.name, 60) || "My class", createdAt: num(c.createdAt), updatedAt: num(c.updatedAt), students: {}, order: [] };
  if (c.deleted) { out.deleted = true; return out; }
  /* Students taken off the list keep their name (flagged `left`) so their
     past days still show in the history */
  var students = c.students && typeof c.students === "object" ? c.students : {};
  Object.keys(students).slice(0, MAX_STUDENTS * 4).forEach(function (id) {
    var s = students[id];
    if (!s || !ID.test(id)) return;
    out.students[id] = { id: id, name: clean(s.name, 40) || "Student", addedAt: num(s.addedAt) };
    if (s.joined) out.students[id].joined = true;
    if (s.left) out.students[id].left = true;
  });
  (Array.isArray(c.order) ? c.order : []).forEach(function (id) {
    if (out.students[id] && !out.students[id].left && out.order.indexOf(id) < 0) out.order.push(id);
  });
  Object.keys(out.students).forEach(function (id) {
    if (!out.students[id].left && out.order.indexOf(id) < 0) out.order.push(id);
  });
  out.order = out.order.slice(0, MAX_STUDENTS);
  return out;
}

function tidyMark(m) {
  if (!m || !STATUS[m.s]) return null;
  var out = { s: m.s, at: num(m.at) };
  if (m.auto) out.auto = true;
  if (m.joinedAt) out.joinedAt = num(m.joinedAt);
  return out;
}

function merge(stored, incoming) {
  var book = { classes: {}, records: {} };
  [stored, incoming].forEach(function (src) {
    if (!src) return;
    var classes = src.classes || {};
    Object.keys(classes).forEach(function (id) {
      var c = tidyClass(classes[id]);
      if (!c) return;
      var have = book.classes[id];
      if (!have || c.updatedAt >= have.updatedAt) book.classes[id] = c;
    });
    var records = src.records || {};
    Object.keys(records).forEach(function (cid) {
      if (!ID.test(cid)) return;
      var days = records[cid] || {};
      Object.keys(days).forEach(function (date) {
        if (!DATE.test(date)) return;
        var marks = days[date] || {};
        Object.keys(marks).forEach(function (sid) {
          if (!ID.test(sid)) return;
          var m = tidyMark(marks[sid]);
          if (!m) return;
          var day = ((book.records[cid] = book.records[cid] || {})[date] = book.records[cid][date] || {});
          var old = day[sid];
          if (!old || m.at >= old.at) {
            /* Keep the first time they joined, whichever copy saw it */
            if (old && old.joinedAt && (!m.joinedAt || old.joinedAt < m.joinedAt)) m.joinedAt = old.joinedAt;
            day[sid] = m;
          } else if (m.joinedAt && (!old.joinedAt || m.joinedAt < old.joinedAt)) {
            old.joinedAt = m.joinedAt;
          }
        });
      });
    });
  });

  /* A deleted class takes its marks with it */
  Object.keys(book.classes).forEach(function (id) {
    if (book.classes[id].deleted) delete book.records[id];
  });
  var live = Object.keys(book.classes).filter(function (id) { return !book.classes[id].deleted; });
  if (live.length > MAX_CLASSES) {
    live.sort(function (a, b) { return book.classes[b].updatedAt - book.classes[a].updatedAt; })
      .slice(MAX_CLASSES).forEach(function (id) { delete book.classes[id]; delete book.records[id]; });
  }
  Object.keys(book.records).forEach(function (id) { if (!book.classes[id]) delete book.records[id]; });
  return book;
}

exports.handler = async function (event) {
  var teacher = teacherFrom(event);
  if (!teacher) return respond(401, { error: "Log in as a teacher to keep attendance." });

  var store;
  try {
    const blobs = require("@netlify/blobs");
    blobs.connectLambda(event);
    store = blobs.getStore("doodle-attendance");
  } catch (err) {
    return respond(500, { error: "Attendance couldn't open.", detail: String(err && err.message || err) });
  }

  var key = keyFor(teacher.email);

  try {
    var stored = (await store.get(key, { type: "json" })) || { classes: {}, records: {} };

    if (event.httpMethod === "GET") return respond(200, { book: merge(stored, null) });
    if (event.httpMethod !== "POST") return respond(405, { error: "Use GET or POST" });

    if ((event.body || "").length > MAX_BYTES) return respond(413, { error: "That's more attendance than one save can hold." });
    var data;
    try {
      data = JSON.parse(event.body || "{}");
    } catch (err) {
      return respond(400, { error: "Could not read that request." });
    }

    var book = merge(stored, data.book);
    if (JSON.stringify(book).length > MAX_BYTES) return respond(413, { error: "Your attendance book is full." });
    await store.setJSON(key, book);
    return respond(200, { book: book });
  } catch (err) {
    return respond(500, { error: "Attendance couldn't be saved just now.", detail: String(err && err.message || err) });
  }
};
