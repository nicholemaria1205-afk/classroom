/* ==========================================================================
   Doodle Desk — password hashing (no dependency)

   scrypt is built into Node's "crypto" module and is a good, slow-on-purpose
   hash for passwords — no bcrypt/argon2 package needed. Each password gets
   its own random salt; the stored value is "salt:hash", both hex.
   ========================================================================== */
"use strict";

const crypto = require("crypto");

var KEY_LEN = 64;

function hash(password) {
  var salt = crypto.randomBytes(16).toString("hex");
  var derived = crypto.scryptSync(String(password), salt, KEY_LEN).toString("hex");
  return salt + ":" + derived;
}

function verify(password, stored) {
  if (!stored || typeof stored !== "string" || stored.indexOf(":") === -1) return false;
  var parts = stored.split(":");
  var salt = parts[0], expectedHex = parts[1];
  if (!salt || !expectedHex) return false;

  var derived = crypto.scryptSync(String(password), salt, KEY_LEN);
  var expected = Buffer.from(expectedHex, "hex");
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

module.exports = { hash: hash, verify: verify };
