/* ==========================================================================
   Doodle Desk — store one uploaded page (Teacher Pro)

   POST { image: "data:image/jpeg;base64,...", name: "Fractions worksheet p1" }
   with the teacher's session as a Bearer token. Returns { id }.

   The browser does the heavy lifting first: PDFs (including Google Docs
   exported from Drive) are turned into one image per page, sized to the
   board, so this only ever stores a modest JPEG or PNG. Pages live in
   Netlify Blobs; students load them from asset.js by their id.
   ========================================================================== */
"use strict";

const crypto = require("crypto");
const { teacherFrom, isPro } = require("./_lib/teacher.js");

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = { "image/jpeg": 1, "image/png": 1, "image/webp": 1 };

function respond(statusCode, body) {
  return { statusCode: statusCode, headers: headers, body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return respond(405, { error: "Use POST" });

  var teacher = teacherFrom(event);
  if (!teacher) return respond(401, { error: "Log in as a teacher to upload files." });
  if (!isPro(teacher.email)) {
    return respond(403, { error: "Uploading files is part of Teacher Pro.", pro: false });
  }

  var data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch (err) {
    return respond(400, { error: "Could not read that upload." });
  }

  var match = /^data:([a-z/+-]+);base64,(.+)$/i.exec(String(data.image || ""));
  if (!match || !TYPES[match[1].toLowerCase()]) {
    return respond(400, { error: "Pages must be a JPEG, PNG or WebP image." });
  }
  var bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_BYTES) {
    return respond(413, { error: "That page is too big. Try a smaller file." });
  }

  try {
    const blobs = require("@netlify/blobs");
    blobs.connectLambda(event);
    var store = blobs.getStore("doodle-assets");
    var id = crypto.randomBytes(16).toString("hex");
    await store.set(id, bytes, {
      metadata: {
        type: match[1].toLowerCase(),
        owner: teacher.email,
        name: String(data.name || "").slice(0, 120),
        createdAt: Date.now()
      }
    });
    return respond(200, { id: id });
  } catch (err) {
    return respond(500, { error: "Could not save that page.", detail: String(err && err.message || err) });
  }
};
