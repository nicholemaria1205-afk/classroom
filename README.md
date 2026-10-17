# Doodle Desk — classroom whiteboards

A bright, playful public website *and* the live classroom app behind it, in the
spirit of Classkick and Whiteboard.fi: every student gets a whiteboard, the
teacher sees all of them at once. Static HTML, CSS and vanilla JS — no build
step, no dependencies, no framework. Drop the folder on any host and it works.

## Pages

**The public site**

| File | What it is |
| --- | --- |
| `index.html` | Landing page: hero, features, how-it-works, stats, pricing, testimonials, FAQ |
| `pricing.html` | Full plan grid, monthly/yearly switch, feature comparison table, billing FAQ |
| `subscribe.html` | Sign-up + checkout: plan picker, seat count, live order summary, validation |
| `demo.html` | A real, working whiteboard — pens, highlighter, eraser, stamps, undo, PNG export |
| `login.html` | Teacher log in, plus the student "join with a room code" form |
| `FinalAtt.html` | The existing attendance tracker, linked from the site as a bundled tool |

**The app**

| File | What it is |
| --- | --- |
| `dashboard.html` | The teacher's rooms: open one, copy its join link, see who's in it, close it |
| `room.html` | The live room — every student's board as a thumbnail, class controls, focus view |
| `board.html` | A student's own board: joins by code, draws, gets the task and the teacher's marks |

## The app, and how the live sync works

The app runs in one of two modes, chosen automatically when a page loads:

- **Live** — teacher and students on *different devices*, connected through
  [Ably](https://ably.com). Needs the Netlify setup in **Live sync across devices**
  below.
- **This browser only** — anywhere else (GitHub Pages, a file on disk, a Netlify
  site with no Ably key yet). Rooms and messages stay in one browser, so you can
  try everything across tabs with no server at all. The teacher is shown a notice
  when a room is running this way.

Try it either way:

1. Open `login.html`, log in with any valid-looking email, and create a room.
2. Copy the join link and open it in two or three other tabs (or, in live mode,
   on other devices), giving each a different name.
3. Draw in a student tab and watch the thumbnail appear in the teacher's grid.

From the room view a teacher can set the task, freeze every board, clear them,
filter by who's stuck or finished, and click any board to open it full size and
draw a hint straight onto it. From a student board you can flag that you're
stuck or done, and the teacher's marks appear as you work. Undo only ever
removes your own marks, so a student can't rub out the hint they were just
given.

**How it fits together**

- `assets/js/board-engine.js` — the drawing core. Marks are stored as data
  (`{type:"stroke", colour, width, points:[...]}`), not pixels, so undo, replay,
  thumbnails and sending a board over the wire all work on the same objects.
  Committed marks are composited onto an offscreen canvas, so a long lesson
  doesn't get slower with every stroke.
- `assets/js/board-ui.js` — binds the standard toolbar markup to a board, so the
  tools behave the same in all three places a board appears.
- `assets/js/realtime.js` (`DoodleNet`) — rooms and messaging. The teacher's
  browser keeps the room and its students in `localStorage`; each tab's student
  identity lives in `sessionStorage`, which is what lets one browser hold a whole
  class. Messages go over Ably in live mode, or a `BroadcastChannel` (falling back
  to `storage` events on older browsers) in one-browser mode.

Messages on the bus: `join`, `leave`, `presence`, `board` (a new thumbnail),
`status`, `prompt`, `freeze`, `clear-board`, `teacher-mark`, `full-request` /
`full-reply` (the teacher asking a student's tab for its full board), and
`room-closed`.

Students publish a small JPEG thumbnail rather than every stroke — cheap to send
and to store, and it's all the teacher's grid needs. The full board only travels
when a teacher actually opens it.

### Drawing tools, lesson pages and saving

- **Tools** — pen, highlighter, eraser, straight line, arrow, rectangle,
  circle, text and stamps (text wraps, Shift + Enter for a new line, and
  clicking your own text again with the Text tool edits it), with undo and redo (Ctrl/⌘ + Z, Ctrl/⌘ + Y). The
  eraser only rubs out ink, never the paper underneath.
- **Paper and lesson pages** — `DoodleTemplates` in `board-engine.js` draws
  every background with code: blank, lined, graph, dot paper, a 0–20 number
  line, a first-quadrant coordinate grid, fraction strips, a Venn diagram, a
  T-chart, a KWL chart and a water cycle to label. Only the page's name is
  stored or sent, as a `{type:"bg", name}` item at the front of a board. A
  teacher picks one in the room and presses **Send to every board**
  (`template` message); students who join later get it too.
- **Student controls** — the room's **Class list** shows who's connected and
  when each student was last seen, and lets the teacher pause one student's
  board (`lock`), open it, or remove them from the room (`remove-student`).
  A paused or removed student whose tab reloads is told again when it checks in.
- **Saving** — a student's board is kept on their device under their name, so
  closing the tab and rejoining the same room with the same name brings it back
  (for two weeks). The practice board remembers itself too. **Save snapshot**
  in the room keeps every student's board at that moment (full boards from
  online students, thumbnails for the rest) in the teacher's browser
  (IndexedDB); **Saved snapshots** reopens them, and any board or snapshot can
  be printed or saved as a PDF from the browser's print dialog.

### Worksheets on every board (Teacher Pro)

In a room, **Upload a worksheet** takes a PDF or an image (a worksheet made
in any app — or with an AI tool — exported as PDF or image works the same).
**Google Drive** opens Google's file picker for PDFs, images, Docs, Slides
and Drawings (Google files are exported as PDF). The teacher's browser turns
each page into an image sized to the board (PDF.js, loaded only when needed;
up to 20 pages), uploads them to `asset-upload.js`, and they appear under
**Your uploads** in the Lesson page list. **Send to every board** puts the
page under each student's ink so they can write, draw and type their answers
on it. Students load pages from `asset.js`; only the page's id travels in
messages.

```
netlify/functions/asset-upload.js   stores one page (teacher + Pro only)
netlify/functions/asset.js          serves a page by its id (public)
netlify/functions/account.js        tells a signed-in page if the teacher is Pro
netlify/functions/public-config.js  hands the browser the Google Drive keys
netlify/functions/_lib/teacher.js   session check + the Pro list
assets/js/uploads.js                PDF/image -> pages, Google Drive picker
```

**Who gets Pro** — until real payments are connected, Pro is a list you
control: in Netlify, **Project configuration → Environment variables**, add
`PRO_EMAILS` with the teacher emails, separated by commas, then redeploy.
Teachers not on it see a "part of Teacher Pro" note with a link to pricing.
When payments arrive, `isPro()` in `_lib/teacher.js` is the one place to change.

**Turning on Google Drive** (free, about 15 minutes, once):

1. Go to <https://console.cloud.google.com>, create a project (e.g.
   "Doodle Desk"), and note its **project number** on the dashboard.
