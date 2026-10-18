/* ==========================================================================
   Doodle Desk — Doodle Drawer client
   A teacher's saved Doodle Pads, kept in their account (netlify/functions/
   drawer.js) so they follow the teacher to any computer.

     DoodleDrawer.list()            -> Promise<{ ok, pads }>  (summaries)
     DoodleDrawer.cached()          -> pads from the last list(), instantly
     DoodleDrawer.get(id)           -> Promise<{ ok, pad }>   (everything)
     DoodleDrawer.save(pad)         -> Promise<{ ok, pad }>
     DoodleDrawer.update(id, patch) -> Promise<{ ok, pad }>
     DoodleDrawer.remove(id)        -> Promise<{ ok }>
     DoodleDrawer.keepSelectHTML(selected)
     DoodleDrawer.shrink(dataUrl, width, quality) -> Promise<dataUrl>
   ========================================================================== */
window.DoodleDrawer = (function () {
  "use strict";

  var net = window.DoodleNet;
  var URL_ = "/.netlify/functions/drawer";
  var KEEP_CHOICES = ["month", "three", "schoolyear", "year", "forever"];

  function token() {
    var s = net && net.session && net.session();
    return s && s.token ? s.token : null;
  }

  function cacheKey() {
    var t = net && net.teacher && net.teacher();
    return "doodle-drawer-" + (t && t.email ? t.email.toLowerCase() : "guest");
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(cacheKey()) || "[]"); } catch (e) { return []; }
  }

  function writeCache(pads) {
    try { localStorage.setItem(cacheKey(), JSON.stringify(pads)); } catch (e) {}
  }

  function call(method, body, query) {
    var t = token();
    if (!t) return Promise.resolve({ ok: false, error: "Log in as a teacher to use your Doodle Drawer.", status: 401 });
    var opts = { method: method, headers: { "Authorization": "Bearer " + t } };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(URL_ + (query || ""), opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        json.ok = res.ok;
        json.status = res.status;
        if (!res.ok && !json.error) json.error = "The Doodle Drawer didn't answer (" + res.status + ").";
        return json;
      });
    }, function () {
      return { ok: false, error: "Couldn't reach your Doodle Drawer. Check your connection." };
    });
  }

  function list() {
    return call("GET").then(function (r) {
      if (r.ok) writeCache(r.pads || []);
      return r.ok ? { ok: true, pads: r.pads || [] } : { ok: false, error: r.error, pads: readCache(), status: r.status };
    });
  }

  function cached() {
    var now = Date.now();
    return readCache().filter(function (p) { return !p.keepUntil || p.keepUntil > now; });
  }

  function get(id) {
    return call("GET", null, "?id=" + encodeURIComponent(id));
  }

  function save(pad) {
    return call("POST", { action: "save", pad: pad }).then(function (r) {
      if (r.ok && r.pad) {
        var pads = readCache().filter(function (p) { return p.id !== r.pad.id; });
        pads.unshift(r.pad);
        writeCache(pads);
      }
      return r;
    });
  }

  function update(id, patch) {
    var body = { action: "update", id: id };
    Object.keys(patch).forEach(function (k) { body[k] = patch[k]; });
    return call("POST", body).then(function (r) {
      if (r.ok && r.pad) writeCache(readCache().map(function (p) { return p.id === id ? r.pad : p; }));
      return r;
    });
  }

  function remove(id) {
    return call("POST", { action: "delete", id: id }).then(function (r) {
      if (r.ok) writeCache(readCache().filter(function (p) { return p.id !== id; }));
      return r;
    });
  }

  function keepSelectHTML(selected) {
    return net.keepOptionsHTML(KEEP_CHOICES, selected || "forever");
  }

  /* Re-encode an image smaller, so a whole class fits in one Doodle Pad */
  function shrink(dataUrl, width, quality) {
    return new Promise(function (resolve) {
      if (!dataUrl) return resolve("");
      var img = new Image();
      img.onload = function () {
        var w = Math.min(width, img.naturalWidth);
        var h = Math.round(img.naturalHeight * (w / img.naturalWidth));
        var c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        var x = c.getContext("2d");
        x.fillStyle = "#fff";
        x.fillRect(0, 0, w, h);
        x.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality || 0.75));
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  return {
    KEEP_CHOICES: KEEP_CHOICES,
    list: list,
    cached: cached,
    get: get,
    save: save,
    update: update,
    remove: remove,
    keepSelectHTML: keepSelectHTML,
    shrink: shrink
  };
})();
