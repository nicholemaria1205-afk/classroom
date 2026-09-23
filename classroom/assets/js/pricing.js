/* ==========================================================================
   Doodle Desk — plan cards
   Renders the plan grid from window.DOODLE.PLANS and handles the
   monthly / annual switch. Used on index.html and pricing.html.
   ========================================================================== */
(function () {
  "use strict";

  var cfg = window.DOODLE;
  var grid = document.querySelector("[data-plans]");
  if (!cfg || !grid) return;

  var billing = "annual"; /* annual is the default — it shows the saving */

  function money(value) {
    return cfg.CURRENCY + value;
  }

  function priceFor(plan) {
    return billing === "annual" ? plan.annual : plan.monthly;
  }

  function subLine(plan) {
    if (plan.monthly === 0) return "Free forever, no card needed";
    if (plan.perSeat) {
      return billing === "annual"
        ? "per teacher, billed yearly (min. " + plan.minSeats + ")"
        : "per teacher, billed monthly (min. " + plan.minSeats + ")";
    }
    if (billing === "annual") {
      return "billed yearly as " + money(plan.annual * 12) + " — save " + money((plan.monthly - plan.annual) * 12) + "/yr";
    }
    return "billed monthly, cancel any time";
  }

  function planCard(plan) {
    var card = document.createElement("article");
    card.className = "card card--lift plan reveal" + (plan.featured ? " plan--featured" : "");

    var flag = plan.featured
      ? '<span class="badge badge--pink plan__flag">★ Most loved</span>'
      : "";

    var features = plan.features.map(function (f) {
      return "<li>" + f + "</li>";
    }).join("");

    var missing = (plan.missing || []).map(function (f) {
      return '<li data-no><span class="muted">' + f + "</span></li>";
    }).join("");

    var priceBlock = plan.monthly === 0
      ? '<div class="plan__price"><span class="plan__amount">Free</span></div>'
      : '<div class="plan__price"><span class="plan__amount" data-amount>' + money(priceFor(plan)) +
        '</span><span class="plan__per">/ month' + (plan.perSeat ? " / teacher" : "") + "</span></div>";

    var href = "subscribe.html?plan=" + plan.id + "&billing=" + billing;

    card.innerHTML =
      flag +
      '<div class="card__icon" style="background:' + plan.colour + '">' + plan.emoji + "</div>" +
      '<h3 class="plan__name">' + plan.name + "</h3>" +
      '<p class="plan__blurb">' + plan.blurb + "</p>" +
      priceBlock +
      '<p class="plan__sub" data-sub>' + subLine(plan) + "</p>" +
      '<ul class="plan__list">' + features + missing + "</ul>" +
      '<a class="btn ' + (plan.featured ? "btn--primary" : "btn--sun") + ' btn--block" data-cta href="' +
        href + '">' + plan.cta + "</a>";

    return card;
  }

  function render() {
    grid.innerHTML = "";
    cfg.PLANS.forEach(function (plan) {
      grid.appendChild(planCard(plan));
    });
    /* Newly created cards need to be revealed — site.js already ran. */
    grid.querySelectorAll(".reveal").forEach(function (el) {
      el.setAttribute("data-seen", "true");
    });
  }

  document.querySelectorAll("[data-billing]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      billing = btn.getAttribute("data-billing");
      document.querySelectorAll("[data-billing]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === btn));
      });
      render();
    });
  });

  render();
})();
