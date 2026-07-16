/**
 * Seeded PRNG for reproducible visuals.
 * Seed from ?seed= or ?fxhash=, otherwise a random string.
 * Exposes: fxhash, fxrand() (+ .reset()), seed
 */
(function () {
	"use strict";

	function hashStringToUint32(str) {
		var h1 = 0x9e3779b9;
		var h2 = 0x85ebca6b;
		var h3 = 0xc2b2ae35;
		var h4 = 0x27d4eb2f;
		for (var i = 0; i < str.length; i++) {
			var c = str.charCodeAt(i);
			h1 = Math.imul(h1 ^ c, 0x85ebca6b);
			h2 = Math.imul(h2 ^ c, 0xc2b2ae35);
			h3 = Math.imul(h3 ^ c, 0x27d4eb2f);
			h4 = Math.imul(h4 ^ c, 0x165667b1);
		}
		return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
	}

	function prngFromState(state) {
		var a = state[0] | 0;
		var b = state[1] | 0;
		var c = state[2] | 0;
		var d = state[3] | 0;
		return function () {
			a |= 0;
			b |= 0;
			c |= 0;
			d |= 0;
			var t = (((a + b) | 0) + d) | 0;
			d = (d + 1) | 0;
			a = b ^ (b >>> 9);
			b = (c + (c << 3)) | 0;
			c = (c << 21) | (c >>> 11);
			c = (c + t) | 0;
			return (t >>> 0) / 4294967296;
		};
	}

	function randomSeedString() {
		var chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
		var out = "";
		for (var i = 0; i < 32; i++) {
			out += chars[(Math.random() * chars.length) | 0];
		}
		return out;
	}

	function makeRand(seedStr) {
		var state = hashStringToUint32(seedStr);
		var fn = prngFromState(state);
		fn.reset = function () {
			window.fxrand = makeRand(seedStr);
		};
		return fn;
	}

	var search = new URLSearchParams(window.location.search);
	var seedStr = search.get("seed") || search.get("fxhash") || randomSeedString();

	window.fxhash = seedStr;
	window.fxrand = makeRand(seedStr);
	window.seed = (window.fxrand() * 1e7) | 0;

	console.log("[seed]", seedStr);
})();
