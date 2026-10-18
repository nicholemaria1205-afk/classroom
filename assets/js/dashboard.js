/* ==========================================================================
   Doodle Desk — teacher dashboard (dashboard.html)
   Lists the teacher's rooms and opens new ones.
   ========================================================================== */
(function () {
  "use strict";

  var net = window.DoodleNet;
  var list = document.querySelector("[data-room-list]");
  if (!net || !list) return;

  /* No account, no rooms — this page needs a signed-in teacher */
  var who = net.teacher();
  if (!who) {
    window.location.href = "login.html";
    return;
  }

  var form = document.getElementById("new-room-form");

  var greet = document.querySelector("[data-greet-name]");
  if (greet && who.name) greet.textContent = ", " + who.name;

  var badge = document.querySelector("[data-teacher-badge]");
  if (badge) {
    badge.hidden = false;
    badge.textContent = "👩‍🏫 " + who.name;
  }

  var logOut = document.querySelector("[data-log-out]");
  if (logOut) {
    logOut.addEventListener("click", function () {
      net.logout();
      window.location.href = "login.html";
    });
  }

  function escape(text) {
    return String(text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function ago(ts) {
    var mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? " hour ago" : " hours ago");
    return Math.round(hrs / 24) + " days ago";
  }

  function render() {
    var rooms = net.listRooms();

    if (!rooms.length) {
      list.innerHTML =
        '<div class="empty"><span>🪑</span>' +
        "<p><strong>No rooms yet.</strong><br>Open one and the code appears on screen for the class to type in.</p></div>";
      return;
    }

    list.innerHTML = '<div class="grid grid--2">' + rooms.map(function (room) {
      var students = Object.keys(room.students).map(function (id) { return room.students[id]; });
      var online = students.filter(net.isOnline).length;
      var stuck = students.filter(function (s) { return s.status === "stuck" && net.isOnline(s); }).length;

      return '<article class="card">' +
        '<div style="display:flex;align-items:flex-start;gap:.8rem">' +
          "<div>" +
            '<h3 style="margin-bottom:.15rem">' + escape(room.name) + "</h3>" +
            '<p class="small muted mb-0">' + escape(room.subject) + " · opened " + ago(room.createdAt) + "</p>" +
          "</div>" +
          '<span class="badge badge--sky" style="margin-left:auto;white-space:nowrap">' + room.code + "</span>" +
        "</div>" +
        (room.prompt ? '<p class="small" style="margin-top:.8rem"><strong>Task:</strong> ' + escape(room.prompt) + "</p>" : "") +
        '<p class="small muted" style="margin-top:.8rem">' +
          "🗓️ " + escape(net.keepLabel(room.keepUntil)) + " · " +
          "👥 " + online + " online · " + students.length + " joined" +
          (stuck ? ' · <strong style="color:var(--coral)">' + stuck + " stuck</strong>" : "") +
        "</p>" +
        '<div style="display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem">' +
          '<a class="btn btn--primary" href="room.html?code=' + room.code + '">Open room</a>' +
          '<button class="btn" type="button" data-copy="' + room.code + '">Copy join link</button>' +
          '<button class="btn" type="button" data-close-room="' + room.code + '">Close</button>' +
        "</div>" +
        "</article>";
    }).join("") + "</div>";
  }

  /* ---- New room --------------------------------------------------------- */
  document.querySelector("[data-new-room]").addEventListener("click", function () {
    form.hidden = !form.hidden;
    if (!form.hidden) form.elements.name.focus();
  });

  document.querySelector("[data-cancel-room]").addEventListener("click", function () {
    form.hidden = true;
    form.reset();
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var name = form.elements.name;
    var field = name.closest(".field");
    if (name.value.trim().length < 2) {
      field.classList.add("field--error");
      field.querySelector(".err").textContent = "Give the room a name your class will recognise.";
      name.focus();
      return;
    }
    field.classList.remove("field--error");
    field.querySelector(".err").textContent = "";

    var room = net.createRoom({
      name: name.value.trim(),
      subject: form.elements.subject.value,
      prompt: form.elements.prompt.value.trim(),
      keep: form.elements.keep.value,
      teacher: who.name
    });

    window.location.href = "room.html?code=" + room.code;
  });

  /* ---- Row actions ------------------------------------------------------ */
  list.addEventListener("click", function (e) {
    var copy = e.target.closest("[data-copy]");
    if (copy) {
      var url = net.joinUrl(copy.getAttribute("data-copy"));
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () {
          window.doodleToast("Join link copied 📋");
        }, function () {
          window.prompt("Copy this link for your class:", url);
        });
      } else {
        window.prompt("Copy this link for your class:", url);
      }
      return;
    }

    var close = e.target.closest("[data-close-room]");
    if (close) {
      var code = close.getAttribute("data-close-room");
      if (window.confirm("Close room " + code + "? Everyone in it is sent back, and the desks go with it.")) {
        net.deleteRoom(code);
        render();
        window.doodleToast("Room " + code + " closed", "warn");
      }
    }
  });

  /* ---- Tidy rooms past their keep-until date ----------------------------- */
  var tidied = net.tidyRooms();
  if (tidied.length) {
    window.doodleToast(tidied.length === 1
      ? "“" + tidied[0].name + "” reached its keep-until date and was closed 🗓️"
      : tidied.length + " rooms reached their keep-until date and were closed 🗓️", "warn");
  }

  /* ---- Keep counts live ------------------------------------------------- */
  /* Answer students joining from other devices, even from this page */
  net.host();

  ["join", "leave", "presence", "status"].forEach(function (type) {
    net.on(type, render);
  });
  setInterval(render, 8000);

  render();
})();
