/* ==========================================================================
   Doodle Desk — worksheets onto boards (Teacher Pro)

   Turns a file into board pages and stores them on the server:

     DoodleUploads.fromFile(file, onProgress)   an image or a PDF from the
                                                teacher's computer
     DoodleUploads.fromDrive(onProgress)        pick a file in Google Drive
                                                (PDF, image, Doc, Slides…)

   Both resolve to { name, pages: [{ id: "img:<assetId>", name }] } — ready to
   drop into the Lesson page list and send to every board.

   Everything heavy happens in the teacher's browser: a PDF is drawn page by
   page with PDF.js (loaded only when needed), each page is fitted to the
   board and saved as a JPEG, and only those images are uploaded. A file made
   with any AI tool works the same way — export it as a PDF or image first.
   ========================================================================== */
window.DoodleUploads = (function () {
  "use strict";

  var cfg = window.DOODLE || {};
  var net = window.DoodleNet;

  var MAX_PAGES = 20;
  var PAGE_W = 1800;            /* sharp on a big screen, still a small file */
  var PAGE_H = Math.round(PAGE_W * 740 / 1200);
  var MAX_FILE = 25 * 1024 * 1024;

  var loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = function () {
        delete loaded[src];
        reject(new Error("Couldn't load " + src));
      };
      document.head.appendChild(s);
    });
    return loaded[src];
  }

  function baseName(name) {
    return String(name || "Worksheet").replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "Worksheet";
  }

  /* Draw any image-like thing onto a white board-sized page as a JPEG */
  function toPage(source, sw, sh) {
    var scale = Math.min(PAGE_W / sw, PAGE_H / sh, 2);
    var w = Math.max(1, Math.round(sw * scale));
    var h = Math.max(1, Math.round(sh * scale));
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var x = c.getContext("2d");
    x.fillStyle = "#ffffff";
    x.fillRect(0, 0, w, h);
    x.drawImage(source, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.86);
  }

  function imagePages(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          resolve([toPage(img, img.naturalWidth, img.naturalHeight)]);
        } catch (e) {
          reject(e);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("That image couldn't be opened. Try a JPEG or PNG."));
      };
      img.src = url;
    });
  }

  function pdfPages(file, onProgress) {
    var pdfjs = cfg.PDFJS || {};
    return loadScript(pdfjs.SRC).then(function () {
      var lib = window.pdfjsLib;
      if (!lib) throw new Error("The PDF reader didn't load.");
      lib.GlobalWorkerOptions.workerSrc = pdfjs.WORKER;
      return file.arrayBuffer().then(function (buf) {
        return lib.getDocument({ data: buf }).promise;
      });
    }).then(function (pdf) {
      var count = Math.min(pdf.numPages, MAX_PAGES);
      var pages = [];
      var chain = Promise.resolve();
      for (var n = 1; n <= count; n++) {
        (function (num) {
          chain = chain.then(function () {
            if (onProgress) onProgress("Reading page " + num + " of " + count + "…");
            return pdf.getPage(num).then(function (page) {
              var base = page.getViewport({ scale: 1 });
              var scale = Math.min(PAGE_W / base.width, PAGE_H / base.height) * 1.0;
              var vp = page.getViewport({ scale: scale });
              var c = document.createElement("canvas");
              c.width = Math.round(vp.width);
              c.height = Math.round(vp.height);
              var x = c.getContext("2d");
              x.fillStyle = "#ffffff";
              x.fillRect(0, 0, c.width, c.height);
              return page.render({ canvasContext: x, viewport: vp }).promise.then(function () {
                pages.push(c.toDataURL("image/jpeg", 0.86));
              });
            });
          });
        })(n);
      }
      return chain.then(function () {
        return { pages: pages, truncated: pdf.numPages > MAX_PAGES };
      });
    }, function (err) {
      throw new Error(err && err.message && err.message.indexOf("load") !== -1
        ? "The PDF reader couldn't load. Check your connection (or school filter) and try again."
        : "That PDF couldn't be opened.");
    });
  }

  function isPdf(file) {
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  }

  function isImage(file) {
    return /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(file.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name || "");
  }

  /* file -> pages on the server */
  function fromFile(file, onProgress) {
    if (!file) return Promise.reject(new Error("No file chosen."));
    if (file.size > MAX_FILE) return Promise.reject(new Error("That file is over 25 MB. Try a smaller one."));
    if (!isPdf(file) && !isImage(file)) {
      return Promise.reject(new Error("Upload a PDF or an image (JPEG, PNG). Word or PowerPoint files: save them as PDF first."));
    }

    var name = baseName(file.name);
    if (onProgress) onProgress("Opening " + name + "…");
    var make = isPdf(file)
      ? pdfPages(file, onProgress)
      : imagePages(file).then(function (pages) { return { pages: pages, truncated: false }; });

    return make.then(function (result) {
      var total = result.pages.length;
      if (!total) throw new Error("That file has no pages.");
      var ids = [];
      var chain = Promise.resolve();
      result.pages.forEach(function (dataUrl, i) {
        chain = chain.then(function () {
          if (onProgress) onProgress("Uploading page " + (i + 1) + " of " + total + "…");
          return net.uploadPage(dataUrl, name + (total > 1 ? " p" + (i + 1) : "")).then(function (r) {
            if (!r.ok) {
              var e = new Error(r.error);
              e.pro = r.pro;
              throw e;
            }
            ids.push(r.id);
          });
        });
      });
      return chain.then(function () {
        return {
          name: name,
          truncated: result.truncated,
          pages: ids.map(function (id, i) {
            return { id: "img:" + id, name: name + (total > 1 ? " — page " + (i + 1) : "") };
          })
        };
      });
    });
  }

  /* ---- Google Drive ------------------------------------------------------
     Uses Google's own file picker, so the teacher only ever grants access to
     the one file they choose (the "drive.file" permission). Google Docs,
     Slides and Drawings are exported as PDF, then handled like any upload. */
  var googleCfg = null;
  var accessToken = null;
  var tokenClient = null;

  function getGoogleConfig() {
    if (googleCfg) return Promise.resolve(googleCfg);
    return fetch("/.netlify/functions/public-config")
      .then(function (res) { return res.ok ? res.json() : {}; }, function () { return {}; })
      .then(function (json) {
        googleCfg = json || {};
        return googleCfg;
      });
  }

  function driveConfigured() {
    return getGoogleConfig().then(function (g) {
      return Boolean(g.googleClientId && g.googleApiKey);
    });
  }

  /* Load Google's scripts ahead of time: the sign-in pop-up must open
     straight from the teacher's click, or the browser blocks it. */
  function prepareDrive() {
    return driveConfigured().then(function (ok) {
      if (!ok) return false;
      return Promise.all([
        loadScript("https://apis.google.com/js/api.js"),
        loadScript("https://accounts.google.com/gsi/client")
      ]).then(function () {
        return new Promise(function (resolve) {
          window.gapi.load("picker", function () { resolve(true); });
        });
      }).then(function () {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: googleCfg.googleClientId,
          scope: "https://www.googleapis.com/auth/drive.file",
          callback: function () {}
        });
        return true;
      });
    }).catch(function () { return false; });
  }

  function signIn() {
    return new Promise(function (resolve, reject) {
      if (!tokenClient) return reject(new Error("Google Drive is still loading — try again in a moment."));
      tokenClient.callback = function (resp) {
        if (resp && resp.access_token) {
          accessToken = resp.access_token;
          resolve(accessToken);
        } else {
          reject(new Error("Google sign-in was cancelled."));
        }
      };
      tokenClient.error_callback = function () { reject(new Error("Google sign-in was cancelled or blocked.")); };
      tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
    });
  }

  function pick(token) {
    return new Promise(function (resolve, reject) {
      var g = window.google;
      var view = new g.picker.DocsView(g.picker.ViewId.DOCS)
        .setMimeTypes([
          "application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp",
          "application/vnd.google-apps.document",
          "application/vnd.google-apps.presentation",
          "application/vnd.google-apps.drawing"
        ].join(","))
        .setIncludeFolders(true);
      var builder = new g.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(googleCfg.googleApiKey)
        .setTitle("Choose a worksheet for your class")
        .setCallback(function (data) {
          if (data.action === g.picker.Action.PICKED) resolve(data.docs[0]);
          else if (data.action === g.picker.Action.CANCEL) reject(new Error("cancelled"));
        });
      if (googleCfg.googleAppId) builder.setAppId(googleCfg.googleAppId);
      builder.build().setVisible(true);
    });
  }

  var EXPORTS = {
    "application/vnd.google-apps.document": 1,
    "application/vnd.google-apps.presentation": 1,
    "application/vnd.google-apps.drawing": 1
  };

  function download(doc, token) {
    var id = encodeURIComponent(doc.id);
    var exporting = EXPORTS[doc.mimeType];
    var url = "https://www.googleapis.com/drive/v3/files/" + id +
      (exporting ? "/export?mimeType=application%2Fpdf" : "?alt=media&supportsAllDrives=true");
    return fetch(url, { headers: { "Authorization": "Bearer " + token } }).then(function (res) {
      if (!res.ok) throw new Error("Google Drive wouldn't send that file (" + res.status + "). Check you can open it.");
      return res.blob();
    }).then(function (blob) {
      var type = exporting ? "application/pdf" : (doc.mimeType || blob.type);
      var name = doc.name + (exporting ? ".pdf" : "");
      return new File([blob], name, { type: type });
    });
  }

  function fromDrive(onProgress) {
    if (!window.google || !window.google.picker || !tokenClient) {
      return driveConfigured().then(function (ok) {
        throw new Error(ok ? "Google Drive is still loading — try again in a moment."
          : "Google Drive import isn't switched on for this site yet.");
      });
    }
    return signIn().then(function (token) {
      return pick(token).then(function (doc) {
        if (onProgress) onProgress("Getting " + doc.name + " from Google Drive…");
        return download(doc, token);
      });
    }).then(function (file) {
      return fromFile(file, onProgress);
    });
  }

  return {
    fromFile: fromFile,
    fromDrive: fromDrive,
    prepareDrive: prepareDrive,
    driveConfigured: driveConfigured
  };
})();
