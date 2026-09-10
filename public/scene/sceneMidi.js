// sceneMidi.js — unified MIDI learn for scene + shader params.
//
// Bindings are keyed by "effect.param" (e.g. "scene.speed", "pixelSort.threshold").
// Uses addEventListener so it coexists with s1Midi.js (which also uses addEventListener).
// Learn bindings win over S-1 presets for the same (cc, channel).
//
// Persisted in localStorage under vjMidiLearns.

const STORAGE_KEY = "vjMidiLearns";

/** @type {Map<string, {cc:number, channel:number, effect:string, param:string, outMin?:number, outMax?:number, integer?:boolean, type?:string}>} */
const bindings = new Map();

function bindingKey(effectName, paramName) {
	return `${effectName}.${paramName}`;
}

function loadPersisted() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const list = JSON.parse(raw);
		if (!Array.isArray(list)) return;
		for (const b of list) {
			if (!b || typeof b.effect !== "string" || typeof b.param !== "string") continue;
			if (!Number.isFinite(b.cc) || !Number.isFinite(b.channel)) continue;
			bindings.set(bindingKey(b.effect, b.param), b);
			if (typeof midiLiveControl !== "undefined") {
				midiLiveControl.register(b.effect, b.param, `MIDI CC${b.cc}`);
			}
		}
	} catch (err) {
		console.warn("[midiLearn] failed to load persisted learns:", err);
	}
}

function persist() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([...bindings.values()]));
	} catch (err) {
		console.warn("[midiLearn] failed to persist learns:", err);
	}
}

function resolveRange(effectName, paramName) {
	if (effectName === "scene") {
		const def = (window.sceneHost?.current?.def?.meta?.params || []).find((d) => d.name === paramName);
		if (def) {
			return {
				outMin: def.min ?? 0,
				outMax: def.max ?? 1,
				integer: !!def.integer,
				type: def.type,
			};
		}
		return {outMin: 0, outMax: 1};
	}

	// Prefer a matching S-1 preset range when present
	const presets = window.s1Midi?.S1_PRESETS;
	if (Array.isArray(presets)) {
		const hit = presets.find((p) => p.effect === effectName && p.param === paramName);
		if (hit) {
			return {outMin: hit.outMin, outMax: hit.outMax, integer: !!hit.integer};
		}
	}

	const cfg = typeof shaderEffects !== "undefined" ? shaderEffects.effectsConfig?.[effectName] : null;
	const cur = cfg?.[paramName];
	if (typeof cur === "number" && Number.isFinite(cur)) {
		const abs = Math.abs(cur) || 1;
		if (Number.isInteger(cur)) {
			return {outMin: 0, outMax: Math.max(64, cur * 2), integer: true};
		}
		if (abs <= 1) return {outMin: 0, outMax: 1};
		return {outMin: 0, outMax: abs * 2};
	}

	return {outMin: 0, outMax: 1};
}

function mapValue(binding, value7) {
	const norm = Math.min(127, Math.max(0, value7)) / 127;
	if (binding.type === "bool") return norm > 0.5 ? 1 : 0;
	const lo = binding.outMin ?? 0;
	const hi = binding.outMax ?? 1;
	let v = lo + norm * (hi - lo);
	if (binding.integer) v = Math.round(v);
	return v;
}

export const midiLearn = {
	ready: false,
	/** @type {null | {effect:string, param:string}} */
	learning: null,
	bindings,

	async init() {
		if (this._inited) return this;
		this._inited = true;
		loadPersisted();

		if (!navigator.requestMIDIAccess) {
			console.warn("[midiLearn] Web MIDI not available in this browser");
			return this;
		}
		try {
			const access = await navigator.requestMIDIAccess();
			const bind = (input) => {
				if (!input || input._midiLearnBound) return;
				input._midiLearnBound = true;
				input.addEventListener("midimessage", (e) => this._onMessage(e));
			};
			for (const input of access.inputs.values()) bind(input);
			access.onstatechange = (e) => {
				if (e.port.type === "input" && e.port.state === "connected") bind(e.port);
			};
			this.ready = true;
			console.log(`[midiLearn] ready — ${access.inputs.size} input(s), ${bindings.size} saved binding(s)`);
		} catch (err) {
			console.warn("[midiLearn] requestMIDIAccess failed:", err);
		}
		return this;
	},

	isCcBound(cc, channel) {
		for (const b of bindings.values()) {
			if (b.cc === cc && b.channel === channel) return true;
		}
		return false;
	},

	/**
	 * Bind the next CC to effect.param.
	 * Legacy: startLearn(paramName, onBound) → scene.paramName
	 */
	startLearn(effectNameOrParam, paramNameOrCb, onBound) {
		let effect;
		let param;
		let cb;
		if (typeof paramNameOrCb === "string") {
			effect = effectNameOrParam;
			param = paramNameOrCb;
			cb = onBound || null;
		} else {
			effect = "scene";
			param = effectNameOrParam;
			cb = paramNameOrCb || null;
		}
		this.learning = {effect, param};
		this._learnCallback = cb;
	},

	cancelLearn() {
		this.learning = null;
		const cb = this._learnCallback;
		this._learnCallback = null;
		cb?.();
	},

	clearBinding(effectNameOrParam, paramName) {
		const effect = paramName != null ? effectNameOrParam : "scene";
		const param = paramName != null ? paramName : effectNameOrParam;
		const key = bindingKey(effect, param);
		bindings.delete(key);
		if (typeof midiLiveControl !== "undefined") {
			midiLiveControl.mappings.delete(key);
			midiLiveControl.overrides.delete(key);
		}
		persist();
	},

	_onMessage(e) {
		const status = e.data[0];
		const type = status & 0xf0;
		if (type !== 0xb0) return;

		const channel = status & 0x0f;
		const cc = e.data[1];
		const value7 = e.data[2];

		if (this.learning) {
			const {effect, param} = this.learning;
			const range = resolveRange(effect, param);
			const entry = {
				cc,
				channel,
				effect,
				param,
				outMin: range.outMin,
				outMax: range.outMax,
				integer: range.integer,
				type: range.type,
			};
			bindings.set(bindingKey(effect, param), entry);
			if (typeof midiLiveControl !== "undefined") {
				midiLiveControl.register(effect, param, `MIDI CC${cc}`);
			}
			persist();
			this.learning = null;
			const cb = this._learnCallback;
			this._learnCallback = null;
			cb?.();
			console.log(`[midiLearn] bound "${effect}.${param}" -> CC${cc} (channel ${channel})`);
			return;
		}

		for (const binding of bindings.values()) {
			if (binding.cc !== cc || binding.channel !== channel) continue;
			const key = bindingKey(binding.effect, binding.param);
			if (typeof midiLiveControl !== "undefined" && midiLiveControl.overrides.has(key)) continue;

			if (binding.effect === "scene") {
				const def = (window.sceneHost?.current?.def?.meta?.params || []).find((d) => d.name === binding.param);
				if (!def) continue;
			}

			const mapped = mapValue(binding, value7);
			if (typeof shaderEffects !== "undefined") {
				shaderEffects.updateEffectParam(binding.effect, binding.param, mapped);
			}
		}
	},
};

// Back-compat aliases for scenePanel / boot
export const sceneMidi = midiLearn;
window.midiLearn = midiLearn;
window.sceneMidi = sceneMidi;
