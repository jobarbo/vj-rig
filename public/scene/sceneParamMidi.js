// sceneParamMidi.js — MIDI → the active scene's params. Learned from the MIDI
// chip next to each param in panel V (scene/midiChip.js).
//
// The first message after "learn" decides the kind of binding:
//   S-1 key   velocity maps across the param's min/max; key-up restores the
//             value from before the key went down (bool params: on while held)
//   knob/CC   0–127 maps across min/max
//
// Bindings are PER SCENE, keyed "<sceneId>.<param>", and only fire while that
// scene is active.
//
// History / migrations (all one-way, on load):
//   vjPlasmaMidi          plasma-only panel P → "plasma.<param>"
//   vjSceneNoteMidi       panel P (keys + knobs, per scene) — this module's store
//   midiLearn "scene.*"   old panel-V CC learns were global by param name. sceneMidi.js
//                         hands them over (vjSceneCcLegacy); each is adopted by a
//                         scene the first time a scene declaring that param is shown.

import {cancelAllLearns} from "./midiChip.js";

const STORAGE_KEY = "vjSceneNoteMidi"; // name kept so existing bindings survive
const LEGACY_PLASMA_KEY = "vjPlasmaMidi";
export const LEGACY_SCENE_CC_KEY = "vjSceneCcLegacy";
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** @type {Map<string, {scene:string, param:string, source:"note"|"cc", note?:number, cc?:number, channel:number}>} */
const bindings = new Map();
/** @type {Map<number, {scene:string, param:string, prev:number|boolean}[]>} */
const heldNotes = new Map();

const keyOf = (scene, param) => `${scene}.${param}`;

function noteLabel(note) {
	const n = Math.min(127, Math.max(0, Number(note) || 0));
	return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

function activeId() {
	return window.sceneHost?.current?.def?.id || null;
}

/** Param defs of the active scene. */
function params() {
	return window.sceneParams?.defs() || [];
}

function defFor(name) {
	return params().find((d) => d.name === name) || null;
}

function readList(key) {
	try {
		const raw = localStorage.getItem(key);
		const list = raw ? JSON.parse(raw) : null;
		return Array.isArray(list) ? list : null;
	} catch (_) {
		return null;
	}
}

function load() {
	let list = readList(STORAGE_KEY);
	if (!list) {
		// One-time migration from the plasma-only panel.
		list = (readList(LEGACY_PLASMA_KEY) || []).map((b) => ({...b, scene: "plasma"}));
		if (list.length) console.log(`[sceneParamMidi] migrated ${list.length} plasma binding(s)`);
	}
	for (const b of list) {
		if (!b || typeof b.param !== "string" || typeof b.scene !== "string") continue;
		if (b.source !== "note" && b.source !== "cc") continue;
		bindings.set(keyOf(b.scene, b.param), b);
	}
	if (list.length) persist();
}

/**
 * Old global "scene.<param>" CC learns (handed over by sceneMidi.js). Adopted by
 * the active scene when it declares that param and has nothing bound to it yet.
 * Kept in the legacy list so other scenes with the same param adopt it too.
 */
function adoptLegacy() {
	const id = activeId();
	const legacy = readList(LEGACY_SCENE_CC_KEY);
	if (!id || !legacy?.length) return;
	const adoptedKey = `${LEGACY_SCENE_CC_KEY}.adopted`;
	const adopted = new Set(readList(adoptedKey) || []);
	let changed = false;
	for (const b of legacy) {
		if (!b || typeof b.param !== "string" || !Number.isFinite(b.cc)) continue;
		const k = keyOf(id, b.param);
		if (adopted.has(k) || bindings.has(k) || !defFor(b.param)) continue;
		bindings.set(k, {scene: id, param: b.param, source: "cc", cc: b.cc, channel: b.channel});
		adopted.add(k);
		changed = true;
		console.log(`[sceneParamMidi] adopted old V learn: ${k} ← CC ${b.cc}`);
	}
	if (changed) {
		persist();
		try {
			localStorage.setItem(adoptedKey, JSON.stringify([...adopted]));
		} catch (_) {
			/* quota — re-adoption next load is harmless */
		}
	}
}

function persist() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([...bindings.values()]));
	} catch (err) {
		console.warn("[sceneParamMidi] failed to persist bindings:", err);
	}
}

function map7(value7, def) {
	const t = Math.min(127, Math.max(0, value7)) / 127;
	const lo = def.min ?? 0;
	const hi = def.max ?? 1;
	let v = lo + t * (hi - lo);
	if (def.integer) v = Math.round(v);
	return v;
}

function writeParam(scene, name, value) {
	if (activeId() !== scene) return;
	window.sceneParams?.set(name, value);
}

