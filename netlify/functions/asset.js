/* ==========================================================================
   Doodle Desk — fetch one uploaded page (GET ?id=...)
   Public on purpose: students have no accounts, and an id is a long random
   string that only reaches the students in a room. Served with a long cache
   because a page never changes once uploaded.
   ========================================================================== */
"use strict";

exports.handler = async function (event) {
  var id = String((event.queryStringParameters || {}).id || "");
  if (!/^[a-f0-9]{32}$/.test(id)) {
    return { statusCode: 400, headers: { "Content-Type": "text/plain" }, body: "Bad id" };
  }

  try {
    const blobs = require("@netlify/blobs");
    blobs.connectLambda(event);
    var store = blobs.getStore("doodle-assets");
    var found = await store.getWithMetadata(id, { type: "arrayBuffer" });
    if (!found || !found.data) {
      return { statusCode: 404, headers: { "Content-Type": "text/plain" }, body: "Not found" };
    }
    return {
      statusCode: 200,
      headers: {
        "Content-Type": (found.metadata && found.metadata.type) || "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff"
      },
      body: Buffer.from(found.data).toString("base64"),
      isBase64Encoded: true
    };
  } catch (err) {
    return { statusCode: 500, headers: { "Content-Type": "text/plain" }, body: "Could not load that page" };
  }
};
