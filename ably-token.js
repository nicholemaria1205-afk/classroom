/* ==========================================================================
   Doodle Desk — Ably token function

   Every browser that wants live sync calls this first. It returns a signed,
   short-lived "token request" that Ably will exchange for a connection, so the
   real API key never reaches a browser.

   Setup: in Netlify → Project configuration → Environment variables, add
     ABLY_API_KEY   the key from your Ably app (looks like  xxxx.yyyy:zzzz)
   then redeploy. Visiting /.netlify/functions/ably-token afterwards should
   show a small JSON document containing "keyName" and "mac".

   The token can only touch channels named  doodle:*  and can only publish and
   subscribe on them — it cannot read history, manage the app or use any other
   channel. It lasts an hour and the browser quietly renews it.
   ========================================================================== */
const Ably = require("ably");

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

exports.handler = async function () {
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
      capability: JSON.stringify({ "doodle:*": ["publish", "subscribe"] }),
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
