/**
 * Roland S-1 → shader presets (Web MIDI CC, channel 3 by default).
 *
 * Uses addEventListener so it coexists with sceneMidi / midiLearn.
 * Learn bindings win: if midiLearn claims a (cc, channel), the preset is skipped.
 *
 * Device detection mirrors s1_dashboard (S-1 / AIRA Compact / Digital Audio Interface).
 */
(function () {
	const S1_MIDI_CHANNEL = 2; // MIDI channel 3 (0-indexed)

	/** @type {Array<{cc:number, effect:string, param:string, outMin:number, outMax:number, integer?:boolean, smooth?:boolean, also?:Array<{effect:string,param:string}>}>} */
	const S1_PRESETS = [
		{cc: 74, effect: "pixelSort", param: "threshold", outMin: 0, outMax: 1},
		{cc: 71, effect: "pixelSort", param: "sortAmount", outMin: 0, outMax: 10},
		{cc: 3, effect: "symmetry", param: "rotationSpeed", outMin: 0.1, outMax: 150},
		{cc: 13, effect: "symmetry", param: "rotationStartingAngle", outMin: 0, outMax: 360, smooth: true},
		{cc: 73, effect: "pixelSort", param: "invert", outMin: 0, outMax: 1},
		{cc: 75, effect: "pixelSort", param: "sampleCount", outMin: 1, outMax: 64, integer: true},
		{
			cc: 30,
			effect: "symmetry",
			param: "translationSpeedX",
			outMin: 0.1,
			outMax: 5,
			also: [{effect: "symmetry", param: "translationSpeedY"}],
		},
		{cc: 72, effect: "symmetry", param: "timeMultiplier", outMin: 0.0001, outMax: 10.1},
	];

	const presetByCc = new Map(S1_PRESETS.map((p) => [p.cc, p]));

	function isLikelyS1Port(name) {
		const n = String(name || "").toLowerCase();
		return /s-?1/.test(n) || /aira\s*compact/.test(n) || /compact.*s-?1/.test(n) || (/digital audio interface/.test(n) && /s-?1|aira|compact/.test(n));
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

	function applyPreset(preset, value7) {
		const value = map7(value7, preset.outMin, preset.outMax, preset.integer);

		if (preset.smooth && typeof knobSmoothing !== "undefined" && knobSmoothing[preset.cc]) {
			knobSmoothing[preset.cc].target = value;
			if (typeof midiLiveControl !== "undefined") {
				midiLiveControl.register(preset.effect, preset.param, `S-1 CC${preset.cc}`);
			}
		} else {
			setLive(preset.effect, preset.param, value, preset.cc);
		}

		if (preset.also) {
			for (const extra of preset.also) {
				setLive(extra.effect, extra.param, value, preset.cc);
			}
		}
	}

	function onMessage(e) {
		const status = e.data[0];
		if ((status & 0xf0) !== 0xb0) return;

		const channel = status & 0x0f;
		const cc = e.data[1];
		const value7 = e.data[2];

		// While learning, midiLearn owns the next CC — don't also fire presets
		if (window.midiLearn?.learning) return;

		if (window.midiLearn?.isCcBound?.(cc, channel)) return;

		if (channel !== S1_MIDI_CHANNEL) return;

		const preset = presetByCc.get(cc);
		if (!preset) return;

		applyPreset(preset, value7);
	}

	function bindInput(input) {
		if (!input || input._s1MidiBound) return;
		input._s1MidiBound = true;
		input.addEventListener("midimessage", onMessage);
	}

	async function init() {
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
				console.log(`[s1Midi] ready — presets on channel ${S1_MIDI_CHANNEL + 1} via "${s1.name}" (${inputs.length} input(s))`);
			} else {
				console.log(`[s1Midi] ready — no S-1-named port yet; listening on all ${inputs.length} input(s), presets still require MIDI ch ${S1_MIDI_CHANNEL + 1}`);
			}

			// Register live badges for preset targets so panel E shows ◉ before first move
			if (typeof midiLiveControl !== "undefined") {
				for (const p of S1_PRESETS) {
					midiLiveControl.register(p.effect, p.param, `S-1 CC${p.cc}`);
					if (p.also) {
						for (const extra of p.also) {
							midiLiveControl.register(extra.effect, extra.param, `S-1 CC${p.cc}`);
						}
					}
				}
			}
		} catch (err) {
			console.warn("[s1Midi] requestMIDIAccess failed:", err);
		}
	}

	window.s1Midi = {
		S1_MIDI_CHANNEL,
		S1_PRESETS,
		isLikelyS1Port,
		init,
	};

	init();
})();