2. **APIs & Services → Library**: enable **Google Drive API** and
   **Google Picker API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform): app
   name "Doodle Desk", your email as support contact, audience **External**.
   Add the scope `.../auth/drive.file`. Then **Publish app** so any teacher can
   sign in (drive.file is a non-sensitive scope, so no review is needed).
4. **Credentials → Create credentials → OAuth client ID** → Web application.
   Under **Authorized JavaScript origins** add `https://doodle-desk.netlify.app`.
   Copy the **Client ID**.
5. **Credentials → Create credentials → API key**. Restrict it: application
   restriction **Websites** → `https://doodle-desk.netlify.app/*`; API
   restriction → Google Picker API. Copy the key.
6. In Netlify add environment variables `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY`
   and `GOOGLE_APP_ID` (the project number), then redeploy.

Until those are set, the Drive button says import isn't switched on yet.

### AI worksheet maker (Teacher Pro)

**✨ Make with AI** in a room asks for a topic, grade (K–8), kind of activity
(worksheet, practice problems, quiz, exit ticket, draw & label, reading
passage, vocabulary, thinking organizer), number of questions and optional
notes such as an NC standard. `netlify/functions/ai-worksheet.js` asks Claude
for the content as structured data (forced tool use) and `assets/js/ai-maker.js`
lays it out as wide pages shaped like the board — two columns, numbered
questions, answer lines, choice bubbles, drawing boxes. The teacher can edit
any question, see an answer key only they can view, print the worksheet with
the key, then save it to their uploads or send it straight to every board.

