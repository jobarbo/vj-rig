// Palette helpers for the orbit scene.
//
// hexToHsl moved here from sketch.js when the artwork became a scene — it had
// no other caller. `getPalette` stays a classic-script global from
// swatches/palettes.js; modules can read window globals, they just can't
// declare into that scope.

export function hexToHsl(hex) {
	const r = parseInt(hex.slice(1, 3), 16) / 255;
	const g = parseInt(hex.slice(3, 5), 16) / 255;
	const b = parseInt(hex.slice(5, 7), 16) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	let h;
	let s;
	const l = (max + min) / 2;
	if (max === min) {
		h = s = 0;
	} else {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r:
				h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
				break;
			case g:
				h = ((b - r) / d + 2) / 6;
				break;
			case b:
				h = ((r - g) / d + 4) / 6;
				break;
		}
	}
	return {h: h * 360, s: s * 100, l: l * 100};
}

export function loadHslPalette(name = "hex_palette") {
	const getPalette = window.getPalette;
	if (typeof getPalette !== "function") {
		console.warn("[orbit] getPalette global not found — falling back to a single colour");
		return [{h: 210, s: 100, l: 50}];
	}
	return getPalette(name).map(hexToHsl);
}
