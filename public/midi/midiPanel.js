/**
 * MIDI mapping panel — key M.
 * Clear S-1 knob → shader param mapping with live feedback.
 */
(function () {
	class MidiPanel {
		constructor() {
			this.el = null;
			this.visible = false;
			this._rows = new Map();
			this._noteRows = new Map();
			this._unsub = null;
			this._filter = "";
			this._collapsed = new Set();
			this._findMode = false;
			this._noteLearnMode = false;
			this._lastNoteFlashAt = 0;
		}

		init() {
			this._ensureDom();
			this.rebuild();
			if (window.s1Midi?.onChange) {
				this._unsub = window.s1Midi.onChange(() => this._onActivity());
			}
			return this;
		}

		toggle() {
			this.visible = !this.visible;
			this._applyVisibility();
			if (this.visible) {
				this.rebuild();
				this.filterInput?.focus();
			}
		}

		show() {
			this.visible = true;
			this._applyVisibility();
			this.rebuild();
		}

		hide() {
			this.visible = false;
			this._findMode = false;
			this._cancelNoteLearn();
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
			panel.id = "midi-panel";
			panel.className = "shader-effects-panel midi-panel is-hidden";
			panel.setAttribute("aria-hidden", "true");
			panel.innerHTML = `
				<div class="shader-effects-panel__header">
					<span class="shader-effects-panel__title">S-1 → Shaders</span>
					<span class="shader-effects-panel__hint">M</span>
				</div>

				<div class="midi-panel__status" data-ref="status">
					<div class="midi-panel__status-line">
						<span class="midi-panel__dot" data-ref="dot" title="MIDI device"></span>
						<span data-ref="device">Looking for S-1…</span>
					</div>
					<div class="midi-panel__status-line midi-panel__status-meta">
						<span data-ref="counts">—</span>
						<span data-ref="activity" class="midi-panel__activity">Turn a knob to highlight</span>
					</div>
				</div>

				<div class="midi-panel__toolbar">
					<input type="search" class="midi-panel__search" data-ref="filter" placeholder="Filter knobs or targets…" autocomplete="off" spellcheck="false" />
					<button type="button" class="shader-effects-panel__apply midi-panel__btn" data-ref="find" title="Next S-1 CC you turn scrolls to that row">Find knob</button>
				</div>

				<div class="midi-panel__legend">
					<span class="midi-panel__pill">S-1 knob</span>
					<span class="midi-panel__arrow" aria-hidden="true">→</span>
					<span class="midi-panel__pill midi-panel__pill--target">shader param</span>
				</div>

				<div class="shader-effects-panel__list midi-panel__list" data-ref="list"></div>

				<div class="midi-panel__notes" data-ref="notes-wrap">
					<div class="midi-panel__notes-header">
						<span class="midi-panel__notes-title">Keyboard → effects</span>
						<button type="button" class="shader-effects-panel__apply midi-panel__btn" data-ref="learn-note" title="Next S-1 key creates a binding">Learn note</button>
					</div>
					<p class="midi-panel__notes-hint">Hold (default): key down ON / key up OFF. Latch: each press toggles.</p>
					<div class="midi-panel__notes-list" data-ref="notes"></div>
				</div>

				<div class="midi-panel__footer">
					<button type="button" class="shader-effects-panel__apply" data-ref="reset" title="Restore factory S-1 → shader mappings">Reset defaults</button>
					<button type="button" class="shader-effects-panel__apply" data-ref="clock" title="Toggle OSC MIDI-clock HUD">Clock HUD</button>
				</div>
			`;
			document.body.appendChild(panel);
			this.el = panel;
			this.listEl = panel.querySelector('[data-ref="list"]');
			this.notesEl = panel.querySelector('[data-ref="notes"]');
			this.statusDot = panel.querySelector('[data-ref="dot"]');
			this.deviceEl = panel.querySelector('[data-ref="device"]');
			this.countsEl = panel.querySelector('[data-ref="counts"]');
			this.activityEl = panel.querySelector('[data-ref="activity"]');
			this.filterInput = panel.querySelector('[data-ref="filter"]');
			this.findBtn = panel.querySelector('[data-ref="find"]');
			this.learnNoteBtn = panel.querySelector('[data-ref="learn-note"]');

			this.filterInput.addEventListener("input", () => {
				this._filter = this.filterInput.value.trim().toLowerCase();
				this._applyFilter();
			});
			this.filterInput.addEventListener("keydown", (e) => e.stopPropagation());

			this.findBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this._cancelNoteLearn();
				this._findMode = !this._findMode;
				this.findBtn.classList.toggle("is-armed", this._findMode);
				this.findBtn.textContent = this._findMode ? "Listening…" : "Find knob";
				if (this.activityEl) {
					this.activityEl.textContent = this._findMode ? "Turn an S-1 knob…" : "Turn a knob to highlight";
				}
			});

			this.learnNoteBtn?.addEventListener("click", (e) => {
				e.stopPropagation();
				if (this._noteLearnMode) {
					this._cancelNoteLearn();
					return;
				}
				this._findMode = false;
				this.findBtn?.classList.remove("is-armed");
				if (this.findBtn) this.findBtn.textContent = "Find knob";
				this._armNoteLearn();
			});

			panel.querySelector('[data-ref="reset"]')?.addEventListener("click", (e) => {
				e.stopPropagation();
				if (!confirm("Reset all S-1 mappings to defaults?")) return;
				window.s1Midi?.resetMaps();
				this.rebuild();
			});
			panel.querySelector('[data-ref="clock"]')?.addEventListener("click", (e) => {
				e.stopPropagation();
				if (typeof midiClockOsc !== "undefined") midiClockOsc.toggleOverlay();
			});
		}

		_armNoteLearn() {
			const s1 = window.s1Midi;
			if (!s1?.startNoteLearn) return;
			this._noteLearnMode = true;
			this.learnNoteBtn?.classList.add("is-armed");
			if (this.learnNoteBtn) this.learnNoteBtn.textContent = "Listening…";
			if (this.activityEl) this.activityEl.textContent = "Press an S-1 key…";
			s1.startNoteLearn((note) => {
				this._noteLearnMode = false;
				this.learnNoteBtn?.classList.remove("is-armed");
				if (this.learnNoteBtn) this.learnNoteBtn.textContent = "Learn note";
				if (note == null) {
					if (this.activityEl) this.activityEl.textContent = "Turn a knob to highlight";
					return;
				}
				this.rebuildNotes();
				const row = this._noteRows.get(note);
				row?.root?.scrollIntoView?.({block: "nearest", behavior: "smooth"});
				if (this.activityEl) {
					this.activityEl.textContent = `Bound ${s1.noteLabel?.(note) || note} — pick effect`;
				}
			});
		}

		_cancelNoteLearn() {
			if (!this._noteLearnMode) return;
			this._noteLearnMode = false;
			window.s1Midi?.cancelNoteLearn?.();
			this.learnNoteBtn?.classList.remove("is-armed");
			if (this.learnNoteBtn) this.learnNoteBtn.textContent = "Learn note";
		}

		_refreshStatus() {
			const s1 = window.s1Midi;
			if (!s1) return;
			const info = s1.getDeviceInfo?.() || {};
			const connected = !!info.name;
			this.statusDot?.classList.toggle("is-ok", connected);
			this.statusDot?.classList.toggle("is-warn", !connected);
			if (this.deviceEl) {
				this.deviceEl.textContent = connected
					? `${info.name} · MIDI ch ${info.channel}`
					: `No S-1 yet · listening on ch ${info.channel || 3}`;
			}
			const st = s1.mappingStatus?.() || {mapped: 0, custom: 0, total: 0};
			if (this.countsEl) {
				this.countsEl.textContent =
					st.custom > 0
						? `${st.mapped}/${st.total} mapped · ${st.custom} custom`
						: `${st.mapped}/${st.total} mapped`;
			}
		}

		rebuild() {
			if (!this.listEl) return;
			this._rows.clear();
			this.listEl.innerHTML = "";
			this._refreshStatus();

			const s1 = window.s1Midi;
			if (!s1) {
				const empty = document.createElement("div");
				empty.className = "shader-effects-panel__empty";
				empty.textContent = "s1Midi not loaded";
				this.listEl.appendChild(empty);
				this.rebuildNotes();
				return;
			}

			const targets = s1.listShaderTargets();
			const byEffect = new Map();
			for (const t of targets) {
				if (!byEffect.has(t.effect)) byEffect.set(t.effect, []);
				byEffect.get(t.effect).push(t);
			}

			let lastSection = null;
			let sectionBody = null;

			for (const ctrl of s1.S1_CONTROLS) {
				if (ctrl.section !== lastSection) {
					lastSection = ctrl.section;
					const section = document.createElement("details");
					section.className = "midi-panel__section";
					section.open = !this._collapsed.has(ctrl.section);
					section.addEventListener("toggle", () => {
						if (section.open) this._collapsed.delete(ctrl.section);
						else this._collapsed.add(ctrl.section);
					});

					const summary = document.createElement("summary");
					summary.className = "midi-panel__section-title";
					summary.textContent = ctrl.section;
					section.appendChild(summary);

					sectionBody = document.createElement("div");
					sectionBody.className = "midi-panel__section-body";
					section.appendChild(sectionBody);
					this.listEl.appendChild(section);
				}
				sectionBody.appendChild(this._createRow(ctrl, byEffect, s1));
			}

			this._applyFilter();
			this.rebuildNotes();
		}

		rebuildNotes() {
			if (!this.notesEl) return;
			this._noteRows.clear();
			this.notesEl.innerHTML = "";

			const s1 = window.s1Midi;
			if (!s1?.listNoteMaps) return;

			const effects = s1.listEffectNames?.() || [];
			const maps = s1.listNoteMaps();

			if (!maps.length) {
				const empty = document.createElement("div");
				empty.className = "midi-panel__notes-empty";
				empty.textContent = "No note bindings — Learn note, then pick an effect";
				this.notesEl.appendChild(empty);
				return;
			}

			for (const entry of maps) {
				this.notesEl.appendChild(this._createNoteRow(entry, effects, s1));
			}
		}

		_createNoteRow(entry, effects, s1) {
			const root = document.createElement("div");
			root.className = "midi-panel__note-row";
			root.dataset.note = String(entry.note);

			const label = document.createElement("span");
			label.className = "midi-panel__note-label";
			label.textContent = entry.label || s1.noteLabel?.(entry.note) || String(entry.note);

			const modeSelect = document.createElement("select");
			modeSelect.className = "midi-panel__select midi-panel__mode";
			modeSelect.title = "Hold = momentary · Latch = toggle";
			for (const [value, text] of [
				["hold", "Hold"],
				["latch", "Latch"],
			]) {
				const opt = document.createElement("option");
				opt.value = value;
				opt.textContent = text;
				modeSelect.appendChild(opt);
			}
			modeSelect.value = entry.mode === "latch" ? "latch" : "hold";

			const effectSelect = document.createElement("select");
			effectSelect.className = "midi-panel__select";
			effectSelect.title = "Shader effect toggled by this key";

			const pick = document.createElement("option");
			pick.value = "";
			pick.textContent = "— pick effect —";
			effectSelect.appendChild(pick);

			for (const name of effects) {
				const opt = document.createElement("option");
				opt.value = name;
				opt.textContent = name;
				effectSelect.appendChild(opt);
			}
			if (entry.effect && ![...effectSelect.options].some((o) => o.value === entry.effect)) {
				const opt = document.createElement("option");
				opt.value = entry.effect;
				opt.textContent = entry.effect;
				effectSelect.appendChild(opt);
			}
			effectSelect.value = entry.effect || "";

			effectSelect.addEventListener("change", () => {
				const mode = modeSelect.value === "latch" ? "latch" : "hold";
				if (!effectSelect.value) {
					s1.clearNoteMap(entry.note);
				} else {
					s1.setNoteMap(entry.note, effectSelect.value, mode);
				}
				this.rebuildNotes();
			});
			effectSelect.addEventListener("keydown", (e) => e.stopPropagation());

			modeSelect.addEventListener("change", () => {
				const effect = effectSelect.value || entry.effect;
				if (!effect) return;
				s1.setNoteMap(entry.note, effect, modeSelect.value === "latch" ? "latch" : "hold");
				this.rebuildNotes();
			});
			modeSelect.addEventListener("keydown", (e) => e.stopPropagation());

			const modeBadge = document.createElement("span");
			modeBadge.className = `midi-panel__badge midi-panel__badge--mode${entry.mode === "latch" ? " is-latch" : ""}`;
			modeBadge.textContent = entry.mode === "latch" ? "Latch" : "Hold";

			const clearBtn = document.createElement("button");
			clearBtn.type = "button";
			clearBtn.className = "midi-panel__clear";
			clearBtn.title = "Clear note binding";
			clearBtn.textContent = "×";
			clearBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				s1.clearNoteMap(entry.note);
				this.rebuildNotes();
			});

			root.appendChild(label);
			root.appendChild(effectSelect);
			root.appendChild(modeSelect);
			root.appendChild(modeBadge);
			root.appendChild(clearBtn);

			this._noteRows.set(entry.note, {root, effectSelect, modeSelect});
			return root;
		}

		_createRow(ctrl, byEffect, s1) {
			const root = document.createElement("div");
			root.className = "midi-panel__row";
			root.dataset.cc = String(ctrl.cc);
			root.dataset.search = `${ctrl.label} ${ctrl.section} cc${ctrl.cc}`.toLowerCase();

			const head = document.createElement("div");
			head.className = "midi-panel__row-head";

			const knob = document.createElement("div");
			knob.className = "midi-panel__knob";

			const nameEl = document.createElement("span");
			nameEl.className = "midi-panel__knob-name";
			nameEl.textContent = ctrl.label;

			const ccEl = document.createElement("span");
			ccEl.className = "midi-panel__cc";
			ccEl.textContent = `CC ${ctrl.cc}`;

			knob.appendChild(nameEl);
			knob.appendChild(ccEl);

			const arrow = document.createElement("span");
			arrow.className = "midi-panel__arrow";
			arrow.setAttribute("aria-hidden", "true");
			arrow.textContent = "→";

			const badge = document.createElement("span");
			badge.className = "midi-panel__badge";
			badge.hidden = true;

			head.appendChild(knob);
			head.appendChild(arrow);
			head.appendChild(badge);

			const meterTrack = document.createElement("div");
			meterTrack.className = "midi-panel__meter-track";
			const meterFill = document.createElement("div");
			meterFill.className = "midi-panel__meter-fill";
			meterTrack.appendChild(meterFill);

			const bindRow = document.createElement("div");
			bindRow.className = "midi-panel__bind";

			const select = document.createElement("select");
			select.className = "midi-panel__select";
			select.title = "Shader parameter driven by this S-1 knob";

			const none = document.createElement("option");
			none.value = "";
			none.textContent = "— not mapped —";
			select.appendChild(none);

			for (const [effect, list] of byEffect) {
				const group = document.createElement("optgroup");
				group.label = effect;
				for (const t of list) {
					const opt = document.createElement("option");
					opt.value = t.value;
					opt.textContent = `${t.effect} · ${t.param}`;
					group.appendChild(opt);
				}
				select.appendChild(group);
			}

			const map = s1.getMap(ctrl.cc);
			const isDefault = s1.isDefaultMap?.(ctrl.cc);
			if (map?.effect && map?.param) {
				const v = `${map.effect}.${map.param}`;
				if (![...select.options].some((o) => o.value === v)) {
					const opt = document.createElement("option");
					opt.value = v;
					opt.textContent = `${map.effect} · ${map.param}`;
					select.appendChild(opt);
				}
				select.value = v;
				root.dataset.search += ` ${map.effect} ${map.param}`;
				badge.hidden = false;
				badge.textContent = isDefault ? "default" : "custom";
				badge.classList.toggle("is-custom", !isDefault);
				root.classList.toggle("is-mapped", true);
				root.classList.toggle("is-custom", !isDefault);
			} else {
				select.value = "";
				root.classList.add("is-unmapped");
			}

			select.addEventListener("change", () => {
				if (!select.value) {
					s1.clearMap(ctrl.cc);
				} else {
					const dot = select.value.indexOf(".");
					const effect = select.value.slice(0, dot);
					const param = select.value.slice(dot + 1);
					s1.setMap(ctrl.cc, effect, param);
				}
				this.rebuild();
			});
			select.addEventListener("keydown", (e) => e.stopPropagation());

			const clearBtn = document.createElement("button");
			clearBtn.type = "button";
			clearBtn.className = "midi-panel__clear";
			clearBtn.title = "Clear mapping";
			clearBtn.textContent = "×";
			clearBtn.disabled = !map;
			clearBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				s1.clearMap(ctrl.cc);
				this.rebuild();
			});

			bindRow.appendChild(select);
			bindRow.appendChild(clearBtn);

			const rangeRow = document.createElement("div");
			rangeRow.className = "midi-panel__range";
			rangeRow.hidden = !map;

			const minLabel = document.createElement("label");
			minLabel.className = "midi-panel__range-label";
			minLabel.textContent = "min";
			const minInput = document.createElement("input");
			minInput.type = "number";
			minInput.className = "midi-panel__range-input";
			minInput.step = map?.integer ? "1" : "any";
			minInput.value = map ? String(map.outMin) : "";
			minInput.title = "Uniform value at CC 0";
			minInput.disabled = !map;

			const maxLabel = document.createElement("label");
			maxLabel.className = "midi-panel__range-label";
			maxLabel.textContent = "max";
			const maxInput = document.createElement("input");
			maxInput.type = "number";
			maxInput.className = "midi-panel__range-input";
			maxInput.step = map?.integer ? "1" : "any";
			maxInput.value = map ? String(map.outMax) : "";
			maxInput.title = "Uniform value at CC 127";
			maxInput.disabled = !map;

			const commitRange = () => {
				if (!s1.getMap(ctrl.cc)) return;
				let min = Number.parseFloat(minInput.value);
				let max = Number.parseFloat(maxInput.value);
				if (!Number.isFinite(min) || !Number.isFinite(max)) {
					const cur = s1.getMap(ctrl.cc);
					minInput.value = String(cur.outMin);
					maxInput.value = String(cur.outMax);
					return;
				}
				s1.setMapRange(ctrl.cc, min, max);
				const updated = s1.getMap(ctrl.cc);
				const defNow = s1.isDefaultMap?.(ctrl.cc);
				badge.hidden = false;
				badge.textContent = defNow ? "default" : "custom";
				badge.classList.toggle("is-custom", !defNow);
				root.classList.toggle("is-custom", !defNow);
				this._refreshStatus();
				if (updated?.integer) {
					minInput.value = String(Math.round(updated.outMin));
					maxInput.value = String(Math.round(updated.outMax));
				}
			};

			for (const input of [minInput, maxInput]) {
				input.addEventListener("keydown", (e) => {
					e.stopPropagation();
					if (e.key === "Enter") {
						commitRange();
						input.blur();
					}
					if (e.key === "Escape") {
						const cur = s1.getMap(ctrl.cc);
						if (cur) {
							minInput.value = String(cur.outMin);
							maxInput.value = String(cur.outMax);
						}
						input.blur();
					}
				});
				input.addEventListener("change", commitRange);
				input.addEventListener("blur", commitRange);
			}

			minLabel.appendChild(minInput);
			maxLabel.appendChild(maxInput);
			rangeRow.appendChild(minLabel);
			rangeRow.appendChild(maxLabel);

			root.appendChild(head);
			root.appendChild(meterTrack);
			root.appendChild(bindRow);
			root.appendChild(rangeRow);

			this._rows.set(ctrl.cc, {root, select, meterFill, badge, clearBtn, minInput, maxInput});
			return root;
		}

		_applyFilter() {
			const q = this._filter;
			for (const section of this.listEl?.querySelectorAll(".midi-panel__section") || []) {
				let any = false;
				for (const row of section.querySelectorAll(".midi-panel__row")) {
					const show = !q || (row.dataset.search || "").includes(q);
					row.hidden = !show;
					if (show) any = true;
				}
				section.hidden = !any;
				if (any && q) section.open = true;
			}
		}

		_onActivity() {
			if (!this.visible) return;
			this._refreshStatus();

			const s1 = window.s1Midi;
			const noteAct = s1?.getLastNoteActivity?.();
			const act = s1?.getLastActivity?.();

			const noteNewer = noteAct?.at && (!act?.at || noteAct.at >= act.at);
			if (noteNewer && noteAct?.note != null && noteAct.at !== this._lastNoteFlashAt) {
				this._lastNoteFlashAt = noteAct.at;
				const map = s1.getNoteMap?.(noteAct.note);
				const label = s1.noteLabel?.(noteAct.note) || `N${noteAct.note}`;
				const enabled = map?.effect ? !!shaderEffects?.effectsConfig?.[map.effect]?.enabled : null;
				if (this.activityEl && map?.effect) {
					this.activityEl.textContent = `${label} → ${map.effect} ${enabled ? "ON" : "OFF"}`;
				} else if (this.activityEl && noteAct.on) {
					this.activityEl.textContent = `${label} (unmapped)`;
				}

				const noteRow = this._noteRows.get(noteAct.note);
				if (noteRow) {
					noteRow.root.classList.add("is-active");
					clearTimeout(noteRow._flash);
					noteRow._flash = setTimeout(() => noteRow.root.classList.remove("is-active"), 280);
				}
				return;
			}

			if (!act?.cc) return;
			const row = this._rows.get(act.cc);
			const ctrl = s1?.S1_CONTROLS?.find((c) => c.cc === act.cc);
			const map = s1?.getMap?.(act.cc);

			const pct = Math.round((act.value7 / 127) * 100);
			if (this.activityEl && !this._noteLearnMode) {
				const target = map ? `${map.effect}.${map.param}` : "unmapped";
				this.activityEl.textContent = `${ctrl?.label || `CC${act.cc}`} → ${target} · ${pct}%`;
			}

			if (!row) return;

			row.meterFill.style.width = `${pct}%`;
			row.root.classList.add("is-active");
			clearTimeout(row._flash);
			row._flash = setTimeout(() => row.root.classList.remove("is-active"), 280);

			if (this._findMode) {
				this._findMode = false;
				this.findBtn?.classList.remove("is-armed");
				if (this.findBtn) this.findBtn.textContent = "Find knob";
				row.root.scrollIntoView({block: "nearest", behavior: "smooth"});
				const section = row.root.closest("details");
				if (section) section.open = true;
			}
		}

		update() {}
	}

	const midiPanel = new MidiPanel();
	window.midiPanel = midiPanel;

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => midiPanel.init());
	} else {
		midiPanel.init();
	}
})();
