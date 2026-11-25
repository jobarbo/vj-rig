// sceneHost.js — registry, lazy loading, switching, per-frame driving.
//
// Contract with the rig: update() and resize() are TOTAL functions. They never
// throw and never reject. p5's redraw() awaits draw(), and the next rAF is
// scheduled after that await, so one unhandled scene error would freeze the rig
// permanently. A scene that keeps throwing is quarantined instead of retried.

import {Compositor} from "./compositor.js";
import {createSlot, removeSlot} from "./stage.js";
import {createP5Scene} from "./runtime/p5Scene.js";
import {readPersistedParams} from "./sceneParams.js";

const LOAD_TIMEOUT_MS = 10000;
const MAX_ERRORS = 5;

// ctx.audio.spectrum: log-spaced bands, one per LED column of half the 240-wide
// ceiling. Same AGC/curve as bass/mid/treble (audioAnalyzer._normalizeLevel).
export const SPECTRUM_BANDS = 120;
const SPECTRUM_LOW_HZ = 30;
const SPECTRUM_HIGH_HZ = 16000;

const RUNTIMES = {
	p5: createP5Scene,
};

/** Registers a runtime factory for a scene `kind`. Used by later phases. */
export function registerRuntime(kind, factory) {
	RUNTIMES[kind] = factory;
}

/** Server-absolute folder for a scene, with no trailing slash. */
function scenePath(def) {
	const p = def.path || `/scenes/${def.id}`;
	return p.replace(/\/+$/, "");
}

function emptyAudio() {
	return {
		bass: 0,
		mid: 0,
		treble: 0,
		energy: 0,
		volume: 0,
		subBass: 0,
		lowMid: 0,
		highMid: 0,
		presence: 0,
		beat: false,
		beatPulse: 0,
		spectrum: new Float32Array(SPECTRUM_BANDS),
	};
}

/** [lo, hi] FFT bin index per band, log-spaced. Cached per (bins, sampleRate). */
let bandCache = {n: 0, sr: 0, ranges: null, centers: null};
function bandRanges(n, sr) {
	if (bandCache.n === n && bandCache.sr === sr) return bandCache;
	const nyquist = sr / 2;
	const ranges = new Int32Array(SPECTRUM_BANDS * 2);
	const centers = new Float32Array(SPECTRUM_BANDS); // fractional bin at the band's centre
	const ratio = Math.log(SPECTRUM_HIGH_HZ / SPECTRUM_LOW_HZ);
	for (let b = 0; b < SPECTRUM_BANDS; b++) {
		const f0 = SPECTRUM_LOW_HZ * Math.exp((ratio * b) / SPECTRUM_BANDS);
		const f1 = SPECTRUM_LOW_HZ * Math.exp((ratio * (b + 1)) / SPECTRUM_BANDS);
		const lo = Math.min(n - 1, Math.floor((f0 / nyquist) * n));
		const hi = Math.min(n - 1, Math.max(lo, Math.floor((f1 / nyquist) * n)));
		ranges[b * 2] = lo;
		ranges[b * 2 + 1] = hi;
		centers[b] = Math.min(n - 1, (Math.sqrt(f0 * f1) / nyquist) * n);
	}
	bandCache = {n, sr, ranges, centers};
	return bandCache;
}

function sampleSpectrum(a, out) {
	const spec = a.spectrum;
	const n = spec?.length || 0;
	if (!n) {
		out.fill(0);
		return;
	}
	let sr = 48000;
	try {
		sr = typeof sampleRate === "function" ? sampleRate() || sr : sr;
	} catch (_) {
		/* p5.sound not ready */
	}
	const {ranges, centers} = bandRanges(n, sr);
	const norm = typeof a._normalizeLevel === "function" ? (v) => a._normalizeLevel(v) : (v) => Math.min(1, v);
	const bin = typeof a._binValue === "function" ? (v) => a._binValue(v) : (v) => v || 0;
	for (let b = 0; b < SPECTRUM_BANDS; b++) {
		const lo = ranges[b * 2];
		const hi = ranges[b * 2 + 1];
		if (hi - lo < 2) {
			// Bass bands are narrower than an FFT bin: interpolate instead of
			// letting a dozen bands share one bin (staircase bars).
			const c = centers[b];
			const i0 = Math.floor(c);
			const i1 = Math.min(n - 1, i0 + 1);
			const t = c - i0;
			out[b] = norm(bin(spec[i0]) * (1 - t) + bin(spec[i1]) * t);
			continue;
		}
		let sumSq = 0;
		let peak = 0;
		for (let i = lo; i <= hi; i++) {
			const v = bin(spec[i]);
			sumSq += v * v;
			if (v > peak) peak = v;
		}
		const rms = Math.sqrt(sumSq / (hi - lo + 1));
		out[b] = norm(rms * 0.65 + peak * 0.35);
	}
}

