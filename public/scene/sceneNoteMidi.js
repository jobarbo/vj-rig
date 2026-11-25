// sceneNoteMidi.js — S-1 keys and knobs → the active scene's params (panel P).
//
// Distinct from the shader MIDI panel (M) and the CC learn in the scene panel (V):
// this one also learns KEYS. A key's velocity, or a knob's CC, maps across the
// param's min/max; key-up restores the value from before the key went down.
//
// Bindings are per scene, keyed "<sceneId>.<param>", and only write while that
// scene is active. Started life as sceneNoteMidi.js; its saved bindings
// (vjPlasmaMidi) are migrated to "plasma.<param>" on first load.

const STORAGE_KEY = "vjSceneNoteMidi";
const LEGACY_PLASMA_KEY = "vjPlasmaMidi";
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
		if (list.length) console.log(`[sceneNoteMidi] migrated ${list.length} plasma binding(s)`);
	}
	for (const b of list) {
		if (!b || typeof b.param !== "string" || typeof b.scene !== "string") continue;
		if (b.source !== "note" && b.source !== "cc") continue;
		bindings.set(keyOf(b.scene, b.param), b);
	}
	if (list.length) persist();
}

function persist() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([...bindings.values()]));
	} catch (err) {
		console.warn("[sceneNoteMidi] failed to persist bindings:", err);
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

export const sceneNoteMidi = {
	/** @type {null | string} param waiting for the next key or knob */
	learning: null,

	params,
	bindings,

	bindingLabel(param) {
		const b = bindings.get(keyOf(activeId(), param));
		if (!b) return "—";
		if (b.source === "note") return `key ${noteLabel(b.note)}`;
		return `CC ${b.cc}`;
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
		if (!navigator.requestMIDIAccess) return this;
		try {
			const access = await navigator.requestMIDIAccess();
			const bind = (input) => {
				if (!input || input._sceneNoteMidiBound) return;
				input._sceneNoteMidiBound = true;
				input.addEventListener("midimessage", (e) => this._onMessage(e));
			};
			for (const input of access.inputs.values()) bind(input);
			access.onstatechange = (e) => {
				if (e.port.type === "input" && e.port.state === "connected") bind(e.port);
			};
		} catch (err) {
			console.warn("[sceneNoteMidi] requestMIDIAccess failed:", err);
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
		console.log(`[sceneNoteMidi] ${scene}.${entry.param} ← ${entry.source === "note" ? noteLabel(entry.note) : "CC " + entry.cc}`);
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

class SceneNoteMidiPanel {
	constructor() {
		this.el = null;
		this.visible = false;
		this.rows = new Map();
	}

	init() {
		this._ensureDom();
		this.rebuild();
		window.sceneHost?.onChange(() => {
			sceneNoteMidi.cancelLearn();
			this.rebuild();
		});
		return this;
	}

	toggle() {
		this.visible = !this.visible;
		this._applyVisibility();
		if (this.visible) this.rebuild();
	}

	update() {
		if (!this.visible || !activeId()) return;
		for (const [name, row] of this.rows) {
			const v = window.sceneParams?.get(name);
			if (row.valueEl && v != null && document.activeElement !== row.valueEl) {
				row.valueEl.textContent = typeof v === "boolean" ? (v ? "on" : "off") : Number.isInteger(v) ? String(v) : Number(v).toFixed(2);
			}
			row.learnBtn?.classList.toggle("is-armed", sceneNoteMidi.learning === name);
			if (row.learnBtn) row.learnBtn.textContent = sceneNoteMidi.learning === name ? "…" : "learn";
			if (row.bindEl) row.bindEl.textContent = sceneNoteMidi.bindingLabel(name);
		}
	}

	_applyVisibility() {
		if (!this.el) return;
		this.el.classList.toggle("is-hidden", !this.visible);
		this.el.setAttribute("aria-hidden", this.visible ? "false" : "true");
	}

	_ensureDom() {
		if (this.el) return;
		const panel = document.createElement("div");
		panel.id = "scene-note-midi-panel";
		panel.className = "shader-effects-panel scene-note-midi-panel is-hidden";
		panel.setAttribute("aria-hidden", "true");
		panel.innerHTML = `
			<div class="shader-effects-panel__header">
				<span class="shader-effects-panel__title" data-ref="title">S-1 → Scene</span>
				<span class="shader-effects-panel__hint">P</span>
			</div>
			<p class="scene-note-midi-panel__hint">Learn: next S-1 key (velocity) or knob. Key-up restores the previous value.</p>
			<div class="shader-effects-panel__list" data-ref="list"></div>
		`;
		document.body.appendChild(panel);
		this.el = panel;
		this.listEl = panel.querySelector('[data-ref="list"]');
		this.titleEl = panel.querySelector('[data-ref="title"]');
	}

	rebuild() {
		if (!this.listEl) return;
		this.rows.clear();
		this.listEl.innerHTML = "";
		const cur = window.sceneHost?.current;
		this.titleEl.textContent = `S-1 → ${cur ? cur.def.name || cur.def.id : "Scene"}`;
		for (const def of sceneNoteMidi.params()) {
			const root = document.createElement("div");
			root.className = "shader-effects-panel__control";

			const meta = document.createElement("div");
			meta.className = "shader-effects-panel__control-meta";

			const nameEl = document.createElement("span");
			nameEl.textContent = def.label || def.name;

			const valueEl = document.createElement("span");
			valueEl.className = "scene-note-midi-panel__value";

			const bindEl = document.createElement("span");
			bindEl.className = "scene-note-midi-panel__bind";
			bindEl.textContent = sceneNoteMidi.bindingLabel(def.name);

			const learnBtn = document.createElement("button");
			learnBtn.type = "button";
			learnBtn.className = "shader-effects-panel__apply";
			learnBtn.textContent = "learn";
			learnBtn.title = "Next S-1 key or knob drives this uniform";
			learnBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				if (sceneNoteMidi.learning === def.name) sceneNoteMidi.cancelLearn();
				else sceneNoteMidi.startLearn(def.name);
				this.update();
			});

			const clearBtn = document.createElement("button");
			clearBtn.type = "button";
			clearBtn.className = "shader-effects-panel__apply";
			clearBtn.textContent = "clear";
			clearBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				sceneNoteMidi.clear(def.name);
				this.update();
			});

			const resetBtn = document.createElement("button");
			resetBtn.type = "button";
			resetBtn.className = "shader-effects-panel__apply";
			resetBtn.textContent = "reset";
			resetBtn.title = "Restore this uniform to its original value";
			resetBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				sceneNoteMidi.reset(def.name);
				this.update();
			});

			meta.append(nameEl, valueEl, bindEl, learnBtn, clearBtn, resetBtn);
			root.appendChild(meta);
			this.listEl.appendChild(root);
			this.rows.set(def.name, {valueEl, bindEl, learnBtn});
		}
		this.update();
	}
}

export const sceneNoteMidiPanel = new SceneNoteMidiPanel();
window.sceneNoteMidiPanel = sceneNoteMidiPanel;
