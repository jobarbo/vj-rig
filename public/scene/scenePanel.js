// scenePanel.js — sliders for the active scene's params, with the same live
// audio/MIDI badge as the shader panel.
//
// Reuses shaderEffectsPanel's `.shader-effects-panel__*` CSS classes (owned by
// repo-owned style.css) rather than duplicating them, but is a separate DOM
// tree: shaderEffectsPanel hardcodes `panel.id = "shader-effects-panel"`, so a
// second instance under that id would collide.
//
// Live badge: shaderEffectsPanel._getLiveSource(effectName, paramName) is not
// extensible as a registry list, but it IS fully driven by the
// (effectName, paramName) STRING pair — it just calls getMapping/overrides on
// whatever `audioKnob`/`midiLiveControl` globals it finds. Calling it with
// effectName "scene" therefore works with zero submodule edits, and it's
// calling an existing method, not editing one. A local fallback covers the
// case where shaderEffectsPanel hasn't loaded.

function liveSource(paramName) {
	const sp = typeof shaderEffectsPanel !== "undefined" ? shaderEffectsPanel : null;
	if (sp && typeof sp._getLiveSource === "function") {
		try {
			return sp._getLiveSource("scene", paramName);
		} catch (err) {
			console.warn("[scenePanel] shaderEffectsPanel._getLiveSource failed:", err);
		}
	}
	return fallbackLiveSource(paramName);
}

function fallbackLiveSource(paramName) {
	const registries = [
		typeof audioKnob !== "undefined" ? {reg: audioKnob, source: "audio"} : null,
		typeof midiLiveControl !== "undefined" ? {reg: midiLiveControl, source: "midi"} : null,
	].filter(Boolean);

	for (const {reg, source} of registries) {
		const mapping = reg.getMapping?.("scene", paramName);
		if (!mapping) continue;
		const key = `scene.${paramName}`;
		return {
			source,
			label: mapping.audioFeature || mapping.label || source,
			isOverridden: reg.overrides.has(key),
			override: () => reg.overrideParam("scene", paramName),
			release: () => reg.releaseParam("scene", paramName),
		};
	}
	return null;
}

async function buildCameraDevicePicker() {
	const {getCameraDevicePreference, setCameraDevicePreference} = await import("./runtime/mediaScene.js");

	const row = document.createElement("div");
	row.className = "shader-effects-panel__output-row";

	const label = document.createElement("span");
	label.className = "shader-effects-panel__output-label";
	label.textContent = "camera";

	const select = document.createElement("select");
	select.className = "shader-effects-panel__preset";
	select.style.cssText = "max-width:none;flex:1;";

	if (!navigator.mediaDevices?.enumerateDevices) {
		const opt = document.createElement("option");
		opt.textContent = "unavailable";
		select.appendChild(opt);
		select.disabled = true;
	} else {
		try {
			const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
			const current = getCameraDevicePreference();
			if (!devices.length) {
				const opt = document.createElement("option");
				opt.textContent = "no camera found";
				select.appendChild(opt);
				select.disabled = true;
			}
			devices.forEach((d, i) => {
				const opt = document.createElement("option");
				opt.value = d.deviceId;
				opt.textContent = d.label || `Camera ${i + 1}`;
				if (d.deviceId === current) opt.selected = true;
				select.appendChild(opt);
			});
			select.addEventListener("change", async () => {
				setCameraDevicePreference(select.value);
				// Force a reload with the new device — the runtime only reads the
				// preference at scene-load time.
				await window.sceneHost?.switchTo(window.sceneHost.currentId);
			});
		} catch (err) {
			const opt = document.createElement("option");
			opt.textContent = "permission denied";
			select.appendChild(opt);
			select.disabled = true;
			console.warn("[scenePanel] enumerateDevices failed:", err);
		}
	}

	row.appendChild(label);
	row.appendChild(select);
	return row;
}

function formatValue(num) {
	if (!Number.isFinite(num)) return "—";
	const abs = Math.abs(num);
	if (Number.isInteger(num) || abs >= 100) return String(Math.round(num));
	if (abs >= 10) return num.toFixed(1);
	if (abs >= 1) return num.toFixed(2);
	return num.toFixed(3);
}

