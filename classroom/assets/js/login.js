/* ==========================================================================
   Doodle Desk — log in & join-a-room (login.html)
   Teachers land on their dashboard; students go straight to a board.
   There is no auth server yet, so the teacher form accepts any valid-looking
   email and remembers the name locally — see README.md.
   ========================================================================== */
(function () {
  "use strict";

  var net = window.DoodleNet;

  function setError(input, message) {
    var field = input.closest(".field");
    var slot = field.querySelector(".err");
    field.classList.toggle("field--error", Boolean(message));
    if (slot) slot.textContent = message || "";
    input.setAttribute("aria-invalid", message ? "true" : "false");
    return !message;
  }

  /* Turn "a.okafor@school.edu" into "A. Okafor" for the greeting */
  function nameFromEmail(email) {
    return email.split("@")[0]
      .replace(/[._-]+/g, " ")
      .trim()
      .split(/\s+/)
      .map(function (part) {
        var word = part.charAt(0).toUpperCase() + part.slice(1);
        return word.length === 1 ? word + "." : word;
      })
      .join(" ")
      .slice(0, 40);
  }

  /* ---- Teacher login ---------------------------------------------------- */
  var login = document.getElementById("login-form");
  if (login) {
    login.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = login.elements.email;
      var pass = login.elements.password;

      var ok = setError(email, /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())
        ? "" : "Please enter a valid email address.");
      ok = setError(pass, pass.value.length ? "" : "Please enter your password.") && ok;
      if (!ok) return;

      if (net) net.setTeacher(nameFromEmail(email.value.trim()));

      var note = document.querySelector("[data-login-note]");
      if (note) {
        note.hidden = false;
        note.textContent = "Opening your rooms…";
      }
      window.location.href = "dashboard.html";
    });
  }

  /* ---- Student join ----------------------------------------------------- */
  var join = document.getElementById("join-form");
  if (join) {
    var code = join.elements.code;

    code.addEventListener("input", function () {
      /* Codes look like SUN-42B — uppercase as they type */
      code.value = code.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 8);
    });

    join.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = join.elements.nickname;

      var ok = setError(code, code.value.trim().length >= 5 ? "" : "Room codes look like SUN-42B.");
      ok = setError(name, name.value.trim().length >= 2 ? "" : "Pop your first name in.") && ok;
      if (!ok) return;

      var go = function () {
        window.location.href = "board.html?code=" + encodeURIComponent(code.value.trim()) +
          "&name=" + encodeURIComponent(name.value.trim());
      };
      if (!net) return go();

      var submit = join.querySelector('[type="submit"]');
      var label = submit.textContent;
      submit.disabled = true;
      submit.textContent = "Looking for your room…";

      net.fetchRoom(code.value.trim()).then(function (room) {
        submit.disabled = false;
        submit.textContent = label;
        if (!room) {
          return setError(code, net.mode() === "remote"
            ? "We can't find that room. Is your teacher's room open? Check the code on the board."
            : "We can't find a room with that code. Check the board?");
        }
        go();
      });
    });
  }
})();
