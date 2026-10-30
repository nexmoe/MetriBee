(function () {
  var retryKey = "metribee.ui-reload-at";
  function showFailure() {
    var startup = document.getElementById("metribee-startup");
    if (!startup) return;
    document.getElementById("metribee-startup-message").textContent =
      document.documentElement.lang === "zh"
        ? "MetriBee 启动失败，请重新加载页面。"
        : "MetriBee could not start. Please reload the page.";
    document.getElementById("metribee-startup-reload").hidden = false;
    startup.setAttribute("role", "alert");
  }
  function recover() {
    try {
      var last = Number(sessionStorage.getItem(retryKey));
      if (!last || Date.now() - last > 60000) {
        sessionStorage.setItem(retryKey, String(Date.now()));
        location.reload();
        return true;
      }
    } catch (_) {
      // Storage may be blocked; keep a manual recovery path instead of looping.
    }
    showFailure();
    return false;
  }
  window.addEventListener("vite:preloadError", function (event) {
    if (recover()) event.preventDefault();
  });
  window.addEventListener("error", function (event) {
    if (event.target && event.target.tagName === "SCRIPT" && event.target.type === "module") {
      recover();
    } else if (event.message) {
      showFailure();
    }
  }, true);
  window.addEventListener("unhandledrejection", showFailure);
})();
