// sceneParams.js — the single write path for scene parameters.
//
// Deliberately NOT stored in shaderEffects.effectsConfig: importPanelConfig()
// replaces effectsConfig wholesale and silently drops unknown keys (see the
// "scene" guard in sketch-shaders.js#updateEffectParam), and
// loadPersistedPanelConfig() runs at boot — a scene param living there would
// be destroyed on the next panel import/reload.
//
// There is one param namespace at a time: whichever scene is active. This is
// a thin adapter over that scene's ctx.params (built fresh per scene by
// sceneHost). Switching scenes swaps what "scene.<name>" refers to; a
// mapping bound to a param name that doesn't exist on the new scene simply
// no-ops, exactly like updateEffectParam does for an unknown shader param.

const VALUES_KEY = (id) => `vjSceneParams.${id}`;
const PRESETS_KEY = (id) => `vjScenePresets.${id}`;
const PERSIST_DEBOUNCE_MS = 400;

function readJson(key, fallback) {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return fallback;
		const v = JSON.parse(raw);
		return v && typeof v === "object" ? v : fallback;
	} catch (_) {
		return fallback;
	}
}

function writeJson(key, value) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch (err) {
		console.warn(`[sceneParams] failed to persist ${key}:`, err);
	}
}

/** Clamp/coerce a raw value against its def. Returns undefined if invalid. */
function coerce(def, value) {
	if (def.type === "bool") return typeof value === "boolean" ? value : Number(value) > 0.5;
	let v = Number(value);
	if (!Number.isFinite(v)) return undefined;
	v = Math.min(def.max ?? 1, Math.max(def.min ?? 0, v));
	if (def.integer) v = Math.round(v);
	return v;
}

/**
 * Persisted values for a scene, validated against its current defs. Used by
 * sceneHost._buildParams at load time, so the last look survives a page reload.
 */
export function readPersistedParams(id, defs) {
	const saved = readJson(VALUES_KEY(id), null);
	const out = {};
	if (!saved) return out;
	for (const def of defs || []) {
		if (!(def.name in saved)) continue;
		const v = coerce(def, saved[def.name]);
		if (v !== undefined) out[def.name] = v;
	}
	return out;
}

let persistTimer = null;
function schedulePersist() {
	clearTimeout(persistTimer);
	persistTimer = setTimeout(() => {
		const cur = activeSlot();
		if (cur) writeJson(VALUES_KEY(cur.def.id), {...cur.ctx.params});
	}, PERSIST_DEBOUNCE_MS);
}

function activeSlot() {
	return window.sceneHost?.current || null;
}

function defFor(name) {
	const cur = activeSlot();
	if (!cur) return null;
	return (cur.def.meta?.params || []).find((d) => d.name === name) || null;
}

export const sceneParams = {
	/** Param defs for the currently active scene (empty array if none). */
	defs() {
		const cur = activeSlot();
		return cur ? cur.def.meta?.params || [] : [];
	},

	/** Current value, or undefined if there's no active scene or param. */
	get(name) {
		const cur = activeSlot();
		return cur ? cur.ctx.params[name] : undefined;
	},

	/**
	 * Clamp and write. Returns false on an unknown param or no active scene —
	 * mirrors updateEffectParam's silent no-op on an unknown effect/param.
	 */
	set(name, value) {
		const cur = activeSlot();
		if (!cur) return false;
		const def = defFor(name);
		if (!def) return false;

		const v = coerce(def, value);
		if (v === undefined) return false;
		if (cur.ctx.params[name] !== v) {
			cur.ctx.params[name] = v;
			schedulePersist();
		}
		return true;
	},

	reset(name) {
		const def = defFor(name);
		if (def) this.set(name, def.value ?? def.min ?? 0);
	},

	resetAll() {
		for (const def of this.defs()) this.reset(def.name);
	},

	/** Plain copy of the active scene's current values. */
	snapshot() {
		const cur = activeSlot();
		return cur ? {...cur.ctx.params} : {};
	},

	/** Write several values at once (unknown names are skipped). */
	apply(values) {
		if (!values || typeof values !== "object") return;
		for (const [k, v] of Object.entries(values)) this.set(k, v);
	},

	// -------------------------------------------------------------- presets
	// Per scene, in localStorage under vjScenePresets.<id>: {name: values}.

	presets() {
		const cur = activeSlot();
		return cur ? readJson(PRESETS_KEY(cur.def.id), {}) : {};
	},

	savePreset(name) {
		const cur = activeSlot();
		if (!cur || !name) return false;
		const all = readJson(PRESETS_KEY(cur.def.id), {});
		all[name] = this.snapshot();
		writeJson(PRESETS_KEY(cur.def.id), all);
		return true;
	},

	loadPreset(name) {
		const values = this.presets()[name];
		if (!values) return false;
		this.apply(values);
		return true;
	},

	deletePreset(name) {
		const cur = activeSlot();
		if (!cur) return;
		const all = readJson(PRESETS_KEY(cur.def.id), {});
		delete all[name];
		writeJson(PRESETS_KEY(cur.def.id), all);
	},
};

window.sceneParams = sceneParams;
