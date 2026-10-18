/* ==========================================================================
   Doodle Desk — site configuration
   Single source of truth for plans and pricing. Both pricing.html and
   subscribe.html read from here, so a price change only happens once.

   To take real money you need a server that can talk to Stripe with a SECRET
   key (never put a secret key in this file — it ships to the browser).
   Set CHECKOUT_ENDPOINT below to your own endpoint and the subscribe form
   will POST to it and follow the returned Checkout URL. Until then the form
   runs in demo mode: it validates everything and shows a confirmation.
   See README.md for the ~40 lines of server code required.
   ========================================================================== */
window.DOODLE = {
  /* e.g. "/api/create-checkout-session" — leave empty for demo mode */
  CHECKOUT_ENDPOINT: "",

  /* Your Stripe publishable key (pk_live_… / pk_test_…). Safe to expose. */
  STRIPE_PUBLISHABLE_KEY: "",

  /* Live sync between devices (teacher laptop + students' own devices).
     TOKEN_URL is the Netlify function that hands each browser a short-lived
     Ably token; the real Ably key stays on Netlify and never comes here.
     If the function isn't there (GitHub Pages, a local file, a Netlify site
     with no ABLY_API_KEY yet) the app quietly falls back to working across
     tabs of one browser. Set TOKEN_URL to "" to force that mode. */
  SYNC: {
    TOKEN_URL: "/.netlify/functions/ably-token",
    SDK_URL: "https://cdn.ably.com/lib/ably.min-2.js"
  },

  /* Where uploaded worksheet pages are served from (asset.js) */
  ASSET_URL: "/.netlify/functions/asset?id=",
  /* PDF reader used to turn uploaded PDFs into board pages. Loaded only
     when a teacher actually uploads a PDF. */
  PDFJS: {
    SRC: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    WORKER: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
  },
  CURRENCY: "$",
  TRIAL_DAYS: 30,

  /* Annual prices are shown as a per-month equivalent, billed once a year. */
  PLANS: [
    {
      id: "starter",
      name: "Starter",
      emoji: "🎒",
      colour: "var(--sky)",
      blurb: "Everything you need to run live boards with one class.",
      monthly: 0,
      annual: 0,
      cta: "Start for free",
      featured: false,
      features: [
        "1 live room, up to 30 students",
        "Student whiteboards in real time",
        "Pens, shapes, text & stickers",
        "Attendance tracker",
        "No student accounts — just a room code"
      ],
      missing: ["Saved lessons", "Assignment grading", "Class analytics"]
    },
    {
      id: "pro",
      name: "Teacher Pro",
      emoji: "🚀",
      colour: "var(--sunny)",
      blurb: "For the teacher who lives in the room all day, every day.",
      monthly: 9,
      annual: 7,
      cta: "Start 30-day free trial",
      featured: true,
      features: [
        "Unlimited rooms & classes",
        "Up to 200 students per room",
        "Save, reuse & share lesson packs",
        "Assignments with instant feedback",
        "Sticker & stamp grading, rubrics",
        "Class progress dashboard",
        "✨ AI worksheet & activity maker",
        "📝 AI grading with a grade list for you",
        "Upload worksheets & PDFs to every board",
        "Import from Google Drive",
        "Export boards to PDF & PNG",
        "Priority email support"
      ],
      missing: []
    },
    {
      id: "school",
      name: "School",
      emoji: "🏫",
      colour: "var(--mint)",
      blurb: "Roll it out across a whole staffroom, billed to the school.",
      monthly: 8,
      annual: 6,
      perSeat: true,
      minSeats: 5,
      cta: "Talk to us",
      featured: false,
      features: [
        "Everything in Teacher Pro",
        "Per-teacher seats, min. 5",
        "Admin dashboard & shared library",
        "Google / Microsoft SSO & rostering",
        "Bulk class import from CSV",
        "Invoice or purchase-order billing",
        "Onboarding session for your staff"
      ],
      missing: []
    }
  ]
};
