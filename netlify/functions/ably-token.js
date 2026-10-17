/* ==========================================================================
   Doodle Desk — Ably token function

   Every browser that wants live sync calls this first. It returns a signed,
   short-lived "token request" that Ably will exchange for a connection, so
   the real API key never reaches a browser.

   Setup: in Netlify → Project configuration → Environment variables, add
     ABLY_API_KEY   the key from your Ably app (looks like  xxxx.yyyy:zzzz)
   then redeploy. Visiting /.netlify/functions/ably-token afterwards should
   show a small JSON document containing "keyName" and "mac".

   What a browser is allowed to do on Ably depends on who's asking:

     JWT_SECRET not set at all
       → every browser gets the same open pass this function has always
         granted (publish + subscribe on every doodle:* channel). This is
         exactly the original behaviour, so a site that hasn't turned on
         teacher accounts yet (see auth-signup.js / auth-login.js) keeps
         working unchanged.

     JWT_SECRET is set, but this request has no valid teacher session
       → a student pass: publish only on the "up" channel (where a
         student's own board/status updates go) and subscribe only on
         "down" (where the teacher's broadcasts arrive). A student can
         never listen in on another student's traffic.

     JWT_SECRET is set, and the Authorization header carries a valid,
     unexpired teacher token (from auth-login.js / auth-signup.js)
       → the full pass: publish + subscribe on every doodle:* channel,
         same as the legacy behaviour — a signed-in teacher can host rooms.

   Either way the token lasts an hour and the browser quietly renews it.
   ========================================================================== */
const Ably = require("ably");
const jwt = require("./_lib/jwt.js");

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

var OPEN_CAPABILITY = { "doodle:*": ["publish", "subscribe"] };
var STUDENT_CAPABILITY = {
  "doodle:*:up": ["publish"],
  "doodle:*:down": ["subscribe"]
};

function bearerToken(event) {
  var auth = (event && event.headers &&
    (event.headers.authorization || event.headers.Authorization)) || "";
  var match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match ? match[1] : null;
}

function capabilityFor(event) {
  var secret = process.env.JWT_SECRET;
  if (!secret) return OPEN_CAPABILITY;

  var token = bearerToken(event);
  var payload = token ? jwt.verify(token, secret) : null;
  if (payload && payload.role === "teacher") return OPEN_CAPABILITY;

  return STUDENT_CAPABILITY;
}

exports.handler = async function (event) {
  const key = process.env.ABLY_API_KEY;

  if (!key) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ error: "ABLY_API_KEY is not set on this site" })
    };
  }

  try {
    const rest = new Ably.Rest({ key });
    const tokenRequest = await rest.auth.createTokenRequest({
      capability: JSON.stringify(capabilityFor(event)),
      ttl: 60 * 60 * 1000
    });
    return { statusCode: 200, headers, body: JSON.stringify(tokenRequest) };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Could not create a token", detail: String(err && err.message || err) })
    };
  }
};
