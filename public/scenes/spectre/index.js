// spectre — centred audio visualiser for the 240×20 LED ceiling.
//
// Three layers, mixable live from panel V (or MIDI):
//   bars       mirrored spectrum; each column opens vertically from the middle rows
//   waterfall  the spectrum is born at the centre and slides out to the edges over time
//   shock      every beat launches a wave travelling outward from the centre
//
// The LED strips are wired in pairs, so the 240×20 surface is quantised to
// 240×10 logical cells (ledColumns / ledRows).
//
// JS side (this file) does the per-band smoothing, the history ring buffer and
// the shockwave pool; the .frag only reads them. Everything heavy stays on the GPU.

const BANDS = 120; // must match SPECTRUM_BANDS in scene/sceneHost.js
const HIST_ROWS = 128;
const MAX_RINGS = 8;
const BEAT_COOLDOWN_S = 0.12;

export const meta = {
	name: "Spectre",
	kind: "glsl",
	frag: "spectre.frag",
	size: [240, 20],
	fit: "stretch",
	smooth: false,
	flipY: false,
	params: [
		// Input shaping (JS only)
		{name: "gain", label: "Gain", min: 0, max: 4, value: 1.2, step: 0.01},
		{name: "floor", label: "Floor", min: 0, max: 0.9, value: 0.08, step: 0.001},
		{name: "attack", label: "Attack /s", min: 1, max: 60, value: 30, step: 0.1},
		{name: "release", label: "Release /s", min: 0.5, max: 30, value: 6, step: 0.1},
		// Layer mix
		{name: "barsAmt", label: "Bars", min: 0, max: 1, value: 1, step: 0.01},
		{name: "waterfallAmt", label: "Waterfall", min: 0, max: 1, value: 0.5, step: 0.01},
		{name: "shockAmt", label: "Shockwave", min: 0, max: 1, value: 0.8, step: 0.01},
		// Motion
		{name: "historyLength", label: "History (frames)", min: 4, max: 127, value: 90, integer: true},
		{name: "shockSpeed", label: "Shock speed", min: 0.05, max: 4, value: 0.9, step: 0.01},
		{name: "shockWidth", label: "Shock width", min: 0.005, max: 0.3, value: 0.05, step: 0.001},
		{name: "bassAtCenter", label: "Bass at centre", type: "bool", value: true},
		// Colour
		{name: "hue", label: "Hue", min: 0, max: 1, value: 0.58, step: 0.001},
		{name: "hueSpread", label: "Hue spread", min: -1, max: 1, value: 0.35, step: 0.001},
		{name: "saturation", label: "Saturation", min: 0, max: 1, value: 0.85, step: 0.01},
		{name: "brightness", label: "Brightness", min: 0, max: 3, value: 1, step: 0.01},
		{name: "beatAmt", label: "Beat flash", min: 0, max: 2, value: 0.3, step: 0.01},
		// Geometry
		{name: "ratio", label: "Aspect (w/h)", min: 1, max: 24, value: 12, step: 0.1},
		{name: "pixelate", label: "LED grid", type: "bool", value: true},
		{name: "ledColumns", label: "LED columns", min: 1, max: 480, value: 240, integer: true},
		{name: "ledRows", label: "LED rows", min: 1, max: 40, value: 10, integer: true},
	],
};

export async function setup(ctx) {
	const p = ctx.p;
	ctx.tex = p.createImage(BANDS, HIST_ROWS);
	ctx.tex.loadPixels();
	ctx.tex.pixels.fill(0);
	for (let i = 3; i < ctx.tex.pixels.length; i += 4) ctx.tex.pixels[i] = 255;
	ctx.tex.updatePixels();

	ctx.bands = new Float32Array(BANDS);
	ctx.head = 0;
	// [birthTime, strength] × MAX_RINGS, flattened for uniform vec2 uRings[8]
	ctx.rings = new Float32Array(MAX_RINGS * 2);
	for (let i = 0; i < MAX_RINGS; i++) ctx.rings[i * 2] = -1000;
	ctx.nextRing = 0;
	ctx.lastBeat = -1;
}

export function draw(ctx, shader) {
	const {params, audio, dt} = ctx;
	const src = audio.spectrum;

	// Per-band envelope: fast attack, slower release, time-based so it's fps-independent.
	const ka = 1 - Math.exp(-dt * params.attack);
	const kr = 1 - Math.exp(-dt * params.release);
	const floor = params.floor;
	const span = Math.max(1e-3, 1 - floor);
	for (let b = 0; b < BANDS; b++) {
		const raw = src ? src[b] || 0 : 0;
		const target = Math.min(1, Math.max(0, (raw * params.gain - floor) / span));
		const cur = ctx.bands[b];
		ctx.bands[b] = cur + (target - cur) * (target > cur ? ka : kr);
	}

	// Write the current frame into the history ring buffer (R channel).
	ctx.head = (ctx.head + 1) % HIST_ROWS;
	const px = ctx.tex.pixels;
	const row = ctx.head * BANDS * 4;
	for (let b = 0; b < BANDS; b++) {
		const v = Math.round(ctx.bands[b] * 255);
		const o = row + b * 4;
		px[o] = v;
		px[o + 1] = v;
		px[o + 2] = v;
	}
	ctx.tex.updatePixels();

	// Beat → new shockwave, replacing the oldest.
	if (audio.beat && ctx.time - ctx.lastBeat > BEAT_COOLDOWN_S) {
		ctx.lastBeat = ctx.time;
		const i = ctx.nextRing;
		ctx.rings[i * 2] = ctx.time;
		ctx.rings[i * 2 + 1] = Math.min(1, 0.4 + audio.energy);
		ctx.nextRing = (i + 1) % MAX_RINGS;
	}

	shader.setUniform("uSpectrum", ctx.tex);
	shader.setUniform("uHistHead", ctx.head);
	shader.setUniform("uHistRows", HIST_ROWS);
	shader.setUniform("uBands", BANDS);
	shader.setUniform("uRings", Array.from(ctx.rings));
}
