/* ==========================================================================
   Doodle Desk — teacher log in

   Verifies an existing teacher account (stored in Netlify Blobs by
   auth-signup.js) and returns a signed session token on success.
   ========================================================================== */
"use strict";

const { getStore } = require("@netlify/blobs");
const jwt = require("./_lib/jwt.js");
const passwords = require("./_lib/passwords.js");

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

function respond(statusCode, body) {
  return { statusCode: statusCode, headers: headers, body: JSON.stringify(body) };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return respond(405, { error: "Use POST" });
  }

  var secret = process.env.JWT_SECRET;
  if (!secret) {
    return respond(503, { error: "JWT_SECRET is not set on this site — teacher accounts aren't turned on yet." });
  }

  var data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch (err) {
    return respond(400, { error: "Could not read that request." });
  }

  var email = normalizeEmail(data.email);
  var password = String(data.password || "");

  if (!email || !password) {
    return respond(400, { error: "Enter your email and password." });
  }

  var store = getStore("doodle-teachers");

  try {
    var record = await store.get(email, { type: "json" });
    if (!record || !passwords.verify(password, record.passwordHash)) {
      return respond(401, { error: "Email or password didn't match." });
    }

    var token = jwt.sign({ sub: email, email: email, name: record.name, role: "teacher" }, secret, SESSION_TTL);
    return respond(200, { token: token, teacher: { email: email, name: record.name } });
  } catch (err) {
    return respond(500, { error: "Could not log you in.", detail: String(err && err.message || err) });
  }
};
