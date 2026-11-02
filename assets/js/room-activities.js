/* ==========================================================================
   Doodle Desk — the room's 🎯 Activities tab (room.html)
   The countdown timer, quick polls / exit tickets and the name picker.
   Everything about them is kept on the room (net.updateRoom), so a student
   who joins late gets the running timer and the open poll straight away.
   ========================================================================== */
(function () {
  "use strict";

  var net = window.DoodleNet;
  var Act = window.DoodleActivities;
  if (!net || !Act) return;

  var code = (new URLSearchParams(location.search).get("code") || "").toUpperCase();
  if (!net.getRoom(code)) return;

  var $ = function (sel) { return document.querySelector(sel); };
  var esc = Act.esc;

  function room() { return net.getRoom(code) || {}; }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---- Timer ------------------------------------------------------------------ */
  var timerShow = $("[data-timer-show]");
  var timerSetup = $("[data-timer-setup]");
  var timerControls = $("[data-timer-controls]");
  var pauseBtn = $("[data-timer-pause]");
  var minsEl = $("[data-timer-mins]");
  var labelEl = $("[data-timer-label]");

  var pill = Act.timerPill(timerShow, {
    onDone: function () {
      /* Time's up: the room's timer is finished, so the setup comes back */
      setTimeout(showTimer, 8200);
    }
  });

  var T = Act.timers;

  function showTimer() {
    var t = T.current(net, code);
    pill.set(t);
    var running = !!t && Act.timerLeft(t) > 0;
    timerSetup.hidden = running;
    timerControls.hidden = !running;
    if (t) pauseBtn.textContent = t.pausedLeft != null ? "▶️ Resume" : "⏸️ Pause";
  }

  document.querySelectorAll("[data-timer-min]").forEach(function (b) {
    b.addEventListener("click", function () {
      minsEl.value = b.getAttribute("data-timer-min");
      start();
    });
  });

  function start() {
    var mins = parseFloat(minsEl.value);
    if (!(mins > 0)) { minsEl.focus(); return; }
    T.start(net, code, Math.min(90, mins) * 60000, labelEl.value.trim());
    showTimer();
    window.doodleToast("⏱️ Timer started on every desk");
  }

  $("[data-timer-start]").addEventListener("click", start);
  pauseBtn.addEventListener("click", function () { T.toggle(net, code); showTimer(); });
  $("[data-timer-add]").addEventListener("click", function () { T.addMinute(net, code); showTimer(); });
  $("[data-timer-stop]").addEventListener("click", function () { T.stop(net, code); showTimer(); });

  /* The teaching desk can run the timer too — keep this page in step */
  window.addEventListener("storage", function (e) { if (e.key === "doodle-rooms") showTimer(); });

  showTimer();

  /* ---- Polls ---------------------------------------------------------------------- */
  var pollType = "choice";
  var choiceTexts = ["", "", "", ""];
  var setupEl = $("[data-poll-setup]");
  var liveEl = $("[data-poll-live]");
  var doneEl = $("[data-poll-done]");
  var qEl = $("[data-poll-q]");
  var optsEl = $("[data-poll-opts]");
  var showEl = $("[data-poll-show]");
  var lastDone = null;
  var resultsTimer = null;

  $("[data-poll-types]").innerHTML = Object.keys(Act.POLL_TYPES).map(function (k) {
    var t = Act.POLL_TYPES[k];
    return '<button class="chip" type="button" data-poll-type="' + k + '" aria-pressed="' + String(k === pollType) + '">' +
      t.icon + " " + t.label + "</button>";
  }).join("");

  function drawOpts() {
    document.querySelectorAll("[data-poll-type]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-poll-type") === pollType));
    });
    if (pollType === "choice") {
      optsEl.innerHTML = choiceTexts.map(function (t, i) {
        var L = "ABCDEF"[i];
        return '<div class="poll-opt"><span class="poll-opt__key" aria-hidden="true">' + L + "</span>" +
          '<input class="cp__input" type="text" maxlength="80" value="' + esc(t) + '" placeholder="Choice ' + L + ' (optional)" aria-label="Choice ' + L + '" data-choice="' + i + '">' +
          (choiceTexts.length > 2 ? '<button class="icon-btn" type="button" data-choice-del="' + i + '" aria-label="Remove choice ' + L + '">✕</button>' : "") +
          "</div>";
      }).join("") +
        (choiceTexts.length < 6 ? '<button class="btn btn--ghost" type="button" data-choice-add>＋ Add a choice</button>' : "") +
        '<p class="small muted mb-0">Leave the choices blank to use letters only — handy when the choices are on your screen.</p>';
    } else {
      var preview = pollType === "text"
        ? '<span class="poll-preview__text">Students type a short answer</span>'
        : Act.pollOptions(pollType).map(function (o) {
          return '<span class="poll-preview__opt">' + (o.emoji || "") + " " + esc(o.label) + "</span>";
        }).join("");
      optsEl.innerHTML = '<div class="poll-preview" aria-hidden="true">' + preview + "</div>";
    }
  }

  $("[data-poll-types]").addEventListener("click", function (e) {
    var b = e.target.closest("[data-poll-type]");
    if (!b) return;
    pollType = b.getAttribute("data-poll-type");
    drawOpts();
  });

  optsEl.addEventListener("input", function (e) {
    if (e.target.matches("[data-choice]")) choiceTexts[+e.target.getAttribute("data-choice")] = e.target.value;
  });
  optsEl.addEventListener("click", function (e) {
    if (e.target.closest("[data-choice-add]")) { choiceTexts.push(""); drawOpts(); }
    var del = e.target.closest("[data-choice-del]");
    if (del) { choiceTexts.splice(+del.getAttribute("data-choice-del"), 1); drawOpts(); }
  });

  function hereCount() {
    return net.getStudents(code).filter(net.isOnline).length;
  }

  function resultsHTML(poll, answers, withNames) {
    var ids = Object.keys(answers || {});
    if (poll.type === "text") {
      if (!ids.length) return '<p class="small muted">No answers yet.</p>';
      return '<ul class="poll-answers">' + ids.sort(function (a, b) { return answers[a].at - answers[b].at; }).map(function (id) {
        return "<li><strong>" + esc(answers[id].name) + "</strong> " + esc(answers[id].a) + "</li>";
      }).join("") + "</ul>";
    }
    var c = Act.counts(poll, answers);
    var total = ids.length || 1;
    return poll.options.map(function (o) {
      var n = c[o.key] || 0;
      var pct = Math.round((n / total) * 100);
      var who = withNames ? ids.filter(function (id) { return answers[id].a === o.key; }).map(function (id) { return answers[id].name; }) : [];
      return '<div class="poll-bar">' +
        '<div class="poll-bar__label"><span class="poll-bar__key">' + (o.emoji ? o.emoji + " " : "") + esc(o.label) + "</span>" +
          (o.text ? " " + esc(o.text) : "") + '<span class="poll-bar__n">' + n + "</span></div>" +
        '<div class="poll-bar__track"><span style="width:' + (ids.length ? pct : 0) + '%"></span></div>' +
        (who.length ? '<p class="poll-bar__who">' + who.map(esc).join(", ") + "</p>" : "") +
      "</div>";
    }).join("");
  }

  function showPoll() {
    var p = room().poll;
    setupEl.hidden = !!p || !!lastDone;
    liveEl.hidden = !p;
    doneEl.hidden = !!p || !lastDone;
    if (p) {
      var n = Object.keys(p.answers || {}).length;
      $("[data-poll-live-q]").textContent = p.q || "Quick poll";
      $("[data-poll-count]").textContent = n + (n === 1 ? " answer" : " answers") + " · " + hereCount() + " students here";
      $("[data-poll-results]").innerHTML = resultsHTML(p, p.answers, true);
      showEl.checked = !!p.showResults;
    } else if (lastDone) {
      $("[data-poll-done-q]").textContent = (lastDone.q || "Quick poll") + " — " + Object.keys(lastDone.answers || {}).length + " answers";
      $("[data-poll-done-results]").innerHTML = resultsHTML(lastDone, lastDone.answers, true);
    }
  }

  function wire(p) {
    return { id: p.id, q: p.q, type: p.type, options: p.options, showResults: !!p.showResults };
  }

  function sendResults() {
    clearTimeout(resultsTimer);
    resultsTimer = setTimeout(function () {
      var p = room().poll;
      if (!p) return;
      net.send("poll-results", { code: code, pollId: p.id, show: !!p.showResults, results: p.showResults ? Act.counts(p, p.answers) : null });
    }, 400);
  }

  $("[data-poll-send]").addEventListener("click", function () {
    var q = qEl.value.trim();
    if (!q && pollType === "text") { qEl.focus(); return window.doodleToast("Type the question for the exit ticket first", "warn"); }
    var poll = {
      id: newId(),
      q: q.slice(0, 160),
      type: pollType,
      options: Act.pollOptions(pollType, choiceTexts),
      answers: {},
      showResults: false,
      startedAt: Date.now()
    };
    net.updateRoom(code, { poll: poll });
    net.send("poll", { code: code, poll: wire(poll) });
    lastDone = null;
    showPoll();
    window.doodleToast("📣 Poll sent to every desk");
  });

  showEl.addEventListener("change", function () {
    var p = room().poll;
    if (!p) return;
    p.showResults = showEl.checked;
    net.updateRoom(code, { poll: p });
    sendResults();
  });

  $("[data-poll-end]").addEventListener("click", function () {
    var r = room();
    var p = r.poll;
    if (!p) return;
    p.closed = true;
    p.endedAt = Date.now();
    var history = (r.polls || []).concat([p]).slice(-30);
    net.updateRoom(code, { poll: null, polls: history });
    net.send("poll-close", { code: code, pollId: p.id, results: p.showResults ? Act.counts(p, p.answers) : null });
    lastDone = p;
    $("[data-poll-drawer]").disabled = false;
    $("[data-poll-drawer]").textContent = "🗄️ Save to Doodle Drawer";
    showPoll();
  });

  $("[data-poll-new]").addEventListener("click", function () {
    lastDone = null;
    qEl.value = "";
    choiceTexts = ["", "", "", ""];
    drawOpts();
    showPoll();
    qEl.focus();
  });

  function csvFor(p) {
    function cell(v) {
      var s = String(v == null ? "" : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var label = {};
    (p.options || []).forEach(function (o) { label[o.key] = o.label + (o.text ? " — " + o.text : ""); });
    var ids = Object.keys(p.answers || {}).sort(function (a, b) { return p.answers[a].name.localeCompare(p.answers[b].name); });
    var lines = [["Student", "Answer", "Time"].map(cell).join(",")].concat(ids.map(function (id) {
      var a = p.answers[id];
      return [a.name, p.type === "text" ? a.a : (label[a.a] || a.a), new Date(a.at).toLocaleString()].map(cell).join(",");
    }));
    var link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    link.download = (room().name + " - poll - " + (p.q || "quick poll")).replace(/[^\w\s.()-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 100) + ".csv";
    document.body.appendChild(link);
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
  }

  $("[data-poll-csv]").addEventListener("click", function () { if (lastDone) csvFor(lastDone); });

  var keepSel = $("[data-poll-keep]");
  if (window.DoodleDrawer) keepSel.innerHTML = window.DoodleDrawer.keepSelectHTML("schoolyear");
  else $("[data-poll-drawer]").closest(".drawer-save").hidden = true;

  function savePoll(p, btn) {
    if (!window.DoodleDrawer) return;
    btn.disabled = true;
    btn.textContent = "Saving…";
    var r0 = room();
    window.DoodleDrawer.save({
      kind: "poll",
      title: r0.name + " — " + (p.q || "Quick poll"),
      keep: keepSel.value,
      keepUntil: net.keepUntil(keepSel.value),
      count: Object.keys(p.answers || {}).length,
      data: { roomName: r0.name, q: p.q, type: p.type, options: p.options, at: p.startedAt,
              answers: Object.keys(p.answers || {}).map(function (id) { return p.answers[id]; }) }
    }).then(function (r) {
      btn.textContent = r.ok ? "✅ In your Doodle Drawer" : "🗄️ Save to Doodle Drawer";
      btn.disabled = !!r.ok;
      if (!r.ok) window.doodleToast(r.error || "Couldn't save it just now", "warn");
    });
  }

  $("[data-poll-drawer]").addEventListener("click", function (e) { if (lastDone) savePoll(lastDone, e.currentTarget); });

  /* Past polls */
  var pollsDialog = $("[data-polls]");
  function openPolls() {
    var list = (room().polls || []).slice().reverse();
    $("[data-polls-list]").innerHTML = list.length ? list.map(function (p, i) {
      return '<article class="past-poll">' +
        '<h4>' + esc(p.q || "Quick poll") + "</h4>" +
        '<p class="small muted">' + new Date(p.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) +
          " · " + Object.keys(p.answers || {}).length + " answers · " + Act.POLL_TYPES[p.type].label + "</p>" +
        '<div class="poll-results">' + resultsHTML(p, p.answers, true) + "</div>" +
        '<button class="btn btn--mint" type="button" data-past-csv="' + i + '">⬇️ Spreadsheet</button>' +
      "</article>";
    }).join("") : '<p class="muted">No polls in this room yet.</p>';
    pollsDialog.setAttribute("data-open", "true");
    document.body.style.overflow = "hidden";
  }
  function closePolls() {
    pollsDialog.setAttribute("data-open", "false");
    document.body.style.overflow = "";
  }
  $("[data-poll-history]").addEventListener("click", openPolls);
  $("[data-polls-close]").addEventListener("click", closePolls);
  pollsDialog.addEventListener("click", function (e) {
    if (e.target === pollsDialog) closePolls();
    var b = e.target.closest("[data-past-csv]");
    if (b) csvFor((room().polls || []).slice().reverse()[+b.getAttribute("data-past-csv")]);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && pollsDialog.getAttribute("data-open") === "true") closePolls();
  });

  net.on("poll-answer", function (p) {
    if (p.code !== code) return;
    showPoll();
    if ((room().poll || {}).showResults) sendResults();
  });

  drawOpts();
  showPoll();

  /* ---- Name picker ------------------------------------------------------------------ */
  var pickShow = $("[data-pick-show]");
  var pickMeta = $("[data-pick-meta]");
  var pickBtn = $("[data-pick]");
  var spinning = false;

  var P = Act.picker;

  function showPickMeta() {
    var done = P.picked(code);
    var all = P.pool(net, code, $("[data-pick-online]").checked);
    var left = all.filter(function (s) { return done.indexOf(P.norm(s.name)) < 0; }).length;
    pickMeta.textContent = !all.length ? "Nobody to pick from yet."
      : $("[data-pick-norepeat]").checked
        ? left + " of " + all.length + " still to go today" + (done.length ? " · picked: " + done.length : "")
        : all.length + " to pick from";
  }

  pickBtn.addEventListener("click", function () {
    if (spinning) return;
    var choice = P.choose(net, code, { onlineOnly: $("[data-pick-online]").checked, noRepeat: $("[data-pick-norepeat]").checked });
    if (!choice) {
      showPickMeta();
      return window.doodleToast($("[data-pick-online]").checked ? "No students are here right now" : "No students in this room yet", "warn");
    }
    if (choice.fresh) window.doodleToast("Everyone has had a turn today — starting fresh 🔄");
    spinning = true;
    pickBtn.disabled = true;
    Act.spin(pickShow, choice.names, choice.winner.name, function () {
      spinning = false;
      pickBtn.disabled = false;
      P.done(net, code, choice.winner, $("[data-pick-tell]").checked);
      showPickMeta();
    });
  });

  $("[data-pick-reset]").addEventListener("click", function () {
    P.reset(code);
    pickShow.textContent = "Who's next?";
    pickShow.removeAttribute("data-state");
    showPickMeta();
    window.doodleToast("Everyone can be picked again today");
  });
  ["[data-pick-online]", "[data-pick-norepeat]"].forEach(function (sel) {
    $(sel).addEventListener("change", showPickMeta);
  });

  /* ---- Class stars ----------------------------------------------------------------- */
  var ST = Act.stars;
  var starsList = $("[data-stars-list]");
  var goalForm = $("[data-stars-goal-form]");

  function showStars() {
    var s = ST.get(net, code);
    var total = ST.total(s);
    var monday = new Date(s.week + "T00:00:00");
    $("[data-stars-week]").textContent = "week of " + monday.toLocaleDateString([], { month: "short", day: "numeric" });

    var goal = s.goal;
    $("[data-stars-goal]").innerHTML = goal
      ? '<div class="stars-goal__text"><strong>' + total + " / " + goal.n + " stars</strong>" +
          (goal.reward ? " → " + esc(goal.reward) : "") + (total >= goal.n ? " 🎉 <strong>Goal reached!</strong>" : "") + "</div>" +
        '<div class="poll-bar__track stars-goal__track"><span style="width:' + Math.min(100, Math.round((total / goal.n) * 100)) + '%"></span></div>'
      : '<div class="stars-goal__text"><strong>' + total + (total === 1 ? " star" : " stars") + "</strong> for the class this week</div>";

    /* Everyone here, plus anyone who earned stars this week */
    var people = {};
    net.getStudents(code).forEach(function (st) {
      people[P.norm(st.name)] = { name: st.name, id: st.id, here: net.isOnline(st) };
    });
    Object.keys(s.points).forEach(function (k) {
      if (!people[k]) people[k] = { name: s.points[k].name, here: false };
    });
    var keys = Object.keys(people).sort(function (a, b) {
      return (ST.count(s, people[b].name) - ST.count(s, people[a].name)) || people[a].name.localeCompare(people[b].name);
    });
    starsList.innerHTML = keys.length ? keys.map(function (k) {
      var p = people[k];
      var n = ST.count(s, p.name);
      return '<li class="stars-row" data-star-name="' + esc(p.name) + '"' + (p.here ? "" : ' data-away="true"') + ">" +
        '<span class="stars-row__name">' + esc(p.name) + "</span>" +
        '<span class="stars-row__n" aria-label="' + n + ' stars">' + (n ? "⭐ " + n : "—") + "</span>" +
        '<button class="icon-btn" type="button" data-star-minus aria-label="Take a star from ' + esc(p.name) + '"' + (n ? "" : " disabled") + ">−</button>" +
        '<button class="btn btn--sun stars-row__give" type="button" data-star-plus aria-label="Give ' + esc(p.name) + ' a star">⭐ +1</button>' +
      "</li>";
    }).join("") : '<li class="muted small">Students appear here when they join.</li>';
  }

  starsList.addEventListener("click", function (e) {
    var row = e.target.closest("[data-star-name]");
    if (!row) return;
    var name = row.getAttribute("data-star-name");
    var st = net.getStudents(code).filter(function (x) { return P.norm(x.name) === P.norm(name); })[0] || { name: name };
    if (e.target.closest("[data-star-plus]")) {
      ST.give(net, code, [st], 1);
      window.doodleToast("⭐ Star for " + name + "!", "good");
    } else if (e.target.closest("[data-star-minus]")) {
      ST.give(net, code, [st], -1);
    } else return;
    showStars();
    if (window.doodleRoomRender) window.doodleRoomRender();
  });

  $("[data-stars-all]").addEventListener("click", function () {
    var here = net.getStudents(code).filter(net.isOnline);
    if (!here.length) return window.doodleToast("No students are here right now", "warn");
    ST.give(net, code, here, 1);
    showStars();
    if (window.doodleRoomRender) window.doodleRoomRender();
    if (window.doodleConfetti) window.doodleConfetti(40);
    window.doodleToast("⭐ A star for all " + here.length + "!", "good");
  });

  $("[data-stars-goal-edit]").addEventListener("click", function () {
    var g = ST.get(net, code).goal;
    goalForm.hidden = !goalForm.hidden;
    $("[data-stars-goal-n]").value = g ? g.n : "";
    $("[data-stars-goal-reward]").value = g ? g.reward : "";
    if (!goalForm.hidden) $("[data-stars-goal-n]").focus();
  });
  goalForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var n = parseInt($("[data-stars-goal-n]").value, 10);
    if (!(n > 0)) return $("[data-stars-goal-n]").focus();
    ST.setGoal(net, code, n, $("[data-stars-goal-reward]").value.trim());
    goalForm.hidden = true;
    showStars();
    window.doodleToast("🎯 Class goal set — it shows on every desk");
  });
  $("[data-stars-goal-clear]").addEventListener("click", function () {
    ST.setGoal(net, code, 0, "");
    goalForm.hidden = true;
    showStars();
  });
  $("[data-stars-reset]").addEventListener("click", function () {
    if (!window.confirm("Set everyone's stars back to zero for this week?")) return;
    ST.reset(net, code);
    showStars();
  });

  /* The focus view's ⭐ button changes the room too */
  window.addEventListener("storage", function (e) { if (e.key === "doodle-rooms") showStars(); });
  document.querySelector("[data-focus-star]").addEventListener("click", function () { setTimeout(showStars, 0); });
  showStars();

  /* ---- Partner desks -------------------------------------------------------------------
     The teacher makes groups; each group shares one live desk. This page
     (or the teaching desk) passes marks between the members — see realtime.js.
       room.groups = { active: true, list: [{ id, name, members: [{ id, name }] }], paper }
       after it ends:  { active: false, last: [...], paper, endedAt } */
  var groupSize = 2;
  var plan = null;
  var groupsIdle = $("[data-groups-idle]");
  var groupsPlan = $("[data-groups-plan]");
  var groupsLive = $("[data-groups-live]");
  var groupsDone = $("[data-groups-done]");
  var paperSel = $("[data-group-paper]");
  paperSel.innerHTML = window.DoodleTemplates.optionsHTML(room().template || "lined");
  paperSel.value = room().template || "lined";

  /* One hidden desk draws every group's picture */
  var thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = 1200;
  thumbCanvas.height = 740;
  var thumbBoard = window.DoodleBoard(thumbCanvas, { readOnly: true });
  var thumbs = {};
  var thumbTimers = {};

  function drawThumb(gid, width) {
    thumbBoard.setItems(net.groupItems(code, gid));
    return thumbBoard.ready().then(function () { return thumbBoard.toThumb(width || 320); });
  }

  function refreshThumb(gid) {
    clearTimeout(thumbTimers[gid]);
    thumbTimers[gid] = setTimeout(function () {
      drawThumb(gid).then(function (src) {
        thumbs[gid] = src;
        var img = document.querySelector('[data-group-thumb="' + gid + '"]');
        if (img) img.src = src;
      });
    }, 500);
  }

  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function makePlan() {
    var here = shuffle(net.getStudents(code).filter(net.isOnline));
    if (here.length < 2) return null;
    var list = [];
    for (var i = 0; i < here.length; i += groupSize) {
      list.push(here.slice(i, i + groupSize).map(function (s) { return { id: s.id, name: s.name }; }));
    }
    /* Nobody works alone: a single leftover joins the last group */
    if (list.length > 1 && list[list.length - 1].length === 1) list[list.length - 2].push(list.pop()[0]);
    return list.map(function (members, k) { return { id: newId(), name: "Group " + (k + 1), members: members }; });
  }

  function membersText(g) {
    return g.members.map(function (m) { return m.name; }).join(" & ");
  }

  function showGroups() {
    var gs = room().groups;
    var live = gs && gs.active;
    groupsIdle.hidden = !!(live || plan || (gs && gs.last));
    groupsPlan.hidden = !plan || live;
    groupsLive.hidden = !live;
    groupsDone.hidden = !(gs && !gs.active && gs.last) || !!plan;

    if (plan && !live) {
      $("[data-groups-plan-list]").innerHTML = plan.map(function (g, gi) {
        return '<div class="group-card"><h4 class="group-card__name">' + esc(g.name) + "</h4><ul class=\"group-card__members\">" +
          g.members.map(function (m, mi) {
            return "<li><span>" + esc(m.name) + '</span><select class="paper-select group-move" data-move="' + gi + ":" + mi + '" aria-label="Move ' + esc(m.name) + '">' +
              plan.map(function (o, oi) { return '<option value="' + oi + '"' + (oi === gi ? " selected" : "") + ">" + esc(o.name) + "</option>"; }).join("") +
              '<option value="new">New group</option></select></li>';
          }).join("") + "</ul></div>";
      }).join("");
    }

    if (live) {
      var students = net.getStudents(code);
      var inGroup = {};
      gs.list.forEach(function (g) { g.members.forEach(function (m) { inGroup[m.id] = true; inGroup["n:" + P.norm(m.name)] = true; }); });
      var loose = students.filter(function (s) { return net.isOnline(s) && !inGroup[s.id] && !inGroup["n:" + P.norm(s.name)]; });
      $("[data-groups-live-list]").innerHTML = gs.list.map(function (g) {
        return '<div class="group-card group-card--live">' +
          '<button class="group-card__shot" type="button" data-group-open="' + g.id + '" aria-label="Open ' + esc(g.name) + '’s desk">' +
            '<img data-group-thumb="' + g.id + '" src="' + (thumbs[g.id] || "") + '" alt=""></button>' +
          '<h4 class="group-card__name">' + esc(g.name) + "</h4>" +
          '<p class="group-card__who">' + g.members.map(function (m) {
            var s = students.filter(function (x) { return x.id === m.id || P.norm(x.name) === P.norm(m.name); })[0];
            return '<span class="dot" data-status="' + (s && net.isOnline(s) ? "working" : "offline") + '"></span> ' + esc(m.name);
          }).join(" &nbsp; ") + "</p>" +
          '<button class="btn" type="button" data-group-open="' + g.id + '">👀 Open</button>' +
        "</div>";
      }).join("") + (loose.length ? '<div class="group-card group-card--loose"><h4 class="group-card__name">Not in a group yet</h4><ul class="group-card__members">' +
        loose.map(function (s) {
          return "<li><span>" + esc(s.name) + '</span><select class="paper-select" data-add-to="' + s.id + '" aria-label="Add ' + esc(s.name) + ' to a group">' +
            '<option value="">Add to…</option>' + gs.list.map(function (g, gi) { return '<option value="' + gi + '">' + esc(g.name) + "</option>"; }).join("") +
            "</select></li>";
        }).join("") + "</ul></div>" : "");
      gs.list.forEach(function (g) { if (!thumbs[g.id]) refreshThumb(g.id); });
    }

    if (gs && !gs.active && gs.last && !plan) {
      $("[data-groups-done-list]").innerHTML = gs.last.map(function (g) {
        return '<div class="group-card"><div class="group-card__shot"><img data-group-thumb="' + g.id + '" src="' + (thumbs[g.id] || "") + '" alt=""></div>' +
          '<h4 class="group-card__name">' + esc(g.name) + '</h4><p class="group-card__who">' + esc(membersText(g)) + "</p></div>";
      }).join("");
      gs.last.forEach(function (g) { if (!thumbs[g.id]) refreshThumb(g.id); });
    }
  }

  document.querySelectorAll("[data-group-size]").forEach(function (b) {
    b.addEventListener("click", function () {
      groupSize = +b.getAttribute("data-group-size");
      document.querySelectorAll("[data-group-size]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    });
  });

  $("[data-groups-make]").addEventListener("click", function () {
    plan = makePlan();
    if (!plan) return window.doodleToast("At least two students need to be here to make groups", "warn");
    showGroups();
  });
  $("[data-groups-shuffle]").addEventListener("click", function () { plan = makePlan() || plan; showGroups(); });
  $("[data-groups-cancel]").addEventListener("click", function () { plan = null; showGroups(); });

  $("[data-groups-plan-list]").addEventListener("change", function (e) {
    var sel = e.target.closest("[data-move]");
    if (!sel) return;
    var at = sel.getAttribute("data-move").split(":");
    var m = plan[+at[0]].members.splice(+at[1], 1)[0];
    if (sel.value === "new") plan.push({ id: newId(), name: "Group " + (plan.length + 1), members: [m] });
    else plan[+sel.value].members.push(m);
    plan = plan.filter(function (g) { return g.members.length; });
    plan.forEach(function (g, k) { g.name = "Group " + (k + 1); });
    showGroups();
  });

  function sendGroups(gs) {
    net.updateRoom(code, { groups: gs });
    net.send("groups", { code: code, groups: gs.active ? gs : { active: false } });
  }

  $("[data-groups-start]").addEventListener("click", function () {
    if (!plan || !plan.length) return;
    plan.forEach(function (g) { net.clearGroupItems(code, g.id); });
    var paper = paperSel.value || "lined";
    plan.forEach(function (g) { net.saveGroupItems(code, g.id, [{ type: "bg", name: paper, author: "board" }]); });
    thumbs = {};
    sendGroups({ active: true, list: plan, paper: paper, startedAt: Date.now() });
    plan = null;
    showGroups();
    window.doodleToast("👥 Partner desks are on!", "good");
  });

  $("[data-groups-live-list]").addEventListener("change", function (e) {
    var sel = e.target.closest("[data-add-to]");
    if (!sel || sel.value === "") return;
    var gs = room().groups;
    var s = net.getStudents(code).filter(function (x) { return x.id === sel.getAttribute("data-add-to"); })[0];
    if (!gs || !gs.active || !s) return;
    gs.list[+sel.value].members.push({ id: s.id, name: s.name });
    sendGroups(gs);
    showGroups();
  });

  $("[data-groups-end]").addEventListener("click", function () {
    var gs = room().groups;
    if (!gs || !gs.active) return;
    if (groupView.getAttribute("data-open") === "true") closeGroupView();
    sendGroups({ active: false, last: gs.list, paper: gs.paper, endedAt: Date.now() });
    $("[data-groups-drawer]").disabled = false;
    $("[data-groups-drawer]").textContent = "🗄️ Save to Doodle Drawer";
    showGroups();
  });

  $("[data-groups-new]").addEventListener("click", function () {
    var gs = room().groups;
    if (gs && gs.last) gs.last.forEach(function (g) { net.clearGroupItems(code, g.id); });
    net.updateRoom(code, { groups: null });
    thumbs = {};
    showGroups();
  });

  var groupKeep = $("[data-groups-keep]");
  if (window.DoodleDrawer) groupKeep.innerHTML = window.DoodleDrawer.keepSelectHTML("schoolyear");
  else $("[data-groups-drawer]").closest(".drawer-save").hidden = true;

  /* Saved like a snapshot: one picture per group */
  $("[data-groups-drawer]").addEventListener("click", function (e) {
    var gs = room().groups;
    var btn = e.currentTarget;
    if (!gs || !gs.last || !window.DoodleDrawer) return;
    btn.disabled = true;
    btn.textContent = "Saving…";
    var out = [];
    gs.last.reduce(function (p, g) {
      return p.then(function () {
        return drawThumb(g.id, 900).then(function (img) {
          out.push({ name: g.name + " — " + membersText(g), img: img, marks: net.groupItems(code, g.id).filter(function (i) { return i.type !== "bg"; }).length });
        });
      });
    }, Promise.resolve()).then(function () {
      return window.DoodleDrawer.save({
        kind: "snapshot",
        title: room().name + " — partner desks " + new Date(gs.endedAt || Date.now()).toLocaleDateString([], { month: "short", day: "numeric" }),
        keep: groupKeep.value,
        keepUntil: net.keepUntil(groupKeep.value),
        count: out.length,
        cover: out[0] ? out[0].img : "",
        data: { roomName: room().name, prompt: "Partner desks", at: gs.endedAt || Date.now(), students: out }
      });
    }).then(function (r) {
      btn.textContent = r && r.ok ? "✅ In your Doodle Drawer" : "🗄️ Save to Doodle Drawer";
      btn.disabled = !!(r && r.ok);
      if (!r || !r.ok) window.doodleToast((r && r.error) || "Couldn't save just now", "warn");
    });
  });

  /* Opening one group's desk: the teacher can draw on it too */
  var groupView = $("[data-group-view]");
  var viewBoard = null;
  var viewUI = null;
  var viewGid = null;
  var viewTracker = Act.deskTracker();

  function openGroupView(gid) {
    var gs = room().groups;
    var g = gs && gs.active && gs.list.filter(function (x) { return x.id === gid; })[0];
    if (!g) return;
    viewGid = gid;
    $("[data-group-view-title]").textContent = "👥 " + g.name + " — " + membersText(g);
    if (viewBoard) viewBoard.destroy();
    if (viewUI) viewUI.destroy();
    viewBoard = window.DoodleBoard(document.getElementById("group-board"), {
      author: "teacher",
      onStrokeEnd: function () {
        if (!viewGid) return;
        var ops = viewTracker.diff(viewBoard.getItems());
        if (!ops.length) return;
        net.saveGroupItems(code, viewGid, net.applyOps(net.groupItems(code, viewGid), ops));
        net.send("group-op", { code: code, group: viewGid, from: "teacher", ops: ops });
        refreshThumb(viewGid);
      }
    });
    viewUI = window.DoodleBoardUI(viewBoard, groupView.querySelector(".focus__panel"), { filename: g.name + "-desk" });
    viewBoard.setColour("#ff4d9d").setSize(6).setTool("pen");
    var items = net.groupItems(code, gid);
    viewBoard.setItems(items);
    viewTracker.reset(items);
    groupView.setAttribute("data-open", "true");
    document.body.style.overflow = "hidden";
  }

  function closeGroupView() {
    groupView.setAttribute("data-open", "false");
    document.body.style.overflow = "";
    viewGid = null;
    if (viewBoard) { viewBoard.destroy(); viewBoard = null; }
    if (viewUI) { viewUI.destroy(); viewUI = null; }
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-group-open]");
    if (b) openGroupView(b.getAttribute("data-group-open"));
  });
  $("[data-group-view-close]").addEventListener("click", closeGroupView);
  groupView.addEventListener("click", function (e) { if (e.target === groupView) closeGroupView(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && groupView.getAttribute("data-open") === "true") closeGroupView();
  });

  /* A member drew something (realtime.js has already stored it) */
  net.on("group-op-up", function (p) {
    if (p.code !== code) return;
    refreshThumb(p.group);
    if (viewBoard && viewGid === p.group) {
      var items = net.groupItems(code, viewGid);
      viewBoard.setItems(items);
      viewTracker.reset(items);
    }
  });

  showGroups();

  /* Keep counts fresh as students come and go */
  setInterval(function () {
    showPickMeta();
    showStars();
    if (room().poll) showPoll();
    if ((room().groups || {}).active) showGroups();
  }, 6000);
  ["join", "leave"].forEach(function (t) {
    net.on(t, function (p) { if (p.code === code) { showPickMeta(); showStars(); if ((room().groups || {}).active) showGroups(); } });
  });
  showPickMeta();
})();
