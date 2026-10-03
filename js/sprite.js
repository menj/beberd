/*
 * Flying Bird – pixel-art bird sprite.
 * Frames are drawn from small character grids and tinted from the active
 * colour scheme, so the bird follows light/dark/custom palettes.
 *
 * Legend: o outline · b body · l belly · d shade · e eye white · p pupil
 *         k beak · K beak shade · w wing · W wing edge · t wing tip
 */
(function () {
	'use strict';

	var BODY_TOP = 3;           // body rows start here inside the 20x18 frame
	var SIZE_W = 20, SIZE_H = 18;

	var BODY = [
		'......ooooooo.......',
		'....oobbbbbbboo.....',
		'...obbbbbbbbbbbo....',
		'..obbbbbbbbbbeebo...',
		'.obbbbbbbbbbbepboooo',
		'obbbbbbbbbbbbbbbokkk',
		'obbbbbbbbbbbbbbbokkk',
		'obbbbbbbbbbbbbbboKKK',
		'.obllllbbbbbbbbbbooo',
		'.oblllllllbbbbbbo...',
		'..obllllllllbbbo....',
		'...oodddddddddoo....',
		'.....ooooooooo......'
	];

	// Wing poses, drawn on the full 20x18 frame (they overlap the body).
	var WINGS = {
		up: [
			'....................',
			'....t...............',
			'....Wt..............',
			'...WwWt.............',
			'...WwwWt............',
			'...WwwwWt...........',
			'..WwwwwwW...........',
			'..WwwwwwwW..........',
			'...WwwwwwwW.........',
			'....WWWWWWW.........',
			'....................',
			'....................',
			'....................',
			'....................',
			'....................',
			'....................',
			'....................',
			'....................'
		],
		mid: [
			'....................',
			'....................',
			'....................',
			'....................',
			'....................',
			'....................',
			'....................',
			'......WWWWWW........',
			'..WWWwwwwwwwWW......',
			'.WwwwwwwwwwwwwWt....',
			'..WWWwwwwwwwWW......',
			'......WWWWWW........',
			'....................',
			'....................',
			'....................',
			'....................',
			'....................',
			'....................'
		],
		down: [
			'....................',
			'....................',
			'....................',
			'....................',
			'....................',
			'....................',
			'....................',
			'....................',
			'....WWWWWWW.........',
			'...WwwwwwwwW........',
			'...WwwwwwwwW........',
			'...WwwwwwwW.........',
			'....WwwwwwW.........',
			'....WwwwwW..........',
			'.....WwwwW..........',
			'.....WwwW...........',
			'......WWt...........',
			'......t.............'
		]
	};

	function mix(hex, other, amount) {
		var a = parse(hex), b = parse(other);
		var c = a.map(function (v, i) { return Math.round(v + (b[i] - v) * amount); });
		return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
	}
	function parse(hex) {
		var h = String(hex).trim();
		if (/^#[0-9a-f]{3}$/i.test(h)) { h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; }
		var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
		if (m) { return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]; }
		var r = /rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(h);
		return r ? [+r[1], +r[2], +r[3]] : [245, 165, 36];
	}

	function colours(pal) {
		var body = pal.bird;
		return {
			o: '#1a1424',
			b: body,
			l: mix(body, '#ffffff', 0.55),
			d: mix(body, '#000000', 0.22),
			e: '#ffffff',
			p: '#1a1424',
			k: pal.beak,
			K: mix(pal.beak, '#000000', 0.25),
			w: mix(body, '#000000', 0.16),
			W: '#1a1424',
			t: mix(body, '#ffffff', 0.25)
		};
	}

	function paint(ctx, grid, col, dy) {
		for (var y = 0; y < grid.length; y++) {
			var row = grid[y];
			for (var x = 0; x < row.length; x++) {
				var c = row.charAt(x);
				if (c !== '.' && col[c]) {
					ctx.fillStyle = col[c];
					ctx.fillRect(x, y + dy, 1, 1);
				}
			}
		}
	}

	/** Build one canvas per wing pose. */
	function build(pal) {
		var col = colours(pal), frames = {};
		Object.keys(WINGS).forEach(function (name) {
			var cv = document.createElement('canvas');
			cv.width = SIZE_W; cv.height = SIZE_H;
			var ctx = cv.getContext('2d');
			paint(ctx, BODY, col, BODY_TOP);
			paint(ctx, WINGS[name], col, 0);
			frames[name] = cv;
		});
		return frames;
	}

	window.FBSprite = { build: build, width: SIZE_W, height: SIZE_H, bodyTop: BODY_TOP };
})();
