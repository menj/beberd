/*
 * Flying Bird – synthesised audio (Web Audio, no files to download).
 * Sound effects plus a quiet pentatonic loop whose tempo rises with the score.
 * Browsers only allow audio after a tap/keypress, so call FBAudio.unlock()
 * from a user gesture.
 */
(function () {
	'use strict';

	var ctx = null, master = null, musicGain = null, noiseBuf = null;
	var muted = false, musicEnabled = true;
	var timer = null, nextTime = 0, step = 0, intensity = 0;

	function unlock() {
		if (!ctx) {
			var AC = window.AudioContext || window.webkitAudioContext;
			if (!AC) { return false; }
			ctx = new AC();
			master = ctx.createGain();
			master.gain.value = muted ? 0 : 0.9;
			master.connect(ctx.destination);
			musicGain = ctx.createGain();
			musicGain.gain.value = 0.5;
			musicGain.connect(master);
			noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
			var d = noiseBuf.getChannelData(0);
			for (var i = 0; i < d.length; i++) { d[i] = Math.random() * 2 - 1; }
		}
		if (ctx.state === 'suspended') { ctx.resume(); }
		return true;
	}

	function tone(type, f0, f1, dur, vol, when, dest) {
		var t = when || ctx.currentTime;
		var o = ctx.createOscillator(), g = ctx.createGain();
		o.type = type;
		o.frequency.setValueAtTime(f0, t);
		if (f1 && f1 !== f0) { o.frequency.exponentialRampToValueAtTime(f1, t + dur); }
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g);
		g.connect(dest || master);
		o.start(t);
		o.stop(t + dur + 0.03);
	}

	function noise(dur, vol, f0, f1) {
		var t = ctx.currentTime;
		var src = ctx.createBufferSource(), filt = ctx.createBiquadFilter(), g = ctx.createGain();
		src.buffer = noiseBuf;
		filt.type = 'bandpass';
		filt.Q.value = 0.8;
		filt.frequency.setValueAtTime(f0, t);
		filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		src.connect(filt);
		filt.connect(g);
		g.connect(master);
		src.start(t);
		src.stop(t + dur + 0.03);
	}

	var SFX = {
		flap: function () { tone('triangle', 330, 640, 0.1, 0.16); noise(0.07, 0.12, 2500, 5000); },
		// Pitch climbs one semitone-ish per point (up to an octave): the streak is audible.
		point: function (score) {
			var f = 620 * Math.pow(2, Math.min(score || 0, 24) / 24), t = ctx.currentTime;
			tone('square', f, f, 0.07, 0.07, t);
			tone('square', f * 1.5, f * 1.5, 0.11, 0.07, t + 0.07);
		},
		hit: function () { noise(0.2, 0.5, 2000, 200); tone('sine', 190, 50, 0.28, 0.5); },
		die: function () { tone('sawtooth', 420, 70, 0.5, 0.16); },
		coin: function () { var t = ctx.currentTime; tone('square', 988, 988, 0.06, 0.07, t); tone('square', 1319, 1319, 0.13, 0.07, t + 0.06); },
		power: function () { var t = ctx.currentTime; tone('triangle', 523, 523, 0.07, 0.1, t); tone('triangle', 784, 784, 0.07, 0.1, t + 0.06); tone('triangle', 1175, 1175, 0.16, 0.1, t + 0.12); },
		shield: function () { noise(0.22, 0.4, 3000, 400); tone('sawtooth', 600, 150, 0.25, 0.1); },
		level: function () { var t = ctx.currentTime; [523, 659, 784, 1047].forEach(function (f, i) { tone('square', f, f, 0.09, 0.06, t + i * 0.07); }); },
		swoosh: function () { noise(0.28, 0.25, 400, 3200); }
	};

	function play(name, arg) {
		if (muted || !unlock() || !SFX[name]) { return; }
		SFX[name](arg);
	}

	/* ---- Music: a looping arpeggio that speeds up with the score ---- */
	var SCALE = [0, 2, 4, 7, 9];
	var PATTERN = [0, 2, 4, 2, 3, 1, 2, 4];

	function noteFreq(degree, octave) {
		var semis = SCALE[degree % 5] + 12 * (octave + Math.floor(degree / 5));
		return 220 * Math.pow(2, semis / 12);
	}

	function scheduleAhead() {
		var stepDur = 60 / (92 + Math.min(intensity, 60) * 1.1) / 2;
		while (nextTime < ctx.currentTime + 0.25) {
			var deg = PATTERN[step % PATTERN.length];
			tone('triangle', noteFreq(deg, 1), 0, stepDur * 0.9, 0.05, nextTime, musicGain);
			if (step % 4 === 0) { tone('sine', noteFreq(step % 8 === 0 ? 0 : 3, -1), 0, stepDur * 3.4, 0.07, nextTime, musicGain); }
			nextTime += stepDur;
			step++;
		}
	}

	function musicStart() {
		if (!musicEnabled || muted || timer || !unlock()) { return; }
		nextTime = ctx.currentTime + 0.05;
		timer = setInterval(scheduleAhead, 80);
	}

	function musicStop() {
		if (timer) { clearInterval(timer); timer = null; }
	}

	window.FBAudio = {
		unlock: unlock,
		play: play,
		musicStart: musicStart,
		musicStop: musicStop,
		setIntensity: function (n) { intensity = n; },
		setMusicEnabled: function (on) { musicEnabled = !!on; if (!on) { musicStop(); } },
		setMuted: function (m) {
			muted = !!m;
			if (master) { master.gain.value = muted ? 0 : 0.9; }
			if (muted) { musicStop(); }
		}
	};
})();
