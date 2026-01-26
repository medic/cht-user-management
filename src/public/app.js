(function() {
  let failureCount = 0;
  const MAX_FAILURES = 5;
  document.addEventListener("htmx:sseError", function(evt) {
    failureCount++;
    if (failureCount >= MAX_FAILURES) {
      console.log("Max failures reached. Stopping SSE connection.");
      evt.target.removeAttribute("sse-connect");
      fetch("/").then((resp) => resp.redirected && window.location.replace(resp.url));
    }
  });
})();