class ScenePanel {
	constructor() {
		this.el = null;
		this.visible = false;
		this.controls = new Map(); // paramName -> {root, slider, number, liveDot, learnBtn}
		this._editing = false;
	}

	init() {
		this._ensureDom();
		window.sceneHost?.onChange(() => this.rebuild());
		this.rebuild();
		return this;
	}

	toggle() {
		this.visible = !this.visible;
		this._applyVisibility();
	}

	show() {
		this.visible = true;
		this._applyVisibility();
	}

	hide() {
		this.visible = false;
		this._applyVisibility();
	}

	_applyVisibility() {
		if (!this.el) return;
		this.el.classList.toggle("is-hidden", !this.visible);
		this.el.setAttribute("aria-hidden", this.visible ? "false" : "true");
	}

	_ensureDom() {
		if (this.el) return;
		const panel = document.createElement("div");
		panel.id = "scene-panel";
		panel.className = "shader-effects-panel scene-panel is-hidden";
		panel.setAttribute("aria-hidden", "true");
		panel.innerHTML = `
			<div class="shader-effects-panel__header">
				<span class="shader-effects-panel__title" data-ref="title">Scene</span>
				<span class="shader-effects-panel__hint">V · digits switch</span>
			</div>
			<div class="shader-effects-panel__list" data-ref="list"></div>
		`;
		document.body.appendChild(panel);
		this.el = panel;
		this.titleEl = panel.querySelector('[data-ref="title"]');
		this.listEl = panel.querySelector('[data-ref="list"]');
	}

	/** Rebuild the param rows for whichever scene is now active. */
	async rebuild() {
		if (!this.listEl) return;
		this.controls.clear();
		this.listEl.innerHTML = "";

		const host = window.sceneHost;
		const cur = host?.current;
		this.titleEl.textContent = cur ? `Scene · ${cur.def.name || cur.def.id}` : "Scene";
		if (!cur) return;

		const kind = cur.def.kind || cur.def.meta?.kind;
		if (kind === "camera") {
			this.listEl.appendChild(await buildCameraDevicePicker());
		}

		const defs = cur.def.meta?.params || [];
		if (!defs.length) {
			if (kind !== "camera") {
				const empty = document.createElement("div");
				empty.className = "shader-effects-panel__empty";
				empty.textContent = "No params on this scene.";
				this.listEl.appendChild(empty);
			}
			return;
		}

		for (const def of defs) {
			this.listEl.appendChild(this._createControl(def, cur.ctx.params[def.name]));
		}
	}

