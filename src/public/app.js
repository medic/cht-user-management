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

//reset hierarchy search inputs if higher level input value changes
function resetLowerHierarchyInputs(input) {
  const level = parseInt(input.dataset.hierarchyLevel, 10);
  const prefix = input.dataset.hierarchyPrefix || '';
  if (isNaN(level) || prefix !== 'hierarchy_') {
    return;
  }

  document.querySelectorAll('input[data-hierarchy-level]').forEach(function(otherInput) {
    if (otherInput === input || (otherInput.dataset.hierarchyPrefix || '') !== prefix) {
      return;
    }
    //dont reset higher hierarchy levels
    if (parseInt(otherInput.dataset.hierarchyLevel, 10) >= level) {
      return;
    }
    otherInput.value = '';
    document.getElementById(otherInput.id + '_id')?.remove();
    // clear dropdown
    const results = document.getElementById('search_results_' + otherInput.id);
    if (results) {
      results.innerHTML = '';
    }
  });
}
