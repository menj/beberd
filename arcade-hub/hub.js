/*
 * Arcade hub: lists every game named in games.json by reading that game's own game.json
 * (the "hub contract"). Add a game by dropping its folder next to this page and adding its
 * folder name to games.json. Paths inside a game.json are relative to the game's folder.
 */
(function () {
	'use strict';

	var grid = document.getElementById('hub-grid');
	var empty = document.getElementById('hub-empty');
	var search = document.getElementById('hub-search');
	var tagBox = document.getElementById('hub-tags');
	var games = [], active = null;

	/** Each game records { best, plays, last, lastPlayed } under arcade.stats[<game id>] (see game.json "id"). */
	function stats() {
		try { return JSON.parse(localStorage.getItem('arcade.stats') || '{}') || {}; } catch (e) { return {}; }
	}

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) { n.className = cls; }
		if (text !== undefined) { n.textContent = text; }
		return n;
	}
	function get(url) {
		return fetch(url, { cache: 'no-cache' }).then(function (r) {
			if (!r.ok) { throw new Error(url + ' ' + r.status); }
			return r.json();
		});
	}
	/** A path from game.json, resolved against the game's own folder. */
	function inFolder(folder, path) { return path ? folder + '/' + String(path).replace(/^\.\//, '') : ''; }
	function nice(s) { return String(s).replace(/-/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); }

	function card(g) {
		var li = el('li', 'hub-card');
		var link = inFolder(g.folder, g.url === './' || !g.url ? '' : g.url) || g.folder + '/';
		if (g.thumbnail) {
			var img = el('img');
			img.src = inFolder(g.folder, g.thumbnail);
			img.alt = '';
			img.loading = 'lazy';
			li.appendChild(img);
		}
		var body = el('div', 'body');
		body.appendChild(el('h2', null, g.title));
		if (g.tagline) { body.appendChild(el('p', null, g.tagline)); }
		var mine = stats()[g.id];
		if (mine && mine.best > 0) { body.appendChild(el('p', 'best', 'Your best: ' + mine.best + (mine.plays > 1 ? ' \u00b7 ' + mine.plays + ' plays' : ''))); }
		var badges = el('div', 'badges');
		(g.badges && g.badges.length ? g.badges : (g.features || []).map(nice)).slice(0, 4).forEach(function (f) { badges.appendChild(el('span', null, f)); });
		if (badges.childNodes.length) { body.appendChild(badges); }
		var play = el('div', 'play');
		var a = el('a', null, 'Play ›');
		a.href = link.charAt(link.length - 1) === '/' ? link : link + '/';
		a.setAttribute('aria-label', 'Play ' + g.title);
		play.appendChild(a);
		body.appendChild(play);
		li.appendChild(body);
		return li;
	}

	function render() {
		var q = search.value.trim().toLowerCase();
		grid.textContent = '';
		var shown = 0;
		games.forEach(function (g) {
			var hay = (g.title + ' ' + (g.tagline || '') + ' ' + (g.summary || '') + ' ' + (g.tags || []).join(' ')).toLowerCase();
			if ((q && hay.indexOf(q) === -1) || (active && (g.tags || []).indexOf(active) === -1)) { return; }
			grid.appendChild(card(g));
			shown++;
		});
		if (!q && !active && window.__soon) {
			for (var i = 0; i < window.__soon; i++) { var s = el('li', 'hub-card soon', 'Coming soon'); grid.appendChild(s); }
		}
		empty.hidden = shown !== 0;
	}

	function tags() {
		var all = {};
		games.forEach(function (g) { (g.tags || []).forEach(function (t) { all[t] = true; }); });
		tagBox.textContent = '';
		Object.keys(all).sort().forEach(function (t) {
			var b = el('button', null, nice(t));
			b.type = 'button';
			b.setAttribute('aria-pressed', 'false');
			b.addEventListener('click', function () {
				active = active === t ? null : t;
				Array.prototype.forEach.call(tagBox.children, function (c) { c.setAttribute('aria-pressed', 'false'); });
				if (active) { b.setAttribute('aria-pressed', 'true'); }
				render();
			});
			tagBox.appendChild(b);
		});
	}

	get('games.json').then(function (cfg) {
		document.getElementById('hub-title').textContent = cfg.title || 'Arcade';
		document.title = cfg.title || 'Arcade';
		document.getElementById('hub-sub').textContent = cfg.subtitle || '';
		window.__soon = cfg.comingSoon || 0;
		return Promise.all((cfg.games || []).map(function (folder) {
			// A game whose game.json is missing or broken is skipped; it never breaks the hub.
			return get(folder + '/game.json').then(function (g) { g.folder = folder; return g; }, function () { return null; });
		}));
	}).then(function (list) {
		games = list.filter(Boolean);
		tags();
		render();
	}).catch(function () {
		grid.textContent = '';
		empty.hidden = false;
		empty.textContent = 'Could not load the game list.';
	});

	search.addEventListener('input', render);
})();
