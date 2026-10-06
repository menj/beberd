/*
 * Parity check, browser side: plays real runs of the actual game (js/game.js) with a simple autopilot,
 * stepping the fixed 60 Hz simulation as fast as possible, and prints each recorded run as JSON.
 * Pipe the output into tools/parity-verify.php to confirm the server's replay (includes/replay.php)
 * reproduces the same score and end step. Run it after ANY change to physics, pipes, power-ups or the
 * playfield size.
 *
 *   node tools/parity-harness.js [runs] [baseUrl] | php tools/parity-verify.php
 *
 * Needs Playwright with a Chromium (set PW_CHROMIUM to its path) and a PHP binary on PATH; with no
 * baseUrl it starts `php -S` on a free port in the project folder.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const RUNS = parseInt(process.argv[2] || '120', 10);
let base = process.argv[3] || '';

function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

(async () => {
	let server = null;
	if (!base) {
		const port = 8800 + Math.floor(Math.random() * 100);
		server = spawn('php', ['-S', '127.0.0.1:' + port, '-t', path.join(__dirname, '..')], { stdio: 'ignore' });
		base = 'http://127.0.0.1:' + port + '/index.php';
		await new Promise((r) => setTimeout(r, 1200));
	}
	const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
	const vp = (process.env.PW_VIEW || '500x800').split('x').map(Number); // try 500x800 (portrait) and 1300x900 (wide)
	const page = await browser.newPage({ viewport: { width: vp[0], height: vp[1] } });
	await page.goto(base, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => { const g = document.querySelector('.fb-game'); return g && g.__fb; });

	const rnd = mulberry(20260607);
	const DIFFS = { easy: { gap: 195, speed: 130 }, normal: { gap: 165, speed: 150 }, hard: { gap: 140, speed: 172 } };
	for (let i = 0; i < RUNS; i++) {
		const mode = i % 5 === 4 ? 'daily' : 'classic';
		const diff = ['easy', 'normal', 'normal', 'hard'][Math.floor(rnd() * 4)];
		const plan = { mode, diff, seed: Math.floor(rnd() * 4294967296), giveUp: 600 + Math.floor(rnd() * 7000), bias: (rnd() - 0.5) * 24, noise: rnd() * 0.004 };
		const out = await page.evaluate((p) => {
			const g = document.querySelector('.fb-game').__fb;
			g.state = 'ready';
			if (p.mode === 'classic') { g.diffName = p.diff; g.baseDiff = p.diffs[p.diff]; g.nextSeed = p.seed; }
			g.begin(p.mode);
			let seedRand = p.seed || 1, last = -99;
			const rnd = () => { seedRand = (seedRand * 1664525 + 1013904223) >>> 0; return seedRand / 4294967296; };
			let guard = 0;
			while (g.state === 'playing' && guard++ < 36000) {
				const b = g.bird;
				let pipe = null;
				for (let k = 0; k < g.pipes.length; k++) { if (g.pipes[k].x + 62 > 110 - 15 && (!pipe || g.pipes[k].x < pipe.x)) { pipe = g.pipes[k]; } }
				// aim just below the middle of the next gap; flap when falling past that line
				const target = (pipe ? pipe.gapY : 270) + p.bias + 16;
				const hold = g.stepNo > p.giveUp;
				const want = !hold && b.y > target && b.vy > -120 && rnd() > p.noise * 20;
				if (want && g.stepNo - last >= 6) { g.flap(); last = g.stepNo; }
				g.update(1 / 60);
			}
			// let the death settle so die() has packaged the replay
			return { replay: g.replay, score: g.score, difficulty: g.runDiffName, state: g.state, cheated: g.cheated };
		}, { ...plan, diffs: DIFFS });
		if (!out.replay) { process.stderr.write(`run ${i}: no replay (state=${out.state})\n`); continue; }
		process.stdout.write(JSON.stringify({ replay: out.replay, score: out.score, official: out.difficulty }) + '\n');
	}
	await browser.close();
	if (server) { server.kill(); }
})().catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(2); });
