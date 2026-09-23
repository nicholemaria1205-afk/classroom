/* ==========================================================================
   Doodle Desk — the public demo board (demo.html)
   A thin wrapper over the shared engine: same board the students get, minus
   the room. Nothing leaves the browser.
   ========================================================================== */
(function () {
  "use strict";

  var canvas = document.getElementById("board");
  if (!canvas || !window.DoodleBoard) return;

  var ui;
  var board = window.DoodleBoard(canvas, {
    author: "demo",
    onStrokeEnd: function () { if (ui) ui.refresh(); }
  });

  ui = window.DoodleBoardUI(board, document, { filename: "my-doodle-desk-board" });
  board.setTool("pen");

  /* The little "teacher sees everyone" panel further down the page */
  var mini = document.querySelector("[data-mini-boards]");
  if (mini) {
    var names = ["Ava", "Ben", "Chloe", "Dev", "Esi", "Finn", "Gita", "Hugo"];
    var doodles = ["3x4=12", "H₂O", "🌋", "¾", "🐉", "y=mx+b", "🎻", "Σ"];
    mini.innerHTML = names.map(function (n, i) {
      return '<div class="board' + (i === 0 ? " board--live" : "") + '" data-name="' + n + '">' +
        "<span>" + doodles[i] + "</span></div>";
    }).join("");
  }
})();
