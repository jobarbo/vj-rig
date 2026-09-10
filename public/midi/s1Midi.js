/**
 * Roland S-1 → shader mappings (Web MIDI CC, channel 3 by default).
 *
 * Controllers listed in S1_CONTROLS can be remapped via the MIDI panel (key M).
 * Defaults come from DEFAULT_MAPS; user overrides persist in localStorage (vjS1Maps).
 *
 * Learn bindings (midiLearn / panel E·V) still win for the same (cc, channel).
 */
(function () {
	const S1_MIDI_CHANNEL = 2; // MIDI channel 3 (0-indexed)
	const STORAGE_KEY = "vjS1Maps";

	/** Front-panel continuous knobs available for mapping. */
	const S1_CONTROLS = [
		{cc: 74, id: "filter-cutoff", label: "Filter Cutoff", section: "Filter"},
		{cc: 71, id: "filter-reso", label: "Filter Resonance", section: "Filter"},
		{cc: 24, id: "filter-env", label: "Filter Env Amt", section: "Filter"},
		{cc: 25, id: "filter-lfo", label: "Filter LFO Amt", section: "Filter"},
		{cc: 3, id: "lfo-rate", label: "LFO Rate", section: "LFO"},
		{cc: 17, id: "lfo-mod-depth", label: "LFO Mod Depth", section: "LFO"},
		{cc: 13, id: "osc-lfo-pitch", label: "LFO Pitch", section: "Osc"},
		{cc: 15, id: "square-pw", label: "Square PW", section: "Osc"},
		{cc: 19, id: "square-level", label: "Square Level", section: "Osc"},
		{cc: 20, id: "saw-level", label: "Saw Level", section: "Osc"},
		{cc: 21, id: "sub-level", label: "Sub Level", section: "Osc"},
		{cc: 23, id: "noise-level", label: "Noise Level", section: "Osc"},
		{cc: 73, id: "env-attack", label: "Env Attack", section: "Envelope"},
		{cc: 75, id: "env-decay", label: "Env Decay", section: "Envelope"},
		{cc: 30, id: "env-sustain", label: "Env Sustain", section: "Envelope"},
		{cc: 72, id: "env-release", label: "Env Release", section: "Envelope"},
		{cc: 89, id: "reverb-time", label: "Reverb Time", section: "FX"},
		{cc: 91, id: "reverb-level", label: "Reverb Level", section: "FX"},
		{cc: 90, id: "delay-time", label: "Delay Time", section: "FX"},
		{cc: 92, id: "delay-level", label: "Delay Level", section: "FX"},
	];

	/** Factory defaults (same targets as the original Grid→S-1 port). */
	const DEFAULT_MAPS = {
		74: {effect: "pixelSort", param: "threshold", outMin: 0, outMax: 1},
		71: {effect: "pixelSort", param: "sortAmount", outMin: 0, outMax: 10},
		3: {effect: "symmetry", param: "rotationSpeed", outMin: 0.1, outMax: 150},
		13: {effect: "symmetry", param: "rotationStartingAngle", outMin: 0, outMax: 360, smooth: true},
		73: {effect: "pixelSort", param: "invert", outMin: 0, outMax: 1},
		75: {effect: "pixelSort", param: "sampleCount", outMin: 1, outMax: 64, integer: true},
		30: {
			effect: "symmetry",
			param: "translationSpeedX",
			outMin: 0.1,
			outMax: 5,
			also: [{effect: "symmetry", param: "translationSpeedY"}],
		},
		72: {effect: "symmetry", param: "timeMultiplier", outMin: 0.0001, outMax: 0.1},
	};

	/** @type {Map<number, object|null>} null = explicitly unmapped */
	const mapsByCc = new Map();
	const listeners = new Set();
	let lastCc = null;
	let lastValue7 = 0;
	let lastAt = 0;
	let deviceName = null;
	let inputCount = 0;

	function isLikelyS1Port(name) {
		const n = String(name || "").toLowerCase();
		return (
			/s-?1/.test(n) ||
			/aira\s*compact/.test(n) ||
			/compact.*s-?1/.test(n) ||
			(/digital audio interface/.test(n) && /s-?1|aira|compact/.test(n))
		);
	}

	function notify() {
		for (const fn of listeners) {
			try {
				fn();
			} catch (err) {
				console.warn("[s1Midi] listener error:", err);
			}
		}
	}

	function guessRange(effect, param) {
		const panel = typeof shaderEffectsPanel !== "undefined" ? shaderEffectsPanel : null;
		const cfg = typeof shaderEffects !== "undefined" ? shaderEffects.effectsConfig?.[effect] : null;
		const cur = cfg?.[param];
		if (panel && typeof panel._guessRange === "function" && typeof cur === "number") {
			const r = panel._guessRange(param, cur);
			return {outMin: r.min, outMax: r.max, integer: !!r.integer};
		}
		if (typeof cur === "number" && Number.isFinite(cur)) {
			const abs = Math.abs(cur) || 1;
			if (Number.isInteger(cur)) return {outMin: 0, outMax: Math.max(64, cur * 2), integer: true};
			if (abs <= 1) return {outMin: 0, outMax: 1};
			return {outMin: 0, outMax: abs * 2};
		}
		return {outMin: 0, outMax: 1};
	}

	function loadMaps() {
		mapsByCc.clear();
		for (const [cc, map] of Object.entries(DEFAULT_MAPS)) {
			mapsByCc.set(Number(cc), {...map});
		}
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const saved = JSON.parse(raw);
			if (!saved || typeof saved !== "object") return;
			for (const [ccStr, map] of Object.entries(saved)) {
				const cc = Number(ccStr);
				if (!Number.isFinite(cc)) continue;
				mapsByCc.set(cc, map); // null clears default
			}
		} catch (err) {
			console.warn("[s1Midi] failed to load maps:", err);
		}
	}

	function persistMaps() {
		const out = {};
		for (const ctrl of S1_CONTROLS) {
			const map = mapsByCc.get(ctrl.cc);
			const def = DEFAULT_MAPS[ctrl.cc];
			if (map == null && def) {
				out[ctrl.cc] = null;
				continue;
			}
			if (!map) continue;
			const sameTarget = def && map.effect === def.effect && map.param === def.param;
			const sameRange =
				def &&
				Number(map.outMin) === Number(def.outMin) &&
				Number(map.outMax) === Number(def.outMax) &&
				!!map.integer === !!def.integer;
			if (!def || !sameTarget || !sameRange) {
				out[ctrl.cc] = {
					effect: map.effect,
					param: map.param,
					outMin: map.outMin,
					outMax: map.outMax,
					integer: map.integer,
					smooth: map.smooth,
					also: map.also,
				};
			}
		}
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
		} catch (err) {
			console.warn("[s1Midi] failed to persist maps:", err);
		}
	}

	function getMap(cc) {
		if (!mapsByCc.has(cc)) return null;
		return mapsByCc.get(cc);
	}

	/**
	 * @param {number} cc
	 * @param {string|null} effect
	 * @param {string|null} param
	 * @param {{outMin?:number, outMax?:number, integer?:boolean}=} rangeOverride
	 */
	function setMap(cc, effect, param, rangeOverride) {
		if (!effect || !param) {
			mapsByCc.set(cc, null);
			persistMaps();
			reregisterLive();
			notify();
			return;
		}
		const existing = getMap(cc);
		const keepRange = existing && existing.effect === effect && existing.param === param;
		const guessed = guessRange(effect, param);
		const def = DEFAULT_MAPS[cc];
		const entry = {
			effect,
			param,
			outMin: rangeOverride?.outMin ?? (keepRange ? existing.outMin : guessed.outMin),
			outMax: rangeOverride?.outMax ?? (keepRange ? existing.outMax : guessed.outMax),
			integer: rangeOverride?.integer ?? (keepRange ? existing.integer : guessed.integer),
			smooth:
				keepRange && existing.smooth
					? existing.smooth
					: def?.smooth && def.param === param && def.effect === effect
						? def.smooth
						: param === "rotationStartingAngle",
			also: keepRange ? existing.also : def?.also && def.effect === effect && def.param === param ? def.also : undefined,
		};
		mapsByCc.set(cc, entry);
		if (entry.smooth && typeof addKnobSmooth === "function" && typeof shaderEffects !== "undefined") {
			const init = shaderEffects.effectsConfig?.[effect]?.[param] ?? entry.outMin;
			addKnobSmooth(cc, effect, param, init, 0.08);
		}
		persistMaps();
		reregisterLive();
		notify();
	}

	function setMapRange(cc, outMin, outMax) {
		const map = getMap(cc);
		if (!map) return;
		const min = Number(outMin);
		const max = Number(outMax);
		if (!Number.isFinite(min) || !Number.isFinite(max)) return;
		map.outMin = min;
		map.outMax = max;
		mapsByCc.set(cc, map);
		persistMaps();
		notify();
	}

	function clearMap(cc) {
		setMap(cc, null, null);
	}

	function resetMaps() {
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch (_) {
			/* ignore */
		}
		loadMaps();
		reregisterLive();
		notify();
	}

	function listShaderTargets() {
		const cfg = typeof shaderEffects !== "undefined" ? shaderEffects.effectsConfig : null;
		if (!cfg) return [];
		const skip = new Set(["uniforms", "enabled", "translationPhaseX", "translationPhaseY", "rotationPhase"]);
		const out = [];
		for (const [effect, params] of Object.entries(cfg)) {
			if (!params || typeof params !== "object") continue;
			for (const [key, val] of Object.entries(params)) {
				if (skip.has(key) || key.startsWith("_")) continue;
				if (typeof val !== "number") continue;
				out.push({effect, param: key, value: `${effect}.${key}`, label: `${effect} · ${key}`});
			}
		}
		out.sort((a, b) => a.label.localeCompare(b.label));
		return out;
	}

	function map7(value7, outMin, outMax, integer) {
		const t = Math.min(127, Math.max(0, value7)) / 127;
		let v = outMin + t * (outMax - outMin);
		if (integer) v = Math.round(v);
		return v;
	}

	function setLive(effectName, paramName, value, cc) {
		if (typeof midiLiveControl !== "undefined") {
			midiLiveControl.register(effectName, paramName, `S-1 CC${cc}`);
			if (midiLiveControl.overrides.has(midiLiveControl._key(effectName, paramName))) return;
		}
		if (typeof shaderEffects !== "undefined" && typeof shaderEffects.updateEffectParam === "function") {
			shaderEffects.updateEffectParam(effectName, paramName, value);
		}
	}

	function applyMap(map, cc, value7) {
		if (!map) return;
		const value = map7(value7, map.outMin ?? 0, map.outMax ?? 1, map.integer);

		if (map.smooth && typeof knobSmoothing !== "undefined" && knobSmoothing[cc]) {
			knobSmoothing[cc].target = value;
			if (typeof midiLiveControl !== "undefined") {
				midiLiveControl.register(map.effect, map.param, `S-1 CC${cc}`);
			}
		} else {
			setLive(map.effect, map.param, value, cc);
		}

		if (map.also) {
			for (const extra of map.also) {
				setLive(extra.effect, extra.param, value, cc);
			}
		}
	}

	function reregisterLive() {
		if (typeof midiLiveControl === "undefined") return;
		for (const ctrl of S1_CONTROLS) {
			const map = getMap(ctrl.cc);
			if (!map) continue;
			midiLiveControl.register(map.effect, map.param, `S-1 CC${ctrl.cc}`);
			if (map.also) {
				for (const extra of map.also) {
					midiLiveControl.register(extra.effect, extra.param, `S-1 CC${ctrl.cc}`);
				}
			}
		}
	}

	function onMessage(e) {
		const status = e.data[0];
		if ((status & 0xf0) !== 0xb0) return;

		const channel = status & 0x0f;
		const cc = e.data[1];
		const value7 = e.data[2];

		lastCc = cc;
		lastValue7 = value7;
		lastAt = performance.now();
		notify();

		if (window.midiLearn?.learning) return;
		if (window.midiLearn?.isCcBound?.(cc, channel)) return;
		if (channel !== S1_MIDI_CHANNEL) return;

		const map = getMap(cc);
		if (!map) return;
		applyMap(map, cc, value7);
	}

	function bindInput(input) {
		if (!input || input._s1MidiBound) return;
		input._s1MidiBound = true;
		input.addEventListener("midimessage", onMessage);
	}

	async function init() {
		loadMaps();
		reregisterLive();

		if (!navigator.requestMIDIAccess) {
			console.warn("[s1Midi] Web MIDI not available");
			return;
		}
		try {
			const access = await navigator.requestMIDIAccess();
			const inputs = [...access.inputs.values()];
			const s1 = inputs.find((p) => isLikelyS1Port(p.name));
			for (const input of inputs) bindInput(input);
			access.onstatechange = (ev) => {
				if (ev.port?.type === "input" && ev.port.state === "connected") bindInput(ev.port);
			};

			if (s1) {
				deviceName = s1.name;
				console.log(`[s1Midi] ready — maps on channel ${S1_MIDI_CHANNEL + 1} via "${s1.name}" (${inputs.length} input(s))`);
			} else {
				deviceName = null;
				console.log(
					`[s1Midi] ready — no S-1-named port yet; listening on all ${inputs.length} input(s), maps require MIDI ch ${S1_MIDI_CHANNEL + 1}`,
				);
			}
			inputCount = inputs.length;
			notify();
		} catch (err) {
			console.warn("[s1Midi] requestMIDIAccess failed:", err);
			deviceName = null;
		}
	}

	function isDefaultMap(cc) {
		const map = getMap(cc);
		const def = DEFAULT_MAPS[cc];
		if (!map && !def) return true;
		if (!map || !def) return false;
		return (
			map.effect === def.effect &&
			map.param === def.param &&
			Number(map.outMin) === Number(def.outMin) &&
			Number(map.outMax) === Number(def.outMax)
		);
	}

	function mappingStatus() {
		let mapped = 0;
		let custom = 0;
		for (const ctrl of S1_CONTROLS) {
			const map = getMap(ctrl.cc);
			if (map) {
				mapped++;
				if (!isDefaultMap(ctrl.cc)) custom++;
			}
		}
		return {mapped, custom, total: S1_CONTROLS.length};
	}

	// Back-compat alias used by midiLearn range hints
	const S1_PRESETS = S1_CONTROLS.map((c) => {
		const m = DEFAULT_MAPS[c.cc];
		return m ? {cc: c.cc, ...m} : {cc: c.cc, effect: "", param: "", outMin: 0, outMax: 1};
	}).filter((p) => p.effect);

	window.s1Midi = {
		S1_MIDI_CHANNEL,
		S1_CONTROLS,
		S1_PRESETS,
		DEFAULT_MAPS,
		isLikelyS1Port,
		init,
		getMap,
		setMap,
		setMapRange,
		clearMap,
		resetMaps,
		listShaderTargets,
		isDefaultMap,
		mappingStatus,
		getDeviceInfo() {
			return {
				name: deviceName,
				inputCount,
				channel: S1_MIDI_CHANNEL + 1,
			};
		},
		onChange(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		getLastActivity() {
			return {cc: lastCc, value7: lastValue7, at: lastAt};
		},
	};

	init();
})();
