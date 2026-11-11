// The one script of the site. It keeps the clock of a running trace ticking, brings in new
// steps as they are found, copies the citation, and shows that a form is working.
// Every page reads without it: a running trace then reloads itself every few seconds.
(function () {
  function plain(seconds) {
    var s = Math.max(0, Math.round(seconds));
    return s < 60 ? s + " s" : Math.floor(s / 60) + " min " + (s % 60) + " s";
  }

  function clocks() {
    var all = document.querySelectorAll("[data-since]");
    for (var i = 0; i < all.length; i++) {
      var since = Date.parse(all[i].getAttribute("data-since"));
      if (!isNaN(since)) all[i].textContent = plain((Date.now() - since) / 1000);
    }
  }

  function refresh() {
    var el = document.getElementById("trail");
    if (!el || el.getAttribute("data-running") !== "true") return;
    fetch("/api/traces/" + encodeURIComponent(el.getAttribute("data-id")) + "/fragment")
      .then(function (res) {
        return res.ok ? res.text() : null;
      })
      .then(function (html) {
        if (!html) return;
        var box = document.createElement("div");
        box.innerHTML = html;
        if (box.firstElementChild) {
          el.replaceWith(box.firstElementChild);
          clocks();
        }
      })
      .catch(function () {})
      .then(function () {
        setTimeout(refresh, 3000);
      });
  }

  document.addEventListener("click", function (event) {
    var button = event.target.closest ? event.target.closest("[data-copy]") : null;
    if (!button) return;
    var source = document.getElementById(button.getAttribute("data-copy"));
    if (!source || !navigator.clipboard) return;
    navigator.clipboard.writeText(source.textContent).then(
      function () {
        button.textContent = "Copied";
      },
      function () {
        button.textContent = "Select the text above to copy it";
      },
    );
  });

  document.addEventListener("submit", function (event) {
    var button = event.target.querySelector("button[type=submit]");
    if (!button) return;
    button.disabled = true;
    button.textContent = button.getAttribute("data-busy") || "Working…";
  });

  clocks();
  setInterval(clocks, 1000);
  setTimeout(refresh, 3000);
})();
