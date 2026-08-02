// sceneMidi.js — MIDI CC -> scene param, independent of knob.js.
//
// knob.js binds via property assignment (`xtouch.onmidimessage = ...`,
// knob.js:75), which is a single-slot DOM "event handler IDL attribute" — a
// second `.onmidimessage = ...` from here would silently replace it and knob
// input would stop working. addEventListener-registered listeners are a
// separate mechanism and coexist with that property fine, so this router uses
// its own requestMIDIAccess() and addEventListener exclusively.
//
// A binding is keyed only by param name, not by scene: like an audioKnob
// mapping, it stays live across a scene switch and simply no-ops (via
// sceneParams.set's unknown-param guard) if the new scene has no param with
// that name. This mirrors how audioKnob.map("bass", "scene", "speed", ...)
// already behaves — one flat namespace for whichever scene is active.

const bindings = new Map(); // paramName -> {cc, channel}

function midiKey(paramName) {
	return `scene.${paramName}`;
}

export const sceneMidi = {
	ready: false,
	learning: null,
	bindings,

	async init() {
		if (!navigator.requestMIDIAccess) {
			console.warn("[sceneMidi] Web MIDI not available in this browser");
			return this;
		}
		try {
			const access = await navigator.requestMIDIAccess();
			const bind = (input) => input.addEventListener("midimessage", (e) => this._onMessage(e));
			for (const input of access.inputs.values()) bind(input);
			access.onstatechange = (e) => {
				if (e.port.type === "input" && e.port.state === "connected") bind(e.port);
			};
			this.ready = true;
			console.log(`[sceneMidi] ready — ${access.inputs.size} input(s)`);
		} catch (err) {
			console.warn("[sceneMidi] requestMIDIAccess failed:", err);
		}
		return this;
	},

	/** Bind the next CC message received to `paramName`. `onBound` fires once, success or cancel. */
	startLearn(paramName, onBound) {
		this.learning = paramName;
		this._learnCallback = onBound || null;
	},

	cancelLearn() {
		this.learning = null;
		const cb = this._learnCallback;
		this._learnCallback = null;
		cb?.();
	},

	clearBinding(paramName) {
		bindings.delete(paramName);
		if (typeof midiLiveControl !== "undefined") {
			midiLiveControl.mappings.delete(midiKey(paramName));
			midiLiveControl.overrides.delete(midiKey(paramName));
		}
	},

	_onMessage(e) {
		const status = e.data[0];
		const type = status & 0xf0;
		if (type !== 0xb0) return; // CC messages only

		const channel = status & 0x0f;
		const cc = e.data[1];
		const value7 = e.data[2];

		if (this.learning) {
			const paramName = this.learning;
			bindings.set(paramName, {cc, channel});
			if (typeof midiLiveControl !== "undefined") {
				midiLiveControl.register("scene", paramName, `MIDI CC${cc}`);
			}
			this.learning = null;
			const cb = this._learnCallback;
			this._learnCallback = null;
			cb?.();
			console.log(`[sceneMidi] bound "${paramName}" -> CC${cc} (channel ${channel})`);
			return;
		}

		for (const [paramName, binding] of bindings) {
			if (binding.cc !== cc || binding.channel !== channel) continue;
			if (typeof midiLiveControl !== "undefined" && midiLiveControl.overrides.has(midiKey(paramName))) continue;

			const def = (window.sceneHost?.current?.def?.meta?.params || []).find((d) => d.name === paramName);
			if (!def) continue; // no such param on the active scene right now

			const norm = value7 / 127;
			const mapped = def.type === "bool" ? (norm > 0.5 ? 1 : 0) : (def.min ?? 0) + norm * ((def.max ?? 1) - (def.min ?? 0));
			if (typeof shaderEffects !== "undefined") shaderEffects.updateEffectParam("scene", paramName, mapped);
		}
	},
};

window.sceneMidi = sceneMidi;
