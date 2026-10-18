/* ==========================================================================
   Doodle Desk — the Doodle Drawer: a teacher's saved Doodle Pads

   Every request needs the teacher's session (Bearer token). Pads live in
   Netlify Blobs under the teacher's account, so the Drawer follows them to
   any computer.

   GET                       -> { pads: [summary, ...] }   (expired ones removed)
   GET  ?id=<padId>          -> { pad }                     (everything in it)
   POST { action: "save", pad: { id?, kind, title, keep, keepUntil, data, cover } }
                             -> { pad: summary }
   POST { action: "update", id, title?, keep?, keepUntil? } -> { pad: summary }
   POST { action: "delete", id }                            -> { ok: true }

   kind is "worksheet" (pages + answer key), "snapshot" (every board at one
   moment) or "grades" (a grade list — teacher only, like everything here).
   ========================================================================== */
"use strict";

const crypto = require("crypto");
const { teacherFrom } = require("./_lib/teacher.js");

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const KINDS = { worksheet: 1, snapshot: 1, grades: 1 };
const MAX_PADS = 300;
const MAX_PAD_BYTES = 5 * 1024 * 1024;

function respond(statusCode, body) {
  return { statusCode: statusCode, headers: headers, body: JSON.stringify(body) };
}

function clean(text, max) {
  return String(text == null ? "" : text).replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max);
}

function folder(email) {
  return crypto.createHash("sha256").update(String(email).toLowerCase()).digest("hex").slice(0, 32);
}

function summaryOf(pad) {
  return {
    id: pad.id,
    kind: pad.kind,
    title: pad.title,
    createdAt: pad.createdAt,
    updatedAt: pad.updatedAt,
    keep: pad.keep,
    keepUntil: pad.keepUntil,
    count: pad.count,
    cover: pad.cover,
    /* Small enough to keep in the list, so the Lesson page menu doesn't
       have to open every worksheet */
    pages: pad.kind === "worksheet" ? ((pad.data && pad.data.pages) || []).slice(0, 30) : undefined,
    hasKey: pad.kind === "worksheet" ? Boolean(pad.data && pad.data.key && pad.data.key.length) : undefined
  };
}

exports.handler = async function (event) {
  var teacher = teacherFrom(event);
  if (!teacher) return respond(401, { error: "Log in as a teacher to open your Doodle Drawer." });

  var store;
  try {
    const blobs = require("@netlify/blobs");
    blobs.connectLambda(event);
    store = blobs.getStore("doodle-drawer");
  } catch (err) {
    return respond(500, { error: "The Doodle Drawer couldn't open.", detail: String(err && err.message || err) });
  }

  var base = folder(teacher.email) + "/";
  var indexKey = base + "index";

  async function readIndex() {
    return (await store.get(indexKey, { type: "json" })) || [];
  }

  async function writeIndex(list) {
    await store.setJSON(indexKey, list);
  }

  try {
    /* ---- Read ------------------------------------------------------------ */
    if (event.httpMethod === "GET") {
      var id = String((event.queryStringParameters || {}).id || "");
      if (id) {
        if (!/^[a-z0-9-]{8,40}$/.test(id)) return respond(400, { error: "Bad id" });
        var pad = await store.get(base + "pad/" + id, { type: "json" });
        if (!pad) return respond(404, { error: "That Doodle Pad isn't in your Drawer any more." });
        return respond(200, { pad: pad });
      }

      var list = await readIndex();
      var now = Date.now();
      var live = list.filter(function (p) { return !p.keepUntil || p.keepUntil > now; });
      if (live.length !== list.length) {
        /* Tidy pads past their keep-until date */
        var gone = list.filter(function (p) { return live.indexOf(p) === -1; });
        await Promise.all(gone.map(function (p) { return store.delete(base + "pad/" + p.id).catch(function () {}); }));
        await writeIndex(live);
      }
      return respond(200, { pads: live });
    }

    if (event.httpMethod !== "POST") return respond(405, { error: "Use GET or POST" });

    if ((event.body || "").length > MAX_PAD_BYTES * 1.4) {
      return respond(413, { error: "That's too big for one Doodle Pad." });
    }

    var data;
    try {
      data = JSON.parse(event.body || "{}");
    } catch (err) {
      return respond(400, { error: "Could not read that request." });
    }

    var index = await readIndex();

    /* ---- Save (new or replace) ------------------------------------------- */
    if (data.action === "save") {
      var p = data.pad || {};
      if (!KINDS[p.kind]) return respond(400, { error: "Unknown kind of Doodle Pad." });
      var padId = /^[a-z0-9-]{8,40}$/.test(p.id || "") ? p.id : crypto.randomBytes(9).toString("hex");
      var existing = index.filter(function (x) { return x.id === padId; })[0];
      if (!existing && index.length >= MAX_PADS) {
        return respond(409, { error: "Your Doodle Drawer is full (" + MAX_PADS + " pads). Delete a few old ones first." });
      }
      var full = {
        id: padId,
        kind: p.kind,
        title: clean(p.title, 90) || "Untitled",
        createdAt: existing ? existing.createdAt : Date.now(),
        updatedAt: Date.now(),
        keep: clean(p.keep, 20) || "forever",
        keepUntil: typeof p.keepUntil === "number" && p.keepUntil > Date.now() ? p.keepUntil : null,
        count: Math.max(0, parseInt(p.count, 10) || 0),
        cover: typeof p.cover === "string" && p.cover.length < 60000 ? p.cover : "",
        data: p.data || {}
      };
      var json = JSON.stringify(full);
      if (json.length > MAX_PAD_BYTES) return respond(413, { error: "That's too big for one Doodle Pad." });
      await store.set(base + "pad/" + padId, json);
      index = index.filter(function (x) { return x.id !== padId; });
      index.unshift(summaryOf(full));
      await writeIndex(index);
      return respond(200, { pad: summaryOf(full) });
    }

    /* ---- Rename / change how long it's kept ------------------------------ */
    if (data.action === "update") {
      var target = await store.get(base + "pad/" + clean(data.id, 40), { type: "json" });
      if (!target) return respond(404, { error: "That Doodle Pad isn't in your Drawer any more." });
      if (data.title != null) target.title = clean(data.title, 90) || target.title;
      if (data.keep != null) {
        target.keep = clean(data.keep, 20);
        target.keepUntil = typeof data.keepUntil === "number" && data.keepUntil > Date.now() ? data.keepUntil : null;
      }
      target.updatedAt = Date.now();
      await store.set(base + "pad/" + target.id, JSON.stringify(target));
      index = index.map(function (x) { return x.id === target.id ? summaryOf(target) : x; });
      await writeIndex(index);
      return respond(200, { pad: summaryOf(target) });
    }

    /* ---- Delete ------------------------------------------------------------ */
    if (data.action === "delete") {
      var delId = clean(data.id, 40);
      await store.delete(base + "pad/" + delId).catch(function () {});
      await writeIndex(index.filter(function (x) { return x.id !== delId; }));
      return respond(200, { ok: true });
    }

    return respond(400, { error: "Unknown action." });
  } catch (err) {
    return respond(500, { error: "The Doodle Drawer had a problem. Try again.", detail: String(err && err.message || err) });
  }
};
