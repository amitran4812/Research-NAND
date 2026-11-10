/* Device Hub motion: scroll reveals, card tilt, header glow + sliding menu underline, counting numbers.
   Runs after app.js and only enhances what it renders. Everything is skipped when the visitor
   has asked their device to reduce motion. */
(function () {
  "use strict";
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var app = document.getElementById("app");
  var nav = document.getElementById("nav");

  // ---------------------------------------------------------------- sliding menu underline (works with reduced motion too)
  var bar = document.createElement("span");
  bar.className = "nav-indicator";
  bar.setAttribute("aria-hidden", "true");
  nav.appendChild(bar);
  root.classList.add("has-indicator");
  function moveIndicator() {
    var a = nav.querySelector("a.active");
    if (!a) { bar.style.opacity = "0"; return; }
    bar.style.opacity = "1";
    bar.style.width = a.offsetWidth - 24 + "px";
    bar.style.transform = "translateX(" + (a.offsetLeft + 12) + "px)";
  }
  window.addEventListener("resize", moveIndicator);
  window.addEventListener("hashchange", function () { setTimeout(moveIndicator, 0); });

  if (reduce) {
    new MutationObserver(moveIndicator).observe(app, { childList: true });
    return;
  }
  root.classList.add("motion");

  // ---------------------------------------------------------------- scroll reveal
  // A re-render on the same page within a moment (typing in search, a filter chip) shows instantly.
  var lastHash = location.hash, lastRender = 0;
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      show(e.target, 0);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }) : null;

  function show(el, delay) {
    setTimeout(function () {
      el.classList.add("in");
      setTimeout(function () { el.classList.remove("reveal", "in"); }, 750);
    }, delay);
  }
  function reveal() {
    var now = Date.now();
    var quick = location.hash === lastHash && now - lastRender < 1500;
    lastHash = location.hash; lastRender = now;
    if (quick || !io) return;
    var els = app.querySelectorAll(".page-head, .section-title, .card, .controls, .notice");
    var vh = window.innerHeight, n = 0;
    Array.prototype.forEach.call(els, function (el) {
      if (el.closest(".bell-panel")) return;
      el.classList.add("reveal");
      var r = el.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) show(el, Math.min(n++, 10) * 60); // on screen now: stagger in
      else io.observe(el);
    });
  }

  // ---------------------------------------------------------------- card tilt + light that follows the mouse
  if (finePointer) {
    var current = null;
    app.addEventListener("pointermove", function (e) {
      var card = e.target.closest && e.target.closest(".card.hover");
      if (current && current !== card) reset(current);
      current = card;
      if (!card) return;
      var r = card.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.style.setProperty("--ry", ((x - 0.5) * 5).toFixed(2) + "deg");
      card.style.setProperty("--rx", ((0.5 - y) * 5).toFixed(2) + "deg");
      card.style.setProperty("--mx", (x * 100).toFixed(1) + "%");
      card.style.setProperty("--my", (y * 100).toFixed(1) + "%");
    });
    app.addEventListener("pointerleave", function () { if (current) reset(current); current = null; });
  }
  function reset(card) {
    card.style.removeProperty("--rx"); card.style.removeProperty("--ry");
  }

  // ---------------------------------------------------------------- counting numbers
  var counted = typeof WeakSet === "function" ? new WeakSet() : null;
  var seenCat = false;
  var NUM = /^([^\d]*?)(\d[\d,]*(?:\.\d+)?)([\s\S]*)$/;
  function countUp(el) {
    if (!counted || counted.has(el)) return;
    counted.add(el);
    var m = NUM.exec(el.textContent);
    if (!m) return;
    var raw = m[2], target = parseFloat(raw.replace(/,/g, ""));
    if (!isFinite(target) || target === 0) return;
    var dec = (raw.split(".")[1] || "").length, comma = raw.indexOf(",") !== -1;
    var start = performance.now(), dur = 900 + Math.min(600, target);
    function fmt(v) {
      return comma ? v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec);
    }
    function step(t) {
      var p = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = m[1] + fmt(target * e) + m[3];
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function countAll(scope, sel) { Array.prototype.forEach.call(scope.querySelectorAll(sel), countUp); }
  function countPage() {
    countAll(app, "table.market td.num.up, table.market td.num.down, .week-group .section-title > .small, .journal .hit, .chip .count, .mkt-stat .big");
  }
  function countChrome() {
    var cat = document.getElementById("catbar");
    if (!seenCat && cat && cat.querySelector(".count")) { seenCat = true; countAll(cat, ".chip .count"); }
    countAll(document.getElementById("ticker"), ".ticker-item .chg");
    var badge = document.getElementById("bell-badge");
    if (badge && !badge.hidden) { countUp(badge); document.getElementById("bell").classList.add("ring"); }
  }

  // the bell panel is rebuilt each time it opens: count its totals up
  var panel = document.getElementById("bell-panel");
  if (panel) new MutationObserver(function () {
    if (!panel.hidden) countAll(panel, ".bell-sum a");
  }).observe(panel, { childList: true });

  // ---------------------------------------------------------------- run after every page render
  var pending = false;
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      var quick = location.hash === lastHash && Date.now() - lastRender < 1500;
      reveal();
      if (!quick) countPage();
      countChrome();
      moveIndicator();
    });
  }).observe(app, { childList: true });
})();
