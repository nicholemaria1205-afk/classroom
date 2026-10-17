/* ==========================================================================
   Doodle Desk — settings the browser is allowed to know
   Google Drive import needs a Google OAuth client ID and an API key. Neither
   is a secret (Google expects them in web pages, locked to this site's
   address), but keeping them in Netlify's environment variables means they
   can be changed without editing code:

     GOOGLE_CLIENT_ID   ...apps.googleusercontent.com
     GOOGLE_API_KEY     AIza...
     GOOGLE_APP_ID      the Google Cloud project number (optional)
   ========================================================================== */
"use strict";

exports.handler = async function () {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      googleClientId: process.env.GOOGLE_CLIENT_ID || "",
      googleApiKey: process.env.GOOGLE_API_KEY || "",
      googleAppId: process.env.GOOGLE_APP_ID || ""
    })
  };
};