Setup: add `ANTHROPIC_API_KEY` (from <https://console.anthropic.com>) to
Netlify's environment variables and redeploy. Optional: `AI_DAILY_LIMIT`
(worksheets per teacher per day, default 25) and `AI_MODEL` (default
`claude-haiku-5-5`). Only teachers on the Pro list can use it.

### Live sync across devices

In live mode the **teacher's browser is the host**. It keeps the room, its
students and their thumbnails in its own `localStorage`, exactly as before, and
applies what students send it. Each room gets two Ably channels:

| Channel | Direction | Messages |
| --- | --- | --- |
| `doodle:<CODE>:up` | students → teacher | `join`, `leave`, `presence`, `board`, `status`, `full-reply`, `room-query` |
| `doodle:<CODE>:down` | teacher → students | `room-info`, `prompt`, `freeze`, `clear-board`, `teacher-mark`, `full-request`, `room-closed` |

Students only listen to `down`, so they never receive each other's thumbnails.
That keeps bandwidth, and the number of messages Ably counts, roughly
proportional to the class size instead of its square.

Joining is a question asked of the teacher's device: the student sends
`room-query` and the teacher's open page answers `room-info` with the room's name,
task and freeze state. **No answer means the room isn't open**, and the student is
told so. That is the main thing to know about how it behaves:

- **The teacher needs the dashboard or the room page open** for students to join.
  Once they are in, a closed laptop lid pauses updates rather than ending the
  lesson — students stay on their boards and everything catches up when the
  teacher's browser returns, because each student's heartbeat carries enough to
  rebuild the class list.
- **Only "room closed" ends a student's session.** A quiet teacher never does.
- **Rooms live in the teacher's browser.** Clearing its site data removes them,
  and they don't follow the teacher to another computer.
- A student's **full board** travels only when the teacher opens it, in parts if
  it is too big for one message; the grid otherwise uses small thumbnails.

Message sizes and rates are kept inside Ably's free plan (64 KiB per message, 50
messages a second per channel), which is comfortable for a class of about 30 to
60. Rooms of 100 or more students drawing at once would need a paid Ably plan,
or a room split across several channels.

### Setting up live sync

1. Make a free account at [ably.com](https://ably.com), create an app, and copy
   an API key from its **API keys** tab (it looks like `xxxx.yyyy:zzzz`).
2. In Netlify, open the site's **Project configuration → Environment variables**
   and add `ABLY_API_KEY` with that key. Redeploy.
3. Open `https://<your-site>/.netlify/functions/ably-token`. You should see a small
   piece of JSON containing `keyName` and `mac`. If you see `ABLY_API_KEY is not
   set`, the variable is missing or the site hasn't been redeployed yet.

`netlify/functions/ably-token.js` is the only server-side code. It signs a token
that lets a browser publish and subscribe on channels named `doodle:*` for an hour
— nothing else — so **the real key never reaches a browser**. `package.json`
exists only so Netlify installs the one library that function uses (`ably`); the
site itself still has no build step. The browser library loads from Ably's CDN,
and only when the function answers, so a site without live sync makes no external
requests beyond its fonts.

If the function isn't there, has no key, or the Ably library can't load (a school
firewall, say), the site falls back to one-browser mode by itself.

Known limit worth knowing about: anyone who has a room code can join it, as with
most classroom tools — a room code is not a secret, it's a seat number.

### Teacher accounts

Logging in (`login.html`) is a real account, not a name typed into a box. There's
one form: typing an email and a password of 8+ characters tries to log in, and if
no account exists yet with that email it creates one on the spot — no separate
sign-up page to find. A wrong password on an **existing** account still fails; it
only creates an account when none is there yet.

```
netlify/functions/auth-signup.js   creates a teacher account
netlify/functions/auth-login.js    checks one
netlify/functions/_lib/jwt.js      signs/verifies the session token (no JWT library)
netlify/functions/_lib/passwords.js  hashes passwords with Node's built-in scrypt
```

Accounts are stored with **Netlify Blobs** — a small key/value store Netlify
gives every site, so there's no database to stand up. Passwords are never stored;
only a salted scrypt hash is.

**Setup** — in Netlify, open **Project configuration → Environment variables** and
add `JWT_SECRET`: any long random string (40+ random characters is plenty — a
password generator or `openssl rand -hex 32` both work). Redeploy. That's the only
step; `auth-signup.js`/`auth-login.js` need nothing else, and `package.json` now
also installs `@netlify/blobs` for them.

**If `JWT_SECRET` is never set**, the login form shows a "teacher accounts aren't
turned on yet" error and nothing else changes — the rest of the site, including
live sync, keeps working exactly as before. This is deliberate: a site that
hasn't done this step yet doesn't break.

**Once it's set**, logging in also tightens live sync: `ably-token.js` only hands
full publish/subscribe access to a browser carrying a valid, unexpired teacher
session. Every other browser — including a student's, or anyone poking at the
token endpoint directly — gets a narrower pass: publish-only on "up" and
subscribe-only on "down", the same as any student legitimately needs. That
browser can't listen in on "up" (where every student's board updates travel) and
can't publish on "down" (so it can't send a teacher-only message like "freeze the
class" or "clear the board"). Without `JWT_SECRET` set, there's no way to tell
a teacher's browser from a student's, so everyone keeps the old, fully open pass
instead — which is exactly what let this feature ship without breaking any site
that hasn't set it up yet.

