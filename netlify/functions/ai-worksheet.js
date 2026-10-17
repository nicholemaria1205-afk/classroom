/* ==========================================================================
   Doodle Desk — make a worksheet or activity with AI (Teacher Pro)

   POST { topic, grade, kind, count, notes } with the teacher's session as a
   Bearer token. Returns { worksheet: { title, instructions, items, answer_key,
   teacher_notes } } — plain data. The browser lays it out as board pages,
   so students can write their answers straight onto it.

   Uses Claude (Anthropic's API). Needs the ANTHROPIC_API_KEY environment
   variable. Each teacher gets AI_DAILY_LIMIT generations a day (default 25)
   so a stuck button can't run up a bill. One worksheet costs well under a
   cent with the default model.
   ========================================================================== */
"use strict";

const { teacherFrom, isPro } = require("./_lib/teacher.js");

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const MODEL = process.env.AI_MODEL || "claude-haiku-5-5";

const KINDS = {
  worksheet: "a practice worksheet with a mix of question types",
  problems: "a set of practice problems that build from easier to harder",
  quiz: "a short multiple-choice quiz",
  exit: "a quick exit ticket (keep it short) to check understanding at the end of a lesson",
  draw: "a draw-and-label activity where students sketch and label diagrams",
  reading: "comprehension questions about a short passage you write yourself (include the passage as the first item, type 'passage')",
  vocab: "a vocabulary activity: words with definitions to match, sentences to complete, and one word to illustrate",
  organizer: "a thinking activity using a graphic-organizer style (compare, sequence, cause and effect) with boxes to fill in"
};

const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8"];

const TOOL = {
  name: "make_worksheet",
  description: "Return the finished worksheet for the teacher.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short, friendly title (max 60 characters)." },
      instructions: { type: "string", description: "One or two sentences telling students what to do." },
      items: {
        type: "array",
        description: "The questions or tasks, in order.",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["short_answer", "long_answer", "fill_blank", "multiple_choice", "true_false", "draw", "passage"]
            },
            prompt: { type: "string", description: "The question or task. For fill_blank, mark each blank with ____." },
            choices: { type: "array", items: { type: "string" }, description: "Only for multiple_choice: 3 or 4 options, without letters." },
            lines: { type: "integer", description: "Answer lines to leave (1-6) for short_answer / long_answer." }
          },
          required: ["type", "prompt"]
        }
      },
      answer_key: {
        type: "array",
        items: { type: "string" },
        description: "One entry per item, same order. For a passage item write 'n/a'."
      },
      teacher_notes: { type: "string", description: "One or two short tips for the teacher (optional)." }
    },
    required: ["title", "instructions", "items", "answer_key"]
  }
};

const SYSTEM = [
  "You write classroom materials for teachers in US schools (kindergarten to 8th grade).",
  "Everything must be accurate, age-appropriate, kind and inclusive, and suitable to show a whole class.",
  "Students will see the page on a digital whiteboard and write, draw or type their answers right on it, so",
  "keep wording short and clear for the grade level, and leave answer space with the item type and `lines`.",
  "Use plain text only: no markdown, no emoji, no images or links. Write math with simple symbols",
  "(+, −, ×, ÷, =, fractions like 3/4). Keep each prompt under 220 characters (a passage under 900).",
  "If the teacher names a standard (for example an NC Standard Course of Study code), align to it.",
  "If the request isn't suitable for a classroom, make a worksheet on the closest suitable topic and say so in teacher_notes.",
  "Always answer by calling the make_worksheet tool."
].join(" ");

function respond(statusCode, body) {
  return { statusCode: statusCode, headers: headers, body: JSON.stringify(body) };
}

