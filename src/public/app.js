(function() {
	let failureCount = 0;
	const maxFailures = 5;
	document.addEventListener("htmx:sseError", function(evt) {
		failureCount++;
		if (failureCount >= maxFailures) {
			console.log("Max failures reached. Stopping SSE connection.");
			evt.target.removeAttribute("sse-connect");
		}
	});
})();