A session lasts 30 days and lives in the teacher's browser (`localStorage`); the
🚪 button on the dashboard logs out. There's no "forgot password" flow yet — the
site doesn't send email anywhere else either, so that would be new infrastructure,
not just a new function.

## Running it

Any static server will do:

```bash
npx http-server -p 8080 .
# or
python3 -m http.server 8080
```

Then open <http://localhost:8080/>. Opening `index.html` straight off disk works too.

## Deploying

There is nothing to build, so hosting is a file copy. Two routes are set up:

**GitHub Pages** — `.github/workflows/pages.yml` publishes on every push to
`main` or the working branch. It copies the site (minus `.git`, `.github` and
`netlify.toml`), adds `.nojekyll`, and hands it to Pages;
`actions/configure-pages` runs with `enablement: true`, so Pages switches
itself on the first time it runs. The site lands at
`https://<owner>.github.io/classroom/`. Every path in the site is relative, so
serving it from a subdirectory works.

If the `deploy` job fails in a couple of seconds without running a single step,
it was rejected at the environment gate rather than by anything in the
workflow. Two settings cause that, both under **Settings → Pages** and
**Settings → Environments → github-pages**:

- **Source** is *Deploy from a branch*. `actions/deploy-pages` needs it set to
  *GitHub Actions*.
- **Deployment branches** for the `github-pages` environment allows only the
  default branch. Either merge to `main`, or add the working branch there.

**Netlify** — `netlify.toml` publishes the repo root with no build command, and
points at `netlify/functions/` for the token function (see *Setting up live sync*).
The quickest setup is to let Netlify pull from GitHub, which needs no CLI and
redeploys on every push:

1. Netlify → your site → **Project configuration → Build & deploy → Link repository**
2. Pick `explode35/classroom`, and set the branch to deploy.
3. Leave the build command empty and the publish directory as `.` —
   `netlify.toml` already says so.

`netlify deploy --prod` from a checkout works too, if you'd rather push builds
than have Netlify pull them.

Any other static host works the same way: copy the folder up.

## Changing the plans and prices

All pricing lives in one place: **`assets/js/config.js`**. Both the pricing page and
the checkout read from it, so editing a number there updates every place it appears.

```js
{
  id: "pro",
  name: "Teacher Pro",
  monthly: 9,      // $/month when billed monthly
  annual: 7,       // $/month equivalent when billed yearly
  perSeat: false,  // true = price is per teacher (see the School plan)
  minSeats: 5,
  features: [...], // ticks
  missing: [...]   // greyed-out lines
}
```

The comparison table in `pricing.html` is hand-written HTML — update it there if you
add or move a feature.

The static plan cards inside `<div data-plans>` in `index.html` and `pricing.html` are a
fallback so search engines and no-JS visitors still see real prices; `assets/js/pricing.js`
replaces them on load. Keep them roughly in sync when prices change.

## Taking real money

The subscribe form currently runs in **demo mode**: it validates every field, builds the
order, and shows a confirmation without charging anything or creating an account. To take
real subscriptions you need a small server, because a Stripe *secret* key must never be
shipped to a browser.

1. Create your products and recurring prices in the Stripe dashboard.
2. Add an endpoint that creates a Checkout Session. In Express that is roughly:

   ```js
   import express from "express";
   import Stripe from "stripe";

   const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
   const app = express();
   app.use(express.json());

   // planId + billing -> your Stripe price IDs
   const PRICES = {
     "pro:monthly":    "price_...",
     "pro:annual":     "price_...",
     "school:monthly": "price_...",
     "school:annual":  "price_..."
   };

   app.post("/api/create-checkout-session", async (req, res) => {
     const { planId, billing, seats, email } = req.body;
     const price = PRICES[`${planId}:${billing}`];
     if (!price) return res.status(400).json({ error: "Unknown plan" });

     const session = await stripe.checkout.sessions.create({
       mode: "subscription",
       customer_email: email,
       line_items: [{ price, quantity: planId === "school" ? Number(seats) || 5 : 1 }],
       subscription_data: { trial_period_days: 30 },
       success_url: "https://your-domain.example/subscribe.html?done=1",
       cancel_url: "https://your-domain.example/pricing.html"
     });

     res.json({ url: session.url });
   });
   ```

