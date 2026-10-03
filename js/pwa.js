/* Registers the service worker (HTTPS or localhost only) and adds an install prompt. */
(function () {
	'use strict';

	if ('serviceWorker' in navigator) {
		window.addEventListener('load', function () {
			navigator.serviceWorker.register('sw.js').catch(function () { /* offline support is optional */ });
		});
	}

	// Offer "Install app" once the browser says the game is installable.
	var deferred = null;
	window.addEventListener('beforeinstallprompt', function (e) {
		e.preventDefault();
		deferred = e;
		var footer = document.querySelector('.fb-footer');
		if (!footer || footer.querySelector('.fb-install')) { return; }
		var btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'fb-install';
		btn.textContent = 'Install app';
		btn.addEventListener('click', function () {
			if (!deferred) { return; }
			deferred.prompt();
			deferred.userChoice.then(function () { deferred = null; btn.remove(); });
		});
		footer.insertBefore(btn, footer.firstChild);
	});
	window.addEventListener('appinstalled', function () {
		var b = document.querySelector('.fb-install');
		if (b) { b.remove(); }
	});
})();
