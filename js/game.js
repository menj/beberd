/*
 * Beberd – front-end game.
 * Plain canvas, no dependencies. Reads its config from #fb-config; with no database it keeps scores in the browser.
 */
(function () {
	'use strict';

	var CFG = (function () {
		var node = document.getElementById('fb-config');
		try { return node ? JSON.parse(node.textContent) : {}; } catch (e) { return {}; }
	})();
	var APP = CFG.appName || 'Beberd';
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
	var STEP = 1 / 60; // fixed simulation step: the same inputs always give the same run (needed for replays and verification)
	var PIPE_W = 62, PIPE_SPACING = 224;
	var DIFFICULTY = {
		easy:   { gap: 195, speed: 130 },
		normal: { gap: 165, speed: 150 },
		hard:   { gap: 140, speed: 172 }
	};

	var reducedMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

	var ICONS = {
		pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
		shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z"/></svg>',
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

	// Haptics: short vibrations on touch devices that support them (never for reduced-motion visitors).
	function buzz(pattern) {
		if (reducedMotion || !navigator.vibrate || store('fb_haptics') === '0') { return; }
		try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
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

	// Hamilton's wardrobe: looks and hats unlocked by playing.
	var LOOKS = [
		{ id: 'classic', name: 'Classic' },
		{ id: 'ember',  name: 'Ember',  colors: { bird: '#ff6b4a', beak: '#ffd166' }, need: { pipes: 25 } },
		{ id: 'frost',  name: 'Frost',  colors: { bird: '#9be7ff', beak: '#ff9f1c' }, need: { pipes: 100 } },
		{ id: 'shadow', name: 'Shadow', colors: { bird: '#6c4ab6', beak: '#ffd23f' }, need: { pipes: 250 } },
		{ id: 'golden', name: 'Golden', colors: { bird: '#ffcf33', beak: '#e2531f' }, need: { score: 50 } }
	];
	var HATS = [
		{ id: 'none',   name: 'No hat' },
		{ id: 'cap',    name: 'Cap',       need: { pipes: 50 } },
		{ id: 'shades', name: 'Shades',    need: { pipes: 150 } },
		{ id: 'party',  name: 'Party hat', need: { daily: true } },
		{ id: 'crown',  name: 'Crown',     need: { score: 35 } }
	];
	var BEAT = ['up', 'mid', 'down', 'mid'];

	var COIN_R = 10, POWER_R = 13;
	var LEVEL_EVERY = 8; // pipes per level
	var POWERS = {
		shield: { name: 'Shield',  color: '#4cc9f0', time: 0 },
		slow:   { name: 'Slow-mo', color: '#b794f6', time: 5 },
		magnet: { name: 'Magnet',  color: '#ff6b6b', time: 7 }
	};
	var POWER_KEYS = ['shield', 'slow', 'magnet'];
	function levelOf(n) { return 1 + Math.floor(n / LEVEL_EVERY); }

	// Daily goals: three per day, picked from these by a generator seeded with the date.
	var GOAL_TEMPLATES = [
		{ id: 'score',  picks: [15, 20, 25, 30, 40], text: function (n) { return 'Score ' + n + ' in one run'; },          prog: function (g) { return g.score; } },
		{ id: 'coins',  picks: [4, 6, 8],            text: function (n) { return 'Collect ' + n + ' coins in one run'; },    prog: function (g) { return g.coins; } },
		{ id: 'moving', picks: [3, 5],              text: function (n) { return 'Pass ' + n + ' moving pipes in one run'; }, prog: function (g) { return g.movingPassed; } },
		{ id: 'power',  picks: [1, 2, 3],          text: function (n) { return 'Collect ' + n + ' power-up' + (n > 1 ? 's' : '') + ' in one run'; }, prog: function (g) { return g.powerCount; } },
		{ id: 'total',  picks: [40, 60, 80],        text: function (n) { return 'Clear ' + n + ' pipes today'; },            prog: function (g, st) { return st.total + g.score; } }
	];
	function goalsFor(day) {
		var rnd = mulberry32(seedFrom('goals:' + day)), pool = GOAL_TEMPLATES.slice(), out = [];
		while (out.length < 3) {
			var t = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
			out.push({ id: t.id, target: t.picks[Math.floor(rnd() * t.picks.length)], tpl: t });
		}
		return out;
	}
	function addDays(day, n) { return new Date(new Date(day + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10); }

	// Hamilton's story: chapters unlock as you clear pipes.
	var CHAPTERS = [
		{ title: 'The Smallest Bird', need: null,
		  text: 'On Pipe Hill, every spring the flock crosses the Great Pipes to reach the far shore. Hamilton, the smallest bird on the hill, was always told to wait for next year. This year, he leaves before dawn.' },
		{ title: 'First Flight', need: { pipes: 10 },
		  text: 'The pipes are taller than any tree Hamilton has ever known. His wings ache, but the wind is on his side, and for the first time nobody is telling him to wait.' },
		{ title: 'The Whispering Pipes', need: { pipes: 50 },
		  text: 'Between the pipes the wind hums an old song. Hamilton learns it by heart: dip low, climb late, trust the gap.' },
		{ title: 'Night Crossing', need: { pipes: 150 },
		  text: 'Dusk comes early on the crossing. The moon hangs low and gold, and Hamilton realises he is flying farther than the flock ever let him dream.' },
		{ title: 'The Storm Gate', need: { pipes: 300 },
		  text: 'Thunder rolls through the narrowest gaps of the Great Pipes. Hamilton almost turns back. Then he remembers the song, and flies straight through.' },
		{ title: 'The Far Shore', need: { pipes: 600 },
		  text: 'Salt air, warm sand, and the whole flock staring in disbelief. \u201cYou made it,\u201d says the oldest bird. Hamilton grins. \u201cTomorrow I fly back and show the others the way.\u201d That is why the crossing is different every single day.' }
	];
	// Short captions that appear mid-flight.
	var CAPTIONS = { 5: 'Hamilton leaves Pipe Hill behind\u2026', 15: 'The Great Pipes loom ahead.', 30: 'The wind begins to hum\u2026', 50: 'Is that the far shore?' };

	function progress() {
		return {
			pipes: parseInt(store('fb_total'), 10) || 0,
			score: parseInt(store('fb_max'), 10) || 0,
			daily: store('fb_dp') === '1'
		};
	}
	function isUnlocked(item, pr) {
		var n = item.need;
		if (!n) { return true; }
		return (n.pipes !== undefined && pr.pipes >= n.pipes) ||
			(n.score !== undefined && pr.score >= n.score) ||
			(n.daily === true && pr.daily);
	}
	function needText(item, pr) {
		var n = item.need || {};
		if (n.pipes !== undefined) { return 'Clear ' + n.pipes + ' pipes in total (' + Math.min(pr.pipes, n.pipes) + '/' + n.pipes + ')'; }
		if (n.score !== undefined) { return 'Score ' + n.score + ' or more in one run'; }
		return 'Finish a daily challenge run';
	}
	function byId(list, id) {
		for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
		return list[0];
	}

	// Something funny to say when Hamilton crashes.
	var QUIPS = {
		pipe: ['Bonk! Right in the beak.', 'That pipe came out of nowhere.', 'Hamilton saw stars.', 'Pipes: 1, Hamilton: 0.', 'Beak first. Bold strategy.', 'He\u2019s fine. Mostly.'],
		ground: ['Gravity wins again.', 'Face-planted. Gloriously.', 'Hamilton has landed. Unplanned.', 'The floor is not lava, sadly.', 'Flapping is not optional, Hamilton.', 'Soft landing. For the ground.']
	};
	var COMICS = { pipe: ['BONK!', 'WHAM!', 'OOF!', 'DOINK!'], ground: ['THUD!', 'SPLAT!', 'OOF!', 'PLOP!'] };
	var TAGLINES = [
		'Help Hamilton fly through the pipes.', 'Hamilton has questionable aerodynamics.', 'Gravity is not a suggestion.',
		'Tiny bird. Big dreams. Many pipes.', 'Hamilton believes in himself. Mostly.', 'No birds were harmed. Some were bonked.'
	];
	var PAUSE_LINES = ['Hamilton is catching his breath.', 'Hamilton is checking his map. Upside down.', 'Snack break. Birds need snacks.'];
	var CHEERS = { coin: ['CHA-CHING!', 'SHINY!', 'MINE!', 'YUM!'], level: ['WOO!', 'LEVEL UP!', 'HAMILTON!'], milestone: { 10: 'NICE!', 25: 'WOW!', 50: 'LEGEND!' } };
	function pick(list, not) {
		var v;
		do { v = list[Math.floor(Math.random() * list.length)]; } while (v === not && list.length > 1);
		return v;
	}

	function Game(root) {
		this.root = root;
		this.diffName = DIFFICULTY[root.getAttribute('data-difficulty')] ? root.getAttribute('data-difficulty') : 'normal';
		this.baseDiff = DIFFICULTY[this.diffName];
		this.diff = this.baseDiff;
		this.mode = 'classic';
		this.day = CFG.today || new Date().toISOString().slice(0, 10);
		this.shake = 0; this.flash = 0; this.pop = 0; this.freeze = 0;
		this.god = false; this.cheated = false; this.godT = 0; this.assisted = false;
		this.comic = null; this.dizzy = 0; this.quip = ''; this.expr = null; this.blinkAt = 2; this.nearMisses = 0;
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
		if (store('fb_story_seen') !== '1') { this.storyIdx = 0; this.storyIntro = true; this.showOverlay('story'); }
		this.stage.focus({ preventScroll: true });
		this.last = performance.now();
		this.padPrev = {};
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
		this.stage.setAttribute('aria-label', APP + '. Hamilton the bird. ' + T.hint);

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
		if (CFG.admin) {
			// Admin only (set by the server from the admin session): god-mode toggle.
			this.godBtn = el('button', 'fb-btn-icon fb-god-btn');
			this.godBtn.type = 'button';
			this.godBtn.innerHTML = ICONS.shield;
			this.godBtn.setAttribute('aria-label', 'God mode (admin)');
			this.godBtn.setAttribute('aria-pressed', 'false');
			actions.appendChild(this.godBtn);
		}
		actions.appendChild(this.pauseBtn);
		actions.appendChild(this.muteBtn);
		hud.appendChild(actions);
		this.stage.appendChild(hud);

		this.toast = el('div', 'fb-toast');
		this.toast.setAttribute('role', 'status');
		this.stage.appendChild(this.toast);

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
		this.rebuildSprites();
	};

	/** The saved look/hat, ignoring anything not (yet) unlocked. */
	Game.prototype.outfit = function () {
		var pr = progress();
		var look = byId(LOOKS, store('fb_look') || 'classic');
		var hat = byId(HATS, store('fb_hat') || 'none');
		return {
			look: isUnlocked(look, pr) && look.colors ? look.colors : null,
			hat: isUnlocked(hat, pr) && hat.id !== 'none' ? hat.id : null
		};
	};

	Game.prototype.rebuildSprites = function () {
		this.sprites = window.FBSprite ? FBSprite.build(this.pal, this.outfit()) : null;
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
		if (name && this.toast) { clearTimeout(this.toastTimer); this.toast.classList.remove('is-on'); }
		this.pauseBtn.hidden = !(this.state === 'playing' || this.state === 'paused');
		this.overlay.classList.toggle('fb-overlay--dock', name === 'start');
		if (!name) {
			this.overlay.classList.remove('is-open');
			return;
		}
		var primary;
		if (name === 'start') {
			c.appendChild(el('h2', 'fb-title', APP));
			var bestClassic = this.bestFor('classic');
			c.appendChild(el('p', 'fb-sub', pick(TAGLINES) + (bestClassic ? ' · ' + T.best + ' ' + bestClassic : '')));
			if (CFG.startMode === 'daily') {
				// Opened from the "Daily" shortcut: lead with the daily challenge.
				primary = this.dailyButton();
				primary.className = 'fb-btn';
				c.appendChild(primary);
				var classic = el('button', 'fb-btn fb-btn-ghost', T.classic);
				classic.type = 'button';
				classic.addEventListener('click', function () { self.begin('classic'); });
				c.appendChild(classic);
			} else {
				primary = el('button', 'fb-btn', T.play);
				primary.type = 'button';
				primary.addEventListener('click', function () { self.begin('classic'); });
				c.appendChild(primary);
				c.appendChild(this.dailyButton());
			}
			c.appendChild(this.linkRow());
		} else if (name === 'goals') {
			this.goalsInto(c);
			primary = c.querySelector('.fb-back');
		} else if (name === 'story') {
			this.storyInto(c);
			primary = c.querySelector('.fb-back');
		} else if (name === 'wardrobe') {
			this.wardrobeInto(c);
			primary = c.querySelector('.fb-back');
		} else if (name === 'paused') {
			c.appendChild(el('h2', 'fb-title', T.paused));
			c.appendChild(el('p', 'fb-sub', pick(PAUSE_LINES)));
			primary = el('button', 'fb-btn', T.resume);
			primary.type = 'button';
			primary.addEventListener('click', function () { self.resume(); });
			c.appendChild(primary);
			if (navigator.vibrate) {
				var hap = el('button', 'fb-btn fb-btn-link', 'Haptics ' + (store('fb_haptics') === '0' ? 'off' : 'on'));
				hap.type = 'button';
				hap.addEventListener('click', function () { store('fb_haptics', store('fb_haptics') === '0' ? '1' : '0'); buzz(15); self.showOverlay('paused'); });
				c.appendChild(hap);
			}
		} else if (name === 'over' && data && data.cheated) {
			// God-mode run: nothing is saved, so no medal, form or leaderboard.
			c.appendChild(el('span', 'fb-tag', 'God mode run'));
			c.appendChild(el('h2', 'fb-title', T.gameOver));
			if (data.quip) { c.appendChild(el('p', 'fb-quip', data.quip)); }
			c.appendChild(this.stats(this.score, null));
			c.appendChild(el('p', 'fb-sub', 'Cheat runs are not recorded.'));
			primary = el('button', 'fb-btn', T.playAgain);
			primary.type = 'button';
			primary.addEventListener('click', function () { self.begin(); });
			c.appendChild(primary);
		} else if (name === 'over') {
			var daily = this.mode === 'daily';
			var assisted = !!(data && data.assisted);
			if (assisted) { c.appendChild(el('span', 'fb-tag', 'Assist mode')); }
			if (daily) { c.appendChild(el('span', 'fb-tag', T.daily + ' · ' + this.dayLabel())); }
			if (data.isBest) { c.appendChild(el('span', 'fb-badge', T.newBest)); }
			c.appendChild(el('h2', 'fb-title', T.gameOver));
			if (data.quip) { c.appendChild(el('p', 'fb-quip', data.quip)); }
			var medal = assisted ? null : medalFor(this.score); // assisted runs earn no medals
			if (medal) { c.appendChild(this.medalEl(medal)); }
			if (data.goals && data.goals.length) { c.appendChild(el('p', 'fb-unlock', 'Goal complete: ' + data.goals.join(', '))); }
			if (data.unlocked && data.unlocked.length) { c.appendChild(el('p', 'fb-unlock', 'Unlocked: ' + data.unlocked.join(', '))); }
			c.appendChild(this.stats(this.score, this.bestFor(this.mode), this.coins));
			if (assisted && this.score > 0) { c.appendChild(el('p', 'fb-sub', 'Assisted runs count toward your story and wardrobe, but not scores or medals.')); }
			else if (CFG.leaderboard && CFG.apiUrl && this.score > 0) { this.saveFormInto(c); }
			primary = el('button', 'fb-btn', T.playAgain);
			primary.type = 'button';
			primary.addEventListener('click', function () { self.begin(); });
			var btnRow = el('div', 'fb-btn-row'); // two buttons side by side keeps the card short
			btnRow.appendChild(primary);
			if (daily) {
				var other = el('button', 'fb-btn fb-btn-ghost', 'Classic');
				other.type = 'button';
				other.addEventListener('click', function () { self.begin('classic'); });
				btnRow.appendChild(other);
			} else {
				btnRow.appendChild(this.dailyButton(true));
			}
			c.appendChild(btnRow);
			var shareStatus = el('p', 'fb-status');
			shareStatus.setAttribute('role', 'status');
			this.shareStatus = shareStatus;
			c.appendChild(this.linkRow(true));
			c.appendChild(shareStatus);
			if (CFG.arcadeUrl) {
				var more = el('a', 'fb-btn fb-btn-link', 'More games \u203a');
				more.href = CFG.arcadeUrl;
				c.appendChild(more);
			}
			if (CFG.showBoard && CFG.apiUrl) { this.boardInto(c); }
		}
		this.overlay.classList.add('is-open');
		if (primary && name !== 'start') { primary.focus({ preventScroll: true }); }
	};

	Game.prototype.assistOn = function () { return store('fb_assist') === '1'; };

	Game.prototype.linkRow = function (withShare) {
		var self = this, pr = progress();
		var row = el('div', 'fb-link-row');
		var open = CHAPTERS.filter(function (c) { return isUnlocked(c, pr); }).length;
		var story = el('button', 'fb-btn fb-btn-link', 'Story ' + open + '/' + CHAPTERS.length);
		story.type = 'button';
		story.addEventListener('click', function () { self.storyIdx = open - 1; self.storyIntro = false; self.showOverlay('story'); });
		row.appendChild(story);
		var st = this.goalState(), done = goalsFor(this.day).filter(function (g) { return st.done[g.id]; }).length;
		var goals = el('button', 'fb-btn fb-btn-link', 'Goals ' + done + '/3');
		goals.type = 'button';
		goals.addEventListener('click', function () { self.showOverlay('goals'); });
		row.appendChild(goals);
		row.appendChild(this.wardrobeButton());
		var assist = el('button', 'fb-btn fb-btn-link' + (this.assistOn() ? ' is-on' : ''), 'Assist ' + (this.assistOn() ? 'on' : 'off'));
		assist.type = 'button';
		assist.setAttribute('aria-pressed', this.assistOn() ? 'true' : 'false');
		assist.title = 'Wider gaps and slower pipes. Assisted runs don\u2019t count toward bests, medals or the leaderboard.';
		assist.addEventListener('click', function () { store('fb_assist', self.assistOn() ? '0' : '1'); self.showOverlay(self.overlayName, self.lastOver); });
		row.appendChild(assist);
		var gh = this.loadGhost('fb_ghost_classic');
		if (gh) {
			var rm = el('button', 'fb-btn fb-btn-link', 'Rematch ' + gh.score);
			rm.type = 'button';
			rm.title = 'Race the ghost of your best classic run on the same course.';
			rm.addEventListener('click', function () { self.rematch(); });
			row.appendChild(rm);
		}
		if (withShare) {
			var sh = el('button', 'fb-btn fb-btn-link', 'Share');
			sh.type = 'button';
			sh.addEventListener('click', function () { self.shareResult(self.shareStatus || (self.shareStatus = el('span'))); });
			row.appendChild(sh);
		}
		return row;
	};

	Game.prototype.storyInto = function (c) {
		var self = this, pr = progress();
		var i = Math.max(0, Math.min(CHAPTERS.length - 1, this.storyIdx || 0)), ch = CHAPTERS[i];
		var open = isUnlocked(ch, pr);
		c.appendChild(el('span', 'fb-tag', this.storyIntro ? 'Hamilton\u2019s story' : 'Chapter ' + (i + 1) + ' of ' + CHAPTERS.length));
		c.appendChild(el('h2', 'fb-title', open ? ch.title : 'Locked'));
		var body = el('p', 'fb-story', open ? ch.text : needText(ch, pr));
		c.appendChild(body);

		if (!this.storyIntro) {
			var nav = el('div', 'fb-story-nav');
			var prev = el('button', 'fb-chip', '\u2039 Prev'), next = el('button', 'fb-chip', 'Next \u203a');
			prev.type = next.type = 'button';
			prev.disabled = i === 0; next.disabled = i === CHAPTERS.length - 1;
			prev.addEventListener('click', function () { self.storyIdx = i - 1; self.showOverlay('story'); });
			next.addEventListener('click', function () { self.storyIdx = i + 1; self.showOverlay('story'); });
			nav.appendChild(prev); nav.appendChild(next);
			c.appendChild(nav);
		}
		var back = el('button', 'fb-btn fb-back', this.storyIntro ? 'Let\u2019s fly' : 'Back');
		back.type = 'button';
		back.addEventListener('click', function () {
			store('fb_story_seen', '1');
			self.storyIntro = false;
			self.showOverlay(self.state === 'over' ? 'over' : 'start', self.lastOver);
		});
		c.appendChild(back);
	};

	Game.prototype.caption = function (text) {
		var t = this.toast;
		t.textContent = text;
		t.classList.add('is-on');
		clearTimeout(this.toastTimer);
		this.toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, 2600);
	};

	Game.prototype.wardrobeButton = function () {
		var self = this;
		var b = el('button', 'fb-btn fb-btn-link', 'Wardrobe');
		b.type = 'button';
		b.addEventListener('click', function () { self.wardNote = ''; self.showOverlay('wardrobe'); });
		return b;
	};

	Game.prototype.wardrobeInto = function (c) {
		var self = this, pr = progress();
		c.appendChild(el('h2', 'fb-title', 'Wardrobe'));
		c.appendChild(el('p', 'fb-sub', 'Pipes cleared: ' + pr.pipes + ' \u00b7 Best run: ' + pr.score));

		this.previewCanvas = el('canvas', 'fb-preview');
		this.previewCanvas.width = 20 * 5; this.previewCanvas.height = 18 * 5;
		this.previewCanvas.setAttribute('aria-hidden', 'true');
		c.appendChild(this.previewCanvas);

		var note = el('p', 'fb-status', this.wardNote || 'Tap a locked item to see how to earn it.');
		note.setAttribute('role', 'status');

		var curLook = store('fb_look') || 'classic', curHat = store('fb_hat') || 'none';
		var section = function (label, list, current, key) {
			c.appendChild(el('h3', 'fb-label', label));
			var row = el('div', 'fb-chips');
			row.setAttribute('role', 'radiogroup');
			row.setAttribute('aria-label', label);
			list.forEach(function (item) {
				var open = isUnlocked(item, pr);
				var chip = el('button', 'fb-chip' + (open ? '' : ' is-locked') + (item.id === current && open ? ' is-on' : ''));
				chip.type = 'button';
				chip.setAttribute('role', 'radio');
				chip.setAttribute('aria-checked', item.id === current && open ? 'true' : 'false');
				if (key === 'fb_look') {
					var sw = el('i', 'fb-chip-swatch');
					sw.style.background = item.colors
						? 'linear-gradient(135deg,' + item.colors.bird + ' 55%,' + item.colors.beak + ' 55%)'
						: 'linear-gradient(135deg,var(--fb-bird) 55%,var(--fb-beak) 55%)';
					chip.appendChild(sw);
				}
				chip.appendChild(document.createTextNode(item.name));
				if (!open) { chip.appendChild(el('span', 'fb-lock', '\ud83d\udd12')); chip.setAttribute('aria-label', item.name + ', locked. ' + needText(item, pr)); }
				chip.addEventListener('click', function () {
					if (!open) { self.wardNote = needText(item, pr); note.textContent = self.wardNote; return; }
					store(key, item.id);
					self.wardNote = item.name + ' equipped.';
					self.rebuildSprites();
					self.showOverlay('wardrobe');
				});
				row.appendChild(chip);
			});
			c.appendChild(row);
		};
		section('Look', LOOKS, curLook, 'fb_look');
		section('Hat', HATS, curHat, 'fb_hat');
		c.appendChild(note);

		var back = el('button', 'fb-btn fb-back', 'Back');
		back.type = 'button';
		back.addEventListener('click', function () { self.previewCanvas = null; self.showOverlay(self.state === 'over' ? 'over' : 'start', self.lastOver); });
		c.appendChild(back);
	};

	Game.prototype.drawPreview = function (now) {
		var cv = this.previewCanvas, spr = this.sprites;
		if (!cv || !spr) { return; }
		var ctx = cv.getContext('2d');
		ctx.clearRect(0, 0, cv.width, cv.height);
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(spr[BEAT[Math.floor(now / 130) % 4]], 0, 0, cv.width, cv.height);
	};

	Game.prototype.dailyButton = function (compact) {
		var self = this, done = this.bestFor('daily');
		var b = el('button', 'fb-btn fb-btn-ghost');
		b.type = 'button';
		b.appendChild(document.createTextNode((compact ? 'Daily' : T.daily) + ' · ' + this.dayLabel()));
		if (done && !compact) { b.appendChild(el('small', 'fb-btn-note', T.best + ' ' + done)); }
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

	Game.prototype.stats = function (score, best, coins) {
		var wrap = el('div', 'fb-stats');
		[[score, T.score], [best, T.best], [coins > 0 ? coins : null, 'Coins']].forEach(function (p) {
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
		input.value = store('arcade_name') || store('fb_name') || ''; // one name for every game in the arcade
		var btn = el('button', 'fb-btn', T.save);
		btn.type = 'submit';
		form.appendChild(input);
		form.appendChild(btn);
		form.addEventListener('submit', function (e) {
			e.preventDefault();
			var name = input.value.trim();
			store('fb_name', name);
			store('arcade_name', name);
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
			body: JSON.stringify({ name: name, score: score, mode: this.mode, day: this.day, replay: this.replay })
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
		if (this.godBtn) { this.godBtn.addEventListener('click', function () { self.toggleGod(); }); }
		this.muteBtn.addEventListener('click', function () { self.toggleMute(); });

		this.root.addEventListener('pointerenter', function () { self.hover = true; });
		this.root.addEventListener('pointerleave', function () { self.hover = false; });

		var single = document.querySelectorAll('.fb-game').length === 1;
		var cheatBuf = '';
		document.addEventListener('keydown', function (e) {
			if (e.metaKey || e.ctrlKey || e.altKey) { return; }
			var t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
			if (typing) { return; }
			var onButton = t && t.tagName === 'BUTTON';
			// Keys are live when this game is playing, hovered, focused, or is the only game on the page.
			var active = self.state === 'playing' || self.hover || self.root.contains(document.activeElement) ||
				(single && (document.activeElement === document.body || !document.activeElement));
			if (!active) { return; }
			if (CFG.admin && e.key && e.key.length === 1) {
				cheatBuf = (cheatBuf + e.key.toLowerCase()).slice(-5);
				if (cheatBuf === 'iddqd') { cheatBuf = ''; self.toggleGod(); return; }
			}
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
		// Every run is seeded (classic gets a random seed) so it can be replayed exactly.
		// A rematch reuses the ghost's seed so the course is identical.
		if (this.pendingGhost && this.mode !== 'daily') { this.nextSeed = this.pendingGhost.seed; }
		this.seed = this.mode === 'daily' ? seedFrom('flying-bird:' + this.day) : (this.nextSeed !== undefined ? this.nextSeed : (Math.random() * 4294967296) >>> 0);
		this.nextSeed = undefined;
		this.rng = mulberry32(this.seed);
		this.stepNo = 0; this.flaps = []; this.replay = null;
		this.ghostTrace = [];
		// The ghost of your best run on this exact course: automatic in the daily challenge, via Rematch in classic.
		this.ghost = this.mode === 'daily' ? this.loadGhost('fb_ghost_daily_' + this.day) : this.pendingGhost;
		this.pendingGhost = null;
		this.shake = this.flash = this.pop = this.freeze = 0;
		this.cheated = this.god; // a run that starts in god mode is never recorded
		this.coins = 0; this.coinList = []; this.spawned = 0; this.movingPassed = 0; this.goalsHit = [];
		this.comic = null; this.dizzy = 0; this.expr = null; this.nearMisses = 0;
		this.powerList = []; this.powerCount = 0; this.shield = false; this.slow = 0; this.magnet = 0; this.invuln = 0; this.level = 1;
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
		store('fb_story_seen', '1');
		this.storyIntro = false;
		// The daily challenge is always Normal so everyone flies the same course.
		// A rematch replays an earlier run's course, so it must use that run's difficulty and is never assisted.
		this.forceDiff = this.pendingGhost && this.mode !== 'daily' ? this.pendingGhost.diff : null;
		this.runDiffName = this.mode === 'daily' ? 'normal' : (this.forceDiff || this.diffName);
		this.diff = this.mode === 'daily' ? DIFFICULTY.normal : (this.forceDiff ? DIFFICULTY[this.forceDiff] : this.baseDiff);
		// Assist mode (not available in the daily challenge, which must be the same for everyone):
		// wider gaps and a slower scroll. Such runs never count toward bests, medals or the leaderboard.
		this.assisted = this.assistOn() && this.mode !== 'daily' && !this.pendingGhost;
		if (this.assisted) { this.diff = { gap: this.diff.gap * 1.2, speed: this.diff.speed * 0.85 }; }
		this.stage.classList.toggle('is-assist', this.assisted);
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
		this.flaps.push(this.stepNo); // lands before step number stepNo
		this.bird.anim = 0; // restart the wing-beat cycle
		this.bird.sq = 1;   // squash & stretch
		this.puff();
		snd('flap');
		buzz(8);
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

	/* ---------- Daily goals ---------- */

	Game.prototype.goalState = function () {
		var st;
		try { st = JSON.parse(store('fb_goals_' + this.day) || '{}'); } catch (e) { st = {}; }
		st.done = st.done || {};
		st.total = st.total || 0;
		return st;
	};

	Game.prototype.checkGoals = function (force) {
		if (this.cheated || this.assisted || (!force && this.state !== 'playing')) { return; }
		var st = this.goalState(), goals = goalsFor(this.day), changed = false, self = this;
		goals.forEach(function (g) {
			if (!st.done[g.id] && g.tpl.prog(self, st) >= g.target) {
				st.done[g.id] = true;
				changed = true;
				var text = g.tpl.text(g.target);
				self.goalsHit.push(text);
				if (!force) { self.caption('Goal complete: ' + text); }
			}
		});
		if (changed) {
			store('fb_goals_' + this.day, JSON.stringify(st));
			if (goals.every(function (g) { return st.done[g.id]; })) { this.bumpStreak(); }
		}
	};

	/** Finishing all three goals on a day extends the streak (once per day). */
	Game.prototype.bumpStreak = function () {
		var s;
		try { s = JSON.parse(store('fb_streak') || '{}'); } catch (e) { s = {}; }
		if (s.last === this.day) { return; }
		s = { last: this.day, n: s.last === addDays(this.day, -1) ? (s.n || 0) + 1 : 1 };
		store('fb_streak', JSON.stringify(s));
	};

	Game.prototype.streak = function () {
		var s;
		try { s = JSON.parse(store('fb_streak') || '{}'); } catch (e) { s = {}; }
		// A streak is alive if the last completed day was today or yesterday.
		return s.last === this.day || s.last === addDays(this.day, -1) ? (s.n || 0) : 0;
	};

	Game.prototype.goalsInto = function (c) {
		var self = this, st = this.goalState(), goals = goalsFor(this.day);
		c.appendChild(el('span', 'fb-tag', 'Daily goals \u00b7 ' + this.dayLabel()));
		c.appendChild(el('h2', 'fb-title', 'Today\u2019s goals'));
		var list = el('ul', 'fb-goals');
		goals.forEach(function (g) {
			var done = !!st.done[g.id], have = Math.min(g.target, g.tpl.prog({ score: 0, coins: 0, movingPassed: 0 }, st));
			var li = el('li', done ? 'is-done' : '');
			li.appendChild(el('span', 'fb-goal-mark', done ? '\u2713' : ''));
			li.appendChild(el('span', 'fb-goal-text', g.tpl.text(g.target)));
			if (g.id === 'total' && !done) { li.appendChild(el('small', null, have + '/' + g.target)); }
			list.appendChild(li);
		});
		c.appendChild(list);
		var n = this.streak();
		c.appendChild(el('p', 'fb-sub', n > 0 ? 'Streak: ' + n + (n === 1 ? ' day' : ' days') + ' in a row' : 'Finish all three to start a streak.'));
		var back = el('button', 'fb-btn fb-back', 'Back');
		back.type = 'button';
		back.addEventListener('click', function () { self.showOverlay(self.state === 'over' ? 'over' : 'start', self.lastOver); });
		c.appendChild(back);
	};

	// Admin-only god mode: you can't die. The run is flagged and never recorded.
	Game.prototype.toggleGod = function () {
		if (!CFG.admin) { return; }
		this.god = !this.god;
		if (this.god) { this.cheated = true; }
		if (this.godBtn) {
			this.godBtn.classList.toggle('is-on', this.god);
			this.godBtn.setAttribute('aria-pressed', this.god ? 'true' : 'false');
		}
		this.stage.classList.toggle('is-god', this.god);
		this.caption(this.god ? 'God mode on \u00b7 this run won\u2019t be recorded' : 'God mode off');
	};

	Game.prototype.die = function (reason) {
		var self = this;
		this.state = 'over';
		this.overAt = performance.now();
		if (window.FBAudio) { FBAudio.musicStop(); }
		snd(reason === 'pipe' ? 'hit' : 'die');
		buzz([50, 30, 80]);
		// A comic-book "BONK!", dizzy stars, a cartoon boing and a joke for the card.
		this.comic = { text: pick(COMICS[reason] || COMICS.pipe), t: 0, size: 40 };
		this.dizzy = 2.6;
		this.quip = this.chooseQuip(reason);
		if (reason === 'pipe') { setTimeout(function () { snd('boing'); }, 140); }
		if (!reducedMotion) {
			this.shake = 0.4;
			this.flash = 1;
			this.freeze = 0.07; // brief hit-stop makes the impact land
			for (var i = 0; i < 18; i++) {
				var a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 240;
				this.particles.push({ x: BIRD_X, y: this.bird.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 1, r: 2 + Math.random() * 3 });
			}
		}
		if (this.cheated) {
			// God-mode runs never touch scores, medals, bests or unlocks.
			var self0 = this;
			setTimeout(function () {
				self0.lastOver = { cheated: true, quip: self0.quip };
				if (self0.state === 'over') { self0.showOverlay('over', self0.lastOver); }
			}, reducedMotion ? 0 : 420);
			return;
		}

		// Package the run so the server can re-play it and confirm the score (assisted runs are never submitted).
		if (!this.assisted) {
			var deltas = [], prevStep = 0;
			for (var fi = 0; fi < this.flaps.length; fi++) { deltas.push(this.flaps[fi] - prevStep); prevStep = this.flaps[fi]; }
			this.saveGhost();
			this.replay = { v: 1, seed: this.seed, mode: this.mode, day: this.mode === 'daily' ? this.day : '', difficulty: this.runDiffName, steps: this.stepNo, flaps: deltas, score: this.score };
		}

		// Run totals for goals and the coin stat (cheat runs returned above).
		this.checkGoals(true); // uses today's total *before* this run is added
		if (!this.assisted) {
			var gst = this.goalState();
			gst.total += this.score;
			store('fb_goals_' + this.day, JSON.stringify(gst));
		}
		if (this.coins > 0) { store('fb_coins', String((parseInt(store('fb_coins'), 10) || 0) + this.coins)); }

		// Lifetime progress drives the wardrobe unlocks.
		var before = progress();
		var all = LOOKS.concat(HATS, CHAPTERS).filter(function (it) { return it.need; });
		var wasOpen = all.map(function (it) { return isUnlocked(it, before); });
		store('fb_total', String(before.pipes + this.score));
		if (!this.assisted && this.score > before.score) { store('fb_max', String(this.score)); }
		if (this.mode === 'daily' && this.score > 0) { store('fb_dp', '1'); }
		var after = progress(), unlocked = [];
		all.forEach(function (it, i) {
			if (!wasOpen[i] && isUnlocked(it, after)) { unlocked.push(it.title ? 'Story: ' + it.title : it.name + (LOOKS.indexOf(it) >= 0 ? ' look' : '')); }
		});

		var goalsDone = this.goalsHit.slice();
		var key = this.bestKey(this.mode), prev = this.bestFor(this.mode);
		var isBest = !this.assisted && this.score > prev;
		if (isBest) { store(key, String(this.score)); }
		// Let the crash play out before the card slides in.
		setTimeout(function () {
			self.lastOver = { isBest: isBest && self.score > 0, unlocked: unlocked, goals: goalsDone, assisted: self.assisted, quip: self.quip };
			if (self.state === 'over') { self.showOverlay('over', self.lastOver); }
		}, reducedMotion ? 0 : 420);
	};

	/** A joke that fits what just happened. */
	Game.prototype.chooseQuip = function (reason) {
		var pool = QUIPS[reason] || QUIPS.pipe, extra = [];
		if (this.score === 0) { return 'Hamilton didn\u2019t even leave the hill.'; }
		if (this.score >= 40) { extra.push('An absolute legend. Briefly.'); }
		if (this.coins >= 5) { extra.push('Died with ' + this.coins + ' coins. Worth it?'); }
		if (this.nearMisses >= 3) { extra.push('Lived dangerously. Died dangerously.'); }
		if (this.powerCount >= 2) { extra.push('So many power-ups. So little survival.'); }
		if (this.level >= 4) { extra.push('Level ' + this.level + ' and still bonking.'); }
		// Situational jokes are more likely than the generic ones, but not guaranteed.
		var list = extra.length && Math.random() < 0.65 ? extra : pool;
		return pick(list, this.quip);
	};

	// A little trail of feathers behind the bird on each flap.
	Game.prototype.puff = function () {
		if (reducedMotion) { return; }
		for (var i = 0; i < 3; i++) {
			this.particles.push({ x: BIRD_X - 18, y: this.bird.y + 6 + i * 4, vx: -50 - Math.random() * 50, vy: 25 + Math.random() * 35, life: 0.55, r: 2 + Math.random() * 2, puff: true });
		}
	};

	/* ---------- Simulation ---------- */

	// Difficulty ramps by level (every 8 pipes): gaps tighten a little, moving pipes appear more
	// often and swing wider and faster, and narrow pipes join from level 3. Power-ups and coins float
	// between pipes. The generator is always drawn from five times per pipe, so the daily course is
	// identical for every player.
	Game.prototype.spawnPipe = function (x) {
		var n = this.spawned++, level = levelOf(n);
		var u1 = this.rng(), u2 = this.rng(), u3 = this.rng(), u4 = this.rng(), u5 = this.rng();
		var pMove = n >= 5 ? Math.min(0.5, 0.15 + 0.05 * (level - 1)) : 0;
		var pNarrow = level >= 3 ? Math.min(0.3, 0.1 + 0.04 * (level - 3)) : 0;
		var kind = 'normal';
		if (u2 < pMove) { kind = 'moving'; } else if (u2 < pMove + pNarrow) { kind = 'narrow'; }
		var gap = this.diff.gap * Math.max(0.82, 1 - 0.025 * (level - 1)) * (kind === 'narrow' ? 0.88 : 1);
		var amp = kind === 'moving' ? Math.min(60, 30 + 5 * (level - 1)) : 0, margin = 90;
		var freq = Math.min(2.3, 1.5 + 0.1 * (level - 1));
		var min = margin + gap / 2 + amp, max = H - GROUND - margin - gap / 2 - amp;
		var target = min + u1 * (max - min);
		// Limit the jump between consecutive gaps so every course is passable.
		var baseY = Math.max(min, Math.min(max, this.lastGapY + Math.max(-170, Math.min(170, target - this.lastGapY))));
		this.lastGapY = baseY;
		var phase = u1 * 6.283;
		this.pipes.push({ x: x, baseY: baseY, gapY: baseY + amp * Math.sin(phase), gap: gap, kind: kind, amp: amp, freq: freq, t: phase, passed: false });
		var mid = x + PIPE_W / 2 + PIPE_SPACING / 2;
		if (n >= 4 && u3 < 0.14) {
			this.powerList.push({ x: mid, y: Math.max(150, Math.min(H - GROUND - 60, baseY + (u5 - 0.5) * 80)), kind: POWER_KEYS[Math.floor(u4 * POWER_KEYS.length)] });
		} else if (n >= 2 && u3 < 0.55) {
			this.coinList.push({ x: mid, y: baseY });
		}
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
		this.dizzy = Math.max(0, this.dizzy - dt);
		if (this.expr) { this.expr.t -= dt; if (this.expr.t <= 0) { this.expr = null; } }
		this.blinkAt -= dt;
		if (this.blinkAt <= 0) { // idle blink
			this.blinkAt = 2.4 + Math.random() * 2.6;
			if (!this.expr && this.state !== 'over') { this.expr = { n: 'blink', t: 0.13 }; }
		}
		if (this.comic) { this.comic.t += dt; if (this.comic.t > 1.1) { this.comic = null; } }
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

		this.stepNo++;
		if ((this.stepNo & 1) === 0) { this.ghostTrace.push(Math.round(this.bird.y)); }
		this.playMs += dt * 1000; // real time, so slow-mo can never make a score look too fast
		// Power-up timers run in real time; slow-mo then stretches the world's time.
		this.invuln = Math.max(0, this.invuln - dt);
		this.slow = Math.max(0, this.slow - dt);
		this.magnet = Math.max(0, this.magnet - dt);
		if (this.slow > 0) { dt *= 0.62; }
		this.speed = this.diff.speed + Math.min(this.score * 2.5, 60);
		this.distance += this.speed * dt;

		b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL);
		b.y += b.vy * dt;
		b.rot = Math.max(-0.4, Math.min(0.8, b.vy / 650));
		b.anim += dt;
		if (b.y < BIRD_R) { b.y = BIRD_R; b.vy = 0; }
		if (this.god && !reducedMotion) {
			this.godT += dt;
			if (this.godT > 0.04) {
				this.godT = 0;
				this.particles.push({ x: BIRD_X - 22, y: b.y + 4 + (Math.random() - 0.5) * 8, vx: -90, vy: 0, life: 0.5, r: 3, puff: true, hue: (this.distance * 1.5) % 360 });
			}
		}

		// Coins drift with the pipes; touch one to collect it.
		for (i = this.coinList.length - 1; i >= 0; i--) {
			var coin = this.coinList[i];
			coin.x -= this.speed * dt;
			if (this.magnet > 0) {
				var mx = BIRD_X - coin.x, my = b.y - coin.y;
				if (mx * mx + my * my < 190 * 190) { var pull = Math.min(1, dt * 5); coin.x += mx * pull; coin.y += my * pull; }
			}
			var cdx = coin.x - BIRD_X, cdy = coin.y - b.y;
			if (cdx * cdx + cdy * cdy < (BIRD_R + COIN_R - 2) * (BIRD_R + COIN_R - 2)) {
				this.coinList.splice(i, 1);
				this.coins++;
				snd('coin');
				buzz(12);
				this.setExpr('love', 0.7);
				if (Math.random() < 0.18) { this.say(pick(CHEERS.coin), 28); }
				this.sparkle(coin.x, coin.y);
				this.checkGoals();
			} else if (coin.x < -COIN_R * 2) {
				this.coinList.splice(i, 1);
			}
		}

		for (i = this.powerList.length - 1; i >= 0; i--) {
			var pw = this.powerList[i];
			pw.x -= this.speed * dt;
			var pdx = pw.x - BIRD_X, pdy = pw.y - b.y;
			if (pdx * pdx + pdy * pdy < (BIRD_R + POWER_R - 2) * (BIRD_R + POWER_R - 2)) {
				this.powerList.splice(i, 1);
				this.applyPower(pw.kind, pw.x, pw.y);
			} else if (pw.x < -POWER_R * 2) {
				this.powerList.splice(i, 1);
			}
		}

		for (i = this.pipes.length - 1; i >= 0; i--) {
			var pipe = this.pipes[i];
			pipe.x -= this.speed * dt;
			if (pipe.kind === 'moving') {
				pipe.t += dt * (pipe.freq || 1.7);
				pipe.gapY = pipe.baseY + pipe.amp * Math.sin(pipe.t);
			}
			if (pipe.x + PIPE_W < -10) { this.pipes.splice(i, 1); continue; }
			if (!pipe.passed && pipe.x + PIPE_W < BIRD_X - BIRD_R) {
				pipe.passed = true;
				this.score++;
				if (pipe.kind === 'moving') { this.movingPassed++; }
				if (pipe.minClear !== undefined && pipe.minClear < 9) {
					// Squeaked through: wide eyes, a sweat drop and relief.
					this.nearMisses++;
					this.setExpr('worried', 0.9);
					this.say('PHEW!', 30);
					snd('phew');
				} else {
					this.setExpr('happy', 0.35);
				}
				this.checkGoals();
				this.pop = 1;
				snd('point', this.score);
				if (window.FBAudio) { FBAudio.setIntensity(this.score); }
				if (this.score % LEVEL_EVERY === 0) {
					this.level = levelOf(this.score);
					this.caption('Level ' + this.level);
					snd('level');
					this.setExpr('happy', 1.1);
					this.say(pick(CHEERS.level), 34);
					buzz([20, 40, 20]);
				} else if (CAPTIONS[this.score]) { this.caption(CAPTIONS[this.score]); }
				if (CHEERS.milestone[this.score]) { this.setExpr('happy', 1); this.say(CHEERS.milestone[this.score], 34); }
			}
			if (pipe.x < BIRD_X + BIRD_R && pipe.x + PIPE_W > BIRD_X - BIRD_R) { // bird is alongside this pipe: how close was it?
				var ph = (pipe.gap || this.diff.gap) / 2;
				var clear = Math.min(b.y - (pipe.gapY - ph), (pipe.gapY + ph) - b.y) - BIRD_R;
				pipe.minClear = pipe.minClear === undefined ? clear : Math.min(pipe.minClear, clear);
			}
			if (!this.god && this.invuln <= 0 && this.hits(pipe)) {
				if (this.shield) { this.breakShield(); } else { this.die('pipe'); return; }
			}
		}
		var lastPipe = this.pipes[this.pipes.length - 1];
		if (!lastPipe || lastPipe.x < W - PIPE_SPACING + 40) { this.spawnPipe(W + 40); }

		if (b.y + BIRD_R >= H - GROUND) {
			b.y = H - GROUND - BIRD_R;
			if (this.god) { b.vy = 0; }
			else if (this.invuln > 0 || this.shield) {
				// The shield saves you from the floor too: bounce back up.
				if (this.invuln <= 0) { this.breakShield(); }
				b.vy = FLAP * 0.9; b.sq = 1;
			} else { this.die('ground'); }
		}
	};

	// Circle (bird) vs the two pipe rectangles.
	Game.prototype.hits = function (pipe) {
		var b = this.bird, half = (pipe.gap || this.diff.gap) / 2;
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

	/** Gamepad: A/B/X/Y or D-pad up flaps (and starts/restarts), Start pauses, Back/Select mutes. */
	Game.prototype.pollPad = function () {
		if (!navigator.getGamepads) { return; }
		var pads = navigator.getGamepads(), pad = null, i;
		for (i = 0; i < pads.length; i++) { if (pads[i] && pads[i].connected) { pad = pads[i]; break; } }
		if (!pad) { return; }
		var now = {}, prev = this.padPrev;
		[0, 1, 2, 3, 12, 8, 9].forEach(function (b) { now[b] = !!(pad.buttons[b] && pad.buttons[b].pressed); });
		var edge = function (b) { return now[b] && !prev[b]; };
		if (edge(0) || edge(1) || edge(2) || edge(3) || edge(12)) {
			if (this.state === 'paused') { this.resume(); } else { this.flap(); }
		}
		if (edge(9)) { if (this.state === 'ready' || this.state === 'over') { this.flap(); } else { this.togglePause(); } }
		if (edge(8)) { this.toggleMute(); }
		this.padPrev = now;
	};

	Game.prototype.frame = function (now) {
		var elapsed = Math.min((now - this.last) / 1000, 0.1);
		this.last = now;
		this.pollPad();
		// Fixed-step simulation: identical inputs give an identical run on any device or frame rate.
		this.acc = (this.acc || 0) + elapsed;
		var n = 0;
		while (this.acc >= STEP && n < 6) { this.update(STEP); this.acc -= STEP; n++; }
		if (n === 6) { this.acc = 0; } // very slow device: drop time instead of spiralling
		this.draw();
		if (this.previewCanvas && this.overlayName === 'wardrobe') { this.drawPreview(now); }
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
		for (i = 0; i < this.pipes.length; i++) {
			var p = this.pipes[i], half = (p.gap || this.diff.gap) / 2;
			this.drawPipe(ctx, p.x, -10, p.gapY - half + 10, true);
			this.drawPipe(ctx, p.x, p.gapY + half, H - GROUND - (p.gapY + half), false);
			if (p.kind === 'moving') { this.drawArrows(ctx, p, half); }
		}

		// Power-ups: a coloured badge that bobs.
		var tPow = performance.now();
		for (i = 0; i < this.powerList.length; i++) {
			var pu = this.powerList[i];
			this.drawPowerIcon(ctx, pu.kind, pu.x, pu.y + Math.sin(tPow / 260 + pu.x * 0.05) * 4, POWER_R);
		}

		// Coins: a spinning gold disc.
		var tNow = performance.now();
		for (i = 0; i < this.coinList.length; i++) {
			var cn = this.coinList[i];
			var spin = Math.max(0.2, Math.abs(Math.cos(tNow / 260 + cn.x * 0.04)));
			var cy = cn.y + Math.sin(tNow / 220 + cn.x * 0.05) * 3;
			ctx.fillStyle = '#1a1424';
			ctx.beginPath(); ctx.ellipse(cn.x, cy, COIN_R * spin + 2, COIN_R + 2, 0, 0, Math.PI * 2); ctx.fill();
			ctx.fillStyle = '#ffd23f';
			ctx.beginPath(); ctx.ellipse(cn.x, cy, COIN_R * spin, COIN_R, 0, 0, Math.PI * 2); ctx.fill();
			ctx.fillStyle = 'rgba(255,255,255,.6)';
			ctx.fillRect(cn.x - 2 * spin, cy - 6, 3 * spin, 7);
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
			ctx.fillStyle = q.hue !== undefined ? 'hsl(' + Math.round(q.hue) + ',90%,60%)' : (q.puff ? '#ffffff' : P.bird);
			ctx.fillRect(Math.round(q.x - q.r), Math.round(q.y - q.r), q.r * 2, q.r * 2);
		}
		ctx.globalAlpha = 1;

		this.drawGhost(ctx);
		this.drawBird(ctx);
		this.drawComic(ctx);

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

		// Slow-mo tint, level label and active power-up chips.
		if (this.slow > 0) {
			ctx.fillStyle = 'rgba(140,100,255,.10)';
			ctx.fillRect(0, 0, W, H);
		}
		if (this.state === 'playing' || this.state === 'paused') {
			ctx.font = '700 13px ' + (getComputedStyle(this.root).fontFamily || 'sans-serif');
			ctx.textAlign = 'center'; ctx.fillStyle = P.ink; ctx.globalAlpha = 0.55;
			ctx.fillText('LEVEL ' + this.level, W / 2, 126);
			ctx.globalAlpha = 1;
			var chips = [];
			if (this.shield) { chips.push(['shield', 1]); }
			if (this.slow > 0) { chips.push(['slow', this.slow / POWERS.slow.time]); }
			if (this.magnet > 0) { chips.push(['magnet', this.magnet / POWERS.magnet.time]); }
			for (i = 0; i < chips.length; i++) {
				var cx0 = W / 2 + (i - (chips.length - 1) / 2) * 44;
				this.drawPowerIcon(ctx, chips[i][0], cx0, 150, 11);
				ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(cx0 - 12, 168, 24, 4);
				ctx.fillStyle = POWERS[chips[i][0]].color; ctx.fillRect(cx0 - 12, 168, 24 * chips[i][1], 4);
			}
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

	Game.prototype.applyPower = function (kind, x, y) {
		var pw = POWERS[kind];
		if (kind === 'shield') { this.shield = true; }
		else if (kind === 'slow') { this.slow = pw.time; }
		else if (kind === 'magnet') { this.magnet = pw.time; }
		this.powerCount++;
		snd('power');
		buzz(25);
		this.setExpr(kind === 'slow' ? 'sleepy' : 'smug', 1.4);
		this.say(kind === 'shield' ? 'SHIELD UP!' : (kind === 'slow' ? 'ZZZ...' : 'ZZZAP!'), 28);
		this.sparkle(x, y);
		this.caption(pw.name + '!');
		this.checkGoals();
	};

	Game.prototype.breakShield = function () {
		this.shield = false;
		this.invuln = 1.2; // a moment of grace to get clear of whatever you hit
		snd('shield');
		buzz([30, 20, 30]);
		this.setExpr('shocked', 0.9);
		this.say('WHOA!', 34);
		this.caption('Shield broken');
		if (!reducedMotion) {
			for (var i = 0; i < 14; i++) {
				var a = (i / 14) * Math.PI * 2;
				this.particles.push({ x: BIRD_X, y: this.bird.y, vx: Math.cos(a) * 170, vy: Math.sin(a) * 170, life: 0.5, r: 2.5, puff: true, hue: 195 });
			}
		}
	};

	/** Small power-up glyph centred on (x, y). */
	Game.prototype.drawPowerIcon = function (ctx, kind, x, y, r) {
		var col = POWERS[kind].color;
		ctx.fillStyle = '#1a1424';
		ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fill();
		ctx.fillStyle = col;
		ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
		ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineCap = 'round';
		var k = r / 13;
		if (kind === 'shield') {
			ctx.beginPath();
			ctx.moveTo(x, y - 7 * k); ctx.lineTo(x + 6 * k, y - 4 * k); ctx.lineTo(x + 6 * k, y + 1 * k);
			ctx.quadraticCurveTo(x + 5 * k, y + 6 * k, x, y + 8 * k);
			ctx.quadraticCurveTo(x - 5 * k, y + 6 * k, x - 6 * k, y + 1 * k);
			ctx.lineTo(x - 6 * k, y - 4 * k); ctx.closePath(); ctx.fill();
		} else if (kind === 'slow') {
			ctx.lineWidth = 2 * k;
			ctx.beginPath(); ctx.arc(x, y, 6 * k, 0, Math.PI * 2); ctx.stroke();
			ctx.beginPath(); ctx.moveTo(x, y - 4 * k); ctx.lineTo(x, y); ctx.lineTo(x + 3 * k, y + 2 * k); ctx.stroke();
		} else {
			ctx.lineWidth = 3.2 * k;
			ctx.beginPath(); ctx.arc(x, y + 1 * k, 5 * k, 0, Math.PI); ctx.stroke();
			ctx.fillRect(x - 6.6 * k, y - 6 * k, 3.2 * k, 7 * k);
			ctx.fillRect(x + 3.4 * k, y - 6 * k, 3.2 * k, 7 * k);
		}
	};

	// Little chevrons on a moving pipe's gap edges so you can see it will move.
	Game.prototype.drawArrows = function (ctx, p, half) {
		var cx = p.x + PIPE_W / 2;
		ctx.fillStyle = 'rgba(255,255,255,.7)';
		[[p.gapY - half - 30, -1], [p.gapY + half + 30, 1]].forEach(function (a) {
			ctx.beginPath();
			ctx.moveTo(cx - 8, a[0] - a[1] * 4); ctx.lineTo(cx + 8, a[0] - a[1] * 4); ctx.lineTo(cx, a[0] + a[1] * 6);
			ctx.closePath(); ctx.fill();
		});
	};

	Game.prototype.sparkle = function (x, y) {
		if (reducedMotion) { return; }
		for (var i = 0; i < 8; i++) {
			var a = (i / 8) * Math.PI * 2;
			this.particles.push({ x: x, y: y, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, life: 0.45, r: 2, puff: true, hue: 48 });
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
	Game.prototype.wingPose = function () {
		var b = this.bird;
		if (this.state === 'over') { return 'down'; }
		if (this.state === 'ready' || this.state === 'paused' && b.anim > 50) {
			return BEAT[Math.floor(performance.now() / 130) % 4];
		}
		return b.anim < 0.3 ? BEAT[Math.min(3, Math.floor(b.anim / 0.075))] : 'mid';
	};

	/* ---------- Ghost replays ---------- */

	Game.prototype.ghostKey = function () { return this.mode === 'daily' ? 'fb_ghost_daily_' + this.day : 'fb_ghost_classic'; };

	Game.prototype.loadGhost = function (key) {
		try {
			var g = JSON.parse(store(key) || 'null');
			return g && Array.isArray(g.trace) && g.trace.length > 4 ? g : null;
		} catch (e) { return null; }
	};

	/** Keep the trace of your best run on this course (assisted and god-mode runs never get here). */
	Game.prototype.saveGhost = function () {
		if (this.score < 3 || this.stepNo > 20000) { return; }
		var key = this.ghostKey(), old = this.loadGhost(key);
		if (old && this.score <= old.score) { return; }
		store(key, JSON.stringify({ score: this.score, seed: this.seed, diff: this.runDiffName, trace: this.ghostTrace }));
	};

	/** Race the ghost of your best classic run on its own course. */
	Game.prototype.rematch = function () {
		var g = this.loadGhost('fb_ghost_classic');
		if (!g) { return; }
		this.pendingGhost = g;
		this.begin('classic');
	};

	Game.prototype.drawGhost = function (ctx) {
		var gh = this.ghost, spr = this.sprites;
		if (!gh || !spr || (this.state !== 'playing' && this.state !== 'paused')) { return; }
		var gi = this.stepNo / 2, tr = gh.trace;
		if (gi >= tr.length - 1) { return; } // the ghost's run has ended
		var i0 = Math.floor(gi), gy = tr[i0] + (tr[i0 + 1] - tr[i0]) * (gi - i0);
		ctx.save();
		ctx.globalAlpha = 0.38;
		ctx.translate(BIRD_X, gy);
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(spr.mid, -8 * 3, -9.5 * 3, FBSprite.width * 3, FBSprite.height * 3);
		ctx.restore();
		ctx.globalAlpha = 0.55;
		ctx.fillStyle = this.pal.ink;
		ctx.font = '700 11px ' + (getComputedStyle(this.root).fontFamily || 'sans-serif');
		ctx.textAlign = 'center';
		ctx.fillText('BEST ' + gh.score, BIRD_X, gy - 34);
		ctx.globalAlpha = 1;
	};

	/* ---------- Share card ---------- */

	/** Draw a 1080x1350 image of this result and resolve with a PNG blob. */
	Game.prototype.renderShareCard = function () {
		var W2 = 1080, H2 = 1350, P = this.pal, spr = this.sprites;
		var cv = document.createElement('canvas');
		cv.width = W2; cv.height = H2;
		var x = cv.getContext('2d'), font = getComputedStyle(this.root).fontFamily || 'sans-serif';
		var sky = x.createLinearGradient(0, 0, 0, H2);
		sky.addColorStop(0, P.bg1); sky.addColorStop(1, P.bg2);
		x.fillStyle = sky; x.fillRect(0, 0, W2, H2);
		// soft hills
		[[0.78, 0.5, 70, 0.006], [0.88, 0.85, 50, 0.01]].forEach(function (h) {
			x.globalAlpha = h[1]; x.fillStyle = P.hill; x.beginPath(); x.moveTo(0, H2);
			for (var px = 0; px <= W2; px += 12) { x.lineTo(px, H2 * h[0] + Math.sin(px * h[3] + h[0] * 9) * h[2]); }
			x.lineTo(W2, H2); x.closePath(); x.fill();
		});
		x.globalAlpha = 1;
		x.textAlign = 'center';
		x.fillStyle = P.ink;
		x.font = '800 64px ' + font; x.fillText(APP.toUpperCase(), W2 / 2, 120);
		var sub = this.mode === 'daily' ? 'Daily challenge \u00b7 ' + this.dayLabel() : 'Level ' + this.level;
		x.globalAlpha = 0.7; x.font = '600 40px ' + font; x.fillText(sub, W2 / 2, 184); x.globalAlpha = 1;
		// Hamilton, mid-bonk
		if (spr) {
			x.imageSmoothingEnabled = false;
			x.drawImage(spr.dead || spr.mid, W2 / 2 - 150, 250, 20 * 15, 18 * 15);
		}
		x.font = '900 340px ' + font; x.fillStyle = P.ink;
		x.fillText(String(this.score), W2 / 2, 820);
		x.globalAlpha = 0.6; x.font = '700 38px ' + font; x.fillText('POINTS', W2 / 2, 880); x.globalAlpha = 1;
		var medal = this.assisted ? null : medalFor(this.score);
		if (medal) {
			var mc = { bronze: ['#f0b27a', '#b9692f'], silver: ['#f4f6f8', '#a9b3bd'], gold: ['#ffe680', '#d9a21b'] }[medal.key];
			var mg = x.createRadialGradient(W2 / 2 - 14, 975, 8, W2 / 2, 990, 70); mg.addColorStop(0, mc[0]); mg.addColorStop(1, mc[1]);
			x.fillStyle = mg; x.beginPath(); x.arc(W2 / 2, 990, 64, 0, Math.PI * 2); x.fill();
			x.fillStyle = 'rgba(0,0,0,.55)'; x.font = '800 22px ' + font; x.fillText(medal.label.toUpperCase(), W2 / 2, 997);
		}
		// the joke, wrapped
		x.fillStyle = P.ink; x.globalAlpha = 0.85; x.font = 'italic 600 42px ' + font;
		var words = (this.quip || '').split(' '), line = '', ly = medal ? 1120 : 1040;
		words.forEach(function (w) {
			var test = line ? line + ' ' + w : w;
			if (x.measureText(test).width > W2 - 200 && line) { x.fillText(line, W2 / 2, ly); ly += 56; line = w; } else { line = test; }
		});
		if (line) { x.fillText(line, W2 / 2, ly); }
		x.globalAlpha = 0.65; x.font = '600 34px ' + font; x.fillText(this.shareUrl().replace(/^https?:\/\//, ''), W2 / 2, H2 - 56); x.globalAlpha = 1;
		return new Promise(function (resolve) { cv.toBlob(resolve, 'image/png'); });
	};

	Game.prototype.shareUrl = function () { return CFG.publicUrl || (location.origin + location.pathname.replace(/[^/]*$/, '')); };

	Game.prototype.shareResult = function (status) {
		var self = this, text = APP + ': I scored ' + this.score + (this.mode === 'daily' ? ' in the daily challenge' : ' (level ' + this.level + ')') + ' as Hamilton. Can you beat it? ' + this.shareUrl();
		status.textContent = '\u2026';
		return this.renderShareCard().then(function (blob) {
			var file = new File([blob], 'beberd-score.png', { type: 'image/png' });
			if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
				return navigator.share({ files: [file], title: APP, text: text, url: self.shareUrl() }).then(function () { status.textContent = 'Shared'; }, function () { status.textContent = ''; });
			}
			// No native sharing (most desktops): save the picture and copy the text.
			var a = document.createElement('a');
			a.href = URL.createObjectURL(blob); a.download = 'beberd-score.png';
			document.body.appendChild(a); a.click(); a.remove();
			setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
			if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).catch(function () {}); }
			status.textContent = 'Image saved \u00b7 text copied';
		});
	};

	/** Which face Hamilton is pulling right now (null = the default one). */
	Game.prototype.faceName = function () {
		if (this.state === 'over') { return 'dead'; }
		if (this.expr) { return this.expr.n; }
		return this.slow > 0 ? 'sleepy' : null; // slow-mo makes him drowsy
	};

	/** Hamilton pulls a face for a moment. */
	Game.prototype.setExpr = function (name, secs) {
		if (this.state === 'over') { return; }
		this.expr = { n: name, t: secs };
	};

	/** A comic-book word bursts out next to Hamilton. */
	Game.prototype.say = function (text, size) {
		this.comic = { text: text, t: 0, size: size || 30 };
	};

	/** Dizzy stars circling Hamilton's head, plus the comic-book "BONK!" burst. */
	Game.prototype.drawComic = function (ctx) {
		var b = this.bird, now = performance.now();
		if (this.state === 'over' && this.dizzy > 0) {
			var fade = Math.min(1, this.dizzy / 0.6);
			for (var k = 0; k < 3; k++) {
				var ang = now / 260 + (k * Math.PI * 2) / 3;
				var sx = BIRD_X + Math.cos(ang) * 24, sy = b.y - 30 + Math.sin(ang) * 7;
				ctx.globalAlpha = fade;
				ctx.fillStyle = '#1a1424';
				ctx.fillRect(sx - 6, sy - 2, 12, 4); ctx.fillRect(sx - 2, sy - 6, 4, 12);
				ctx.fillStyle = '#ffd23f';
				ctx.fillRect(sx - 5, sy - 1, 10, 2); ctx.fillRect(sx - 1, sy - 5, 2, 10);
			}
			ctx.globalAlpha = 1;
		}
		if (this.comic) {
			var t = this.comic.t, rise = reducedMotion ? 0 : Math.min(1, t * 6) * 22;
			var alpha = t < 0.8 ? 1 : Math.max(0, 1 - (t - 0.8) / 0.3);
			var scale = reducedMotion ? 1 : 0.6 + 0.5 * Math.min(1, t * 8);
			ctx.save();
			ctx.translate(BIRD_X + 70, b.y - 50 - rise);
			ctx.rotate(-0.14);
			ctx.scale(scale, scale);
			ctx.globalAlpha = alpha;
			var fs = this.comic.size || 40;
			ctx.font = '900 ' + fs + 'px ' + (getComputedStyle(this.root).fontFamily || 'sans-serif');
			ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
			ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(5, fs / 5); ctx.strokeStyle = '#1a1424';
			ctx.strokeText(this.comic.text, 0, 0);
			ctx.fillStyle = '#ffd23f';
			ctx.fillText(this.comic.text, 0, 0);
			ctx.restore();
			ctx.globalAlpha = 1;
		}
	};

	Game.prototype.drawBird = function (ctx) {
		var b = this.bird, spr = this.sprites;
		if (!spr) { return; }
		var S = 3; // logical px per sprite pixel
		var rot = Math.round(b.rot * 8) / 8; // stepped tilt keeps the pixels crisp
		ctx.save();
		ctx.translate(BIRD_X, b.y);
		if (this.god) { ctx.globalAlpha = 0.7 + 0.15 * Math.sin(performance.now() / 120); }
		else if (this.invuln > 0 && Math.floor(performance.now() / 90) % 2) { ctx.globalAlpha = 0.35; }
		if (this.shield) {
			var pulse = 1 + 0.05 * Math.sin(performance.now() / 150);
			ctx.fillStyle = 'rgba(76,201,240,.18)'; ctx.strokeStyle = 'rgba(76,201,240,.95)'; ctx.lineWidth = 2;
			ctx.beginPath(); ctx.arc(0, 0, 28 * pulse, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
		}
		ctx.rotate(rot);
		ctx.scale(1 - 0.12 * b.sq, 1 + 0.18 * b.sq); // squash & stretch on flap
		ctx.imageSmoothingEnabled = false;
		var pose = this.wingPose(), face = this.faceName();
		var frame = face === 'dead' && spr.dead ? spr.dead : (face && spr[pose + ':' + face]) || spr[pose];
		ctx.drawImage(frame, -8 * S, -9.5 * S, FBSprite.width * S, FBSprite.height * S);
		ctx.restore();
	};

	function init() {
		if (CFG.arcadeUrl && !document.querySelector('.fb-arcade')) { // "back to the arcade" link when hosted in a hub
			var back = document.createElement('a');
			back.className = 'fb-arcade';
			back.href = CFG.arcadeUrl;
			back.textContent = '\u2039 Arcade';
			document.body.appendChild(back);
		}
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
