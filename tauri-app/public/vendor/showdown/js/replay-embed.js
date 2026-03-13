/*
 * Placeholder replay embed template.
 * The build script (build-tools/update) reads this file and injects a hashed
 * version to produce replay-embed.js for cache busting.
 *
 * If you want a functional embed, replace the minimal implementation below
 * with the upstream version or a custom loader.
 */
(function(){
	// Basic no-op embed loader. Upstream usually defines window.showdownReplay
	// or similar hook for embedding a replay inside an iframe.
	if (typeof window !== 'undefined') {
		window.showdownReplay = function showReplayPlaceholder(id, targetEl){
			if (!targetEl) targetEl = document.getElementById('replay-root');
			if (!targetEl) return;
			targetEl.textContent = 'Replay placeholder (id: ' + id + ')';
		};
		// Debug marker so we know template got bundled.
		if (window.console && console.debug) console.debug('[replay-embed.template] placeholder loaded');
	}
})();
