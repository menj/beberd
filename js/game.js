/*
 * Flying Bird – front-end game.
 * Plain canvas, no dependencies. Reads its config from #fb-config; with no database it keeps scores in the browser.
 */
(function () {
	'use strict';

	var CFG = (function () {
		var node = document.getElementById('fb-config');
		try { return node ? JSON.parse(node.textContent) : {}; } catch (e) { return {}; }
	})();
	var T = Object.assign({
		play: 'Play', playAgain: 'Play again', resume: 'Resume', best: 'Best', score: 'Score',
		gameOver: 'Game over', paused: 'Paused', newBest: 'New best!', yourName: 'Your name',
		save: 'Save score', saved: 'Score saved', saveFailed: 'Could not save score',
		leaderboard: 'Leaderboard', noScores: 'No scores yet. Be the first!',
		daily: 'Daily challenge', classic: 'Classic', tryDaily: 'Try the daily challenge', tryClassic: 'Play classic', dailyBoard: "Today's leaderboard", hint: 'Tap, click or press Space to flap', tagline: 'Help Hamilton fly through the pipes.', mute: 'Mute', unmute: 'Unmute', pause: 'Pause'
	}, {});

	// Logical world size; the canvas is scaled to fit its container.
	var W = 420, H = 640, GROUND = 64;
	var BIRD_X = 110, BIRD_R = 15;
	var GRAVITY = 1500, FLAP = -430, MAX_FALL = 620;
	var PIPE_W = 62, PIPE_SPACING = 224;
	var DIFFICULTY = {
		easy:   { gap: 195, speed: 130 },
		normal: { gap: 165, speed: 150 },
		hard:   { gap: 140, speed: 172 }
	};

	var reducedMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

	var ICONS = {
		pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
		sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>',
		muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>'
	};

	function store(key, value) {
		try {
			if (value === undefined) { return window.localStorage.getItem(key); }
			window.localStorage.setItem(key, value);
		} catch (e) { /* storage unavailable (private mode) */ }
		return null;
	}

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) { n.className = cls; }
		if (text !== undefined) { n.textContent = text; }
		return n;
	}

	function snd(name, arg) {
		if (window.FBAudio) { FBAudio.play(name, arg); }
	}

	// Deterministic RNG so everyone gets the same pipes in the daily challenge.
	function seedFrom(str) {
		var h = 1779033703 ^ str.length;
		for (var i = 0; i < str.length; i++) {
			h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
			h = (h << 13) | (h >>> 19);
		}
		h = Math.imul(h ^ (h >>> 16), 2246822507);
		h = Math.imul(h ^ (h >>> 13), 3266489909);
		return (h ^ (h >>> 16)) >>> 0;
	}
	function mulberry32(a) {
		return function () {
			a |= 0; a = (a + 0x6D2B79F5) | 0;
			var t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	var MEDALS = [
		{ at: 50, key: 'gold', label: 'Gold' },
		{ at: 25, key: 'silver', label: 'Silver' },
		{ at: 10, key: 'bronze', label: 'Bronze' }
	];
	function medalFor(score) {
		for (var i = 0; i < MEDALS.length; i++) { if (score >= MEDALS[i].at) { return MEDALS[i]; } }
		return null;
	}

	function Game(root) {
		this.root = root;
		this.baseDiff = DIFFICULTY[root.getAttribute('data-difficulty')] || DIFFICULTY.normal;
		this.diff = this.baseDiff;
		this.mode = 'classic';
		this.day = CFG.today || new Date().toISOString().slice(0, 10);
		this.shake = 0; this.flash = 0; this.pop = 0; this.freeze = 0;
		var storedMute = store('fb_muted');
		this.muted = storedMute === null ? CFG.sound === false : storedMute === '1';
		if (window.FBAudio) {
			FBAudio.setMuted(this.muted);
			FBAudio.setMusicEnabled(CFG.music !== false);
		}
		this.state = 'ready';
		this.hover = false;
		this.build();
		this.refreshPalette();
		this.reset();
		this.bind();
		this.showOverlay('start');
		this.stage.focus({ preventScroll: true });
		this.last = performance.now();
		var self = this;
		requestAnimationFrame(function tick(now) {
			self.frame(now);
			requestAnimationFrame(tick);
		});
	}

	/* ---------- DOM ---------- */

	Game.prototype.build = function () {
		var root = this.root;
		root.textContent = '';

		this.stage = el('div', 'fb-stage');
		this.stage.tabIndex = 0;
		this.stage.setAttribute('role', 'application');
		this.stage.setAttribute('aria-label', 'Flying Bird. Hamilton the bird. ' + T.hint);

		this.canvas = el('canvas', 'fb-canvas');
		this.ctx = this.canvas.getContext('2d');
		this.stage.appendChild(this.canvas);

		var hud = el('div', 'fb-hud');
		hud.appendChild(el('span'));
		var actions = el('div', 'fb-hud-actions');
		this.pauseBtn = el('button', 'fb-btn-icon');
		this.pauseBtn.type = 'button';
		this.pauseBtn.innerHTML = ICONS.pause;
		this.pauseBtn.setAttribute('aria-label', T.pause);
		this.muteBtn = el('button', 'fb-btn-icon');
		this.muteBtn.type = 'button';
		actions.appendChild(this.pauseBtn);
		actions.appendChild(this.muteBtn);
		hud.appendChild(actions);
		this.stage.appendChild(hud);

		this.overlay = el('div', 'fb-overlay');
		this.overlay.setAttribute('role', 'dialog');
		this.overlay.setAttribute('aria-live', 'polite');
		this.card = el('div', 'fb-card');
		this.overlay.appendChild(this.card);
		this.stage.appendChild(this.overlay);

		var hint = el('p', 'fb-hint');
		hint.innerHTML = '<span class="fb-keys"><kbd>Space</kbd> / click flap · <kbd>P</kbd> pause · <kbd>M</kbd> mute · <kbd>R</kbd> restart</span><span class="fb-tap">Tap to flap · Space also works</span>';

		root.appendChild(this.stage);
		root.appendChild(hint);
		this.updateMuteBtn();
	};

	Game.prototype.updateMuteBtn = function () {
		this.muteBtn.innerHTML = this.muted ? ICONS.muted : ICONS.sound;
		this.muteBtn.setAttribute('aria-label', this.muted ? T.unmute : T.mute);
		this.muteBtn.setAttribute('aria-pressed', this.muted ? 'true' : 'false');
	};

	Game.prototype.refreshPalette = function () {
		var cs = getComputedStyle(this.root);
		var get = function (k, d) { return cs.getPropertyValue('--fb-' + k).trim() || d; };
		this.pal = {
			bg1: get('bg1', '#cfe8ff'), bg2: get('bg2', '#fff1de'), hill: get('hill', '#b9d4c3'),
			pipe: get('pipe', '#3d8b6e'), bird: get('bird', '#ffd23f'), beak: get('beak', '#ff6b35'), ink: get('ink', '#14213d'),
			surface: get('surface', '#fff')
		};
		this.sprites = window.FBSprite ? FBSprite.build(this.pal) : null;
	};

	/* ---------- Scores per mode ---------- */

	Game.prototype.bestKey = function (mode) { return mode === 'daily' ? 'fb_daily_' + this.day : 'fb_best'; };
	Game.prototype.bestFor = function (mode) { return parseInt(store(this.bestKey(mode)), 10) || 0; };
	Game.prototype.dayLabel = function () {
		try { return new Date(this.day + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
		catch (e) { return this.day; }
	};

	/* ---------- Overlays ---------- */

	Game.prototype.showOverlay = function (name, data) {
		var self = this, c = this.card;
		c.textContent = '';
		this.overlayName = name;
		this.pauseBtn.hidden = !(this.state === 'playing' || this.state === 'paused');
		this.overlay.classList.toggle('fb-overlay--dock', name === 'start');
		if (!name) {
			this.overlay.classList.remove('is-open');
			return;
		}
		var primary;
		if (name === 'start') {
			c.appendChild(el('h2', 'fb-title', 'Flying Bird'));
			var bestClassic = this.bestFor('classic');
			c.appendChild(el('p', 'fb-sub', T.tagline + (bestClassic ? ' · ' + T.best + ' ' + bestClassic : '')));
			primary = el('button', 'fb-btn', T.play);
			primary.type = 'button';
			primary.addEventListener('click', function () { self.begin('classic'); });
			c.appendChild(primary);
			c.appendChild(this.dailyButton());
		} else if (name === 'paused') {
			c.appendChild(el('h2', 'fb-title', T.paused));
			c.appendChild(el('p', 'fb-sub', 'P / Esc'));
			primary = el('button', 'fb-btn', T.resume);
			primary.type = 'button';
			primary.addEventListener('click', function () { self.resume(); });
			c.appendChild(primary);
		} else if (name === 'over') {
			var daily = this.mode === 'daily';
			if (daily) { c.appendChild(el('span', 'fb-tag', T.daily + ' · ' + this.dayLabel())); }
			if (data.isBest) { c.appendChild(el('span', 'fb-badge', T.newBest)); }
			c.appendChild(el('h2', 'fb-title', T.gameOver));
			var medal = medalFor(this.score);
			if (medal) { c.appendChild(this.medalEl(medal)); }
			c.appendChild(this.stats(this.score, this.bestFor(this.mode)));
			if (CFG.leaderboard && CFG.apiUrl && this.score > 0) { this.saveFormInto(c); }
			primary = el('button', 'fb-btn', T.playAgain);
			primary.type = 'button';
			primary.addEventListener('click', function () { self.begin(); });
			c.appendChild(primary);
			if (daily) {
				var other = el('button', 'fb-btn fb-btn-ghost', T.tryClassic);
				other.type = 'button';
				other.addEventListener('click', function () { self.begin('classic'); });
				c.appendChild(other);
			} else {
				c.appendChild(this.dailyButton());
			}
			if (CFG.showBoard && CFG.apiUrl) { this.boardInto(c); }
		}
		this.overlay.classList.add('is-open');
		if (primary && name !== 'start') { primary.focus({ preventScroll: true }); }
	};

	Game.prototype.dailyButton = function () {
		var self = this, done = this.bestFor('daily');
		var b = el('button', 'fb-btn fb-btn-ghost');
		b.type = 'button';
		b.appendChild(document.createTextNode(T.daily + ' · ' + this.dayLabel()));
		if (done) { b.appendChild(el('small', 'fb-btn-note', T.best + ' ' + done)); }
		b.addEventListener('click', function () { self.begin('daily'); });
		return b;
	};

	Game.prototype.medalEl = function (medal) {
		var m = el('div', 'fb-medal fb-medal--' + medal.key);
		m.setAttribute('role', 'img');
		m.setAttribute('aria-label', medal.label + ' medal');
		m.appendChild(el('span', null, medal.label));
		return m;
	};

	Game.prototype.stats = function (score, best) {
		var wrap = el('div', 'fb-stats');
		[[score, T.score], [best, T.best]].forEach(function (p) {
			if (p[0] === null) { return; }
			var s = el('div', 'fb-stat');
			s.appendChild(el('b', null, String(p[0])));
			s.appendChild(el('span', null, p[1]));
			wrap.appendChild(s);
		});
		return wrap;
	};

	Game.prototype.boardInto = function (parent, highlight) {
		var box = el('div', 'fb-board');
		box.appendChild(el('h3', null, this.overlayName === 'over' && this.mode === 'daily' ? T.dailyBoard : T.leaderboard));
		var list = el('ol');
		list.style.cssText = 'margin:0;padding:0;list-style:none';
		box.appendChild(list);
		parent.appendChild(box);
		this.boardList = list;
		this.loadBoard(highlight);
	};

	Game.prototype.renderBoard = function (rows, highlight) {
		var list = this.boardList;
		if (!list) { return; }
		list.textContent = '';
		if (!rows.length) {
			list.parentNode.appendChild(el('p', 'fb-board-empty', T.noScores));
			return;
		}
		var marked = false;
		rows.forEach(function (r) {
			var li = el('li');
			if (highlight && !marked && r.name === highlight.name && r.score === highlight.score) {
				li.className = 'is-you';
				marked = true;
			}
			li.appendChild(el('span', null, r.name));
			li.appendChild(el('b', null, String(r.score)));
			list.appendChild(li);
		});
	};

	Game.prototype.loadBoard = function (highlight) {
		var self = this;
		var q = this.overlayName === 'over' && this.mode === 'daily' ? '?mode=daily&day=' + encodeURIComponent(this.day) : '?mode=classic';
		fetch(CFG.apiUrl + q, { credentials: 'same-origin' })
			.then(function (r) { return r.ok ? r.json() : []; })
			.then(function (rows) { self.renderBoard(Array.isArray(rows) ? rows : [], highlight); })
			.catch(function () { self.renderBoard([]); });
	};

	Game.prototype.saveFormInto = function (parent) {
		var self = this;
		var status = el('p', 'fb-status');
		status.setAttribute('role', 'status');

		var form = el('form', 'fb-form');
		var input = el('input');
		input.type = 'text';
		input.maxLength = 40;
		input.placeholder = T.yourName;
		input.setAttribute('aria-label', T.yourName);
		input.value = store('fb_name') || '';
		var btn = el('button', 'fb-btn', T.save);
		btn.type = 'submit';
		form.appendChild(input);
		form.appendChild(btn);
		form.addEventListener('submit', function (e) {
			e.preventDefault();
			var name = input.value.trim();
			store('fb_name', name);
			btn.disabled = true;
			self.submit(name, status, function (ok) {
				if (ok) { form.remove(); } else { btn.disabled = false; }
			});
		});
		// Keep game hotkeys from firing while typing.
		input.addEventListener('keydown', function (e) { e.stopPropagation(); });
		parent.appendChild(form);
		parent.appendChild(status);
	};

	Game.prototype.submit = function (name, status, done) {
		var self = this, score = this.score;
		status.textContent = '…';
		fetch(CFG.apiUrl, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CFG.csrf || '' },
			body: JSON.stringify({ name: name, score: score, duration: Math.round(this.playMs), mode: this.mode, day: this.day })
		}).then(function (r) {
			return r.json().then(function (j) { return { ok: r.ok, body: j }; });
		}).then(function (res) {
			if (!res.ok) { throw new Error(res.body && res.body.message); }
			status.textContent = T.saved;
			if (self.boardList) { self.renderBoard(res.body.scores || [], { name: name || '', score: score }); }
			if (done) { done(true); }
		}).catch(function (err) {
			status.textContent = (err && err.message) || T.saveFailed;
			if (done) { done(false); }
		});
	};

	/* ---------- Input & lifecycle ---------- */

	Game.prototype.bind = function () {
		var self = this;

		// One handler for mouse, touch and pen. Tapping anywhere on the stage flaps;
		// on the start / game-over / pause screens, tapping outside the card acts too.
		this.stage.addEventListener('pointerdown', function (e) {
			if (e.button > 0 || !e.isPrimary) { return; }
			if (e.target.closest('.fb-btn-icon') || e.target.closest('.fb-card')) { return; }
			e.preventDefault();
			if (self.state === 'paused') { self.resume(); } else { self.flap(); }
		});
		// Keep the page from scrolling / zooming / selecting while playing on touch devices.
		this.stage.addEventListener('contextmenu', function (e) { e.preventDefault(); });
		this.pauseBtn.addEventListener('click', function () { self.togglePause(); });
		this.muteBtn.addEventListener('click', function () { self.toggleMute(); });

		this.root.addEventListener('pointerenter', function () { self.hover = true; });
		this.root.addEventListener('pointerleave', function () { self.hover = false; });

		var single = document.querySelectorAll('.fb-game').length === 1;
		document.addEventListener('keydown', function (e) {
			if (e.metaKey || e.ctrlKey || e.altKey) { return; }
			var t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
			if (typing) { return; }
			var onButton = t && t.tagName === 'BUTTON';
			// Keys are live when this game is playing, hovered, focused, or is the only game on the page.
			var active = self.state === 'playing' || self.hover || self.root.contains(document.activeElement) ||
				(single && (document.activeElement === document.body || !document.activeElement));
			if (!active) { return; }
			switch (e.code) {
				case 'Space': case 'ArrowUp': case 'KeyW':
					if (onButton && self.state !== 'playing') { return; } // let Space activate a focused button
					e.preventDefault();
					if (e.repeat) { return; }
					if (self.state === 'paused') { self.resume(); } else { self.flap(); }
					break;
				case 'Enter': case 'NumpadEnter':
					if (onButton) { return; }
					if (self.state === 'ready' || self.state === 'over') { e.preventDefault(); self.flap(); }
					else if (self.state === 'paused') { e.preventDefault(); self.resume(); }
					break;
				case 'KeyP': case 'Escape': self.togglePause(); break;
				case 'KeyM': self.toggleMute(); break;
				case 'KeyR': self.begin(); break;
			}
		});

		document.addEventListener('visibilitychange', function () {
			if (document.hidden && self.state === 'playing') { self.pause(); }
		});
		if ('IntersectionObserver' in window) {
			new IntersectionObserver(function (entries) {
				if (!entries[0].isIntersecting && self.state === 'playing') { self.pause(); }
			}, { threshold: 0.2 }).observe(this.stage);
		}
		if ('ResizeObserver' in window) {
			new ResizeObserver(function () { self.resize(); }).observe(this.stage);
		} else {
			window.addEventListener('resize', function () { self.resize(); });
		}
		this.resize();

		if (window.matchMedia) {
			var mq = matchMedia('(prefers-color-scheme: dark)');
			var onChange = function () { self.refreshPalette(); };
			if (mq.addEventListener) { mq.addEventListener('change', onChange); }
		}
	};

	Game.prototype.resize = function () {
		var r = this.stage.getBoundingClientRect();
		var dpr = Math.min(window.devicePixelRatio || 1, 2);
		this.canvas.width = Math.max(1, Math.round(r.width * dpr));
		this.canvas.height = Math.max(1, Math.round(r.height * dpr));
		this.scale = this.canvas.width / W;
	};

	Game.prototype.reset = function () {
		this.bird = { y: H * 0.42, vy: 0, rot: 0, anim: 99, sq: 0 };
		this.rng = this.mode === 'daily' ? mulberry32(seedFrom('flying-bird:' + this.day)) : Math.random;
		this.shake = this.flash = this.pop = this.freeze = 0;
		this.pipes = [];
		this.particles = [];
		this.score = 0;
		this.playMs = 0;
		this.distance = 0;
		this.speed = this.diff.speed;
		this.lastGapY = (H - GROUND) / 2;
		this.overAt = 0;
		this.spawnPipe(W + 120);
	};

	Game.prototype.begin = function (mode) {
		if (mode) { this.mode = mode; }
		// The daily challenge is always Normal so everyone flies the same course.
		this.diff = this.mode === 'daily' ? DIFFICULTY.normal : this.baseDiff;
		this.reset();
		this.state = 'playing';
		this.showOverlay(null);
		if (window.FBAudio) { FBAudio.unlock(); FBAudio.setIntensity(0); }
		snd('swoosh');
		if (window.FBAudio) { FBAudio.musicStart(); }
		this.bird.vy = FLAP;
		this.bird.anim = 0;
		this.stage.focus({ preventScroll: true });
	};

	Game.prototype.flap = function () {
		if (this.state === 'ready') { this.begin(); return; }
		if (this.state === 'over') {
			if (performance.now() - this.overAt > 450) { this.begin(); }
			return;
		}
		if (this.state !== 'playing') { return; }
		this.bird.vy = FLAP;
		this.bird.anim = 0; // restart the wing-beat cycle
		this.bird.sq = 1;   // squash & stretch
		this.puff();
		snd('flap');
	};

	Game.prototype.pause = function () {
		if (this.state !== 'playing') { return; }
		this.state = 'paused';
		if (window.FBAudio) { FBAudio.musicStop(); }
		this.showOverlay('paused');
	};

	Game.prototype.resume = function () {
		if (this.state !== 'paused') { return; }
		this.state = 'playing';
		this.showOverlay(null);
		if (window.FBAudio) { FBAudio.musicStart(); }
		this.stage.focus({ preventScroll: true });
	};

	Game.prototype.togglePause = function () {
		if (this.state === 'playing') { this.pause(); } else if (this.state === 'paused') { this.resume(); }
	};

	Game.prototype.toggleMute = function () {
		this.muted = !this.muted;
		store('fb_muted', this.muted ? '1' : '0');
		this.updateMuteBtn();
		if (window.FBAudio) {
			FBAudio.setMuted(this.muted);
			if (!this.muted && this.state === 'playing') { FBAudio.musicStart(); }
		}
	};

	Game.prototype.die = function (reason) {
		var self = this;
		this.state = 'over';
		this.overAt = performance.now();
		if (window.FBAudio) { FBAudio.musicStop(); }
		snd(reason === 'pipe' ? 'hit' : 'die');
		if (!reducedMotion) {
			this.shake = 0.4;
			this.flash = 1;
			this.freeze = 0.07; // brief hit-stop makes the impact land
			for (var i = 0; i < 18; i++) {
				var a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 240;
				this.particles.push({ x: BIRD_X, y: this.bird.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 1, r: 2 + Math.random() * 3 });
			}
		}
		var key = this.bestKey(this.mode), prev = this.bestFor(this.mode);
		var isBest = this.score > prev;
		if (isBest) { store(key, String(this.score)); }
		// Let the crash play out before the card slides in.
		setTimeout(function () {
			if (self.state === 'over') { self.showOverlay('over', { isBest: isBest && self.score > 0 }); }
		}, reducedMotion ? 0 : 420);
	};

	// A little trail of feathers behind the bird on each flap.
	Game.prototype.puff = function () {
		if (reducedMotion) { return; }
		for (var i = 0; i < 3; i++) {
			this.particles.push({ x: BIRD_X - 18, y: this.bird.y + 6 + i * 4, vx: -50 - Math.random() * 50, vy: 25 + Math.random() * 35, life: 0.55, r: 2 + Math.random() * 2, puff: true });
		}
	};

	/* ---------- Simulation ---------- */

	Game.prototype.spawnPipe = function (x) {
		var margin = 90, gap = this.diff.gap;
		var min = margin + gap / 2, max = H - GROUND - margin - gap / 2;
		var target = min + this.rng() * (max - min);
		// Limit the jump between consecutive gaps so every course is passable.
		var gapY = Math.max(min, Math.min(max, this.lastGapY + Math.max(-170, Math.min(170, target - this.lastGapY))));
		this.lastGapY = gapY;
		this.pipes.push({ x: x, gapY: gapY, passed: false });
	};

	Game.prototype.update = function (dt) {
		var b = this.bird, i;

		// Particles and effect timers keep running after death.
		for (i = this.particles.length - 1; i >= 0; i--) {
			var p = this.particles[i];
			if (!p.puff) { p.vy += GRAVITY * 0.5 * dt; }
			p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * (p.puff ? 1.6 : 1.4);
			if (p.life <= 0) { this.particles.splice(i, 1); }
		}
		this.shake = Math.max(0, this.shake - dt);
		this.flash = Math.max(0, this.flash - dt * 4);
		this.pop = Math.max(0, this.pop - dt * 5);
		b.sq = Math.max(0, b.sq - dt * 7);
		if (this.freeze > 0) { this.freeze -= dt; return; }

		if (this.state === 'ready') {
			b.y = H * 0.42 + Math.sin(performance.now() / 300) * 8;
			this.distance += this.speed * dt * 0.5;
			return;
		}
		if (this.state === 'over') {
			// Let the bird tumble to the ground.
			if (b.y + BIRD_R < H - GROUND) {
				b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL);
				b.y += b.vy * dt;
				b.rot = Math.min(b.rot + dt * 6, Math.PI / 2);
			}
			return;
		}
		if (this.state !== 'playing') { return; }

		this.playMs += dt * 1000;
		this.speed = this.diff.speed + Math.min(this.score * 2.5, 60);
		this.distance += this.speed * dt;

		b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL);
		b.y += b.vy * dt;
		b.rot = Math.max(-0.4, Math.min(0.8, b.vy / 650));
		b.anim += dt;
		if (b.y < BIRD_R) { b.y = BIRD_R; b.vy = 0; }

		for (i = this.pipes.length - 1; i >= 0; i--) {
			var pipe = this.pipes[i];
			pipe.x -= this.speed * dt;
			if (pipe.x + PIPE_W < -10) { this.pipes.splice(i, 1); continue; }
			if (!pipe.passed && pipe.x + PIPE_W < BIRD_X - BIRD_R) {
				pipe.passed = true;
				this.score++;
				this.pop = 1;
				snd('point', this.score);
				if (window.FBAudio) { FBAudio.setIntensity(this.score); }
			}
			if (this.hits(pipe)) { this.die('pipe'); return; }
		}
		var lastPipe = this.pipes[this.pipes.length - 1];
		if (!lastPipe || lastPipe.x < W - PIPE_SPACING + 40) { this.spawnPipe(W + 40); }

		if (b.y + BIRD_R >= H - GROUND) {
			b.y = H - GROUND - BIRD_R;
			this.die('ground');
		}
	};

	// Circle (bird) vs the two pipe rectangles.
	Game.prototype.hits = function (pipe) {
		var b = this.bird, half = this.diff.gap / 2;
		var rects = [[pipe.x, -10, PIPE_W, pipe.gapY - half + 10], [pipe.x, pipe.gapY + half, PIPE_W, H]];
		for (var i = 0; i < 2; i++) {
			var r = rects[i];
			var cx = Math.max(r[0], Math.min(BIRD_X, r[0] + r[2]));
			var cy = Math.max(r[1], Math.min(b.y, r[1] + r[3]));
			var dx = BIRD_X - cx, dy = b.y - cy;
			if (dx * dx + dy * dy < (BIRD_R - 3) * (BIRD_R - 3)) { return true; } // slightly smaller than the sprite: near-misses feel fair
		}
		return false;
	};

	/* ---------- Rendering ---------- */

	Game.prototype.frame = function (now) {
		var dt = Math.min((now - this.last) / 1000, 1 / 30);
		this.last = now;
		this.update(dt);
		this.draw();
	};

	Game.prototype.hills = function (ctx, offset, base, amp, freq, color, alpha) {
		ctx.globalAlpha = alpha;
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.moveTo(0, H - GROUND);
		for (var x = 0; x <= W; x += 6) {
			ctx.lineTo(x, base + Math.sin((x + offset) * freq) * amp + Math.sin((x + offset) * freq * 2.3) * amp * 0.4);
		}
		ctx.lineTo(W, H - GROUND);
		ctx.closePath();
		ctx.fill();
		ctx.globalAlpha = 1;
	};

	Game.prototype.draw = function () {
		var ctx = this.ctx, P = this.pal, i;
		ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);

		var sky = ctx.createLinearGradient(0, 0, 0, H - GROUND);
		sky.addColorStop(0, P.bg1);
		sky.addColorStop(1, P.bg2);
		ctx.fillStyle = sky;
		ctx.fillRect(0, 0, W, H);

		// Sun / moon.
		ctx.globalAlpha = 0.3;
		ctx.fillStyle = P.bird;
		ctx.beginPath(); ctx.arc(W * 0.74, 150, 44, 0, Math.PI * 2); ctx.fill();
		ctx.globalAlpha = 1;

		this.hills(ctx, this.distance * 0.1, H - GROUND - 120, 26, 0.012, P.hill, 0.55);
		this.hills(ctx, this.distance * 0.25, H - GROUND - 60, 20, 0.02, P.hill, 0.9);

		// Pipes.
		var half = this.diff.gap / 2;
		for (i = 0; i < this.pipes.length; i++) {
			var p = this.pipes[i];
			this.drawPipe(ctx, p.x, -10, p.gapY - half + 10, true);
			this.drawPipe(ctx, p.x, p.gapY + half, H - GROUND - (p.gapY + half), false);
		}

		// Ground.
		ctx.fillStyle = P.hill;
		ctx.fillRect(0, H - GROUND, W, GROUND);
		ctx.fillStyle = P.pipe;
		ctx.fillRect(0, H - GROUND, W, 4);
		ctx.globalAlpha = 0.25;
		var off = -(this.distance % 32);
		for (var x = off; x < W; x += 32) { ctx.fillRect(x, H - GROUND + 22, 16, 4); }
		ctx.globalAlpha = 1;

		// Particles: square "pixels" to match the sprite.
		for (i = 0; i < this.particles.length; i++) {
			var q = this.particles[i];
			ctx.globalAlpha = Math.max(0, Math.min(1, q.life));
			ctx.fillStyle = q.puff ? '#ffffff' : P.bird;
			ctx.fillRect(Math.round(q.x - q.r), Math.round(q.y - q.r), q.r * 2, q.r * 2);
		}
		ctx.globalAlpha = 1;

		this.drawBird(ctx);

		if (this.state === 'playing' || this.state === 'paused' || this.state === 'over') {
			ctx.font = '700 56px ' + (getComputedStyle(this.root).fontFamily || 'sans-serif');
			ctx.textAlign = 'center';
			ctx.textBaseline = 'alphabetic';
			ctx.fillStyle = P.ink;
			ctx.globalAlpha = this.state === 'over' ? 0.35 : 0.9;
			var k = 1 + 0.28 * this.pop; // score pops when you clear a pipe
			ctx.save();
			ctx.translate(W / 2, 104);
			ctx.scale(k, k);
			ctx.fillText(String(this.score), 0, 0);
			ctx.restore();
			ctx.globalAlpha = 1;
		}

		// Impact flash and screen shake (shake is a CSS transform, so no edges show).
		if (this.flash > 0) {
			ctx.fillStyle = '#ffffff';
			ctx.globalAlpha = this.flash * 0.5;
			ctx.fillRect(0, 0, W, H);
			ctx.globalAlpha = 1;
		}
		if (this.shake > 0) {
			var m = this.shake * 18;
			this.canvas.style.transform = 'translate(' + ((Math.random() - 0.5) * m).toFixed(1) + 'px,' + ((Math.random() - 0.5) * m).toFixed(1) + 'px)';
			this.shaking = true;
		} else if (this.shaking) {
			this.canvas.style.transform = '';
			this.shaking = false;
		}
	};

	Game.prototype.drawPipe = function (ctx, x, y, h, capAtBottom) {
		if (h <= 0) { return; }
		var P = this.pal, capH = 22, capX = x - 5, capW = PIPE_W + 10;
		ctx.fillStyle = P.pipe;
		ctx.fillRect(x, y, PIPE_W, h);
		// Soft highlight.
		ctx.fillStyle = 'rgba(255,255,255,.14)';
		ctx.fillRect(x + 8, y, 7, h);
		ctx.fillStyle = P.pipe;
		var cy = capAtBottom ? y + h - capH : y;
		ctx.beginPath();
		if (ctx.roundRect) { ctx.roundRect(capX, cy, capW, capH, 6); } else { ctx.rect(capX, cy, capW, capH); }
		ctx.fill();
		ctx.fillStyle = 'rgba(255,255,255,.14)';
		ctx.fillRect(capX + 8, cy + 3, 7, capH - 6);
	};

	// Wing beat: up, mid, down, mid – one cycle per flap, then glide with wings level.
	var BEAT = ['up', 'mid', 'down', 'mid'];
	Game.prototype.wingPose = function () {
		var b = this.bird;
		if (this.state === 'over') { return 'down'; }
		if (this.state === 'ready' || this.state === 'paused' && b.anim > 50) {
			return BEAT[Math.floor(performance.now() / 130) % 4];
		}
		return b.anim < 0.3 ? BEAT[Math.min(3, Math.floor(b.anim / 0.075))] : 'mid';
	};

	Game.prototype.drawBird = function (ctx) {
		var b = this.bird, spr = this.sprites;
		if (!spr) { return; }
		var S = 3; // logical px per sprite pixel
		var rot = Math.round(b.rot * 8) / 8; // stepped tilt keeps the pixels crisp
		ctx.save();
		ctx.translate(BIRD_X, b.y);
		ctx.rotate(rot);
		ctx.scale(1 - 0.12 * b.sq, 1 + 0.18 * b.sq); // squash & stretch on flap
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(spr[this.wingPose()], -8 * S, -9.5 * S, FBSprite.width * S, FBSprite.height * S);
		ctx.restore();
	};

	function init() {
		var nodes = document.querySelectorAll('.fb-game');
		for (var i = 0; i < nodes.length; i++) {
			if (!nodes[i].__fb) { nodes[i].__fb = new Game(nodes[i]); }
		}
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
