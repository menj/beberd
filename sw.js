/*
 * Beberd service worker: makes the game installable and playable offline.
 * - Pages: network first, falling back to the last cached copy.
 * - Static assets (css/js/icons): stale-while-revalidate.
 * - api.php, admin.php and install.php are never cached.
 * Bump VERSION to force clients to refresh their cache.
 */
const VERSION = 'fb-v6';
const SHELL = [
	'./', 'css/game.css', 'css/site.css', 'css/arcade.css', 'fonts/SpecialElite-Regular.woff2', 'js/game.js', 'js/sprite.js', 'js/audio.js', 'js/pwa.js',
	'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'
];
const NEVER = /\/(api|admin|install)\.php/;

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(VERSION)
			.then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(u))))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	const url = new URL(req.url);
	if (req.method !== 'GET' || url.origin !== location.origin || NEVER.test(url.pathname)) { return; }

	if (req.mode === 'navigate') {
		event.respondWith(
			fetch(req)
				.then((res) => {
					if (!/no-store/.test(res.headers.get('Cache-Control') || '')) {
						const copy = res.clone();
						caches.open(VERSION).then((c) => c.put('./', copy));
					}
					return res;
				})
				.catch(() => caches.match('./').then((hit) => hit || caches.match(req)))
		);
		return;
	}

	event.respondWith(
		caches.match(req).then((hit) => {
			const fresh = fetch(req).then((res) => {
				if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
				return res;
			}).catch(() => hit);
			return hit || fresh;
		})
	);
});