3. Point the site at it in `assets/js/config.js`:

   ```js
   CHECKOUT_ENDPOINT: "/api/create-checkout-session",
   ```

The form then POSTs the order and follows the returned Checkout URL instead of showing
the demo confirmation. Stripe collects the card, so you can delete the card fields from
`subscribe.html` once this is live — that also takes your site out of scope for handling
card data.

4. Handle the `checkout.session.completed` and `customer.subscription.*` webhooks to
   create and expire accounts.

## What is real and what is a placeholder

**Real and working:** every page and layout, light/dark mode with the choice remembered,
the mobile menu, the monthly/yearly switch, plan deep links (`subscribe.html?plan=pro&billing=annual`),
form validation, the live order summary, the whiteboard demo, and the whole app —
rooms, codes, joining, live thumbnails, status flags, the task banner, freeze, clear,
and the teacher marking a student's board — across tabs in one browser, and across
devices once `ABLY_API_KEY` is set on Netlify. Teacher log in is a real account
(password hashed, checked server-side) once `JWT_SECRET` is set — see *Teacher
accounts* above.

**Placeholder, replace before launch:**

- Payments — demo mode until `CHECKOUT_ENDPOINT` is set (above).
- Cross-device sync is real but **only when Ably is set up** (see above). Without
  it the app stays confined to one browser. Rooms still live only in the
  teacher's browser — there's no "my rooms, on any device" yet, even with a
  real account.
- There's no "forgot password" flow (see *Teacher accounts* above) and no way
  for a teacher to change their email or delete their account except by asking
  whoever manages the Netlify Blobs store directly.
- Newsletter sign-up — shows a confirmation, posts nowhere.
- Testimonials on `index.html` — illustrative copy, marked with an HTML comment. Swap
  for real, permissioned quotes.
- `hello@doodledesk.example` and the Privacy / Terms / About links point at the FAQ.

## Notes on how it's built

- **No dependencies in the site.** Google Fonts (Fredoka + Nunito) are the only
  external request, with a system-font fallback if they're blocked, plus the Ably
  library when live sync is switched on. The npm dependencies (`ably`,
  `@netlify/blobs`) belong to the Netlify functions, not the pages.
- **Accessible by default:** skip link, visible focus rings, labelled form fields with
  inline errors, `aria-pressed` on toggles, and full keyboard operation.
- **Respects `prefers-reduced-motion`** — every animation, including the confetti, is
  switched off for people who ask for that.
- **Nothing is hidden without JS.** The reveal-on-scroll animation is scoped to a `.js`
  class set before first paint, so a page with scripts blocked shows all its content.
- **Theme choice** is stored in `localStorage` and applied before paint, so dark-mode
  visitors never see a white flash.

### Files

```
netlify/functions/ably-token.js      hands browsers a short-lived Ably token (server side)
netlify/functions/auth-signup.js     creates a teacher account
netlify/functions/auth-login.js      checks a teacher account
netlify/functions/_lib/jwt.js        tiny HS256 session tokens, no library
netlify/functions/_lib/passwords.js  password hashing (Node's built-in scrypt)
package.json                         installs the two libraries those functions need

assets/css/site.css       design tokens + every component
assets/js/config.js       plans, prices, checkout endpoint, sync endpoint  ← edit this one
assets/js/site.js         theme, mobile nav, scroll reveals, confetti, toasts
assets/js/pricing.js      renders the plan cards, monthly/yearly switch
assets/js/checkout.js     plan picker, order summary, validation, submit
assets/js/login.js        log in + join-a-room forms

assets/js/board-engine.js the drawing core, shared by all three boards
assets/js/board-ui.js     binds the toolbar markup to a board
assets/js/realtime.js     rooms, identities and the message bus (Ably or one-browser)
assets/js/whiteboard.js   the public demo board
assets/js/dashboard.js    the teacher's room list
assets/js/room.js         the live room: grid, controls, focus view
assets/js/student.js      a student's board
```
