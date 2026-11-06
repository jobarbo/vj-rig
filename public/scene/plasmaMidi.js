// plasmaMidi.js — S-1 keys and knobs → plasma shader uniforms.
//
// Distinct from the shader MIDI panel (M) and the scene param panel (V).
// A key's velocity, or a knob's CC, maps across that uniform's min/max.
// Key-up restores the value from before the key went down.
// Writes only while the plasma scene is active.

import {meta as plasmaMeta} from "../scenes/plasma/index.js";

const STORAGE_KEY = "vjPlasmaMidi";
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** @type {Map<string, {param:string, source:"note"|"cc", note?:number, cc?:number, channel:number}>} */
const bindings = new Map();
/** @type {Map<number, {param:string, prev:number}>} */
const heldNotes = new Map();

function noteLabel(note) {
	const n = Math.min(127, Math.max(0, Number(note) || 0));
	return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

function params() {
	return plasmaMeta.params || [];
}

function defFor(name) {
	return params().find((d) => d.name === name) || null;
}

function plasmaActive() {
	return window.sceneHost?.currentId === "plasma" || window.sceneHost?.current?.def?.id === "plasma";
}

function load() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const list = JSON.parse(raw);
		if (!Array.isArray(list)) return;
		for (const b of list) {
			if (!b || typeof b.param !== "string") continue;
			if (b.source !== "note" && b.source !== "cc") continue;
			bindings.set(b.param, b);
		}
	} catch (err) {
		console.warn("[plasmaMidi] failed to load bindings:", err);
	}
}

function persist() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([...bindings.values()]));
	} catch (err) {
		console.warn("[plasmaMidi] failed to persist bindings:", err);
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

function writeParam(name, value) {
	if (!plasmaActive()) return;
	window.sceneParams?.set(name, value);
}

export const plasmaMidi = {
	/** @type {null | string} param waiting for the next key or knob */
	learning: null,

	params,
	bindings,

	bindingLabel(param) {
		const b = bindings.get(param);
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
		bindings.delete(param);
		persist();
	},

	reset(param) {
		const def = defFor(param);
		if (!def || !plasmaActive()) return;
		window.sceneParams?.set(param, def.value ?? def.min ?? 0);
	},

	async init() {
		if (this._inited) return this;
		this._inited = true;
		load();
		if (!navigator.requestMIDIAccess) return this;
		try {
			const access = await navigator.requestMIDIAccess();
			const bind = (input) => {
				if (!input || input._plasmaMidiBound) return;
				input._plasmaMidiBound = true;
				input.addEventListener("midimessage", (e) => this._onMessage(e));
			};
			for (const input of access.inputs.values()) bind(input);
			access.onstatechange = (e) => {
				if (e.port.type === "input" && e.port.state === "connected") bind(e.port);
			};
		} catch (err) {
			console.warn("[plasmaMidi] requestMIDIAccess failed:", err);
		}
		return this;
	},

	_bind(entry) {
		bindings.set(entry.param, entry);
		persist();
		this.learning = null;
		console.log(`[plasmaMidi] ${entry.param} ← ${entry.source === "note" ? noteLabel(entry.note) : "CC " + entry.cc}`);
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
				for (const b of bindings.values()) {
					if (b.source !== "note" || b.note !== note || b.channel !== channel) continue;
					const def = defFor(b.param);
					if (!def) continue;
					if (!heldNotes.has(note)) {
						heldNotes.set(note, {param: b.param, prev: window.sceneParams?.get(b.param) ?? def.value ?? def.min ?? 0});
					}
					writeParam(b.param, map7(velocity, def));
				}
				return;
			}

			const held = heldNotes.get(note);
			if (held) {
				heldNotes.delete(note);
				writeParam(held.param, held.prev);
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

		for (const b of bindings.values()) {
			if (b.source !== "cc" || b.cc !== cc || b.channel !== channel) continue;
			const def = defFor(b.param);
			if (!def) continue;
			writeParam(b.param, map7(value7, def));
		}
	},
};

class PlasmaMidiPanel {
	constructor() {
		this.el = null;
		this.visible = false;
		this.rows = new Map();
	}

	init() {
		this._ensureDom();
		this.rebuild();
		return this;
	}

	toggle() {
		this.visible = !this.visible;
		this._applyVisibility();
		if (this.visible) this.rebuild();
	}

	update() {
		if (!this.visible || !plasmaActive()) return;
		for (const [name, row] of this.rows) {
			const v = window.sceneParams?.get(name);
			if (row.valueEl && v != null && document.activeElement !== row.valueEl) {
				row.valueEl.textContent = Number.isInteger(v) ? String(v) : Number(v).toFixed(2);
			}
			row.learnBtn?.classList.toggle("is-armed", plasmaMidi.learning === name);
			if (row.learnBtn) row.learnBtn.textContent = plasmaMidi.learning === name ? "…" : "learn";
			if (row.bindEl) row.bindEl.textContent = plasmaMidi.bindingLabel(name);
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
		panel.id = "plasma-midi-panel";
		panel.className = "shader-effects-panel plasma-midi-panel is-hidden";
		panel.setAttribute("aria-hidden", "true");
		panel.innerHTML = `
			<div class="shader-effects-panel__header">
				<span class="shader-effects-panel__title">S-1 → Plasma</span>
				<span class="shader-effects-panel__hint">P</span>
			</div>
			<p class="plasma-midi-panel__hint">Learn: next S-1 key (velocity) or knob. Key-up restores the previous value.</p>
			<div class="shader-effects-panel__list" data-ref="list"></div>
		`;
		document.body.appendChild(panel);
		this.el = panel;
		this.listEl = panel.querySelector('[data-ref="list"]');
	}

	rebuild() {
		if (!this.listEl) return;
		this.rows.clear();
		this.listEl.innerHTML = "";
		for (const def of plasmaMidi.params()) {
			const root = document.createElement("div");
			root.className = "shader-effects-panel__control";

			const meta = document.createElement("div");
			meta.className = "shader-effects-panel__control-meta";

			const nameEl = document.createElement("span");
			nameEl.textContent = def.label || def.name;

			const valueEl = document.createElement("span");
			valueEl.className = "plasma-midi-panel__value";

			const bindEl = document.createElement("span");
			bindEl.className = "plasma-midi-panel__bind";
			bindEl.textContent = plasmaMidi.bindingLabel(def.name);

			const learnBtn = document.createElement("button");
			learnBtn.type = "button";
			learnBtn.className = "shader-effects-panel__apply";
			learnBtn.textContent = "learn";
			learnBtn.title = "Next S-1 key or knob drives this uniform";
			learnBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				if (plasmaMidi.learning === def.name) plasmaMidi.cancelLearn();
				else plasmaMidi.startLearn(def.name);
				this.update();
			});

			const clearBtn = document.createElement("button");
			clearBtn.type = "button";
			clearBtn.className = "shader-effects-panel__apply";
			clearBtn.textContent = "clear";
			clearBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				plasmaMidi.clear(def.name);
				this.update();
			});

			const resetBtn = document.createElement("button");
			resetBtn.type = "button";
			resetBtn.className = "shader-effects-panel__apply";
			resetBtn.textContent = "reset";
			resetBtn.title = "Restore this uniform to its original value";
			resetBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				plasmaMidi.reset(def.name);
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

export const plasmaMidiPanel = new PlasmaMidiPanel();
window.plasmaMidiPanel = plasmaMidiPanel;