export class SceneHost {
	constructor({manifest = [], hostSize = {width: 0, height: 0}, pixelDensity = 1} = {}) {
		this.manifest = manifest;
		this.hostSize = {...hostSize};
		this.pixelDensity = pixelDensity;
		this.compositor = new Compositor();

		this.current = null; // {def, scene, ctx, node, errors}
		this.currentId = null;
		this._moduleCache = new Map();
		this._switching = null;
		this._lastTime = performance.now();
		this._quarantined = new Set();
		this._changeListeners = new Set();
		this._versions = new Map(); // id -> cache-bust token after a hot reload
		this._lastAttemptId = null;
		/** Last load failure, shown by the scene panel: {id, message} | null */
		this.lastError = null;
	}

	/** Fires after the active scene changes (switch, or quarantine teardown). */
	onChange(fn) {
		this._changeListeners.add(fn);
		return () => this._changeListeners.delete(fn);
	}

	_notifyChange() {
		for (const fn of this._changeListeners) {
			try {
				fn();
			} catch (err) {
				console.warn("[sceneHost] onChange listener failed:", err);
			}
		}
	}

	list() {
		return this.manifest.map((d) => ({id: d.id, name: d.name || d.id, kind: d.kind || "p5"}));
	}

	indexOf(id) {
		return this.manifest.findIndex((d) => d.id === id);
	}

	// ---------------------------------------------------------------- loading

	_surfaceSizeFor(def) {
		const size = def.size ?? def.meta?.size ?? "host";
		if (Array.isArray(size) && size.length === 2) return {width: size[0], height: size[1]};
		return {width: this.hostSize.width, height: this.hostSize.height};
	}

	/**
	 * Seed ctx.params from the scene's declared defaults.
	 *
	 * The object identity is stable for the scene's whole lifetime — later
	 * phases (panel sliders, audio/MIDI mapping) mutate it in place rather than
	 * replacing it, so authors can capture `const {params} = ctx` in setup.
	 */
	_buildParams(id, meta) {
		const params = {};
		for (const def of meta.params || []) {
			if (!def?.name) continue;
			params[def.name] = def.value ?? def.min ?? 0;
		}
		// Last values from panel V / MIDI, so the look survives a page reload.
		return Object.assign(params, readPersistedParams(id, meta.params));
	}

