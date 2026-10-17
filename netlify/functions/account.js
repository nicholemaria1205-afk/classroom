/* ==========================================================================
   Doodle Desk — the signed-in teacher's account (GET, Bearer token)
   Lets a page check, without logging in again, whether this teacher is on
   Teacher Pro — so a teacher added to PRO_EMAILS gets Pro straight away.
   ========================================================================== */
"use strict";

const { teacherFrom, isPro } = require("./_lib/teacher.js");

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

exports.handler = async function (event) {
  var t = teacherFrom(event);
  if (!t) {
    return { statusCode: 401, headers: headers, body: JSON.stringify({ error: "Log in again to continue." }) };
  }
  return {
    statusCode: 200,
    headers: headers,
    body: JSON.stringify({ teacher: { email: t.email, name: t.name, pro: isPro(t.email) } })
  };
};