function clean(text, max) {
  return String(text || "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max);
}

/* A small per-teacher, per-day counter in Netlify Blobs */
async function countUse(event, email) {
  var limit = parseInt(process.env.AI_DAILY_LIMIT || "25", 10);
  if (!(limit > 0)) return { ok: true };
  try {
    const blobs = require("@netlify/blobs");
    blobs.connectLambda(event);
    var store = blobs.getStore("doodle-ai-usage");
    var key = new Date().toISOString().slice(0, 10) + ":" + email;
    var used = (await store.get(key, { type: "json" })) || { n: 0 };
    if (used.n >= limit) return { ok: false, limit: limit };
    await store.setJSON(key, { n: used.n + 1 });
    return { ok: true, left: limit - used.n - 1 };
  } catch (err) {
    return { ok: true };  /* never block a lesson over the counter itself */
  }
}

/* Keep only what the page layout understands, with sensible limits */
function tidy(ws, count) {
  var items = Array.isArray(ws.items) ? ws.items : [];
  var key = Array.isArray(ws.answer_key) ? ws.answer_key : [];
  var allowed = TOOL.input_schema.properties.items.items.properties.type.enum;
  var out = [];
  items.slice(0, Math.max(count + 1, 3)).forEach(function (it, i) {
    if (!it || !it.prompt) return;
    var type = allowed.indexOf(it.type) !== -1 ? it.type : "short_answer";
    var item = { type: type, prompt: clean(it.prompt, type === "passage" ? 950 : 300) };
    if (type === "multiple_choice") {
      item.choices = (Array.isArray(it.choices) ? it.choices : []).slice(0, 4).map(function (c) { return clean(c, 120); }).filter(Boolean);
      if (item.choices.length < 2) item.type = "short_answer";
    }
    if (type === "short_answer" || type === "long_answer") {
      var n = parseInt(it.lines, 10);
      item.lines = Math.min(6, Math.max(1, isNaN(n) ? (type === "long_answer" ? 4 : 2) : n));
    }
    item.answer = clean(key[i], 300);
    out.push(item);
  });
  return {
    title: clean(ws.title, 70) || "Worksheet",
    instructions: clean(ws.instructions, 240),
    items: out,
    teacher_notes: clean(ws.teacher_notes, 400)
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return respond(405, { error: "Use POST" });

  var teacher = teacherFrom(event);
  if (!teacher) return respond(401, { error: "Log in as a teacher to use the AI maker." });
  if (!isPro(teacher.email)) return respond(403, { error: "The AI worksheet maker is part of Teacher Pro.", pro: false });

  var key = process.env.ANTHROPIC_API_KEY;
  if (!key) return respond(503, { error: "The AI maker isn't switched on for this site yet." });

  var data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch (err) {
    return respond(400, { error: "Could not read that request." });
  }

  var topic = clean(data.topic, 200);
  if (topic.length < 3) return respond(400, { error: "Tell the AI what the worksheet is about." });
  var grade = GRADES.indexOf(String(data.grade)) !== -1 ? String(data.grade) : "5";
  var kind = KINDS[data.kind] ? data.kind : "worksheet";
  var count = Math.min(12, Math.max(3, parseInt(data.count, 10) || 6));
  var notes = clean(data.notes, 400);

  var use = await countUse(event, teacher.email);
  if (!use.ok) return respond(429, { error: "You've used today's " + use.limit + " AI worksheets. More tomorrow!" });

  var ask = "Make " + KINDS[kind] + " for " + (grade === "K" ? "kindergarten" : "grade " + grade) +
    " about: " + topic + ".\nAbout " + count + " items." +
    (notes ? "\nTeacher's notes: " + notes : "");

  var res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 6000,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content: ask }]
      })
    });
  } catch (err) {
    return respond(502, { error: "Couldn't reach the AI service. Try again in a moment." });
  }

  var body = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    var why = body && body.error && body.error.message ? body.error.message : "status " + res.status;
    return respond(502, { error: "The AI service had a problem (" + why + "). Try again." });
  }
  if (body.stop_reason === "refusal") {
    return respond(422, { error: "The AI couldn't make that one. Try a different topic or wording." });
  }

  var call = (body.content || []).filter(function (b) { return b.type === "tool_use"; })[0];
  if (!call || !call.input) return respond(502, { error: "The AI didn't send a worksheet back. Try again." });

  var worksheet = tidy(call.input, count);
  if (!worksheet.items.length) return respond(502, { error: "The AI sent back an empty worksheet. Try again." });

  return respond(200, { worksheet: worksheet, left: use.left });
};
