/* ==========================================================================
   Doodle Desk — who is calling, and are they on Teacher Pro?

   teacherFrom(event)  -> the verified session payload, or null
   isPro(email)        -> true if that email is on the Pro list

   The Pro list is the PRO_EMAILS environment variable in Netlify: email
   addresses separated by commas (or spaces / new lines). Add or remove a
   teacher there and redeploy — no code change needed. When real payments are
   wired up, this is the one function to change so a paid plan counts too.
   ========================================================================== */
"use strict";

const jwt = require("./jwt.js");

function teacherFrom(event) {
  var secret = process.env.JWT_SECRET;
  if (!secret) return null;
  var auth = (event && event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  var match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!match) return null;
  var payload = jwt.verify(match[1], secret);
  return payload && payload.role === "teacher" ? payload : null;
}

function proList() {
  return String(process.env.PRO_EMAILS || "")
    .split(/[\s,;]+/)
    .map(function (e) { return e.trim().toLowerCase(); })
    .filter(Boolean);
}

function isPro(email) {
  if (!email) return false;
  return proList().indexOf(String(email).trim().toLowerCase()) !== -1;
}

module.exports = { teacherFrom: teacherFrom, isPro: isPro };
