/* ==========================================================================
   Doodle Desk — tiny HS256 JWT (no dependency)

   This is a deliberately small stand-in for a JWT library: just enough to
   sign and verify the teacher session tokens, using only Node's built-in
   "crypto" module. It is NOT a general-purpose JWT implementation (no "none"
   algorithm, no key rotation, no other algorithms) — that's on purpose, it
   keeps the whole auth surface in one file you can read top to bottom.

   sign(payload, secret, ttlSeconds)   -> token string
   verify(token, secret)               -> payload object, or null if the
                                           token is missing, malformed,
                                           tampered with, or expired
   ========================================================================== */
"use strict";

const crypto = require("crypto");

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlToBuffer(str) {
  var padded = str.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4) padded += "=";
  return Buffer.from(padded, "base64");
}

function sign(payload, secret, ttlSeconds) {
  if (!secret) throw new Error("jwt.sign: secret is required");

  var header = { alg: "HS256", typ: "JWT" };
  var now = Math.floor(Date.now() / 1000);
  var body = Object.assign({}, payload, {
    iat: now,
    exp: now + (ttlSeconds || 60 * 60 * 24 * 30)
  });

  var headerPart = base64url(JSON.stringify(header));
  var payloadPart = base64url(JSON.stringify(body));
  var signingInput = headerPart + "." + payloadPart;

  var signature = crypto
    .createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return signingInput + "." + signature;
}

function verify(token, secret) {
  if (!secret || typeof token !== "string") return null;

  var parts = token.split(".");
  if (parts.length !== 3) return null;

  var headerPart = parts[0], payloadPart = parts[1], signaturePart = parts[2];
  var signingInput = headerPart + "." + payloadPart;

  var expected = crypto
    .createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  var a = Buffer.from(expected);
  var b = Buffer.from(signaturePart);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  var payload;
  try {
    payload = JSON.parse(base64urlToBuffer(payloadPart).toString("utf8"));
  } catch (err) {
    return null;
  }

  if (typeof payload.exp === "number" && Math.floor(Date.now() / 1000) >= payload.exp) {
    return null;
  }

  return payload;
}

module.exports = { sign: sign, verify: verify };
