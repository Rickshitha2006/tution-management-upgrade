/* Smart Academy System — public website behaviour (mobile menu, smart buttons, reveal). */
(function () {
  var nav = document.getElementById("siteNav");
  var btn = document.getElementById("menuBtn");
  if (btn && nav) {
    btn.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.querySelectorAll(".nav-links a").forEach(function (a) {
      a.addEventListener("click", function () { nav.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); });
    });
  }

  // If the visitor is already signed in, send "Log in / Start free" straight to the dashboard.
  var signedIn = false;
  try { signedIn = !!localStorage.getItem("tm_auth_token"); } catch (e) {}
  if (signedIn) {
    document.querySelectorAll("[data-auth-link]").forEach(function (el) {
      el.setAttribute("href", "dashboard.html");
      if (el.dataset.authLabel) el.textContent = el.dataset.authLabel;
    });
  }

  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  // Gentle reveal on scroll (content stays visible if JS or IntersectionObserver is unavailable).
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var els = document.querySelectorAll(".feature, .step, .sec-card, .mock, .price, .faq details, .sec-head");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    els.forEach(function (el) { el.classList.add("reveal"); io.observe(el); });
  }
})();