	_createControl(def, value) {
		const root = document.createElement("div");
		root.className = "shader-effects-panel__control";

		const meta = document.createElement("div");
		meta.className = "shader-effects-panel__control-meta";

		const liveDot = document.createElement("button");
		liveDot.type = "button";
		liveDot.hidden = true;
		liveDot.style.cssText = "border:none;background:none;padding:0 4px;margin-right:4px;cursor:pointer;font-size:9px;line-height:1;vertical-align:middle;";
		liveDot.addEventListener("click", (e) => {
			e.stopPropagation();
			const live = liveSource(def.name);
			if (!live) return;
			live.isOverridden ? live.release() : live.override();
			this._refreshLive(def.name, control);
		});

		const nameEl = document.createElement("span");
		nameEl.textContent = def.label || def.name;

		const learnBtn = document.createElement("button");
		learnBtn.type = "button";
		learnBtn.className = "shader-effects-panel__apply";
		learnBtn.style.cssText = "margin-left:4px;padding:0 6px;font-size:9px;";
		learnBtn.title = "Bind the next MIDI CC turned to this param";
		learnBtn.textContent = "learn";
		learnBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			const midi = window.sceneMidi;
			if (!midi) return;
			if (midi.learning === def.name) {
				midi.cancelLearn();
				learnBtn.textContent = "learn";
			} else {
				midi.startLearn(def.name, () => {
					learnBtn.textContent = "learn";
				});
				learnBtn.textContent = "…";
			}
		});

		let slider;
		let number;

		if (def.type === "bool") {
			slider = document.createElement("input");
			slider.type = "checkbox";
			slider.className = "shader-effects-panel__bool";
			slider.checked = !!value;
			slider.addEventListener("change", () => {
				shaderEffects?.updateEffectParam("scene", def.name, slider.checked);
			});
			meta.appendChild(liveDot);
			meta.appendChild(nameEl);
			meta.appendChild(learnBtn);
			root.classList.add("shader-effects-panel__control--bool");
			root.appendChild(meta);
			root.appendChild(slider);
		} else {
			number = document.createElement("input");
			number.type = "number";
			number.className = "shader-effects-panel__number";
			number.min = String(def.min ?? 0);
			number.max = String(def.max ?? 1);
			number.step = String(def.step ?? (def.integer ? 1 : (def.max - def.min) / 200 || 0.001));
			number.value = formatValue(value);

			slider = document.createElement("input");
			slider.type = "range";
			slider.className = "shader-effects-panel__slider";
			slider.min = number.min;
			slider.max = number.max;
			slider.step = number.step;
			slider.value = String(value);

			const commit = (raw) => {
				const num = Number.parseFloat(raw);
				if (!Number.isFinite(num)) return;
				shaderEffects?.updateEffectParam("scene", def.name, num);
				const clamped = window.sceneParams?.get(def.name) ?? num;
				slider.value = String(clamped);
				number.value = formatValue(clamped);
			};

			slider.addEventListener("pointerdown", () => (this._editing = true));
			slider.addEventListener("pointerup", () => (this._editing = false));
			slider.addEventListener("input", () => commit(slider.value));
			slider.addEventListener("change", () => {
				this._editing = false;
				commit(slider.value);
			});

			number.addEventListener("focus", () => (this._editing = true));
			number.addEventListener("blur", () => {
				commit(number.value);
				this._editing = false;
			});
			number.addEventListener("keydown", (e) => {
				e.stopPropagation();
				if (e.key === "Enter") {
					commit(number.value);
					number.blur();
				}
				if (e.key === "Escape") {
					number.value = formatValue(Number.parseFloat(slider.value));
					number.blur();
				}
			});

			meta.appendChild(liveDot);
			meta.appendChild(nameEl);
			meta.appendChild(number);
			meta.appendChild(learnBtn);
			root.appendChild(meta);
			root.appendChild(slider);
		}

		const control = {root, slider, number, liveDot, learnBtn};
		this.controls.set(def.name, control);
		this._refreshLive(def.name, control);
		return root;
	}

	_refreshLive(paramName, control) {
		const live = liveSource(paramName);
		if (!live) {
			control.liveDot.hidden = true;
			control.slider.disabled = false;
			if (control.number) control.number.disabled = false;
			return;
		}
		control.liveDot.hidden = false;
		control.liveDot.textContent = live.isOverridden ? "●" : "◉";
		control.liveDot.title = live.isOverridden
			? `Manual override (was ${live.source}: ${live.label}) — click to give control back`
			: `Live: ${live.source} — ${live.label}. Click to take control.`;
		control.liveDot.style.color = live.isOverridden ? "#888" : "#4ade80";
		control.slider.disabled = !live.isOverridden;
		if (control.number) control.number.disabled = !live.isOverridden;
	}

	/** Called every frame from draw(). Cheap: only syncs views, no rebuilding. */
	update() {
		if (!this.visible || this._editing) return;
		const cur = window.sceneHost?.current;
		if (!cur) return;

		for (const [name, control] of this.controls) {
			this._refreshLive(name, control);
			const value = cur.ctx.params[name];
			if (value === undefined) continue;
			if (control.slider.type === "checkbox") {
				if (document.activeElement !== control.slider) control.slider.checked = !!value;
			} else if (document.activeElement !== control.slider && document.activeElement !== control.number) {
				control.slider.value = String(value);
				control.number.value = formatValue(value);
			}
		}
	}
}

export const scenePanel = new ScenePanel();
window.scenePanel = scenePanel;
