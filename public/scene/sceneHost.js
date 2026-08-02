// sceneHost.js — registry, lazy loading, switching, per-frame driving.
//
// Contract with the rig: update() and resize() are TOTAL functions. They never
// throw and never reject. p5's redraw() awaits draw(), and the next rAF is
// scheduled after that await, so one unhandled scene error would freeze the rig
// permanently. A scene that keeps throwing is quarantined instead of retried.

import {Compositor} from "./compositor.js";
import {createSlot, removeSlot} from "./stage.js";
import {createP5Scene} from "./runtime/p5Scene.js";

const LOAD_TIMEOUT_MS = 10000;
const MAX_ERRORS = 5;

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
	};
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
	_buildParams(meta) {
		const params = {};
		for (const def of meta.params || []) {
			if (!def?.name) continue;
			params[def.name] = def.value ?? def.min ?? 0;
		}
		return params;
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
			params: this._buildParams(def.meta || {}),
			audio: emptyAudio(),
			host: {width: this.hostSize.width, height: this.hostSize.height},
		};
	}

	async _importModule(def) {
		if (this._moduleCache.has(def.id)) return this._moduleCache.get(def.id);
		// Server-absolute so the URL is stable no matter which module imports us.
		// import() caches by URL for the page lifetime — fine, because live reload
		// does a full location.reload().
		const mod = await import(`${scenePath(def)}/${def.entry || "index.js"}`);
		this._moduleCache.set(def.id, mod);
		return mod;
	}

	/**
	 * Load and activate a scene. Resolves to true on success, false on any
	 * failure — it never throws, so callers (keys, MIDI) can fire and forget.
	 */
	async switchTo(id) {
		if (this._switching) {
			try {
				await this._switching;
			} catch (_) {
				/* previous switch already reported its own failure */
			}
		}
		this._switching = this._switchTo(id);
		try {
			return await this._switching;
		} finally {
			this._switching = null;
		}
	}

	async _switchTo(id) {
		const def = this.manifest.find((d) => d.id === id);
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
			node = createSlot(def.id);

			// An author setup() that never settles (bad asset URL) would otherwise
			// hang switchTo forever.
			const scene = await Promise.race([
				factory(mod, {node, width: ctx.width, height: ctx.height, ctx, pixelDensity: this.pixelDensity}),
				new Promise((_, rej) => setTimeout(() => rej(new Error(`load timeout after ${LOAD_TIMEOUT_MS}ms`)), LOAD_TIMEOUT_MS)),
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
			this._notifyChange();
			return true;
		} catch (err) {
			console.warn(`[sceneHost] failed to load scene "${id}":`, err);
			removeSlot(node);
			return false;
		}
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
		const a = window.audioAnalyzer;
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
		this._sampleAudio(ctx.audio);

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