	_buildContext(def) {
		const base = `${scenePath(def)}/`;
		const {width, height} = this._surfaceSizeFor(def);
		return {
			id: def.id,
			base,
			asset: (name) => base + String(name).replace(/^\.?\//, ""),
			p: null,
			width,
			height,
			frame: 0,
			time: 0,
			dt: 1 / 60,
			params: this._buildParams(def.id, def.meta || {}),
			audio: emptyAudio(),
			host: {width: this.hostSize.width, height: this.hostSize.height},
		};
	}

	async _importModule(def) {
		if (this._moduleCache.has(def.id)) return this._moduleCache.get(def.id);
		// Server-absolute so the URL is stable no matter which module imports us.
		// import() caches by URL for the page lifetime, so a hot reload appends a
		// version token. Only the entry is busted — sibling modules stay cached,
		// which is why hotReload() refuses (full reload) when a sibling .js changes.
		const v = this._versions.get(def.id);
		const mod = await import(`${scenePath(def)}/${def.entry || "index.js"}${v ? `?v=${v}` : ""}`);
		this._moduleCache.set(def.id, mod);
		return mod;
	}

	/**
	 * Load and activate a scene. Resolves to true on success, false on any
	 * failure — it never throws, so callers (keys, MIDI) can fire and forget.
	 */
	async switchTo(id, opts) {
		if (this._switching) {
			try {
				await this._switching;
			} catch (_) {
				/* previous switch already reported its own failure */
			}
		}
		this._switching = this._switchTo(id, opts);
		try {
			return await this._switching;
		} finally {
			this._switching = null;
		}
	}

	async _switchTo(id, {carry = null} = {}) {
		const def = this.manifest.find((d) => d.id === id);
		this._lastAttemptId = id;
		if (!def) {
			console.warn(`[sceneHost] unknown scene "${id}" — keeping "${this.currentId}"`);
			return false;
		}
		if (this._quarantined.has(id)) {
			console.warn(`[sceneHost] scene "${id}" is quarantined after repeated errors — skipping`);
			return false;
		}

		let node = null;
		try {
			const mod = await this._importModule(def);
			const meta = mod.meta || {};
			const kind = def.kind || meta.kind || "p5";
			const factory = RUNTIMES[kind];
			if (!factory) throw new Error(`no runtime registered for kind "${kind}"`);

			const merged = {...def, meta};
			const ctx = this._buildContext(merged);
			if (carry) {
				// Hot reload: keep the live look. Only params the new code still declares.
				for (const k of Object.keys(ctx.params)) {
					if (k in carry.params) ctx.params[k] = carry.params[k];
				}
				ctx.time = carry.time;
				ctx.frame = carry.frame;
			}
			node = createSlot(def.id);

			// An author setup() that never settles (bad asset URL) would otherwise
			// hang switchTo forever.
			let timedOut = false;
			const loading = factory(mod, {node, width: ctx.width, height: ctx.height, ctx, pixelDensity: this.pixelDensity, version: this._versions.get(def.id)});
			// A load that settles after the timeout would otherwise leak its context.
			loading.then((late) => timedOut && late?.dispose?.(), () => {});
			const scene = await Promise.race([
				loading,
				new Promise((_, rej) =>
					setTimeout(() => {
						timedOut = true;
						rej(new Error(`load timeout after ${LOAD_TIMEOUT_MS}ms`));
					}, LOAD_TIMEOUT_MS),
				),
			]);

			this._teardownCurrent();
			this.current = {def: merged, scene, ctx, node, errors: 0};
			this.currentId = def.id;
			this._lastTime = performance.now();

			this.compositor.setSlot(0, {
				surface: scene.surface,
				fit: def.fit || meta.fit || "cover",
				smooth: (def.smooth ?? meta.smooth) !== false,
				mirror: !!(def.mirror ?? meta.mirror),
				alpha: 1,
			});
			this.lastError = null;
			this._notifyChange();
			return true;
		} catch (err) {
			console.warn(`[sceneHost] failed to load scene "${id}":`, err);
			removeSlot(node);
			this.lastError = {id, message: String(err?.message || err)};
			this._notifyChange();
			return false;
		}
	}

	// ------------------------------------------------------------ hot reload

	/**
	 * Called by the live-reload client with the files that just changed
	 * (paths relative to public/). Returns true if it will hot-swap the scene
	 * in place — then the page is NOT reloaded; false means "do a full reload".
	 *
	 * Accepted: the active (or last attempted, e.g. after a failed compile)
	 * scene's entry module and its shader files. Anything else — a sibling .js,
	 * an asset, the engine, CSS — needs a full reload.
	 */
	hotReload(files) {
		const id = this.current?.def.id || this._lastAttemptId;
		const def = id && this.manifest.find((d) => d.id === id);
		if (!def || !Array.isArray(files) || !files.length) return false;
		const prefix = scenePath(def).replace(/^\/+/, "") + "/";
		const entry = def.entry || "index.js";
		for (const f of files) {
			if (!f.startsWith(prefix)) return false;
			const rel = f.slice(prefix.length);
			if (rel !== entry && !/\.(frag|vert|glsl)$/i.test(rel)) return false;
		}
		this._reload(id);
		return true;
	}

	async _reload(id) {
		const cur = this.current?.def.id === id ? this.current : null;
		const carry = cur ? {params: {...cur.ctx.params}, time: cur.ctx.time, frame: cur.ctx.frame} : null;
		this._moduleCache.delete(id);
		this._quarantined.delete(id);
		this._versions.set(id, Date.now());
		const ok = await this.switchTo(id, {carry});
		console.log(ok ? `[sceneHost] hot-reloaded "${id}"` : `[sceneHost] hot reload of "${id}" failed — previous version kept`);
		return ok;
	}

	async next(step = 1) {
		if (!this.manifest.length) return false;
		const i = this.indexOf(this.currentId);
		const n = this.manifest.length;
		const target = ((i < 0 ? 0 : i + step) % n + n) % n;
		return this.switchTo(this.manifest[target].id);
	}

	async showIndex(i) {
		const def = this.manifest[i];
		if (!def) return false;
		return this.switchTo(def.id);
	}

	_teardownCurrent() {
		const cur = this.current;
		if (!cur) return;
		this.compositor.clearSlot(0);
		try {
			cur.scene.dispose?.();
		} catch (err) {
			console.warn(`[sceneHost] dispose failed for "${cur.def.id}":`, err);
		}
		removeSlot(cur.node);
		this.current = null;
		this.currentId = null;
	}

	// ------------------------------------------------------------- per-frame

	_sampleAudio(audio) {
		// library/utils/audioAnalyzer.js declares `const audioAnalyzer` in a classic
		// script: it lives in the global lexical scope, NOT on window. Modules can
		// still see that binding directly.
		// eslint-disable-next-line no-undef
		const a = window.audioAnalyzer || (typeof audioAnalyzer !== "undefined" ? audioAnalyzer : null);
		if (!a) return;
		audio.bass = a.bass || 0;
		audio.mid = a.mid || 0;
		audio.treble = a.treble || 0;
		audio.energy = a.energy || 0;
		audio.volume = a.volume || 0;
		audio.subBass = a.subBass || 0;
		audio.lowMid = a.lowMid || 0;
		audio.highMid = a.highMid || 0;
		audio.presence = a.presence || 0;
		audio.beat = !!a.isBeat;
		audio.beatPulse = a.isBeat ? 1 : Math.max(0, audio.beatPulse * 0.85);
		sampleSpectrum(a, audio.spectrum);
	}

	/** Advance and render the active scene. TOTAL FUNCTION — never throws. */
	async update() {
		const cur = this.current;
		if (!cur) return;

		const now = performance.now();
		const dt = Math.min(0.1, Math.max(0, (now - this._lastTime) / 1000));
		this._lastTime = now;

		const {ctx} = cur;
		ctx.dt = dt;
		ctx.time += dt;
		ctx.frame++;
		ctx.host.width = this.hostSize.width;
		ctx.host.height = this.hostSize.height;
		try {
			this._sampleAudio(ctx.audio);
		} catch (err) {
			// update() is a total function: audio trouble must never freeze the rig.
			if (!this._audioWarned) console.warn("[sceneHost] audio sampling failed:", err);
			this._audioWarned = true;
		}

		try {
			await cur.scene.render?.(ctx);
			// The surface identity can change across a resize.
			const slot = this.compositor.slots[0];
			if (slot) slot.surface = cur.scene.surface;
		} catch (err) {
			cur.errors++;
			if (cur.errors === 1 || cur.errors % 60 === 0) {
				console.warn(`[sceneHost] scene "${cur.def.id}" render failed (${cur.errors}x):`, err);
			}
			if (cur.errors >= MAX_ERRORS) {
				console.warn(`[sceneHost] quarantining "${cur.def.id}" after ${cur.errors} errors`);
				this._quarantined.add(cur.def.id);
				this._teardownCurrent();
				this._notifyChange();
			}
		}
	}

	render(target) {
		this.compositor.render(target);
	}

	/** Called from updateLayoutMetrics after the output size changes. */
	resize(width, height) {
		this.hostSize = {width, height};
		const cur = this.current;
		if (!cur) return;
		const size = this._surfaceSizeFor(cur.def);
		try {
			cur.scene.resize?.(size.width, size.height);
			const slot = this.compositor.slots[0];
			if (slot) slot.surface = cur.scene.surface;
		} catch (err) {
			console.warn(`[sceneHost] resize failed for "${cur.def.id}":`, err);
		}
	}
}
