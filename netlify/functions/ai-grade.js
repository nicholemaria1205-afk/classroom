/* ==========================================================================
   Doodle Desk — grade one student's board with AI (Teacher Pro)

   POST { image: "data:image/jpeg;base64,...", key: [{ question, answer }],
          title } with the teacher's session as a Bearer token.
   Returns { results: [{ n, status, read, note, confident }], note }.

   For the teacher only: the result goes back to the teacher's own page and
   is never sent to the student. No student name is sent here — the AI only
   sees the picture of the board and the answer key.

   If the key is empty, the AI works out the answers itself and every mark
   is flagged for the teacher to check. Uses ANTHROPIC_API_KEY, like the
   worksheet maker. AI_GRADE_DAILY_LIMIT boards per teacher per day
   (default 300).
   ========================================================================== */
"use strict";

const { teacherFrom, isPro } = require("./_lib/teacher.js");

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const MODEL = process.env.AI_MODEL || "claude-haiku-5-5";
const MAX_IMAGE = 5 * 1024 * 1024;

const TOOL = {
  name: "grade_board",
  description: "Return the marks for this student's board.",
  input_schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        description: "One entry per answer-key question, in the same order.",
        items: {
          type: "object",
          properties: {
            n: { type: "integer", description: "Question number, starting at 1." },
            status: {
              type: "string",
              enum: ["correct", "partial", "incorrect", "blank", "not_on_page"],
              description: "blank = the student wrote nothing for it; not_on_page = that question isn't on this board."
            },
            read: { type: "string", description: "What the student wrote or drew for this question, briefly, as you read it." },
            note: { type: "string", description: "A few words for the teacher on why (max 120 characters)." },
            confident: { type: "boolean", description: "false if handwriting was hard to read, the answer is a drawing or open-ended, or you are unsure." }
          },
          required: ["n", "status", "confident"]
        }
      },
      note: { type: "string", description: "Optional one-line note for the teacher about the whole board." }
    },
    required: ["results"]
  }
};

const SYSTEM = [
  "You help a US elementary or middle school teacher mark a student's work.",
  "You get a picture of the student's digital whiteboard: the worksheet page underneath, with the student's",
  "handwriting, drawings, typed text and stamps on top. Purple-number circles and printed text are the worksheet,",
  "not the student's answer. Mark each answer-key question: correct, partial (on the right track or partly right),",
  "incorrect, blank (nothing written for it), or not_on_page (the question isn't on this board).",
  "Be fair and generous with spelling and neat-enough handwriting; accept equivalent answers (1/2 = 0.5 = 2/4 unless",
  "the question asks for simplest form). For multiple choice, look for the circled, ticked or filled bubble or a",
  "written letter. Set confident to false whenever you have any doubt — the teacher will check those.",
  "Your marks go only to the teacher. Always answer by calling the grade_board tool."
].join(" ");

function respond(statusCode, body) {
  return { statusCode: statusCode, headers: headers, body: JSON.stringify(body) };
}

function clean(text, max) {
  return String(text == null ? "" : text).replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max);
}

async function countUse(event, email) {
  var limit = parseInt(process.env.AI_GRADE_DAILY_LIMIT || "300", 10);
  if (!(limit > 0)) return { ok: true };
  try {
    const blobs = require("@netlify/blobs");
    blobs.connectLambda(event);
    var store = blobs.getStore("doodle-ai-usage");
    var key = "grade:" + new Date().toISOString().slice(0, 10) + ":" + email;
    var used = (await store.get(key, { type: "json" })) || { n: 0 };
    if (used.n >= limit) return { ok: false, limit: limit };
    await store.setJSON(key, { n: used.n + 1 });
    return { ok: true };
  } catch (err) {
    return { ok: true };
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return respond(405, { error: "Use POST" });

  var teacher = teacherFrom(event);
  if (!teacher) return respond(401, { error: "Log in as a teacher to grade with AI." });
  if (!isPro(teacher.email)) return respond(403, { error: "Grading with AI is part of Teacher Pro.", pro: false });

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return respond(503, { error: "AI grading isn't switched on for this site yet." });

  var data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch (err) {
    return respond(400, { error: "Could not read that request." });
  }

  var match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(data.image || ""));
  if (!match) return respond(400, { error: "No board picture was sent." });
  if (match[2].length * 0.75 > MAX_IMAGE) return respond(413, { error: "That board picture is too big." });

  var key = (Array.isArray(data.key) ? data.key : []).slice(0, 40).map(function (k, i) {
    return { n: i + 1, question: clean(k && k.question, 400), answer: clean(k && k.answer, 300) };
  }).filter(function (k) { return k.question || k.answer; });
  var count = Math.max(1, Math.min(40, parseInt(data.count, 10) || key.length || 1));

  var use = await countUse(event, teacher.email);
  if (!use.ok) return respond(429, { error: "You've graded " + use.limit + " boards today with AI. More tomorrow!" });

  var ask;
  if (key.length) {
    ask = "Worksheet: " + clean(data.title, 80) + "\nAnswer key:\n" + key.map(function (k) {
      return k.n + ". " + (k.question ? k.question + " — " : "") + "Answer: " + (k.answer || "(teacher left blank: work it out)");
    }).join("\n") + "\n\nMark each of these " + key.length + " questions for the student's board in the picture.";
  } else {
    ask = "Worksheet: " + clean(data.title, 80) + "\nThere is no answer key. Work out the correct answer to each numbered " +
      "question on the page yourself, then mark the student's answers. About " + count + " questions. " +
      "Set confident to false on every question, since the teacher hasn't confirmed the answers.";
  }

  var res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } },
            { type: "text", text: ask }
          ]
        }]
      })
    });
  } catch (err) {
    return respond(502, { error: "Couldn't reach the AI service. Try again in a moment." });
  }

  var body = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    var why = body && body.error && body.error.message ? body.error.message : "status " + res.status;
    return respond(502, { error: "The AI service had a problem (" + why + ")." });
  }
  if (body.stop_reason === "refusal") return respond(422, { error: "The AI couldn't grade this board." });

  var call = (body.content || []).filter(function (b) { return b.type === "tool_use"; })[0];
  if (!call || !call.input || !Array.isArray(call.input.results)) {
    return respond(502, { error: "The AI didn't send marks back." });
  }

  var allowed = TOOL.input_schema.properties.results.items.properties.status.enum;
  var results = call.input.results.slice(0, 40).map(function (r, i) {
    return {
      n: parseInt(r.n, 10) || i + 1,
      status: allowed.indexOf(r.status) !== -1 ? r.status : "incorrect",
      read: clean(r.read, 200),
      note: clean(r.note, 160),
      confident: key.length ? r.confident !== false : false
    };
  });

  return respond(200, { results: results, note: clean(call.input.note, 200) });
};
