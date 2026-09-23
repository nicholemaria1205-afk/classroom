/* ==========================================================================
   Doodle Desk — board toolbar wiring
   Connects the standard toolbar markup to a DoodleBoard instance. Every page
   with a board uses the same data- attributes, so the toolbar behaves
   identically in the demo, the student board and the teacher's focus view.

     DoodleBoardUI(board, rootEl, { onChange: fn });

   Markup hooks: [data-tool] [data-colour] [data-size] [data-stamp]
                 [data-undo] [data-clear] [data-save] [data-item-count]
   ========================================================================== */
window.DoodleBoardUI = function (board, root, options) {
  "use strict";

  var scope = root || document;
  var opts = options || {};

  function all(sel) {
    return Array.prototype.slice.call(scope.querySelectorAll(sel));
  }

  function press(sel, active) {
    all(sel).forEach(function (el) {
      el.setAttribute("aria-pressed", String(el === active));
    });
  }

  function refreshCount() {
    all("[data-item-count]").forEach(function (el) {
      el.textContent = board.count();
    });
  }

  function changed() {
    refreshCount();
    if (opts.onChange) opts.onChange();
  }

  all("[data-tool]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      board.setTool(btn.getAttribute("data-tool"));
      press("[data-tool]", btn);
      press("[data-stamp]", null);
    });
  });

  all("[data-colour]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      board.setColour(btn.getAttribute("data-colour"));
      press("[data-colour]", btn);
      /* Picking a colour means you want to draw, not erase or stamp */
      if (board.getTool() === "erase" || board.getTool() === "stamp") {
        board.setTool("pen");
        press("[data-tool]", scope.querySelector('[data-tool="pen"]'));
        press("[data-stamp]", null);
      }
    });
  });

  all("[data-size]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      board.setSize(parseInt(btn.getAttribute("data-size"), 10));
      press("[data-size]", btn);
    });
  });

  all("[data-stamp]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      board.setStamp(btn.getAttribute("data-stamp"));
      press("[data-stamp]", btn);
      press("[data-tool]", null);
    });
  });

  all("[data-undo]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      board.undo();
      changed();
    });
  });

  all("[data-clear]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      board.clear();
      changed();
    });
  });

  all("[data-save]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var link = document.createElement("a");
      link.download = (opts.filename || "my-doodle-desk-board") + ".png";
      link.href = board.toPNG();
      link.click();
    });
  });

  /* Muscle memory is universal */
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      var tag = (document.activeElement || {}).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      board.undo();
      changed();
    }
  });

  refreshCount();

  return { refresh: changed };
};
