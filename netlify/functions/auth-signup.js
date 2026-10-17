/* ==========================================================================
   Doodle Desk — teacher sign up

   Creates a real teacher account, stored in Netlify Blobs (a small built-in
   key/value store — no separate database to set up). Returns a signed
   session token the browser keeps, the same shape auth-login.js returns.

   Requires the JWT_SECRET environment variable (any long random string).
   If it isn't set, this function responds 503 rather than silently running
   with no real security.
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
  var name = String(data.name || "").trim();

  if (!email || email.indexOf("@") === -1) {
    return respond(400, { error: "Enter a valid email address." });
  }
  if (password.length < 8) {
    return respond(400, { error: "Passwords need to be at least 8 characters." });
  }
  if (!name) name = email.split("@")[0];

  var store = getStore("doodle-teachers");

  try {
    var existing = await store.get(email, { type: "json" });
    if (existing) {
      return respond(409, { error: "An account already exists for that email. Try logging in instead." });
    }

    var record = {
      email: email,
      name: name,
      passwordHash: passwords.hash(password),
      createdAt: Date.now()
    };
    await store.setJSON(email, record);

    var token = jwt.sign({ sub: email, email: email, name: name, role: "teacher" }, secret, SESSION_TTL);
    return respond(200, { token: token, teacher: { email: email, name: name } });
  } catch (err) {
    return respond(500, { error: "Could not create that account.", detail: String(err && err.message || err) });
  }
};
