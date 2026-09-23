/* ==========================================================================
   Doodle Desk — subscribe / checkout
   Builds the plan picker, keeps the order summary in sync, validates the
   form, then either hands off to a real checkout endpoint or (when none is
   configured) shows the demo confirmation.
   ========================================================================== */
(function () {
  "use strict";

  var cfg = window.DOODLE;
  var form = document.getElementById("subscribe-form");
  if (!cfg || !form) return;

  var picker = document.querySelector("[data-plan-pick]");
  var seatsField = document.querySelector("[data-seats-field]");
  var seatsInput = document.getElementById("seats");
  var success = document.querySelector("[data-success]");
  var submitBtn = form.querySelector("[type=submit]");
  var formPanel = document.querySelector("[data-form-panel]");

  var params = new URLSearchParams(window.location.search);
  var billing = params.get("billing") === "monthly" ? "monthly" : "annual";
  var chosenId = params.get("plan") || "pro";

  function planById(id) {
    return cfg.PLANS.filter(function (p) { return p.id === id; })[0] || cfg.PLANS[1];
  }

  function money(n) {
    return cfg.CURRENCY + (Math.round(n * 100) / 100).toFixed(2);
  }

  function unitPrice(plan) {
    return billing === "annual" ? plan.annual : plan.monthly;
  }

  function seats(plan) {
    if (!plan.perSeat) return 1;
    var n = parseInt(seatsInput && seatsInput.value, 10);
    if (isNaN(n) || n < plan.minSeats) n = plan.minSeats;
    return n;
  }

  function currentPlan() {
    var checked = form.querySelector("input[name=plan]:checked");
    return planById(checked ? checked.value : chosenId);
  }

  /* ---- Plan picker ------------------------------------------------------ */
  function buildPicker() {
    picker.innerHTML = cfg.PLANS.map(function (plan) {
      var price = plan.monthly === 0
        ? "Free"
        : cfg.CURRENCY + unitPrice(plan) + "/mo" + (plan.perSeat ? " / teacher" : "");
      return (
        "<label>" +
        '<input type="radio" name="plan" value="' + plan.id + '"' +
          (plan.id === chosenId ? " checked" : "") + ">" +
        '<span><span class="pp__name">' + plan.emoji + " " + plan.name + "</span>" +
        '<br><small class="muted">' + plan.blurb + "</small></span>" +
        '<span class="pp__price">' + price + "</span>" +
        "</label>"
      );
    }).join("");
  }

  /* ---- Order summary ---------------------------------------------------- */
  function renderSummary() {
    var plan = currentPlan();
    var qty = seats(plan);
    var unit = unitPrice(plan);
    var months = billing === "annual" ? 12 : 1;
    var subtotal = unit * qty * months;
    var free = plan.monthly === 0;

    if (seatsField) seatsField.hidden = !plan.perSeat;
    if (seatsInput && plan.perSeat) seatsInput.min = plan.minSeats;

    var rows = [
      ["Plan", plan.emoji + " " + plan.name],
      ["Billing", free ? "—" : billing === "annual" ? "Yearly" : "Monthly"]
    ];
    if (plan.perSeat) rows.push(["Teacher seats", String(qty)]);
    if (!free) {
      rows.push([
        billing === "annual" ? "Price" : "Monthly price",
        money(unit) + (plan.perSeat ? " × " + qty : "") + (billing === "annual" ? " × 12 months" : "")
      ]);
      rows.push(["Free trial", cfg.TRIAL_DAYS + " days"]);
    }

    var html = rows.map(function (r) {
      return '<div class="summary__row"><span>' + r[0] + "</span><span>" + r[1] + "</span></div>";
    }).join("");

    /* Nothing is ever taken up front — free plan or trial, today costs zero. */
    html += '<div class="summary__row summary__row--total"><span>Due today</span><span>' +
      cfg.CURRENCY + "0.00</span></div>";

    html += '<p class="small muted" style="margin-top:.8rem">' +
      (free
        ? "No card required. Upgrade whenever you like."
        : "Nothing is charged today. After your " + cfg.TRIAL_DAYS + "-day trial you'll pay " +
          money(subtotal) + (billing === "annual" ? " per year" : " per month") +
          ". Cancel any time from your dashboard.") +
      "</p>";

    document.querySelector("[data-summary]").innerHTML = html;

    /* Card details are pointless on the free plan — hide them. */
    var cardBlock = document.querySelector("[data-card-block]");
    if (cardBlock) cardBlock.hidden = free;
    if (submitBtn) submitBtn.textContent = free ? "Create my free account" : "Start my free trial";
  }

  /* ---- Validation ------------------------------------------------------- */
  function setError(input, message) {
    var field = input.closest(".field");
    var slot = field.querySelector(".err");
    field.classList.toggle("field--error", Boolean(message));
    if (slot) slot.textContent = message || "";
    input.setAttribute("aria-invalid", message ? "true" : "false");
    return !message;
  }

  function validate() {
    var ok = true;
    var free = currentPlan().monthly === 0;

    var name = form.elements.fullname;
    ok = setError(name, name.value.trim().length < 2 ? "Please tell us your name." : "") && ok;

    var email = form.elements.email;
    var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim());
    ok = setError(email, emailOk ? "" : "Please enter a valid email address.") && ok;

    var pass = form.elements.password;
    ok = setError(pass, pass.value.length < 8 ? "Use at least 8 characters." : "") && ok;

    if (!free) {
      var card = form.elements.card;
      var digits = card.value.replace(/\D/g, "");
      ok = setError(card, digits.length >= 13 && digits.length <= 19 ? "" : "Enter a valid card number.") && ok;

      var exp = form.elements.exp;
      ok = setError(exp, /^(0[1-9]|1[0-2])\s*\/\s*\d{2}$/.test(exp.value.trim()) ? "" : "Use MM/YY.") && ok;

      var cvc = form.elements.cvc;
      ok = setError(cvc, /^\d{3,4}$/.test(cvc.value.trim()) ? "" : "3 or 4 digits.") && ok;
    }

    var terms = form.elements.terms;
    var termsField = terms.closest(".field") || terms.parentElement;
    termsField.classList.toggle("field--error", !terms.checked);
    if (!terms.checked) ok = false;

    return ok;
  }

  /* Light formatting help so the card fields feel real */
  var cardInput = form.elements.card;
  if (cardInput) {
    cardInput.addEventListener("input", function () {
      var digits = cardInput.value.replace(/\D/g, "").slice(0, 19);
      cardInput.value = digits.replace(/(.{4})/g, "$1 ").trim();
    });
  }
  var expInput = form.elements.exp;
  if (expInput) {
    expInput.addEventListener("input", function () {
      var d = expInput.value.replace(/\D/g, "").slice(0, 4);
      expInput.value = d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d;
    });
  }

  /* ---- Submit ----------------------------------------------------------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validate()) {
      var firstBad = form.querySelector(".field--error input");
      if (firstBad) firstBad.focus();
      return;
    }

    var plan = currentPlan();
    var payload = {
      planId: plan.id,
      billing: billing,
      seats: seats(plan),
      name: form.elements.fullname.value.trim(),
      email: form.elements.email.value.trim(),
      school: form.elements.school.value.trim()
    };

    if (cfg.CHECKOUT_ENDPOINT) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Taking you to checkout…";
      fetch(cfg.CHECKOUT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && data.url) {
            window.location.href = data.url;
          } else {
            throw new Error("No checkout URL returned");
          }
        })
        .catch(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = "Try again";
          var box = document.querySelector("[data-checkout-error]");
          if (box) {
            box.hidden = false;
            box.textContent = "We couldn't reach the checkout service. Please try again in a moment.";
          }
        });
      return;
    }

    /* Demo mode — no payment provider wired up yet. */
    showSuccess(payload, plan);
  });

  function showSuccess(payload, plan) {
    if (formPanel) formPanel.hidden = true;
    var summaryPanel = document.querySelector("[data-summary-panel]");
    if (summaryPanel) summaryPanel.hidden = true;

    success.setAttribute("data-show", "true");
    success.querySelector("[data-success-name]").textContent = payload.name.split(" ")[0];
    success.querySelector("[data-success-plan]").textContent = plan.emoji + " " + plan.name;
    success.querySelector("[data-success-email]").textContent = payload.email;
    success.scrollIntoView({ behavior: "smooth", block: "center" });
    window.doodleConfetti(120);
  }

  /* ---- Wire it up ------------------------------------------------------- */
  buildPicker();
  renderSummary();

  form.addEventListener("change", function (e) {
    if (e.target.name === "plan" || e.target.id === "seats") renderSummary();
  });
  if (seatsInput) seatsInput.addEventListener("input", renderSummary);

  document.querySelectorAll("[data-set-billing]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      billing = btn.getAttribute("data-set-billing");
      document.querySelectorAll("[data-set-billing]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === btn));
      });
      buildPicker();
      renderSummary();
    });
  });

  document.querySelectorAll("[data-set-billing]").forEach(function (b) {
    b.setAttribute("aria-pressed", String(b.getAttribute("data-set-billing") === billing));
  });
})();
