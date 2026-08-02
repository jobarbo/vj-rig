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

		let v;
		if (def.type === "bool") {
			v = typeof value === "boolean" ? value : Number(value) > 0.5;
		} else {
			v = Number(value);
			if (!Number.isFinite(v)) return false;
			const min = def.min ?? 0;
			const max = def.max ?? 1;
			v = Math.min(max, Math.max(min, v));
			if (def.integer) v = Math.round(v);
		}
		cur.ctx.params[name] = v;
		return true;
	},

	reset(name) {
		const cur = activeSlot();
		if (!cur) return;
		const def = defFor(name);
		if (!def) return;
		cur.ctx.params[name] = def.value ?? def.min ?? 0;
	},
};

window.sceneParams = sceneParams;
