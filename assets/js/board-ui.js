/* ==========================================================================
   Doodle Desk — board toolbar wiring
   Connects the standard toolbar markup to a DoodleBoard instance. Every page
   with a board uses the same data- attributes, so the toolbar behaves
   identically in the demo, the student board and the teacher's focus view.

     DoodleBoardUI(board, rootEl, { onChange: fn });

   Markup hooks: [data-tool] [data-colour] [data-size] [data-stamp]
                 [data-undo] [data-redo] [data-clear] [data-save] [data-print]
                 [data-background] (a <select>) [data-item-count]
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

  function refreshRedo() {
    all("[data-redo]").forEach(function (el) {
      el.disabled = !board.canRedo();
    });
  }

  function changed() {
    refreshCount();
    refreshRedo();
    refreshBackground();
    if (opts.onChange) opts.onChange();
  }

  /* Paper / template picker */
  function refreshBackground() {
    all("[data-background]").forEach(function (sel) {
      if (sel.value !== board.getBackground()) sel.value = board.getBackground();
    });
  }

  all("[data-background]").forEach(function (sel) {
    if (!sel.options.length && window.DoodleTemplates) {
      sel.innerHTML = window.DoodleTemplates.optionsHTML(board.getBackground());
    }
    sel.addEventListener("change", function () {
      board.setBackground(sel.value);
      changed();
    });
  });

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

  all("[data-redo]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      board.redo();
      changed();
    });
  });

  all("[data-clear]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!board.isEmpty() && opts.confirmClear !== false &&
          !window.confirm("Clear everything you've drawn? You can't undo this.")) return;
      board.clear();
      changed();
    });
  });

  all("[data-print]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (window.doodlePrint) window.doodlePrint([{ src: board.toPNG(), caption: opts.printTitle || "" }], opts.printTitle);
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
  function onKey(e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    var key = e.key.toLowerCase();
    var tag = (document.activeElement || {}).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (key === "y" || (key === "z" && e.shiftKey)) {
      e.preventDefault();
      board.redo();
      changed();
    } else if (key === "z") {
      e.preventDefault();
      board.undo();
      changed();
    }
  }
  document.addEventListener("keydown", onKey);

  refreshCount();
  refreshRedo();

  return {
    refresh: function () { refreshCount(); refreshRedo(); refreshBackground(); },
    changed: changed,
    destroy: function () { document.removeEventListener("keydown", onKey); }
  };
};