/** Bindings of the active scene. */
function* activeBindings() {
	const id = activeId();
	if (!id) return;
	for (const b of bindings.values()) if (b.scene === id) yield b;
}

export const sceneParamMidi = {
	/** @type {null | string} param waiting for the next key or knob */
	learning: null,

	bindings,

	/** Binding of a param on the active scene, or null. */
	binding(param) {
		return bindings.get(keyOf(activeId(), param)) || null;
	},

	/** Chip state for panel V: a key ("C4") or a knob ("CC12"). */
	chipState(param) {
		const b = this.binding(param);
		const ch = b ? `, channel ${b.channel + 1}` : "";
		return {
			learning: this.learning === param,
			label: !b ? null : b.source === "note" ? noteLabel(b.note) : `CC${b.cc}`,
			title: !b ? undefined : b.source === "note" ? `S-1 key ${noteLabel(b.note)} — velocity, released = restore${ch}` : `CC ${b.cc}${ch}`,
		};
	},

	/**
	 * True if (cc, channel) drives a param of the active scene. s1Midi checks
	 * this (via midiLearn.isCcBound) so a learned knob wins over its S-1 preset.
	 */
	isCcBound(cc, channel) {
		for (const b of activeBindings()) if (b.source === "cc" && b.cc === cc && b.channel === channel) return true;
		return false;
	},

	startLearn(param) {
		this.learning = param;
	},

	cancelLearn() {
		this.learning = null;
	},

	clear(param) {
		bindings.delete(keyOf(activeId(), param));
		persist();
	},

	reset(param) {
		window.sceneParams?.reset(param);
	},

	async init() {
		if (this._inited) return this;
		this._inited = true;
		load();
		adoptLegacy();
		window.sceneHost?.onChange(() => {
			cancelAllLearns();
			adoptLegacy();
		});
		if (!navigator.requestMIDIAccess) return this;
		try {
			const access = await navigator.requestMIDIAccess();
			const bind = (input) => {
				if (!input || input._sceneParamMidiBound) return;
				input._sceneParamMidiBound = true;
				input.addEventListener("midimessage", (e) => this._onMessage(e));
			};
			for (const input of access.inputs.values()) bind(input);
			access.onstatechange = (e) => {
				if (e.port.type === "input" && e.port.state === "connected") bind(e.port);
			};
		} catch (err) {
			console.warn("[sceneParamMidi] requestMIDIAccess failed:", err);
		}
		return this;
	},

	_bind(entry) {
		const scene = activeId();
		this.learning = null;
		if (!scene) return;
		const full = {...entry, scene};
		bindings.set(keyOf(scene, entry.param), full);
		persist();
		console.log(`[sceneParamMidi] ${scene}.${entry.param} ← ${entry.source === "note" ? noteLabel(entry.note) : "CC " + entry.cc}`);
	},

	_onMessage(e) {
		const status = e.data[0];
		const type = status & 0xf0;
		const channel = status & 0x0f;

		if (type === 0x90 || type === 0x80) {
			const note = e.data[1];
			const velocity = e.data[2];
			const isOn = type === 0x90 && velocity > 0;

			if (isOn && this.learning) {
				this._bind({param: this.learning, source: "note", note, channel});
				return;
			}

			if (isOn) {
				const held = heldNotes.get(note) || [];
				for (const b of activeBindings()) {
					if (b.source !== "note" || b.note !== note || b.channel !== channel) continue;
					const def = defFor(b.param);
					if (!def) continue;
					if (!held.some((h) => h.param === b.param)) {
						held.push({scene: b.scene, param: b.param, prev: window.sceneParams?.get(b.param) ?? def.value ?? def.min ?? 0});
					}
					writeParam(b.scene, b.param, def.type === "bool" ? velocity > 0 : map7(velocity, def));
				}
				if (held.length) heldNotes.set(note, held);
				return;
			}

			const held = heldNotes.get(note);
			if (held) {
				heldNotes.delete(note);
				for (const h of held) writeParam(h.scene, h.param, h.prev);
			}
			return;
		}

		if (type !== 0xb0) return;
		const cc = e.data[1];
		const raw7 = e.data[2];
		// Stepped knobs (LFO wave, OSC range…) send a few small values — stretch to 0–127
		window.ccRange?.observe(channel, cc, raw7);
		const value7 = window.ccRange ? window.ccRange.norm(channel, cc, raw7) * 127 : raw7;

		if (this.learning) {
			this._bind({param: this.learning, source: "cc", cc, channel});
		}

		for (const b of activeBindings()) {
			if (b.source !== "cc" || b.cc !== cc || b.channel !== channel) continue;
			const def = defFor(b.param);
			if (!def) continue;
			writeParam(b.scene, b.param, map7(value7, def));
		}
	},
};

window.sceneParamMidi = sceneParamMidi;
