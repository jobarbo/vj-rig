/**
 * SceneManager — switch between the local p5 sketch and remote iframe scenes.
 *
 * Remote scenes with shaders:true (default) load via /scene-proxy/… (same-origin)
 * so their canvas can be captured into mainCanvas and run through the host shader pipeline.
 *
 * Usage:
 *   sceneManager.init(SCENES, SCENE_CONTROLS);
 *   sceneManager.show(1);
 */
class SceneManager {
	constructor() {
		this.scenes = [];
		this.controls = {midiCcs: [], midiChannel: 0, showLabel: true};
		this.index = 0;
		this.stack = null;
		this.labelEl = null;
		this.iframes = new Map();
		this.localPaused = false;
		this._midiAttached = new WeakSet();
		this._initialized = false;
		this._captureWarned = new Set();
		this._captureOk = new Set();
		this._hostSizeBackup = null;
	}

	/**
	 * @param {Array<{id:string,type:"local"|"iframe",url?:string,label?:string,shaders?:boolean}>} scenes
	 * @param {{midiCcs?:number[],midiChannel?:number,showLabel?:boolean}} [controls]
	 */
	init(scenes, controls = {}) {
		if (this._initialized) {
			console.warn("[sceneManager] already initialized");
			return this;
		}

		this.scenes = Array.isArray(scenes) ? scenes.slice() : [];
		this.controls = {
			midiCcs: controls.midiCcs || [],
			midiChannel: controls.midiChannel ?? 0,
			showLabel: controls.showLabel !== false,
		};

		if (!this.scenes.length) {
			console.warn("[sceneManager] no scenes configured");
			return this;
		}

		this._buildDom();
		this._attachMidi();
		this.show(0, {silent: true});
		this._initialized = true;
		console.log(
			"[sceneManager] ready —",
			this.scenes.map((s, i) => `${i}:${s.label || s.id}`).join(", "),
			"| keys 0–9, MIDI CC",
			this.controls.midiCcs.slice(0, this.scenes.length).join("/"),
		);
		return this;
	}

	current() {
		return this.scenes[this.index] || null;
	}

	/** Remote scene that should feed the host shader pipeline. */
	isShaderCaptureActive() {
		const scene = this.current();
		return !!(scene && scene.type === "iframe" && scene.shaders !== false);
	}

	isRemoteActive() {
		const scene = this.current();
		return !!(scene && scene.type === "iframe");
	}

	/** Map remote URL → same-origin proxy path when shaders need canvas access. */
	_resolveIframeSrc(scene) {
		if (!scene?.url) return "";
		if (scene.shaders === false) return scene.url;

		try {
			const u = new URL(scene.url, window.location.href);
			// Already same-origin (local path under public/)
			if (u.origin === window.location.origin) return u.pathname + u.search + u.hash;
			// Cross-origin → proxy (requires scripts/dev-server.js)
			return `/scene-proxy/${u.host}${u.pathname}${u.search}`;
		} catch (_) {
			return scene.url;
		}
	}

	_buildDom() {
		this.stack = document.createElement("div");
		this.stack.id = "scene-stack";
		this.stack.setAttribute("aria-hidden", "true");
		document.body.appendChild(this.stack);

		for (const scene of this.scenes) {
			if (scene.type !== "iframe" || !scene.url) continue;

			const frame = document.createElement("iframe");
			frame.className = "scene-iframe";
			frame.dataset.sceneId = scene.id;
			frame.title = scene.label || scene.id;
			frame.allow = "autoplay; microphone; camera; midi; fullscreen";
			frame.setAttribute("allowfullscreen", "");
			frame.dataset.src = this._resolveIframeSrc(scene);
			frame.dataset.shaders = scene.shaders === false ? "0" : "1";
			frame.hidden = true;
			frame.addEventListener("error", () => {
				console.warn(`[sceneManager] iframe failed to load: ${scene.url}`);
			});
			this.stack.appendChild(frame);
			this.iframes.set(scene.id, frame);
		}

		this.labelEl = document.createElement("div");
		this.labelEl.id = "scene-label";
		this.labelEl.hidden = !this.controls.showLabel;
		document.body.appendChild(this.labelEl);
	}

	_ensureIframeLoaded(scene) {
		const frame = this.iframes.get(scene.id);
		if (!frame) return null;
		if (!frame.src && frame.dataset.src) {
			frame.src = frame.dataset.src;
			console.log(`[sceneManager] loading ${scene.label || scene.id}: ${frame.src}`);
		}
		return frame;
	}

	_getSourceCanvas() {
		const scene = this.current();
		if (!scene || scene.type !== "iframe") return null;
		const frame = this.iframes.get(scene.id);
		if (!frame) return null;
		try {
			return frame.contentDocument?.querySelector("canvas") || null;
		} catch (_) {
			return null;
		}
	}

	/**
	 * Match host artwork/display size to the remote canvas buffer so capture isn't
	 * stretched into the local FORCE_SIZE aspect (e.g. 966×96).
	 */
	syncHostToSource() {
		const canvas = this._getSourceCanvas();
		if (!canvas || typeof shaderEffects === "undefined" || typeof shaderEffects.resize !== "function") {
			return false;
		}

		const w = canvas.width | 0;
		const h = canvas.height | 0;
		if (w < 16 || h < 16) return false;

		if (!this._hostSizeBackup) {
			this._hostSizeBackup = shaderEffects.getCanvasSize();
		}

		const cur = shaderEffects.getCanvasSize();
		if (Math.round(cur.width) === w && Math.round(cur.height) === h) return true;

		shaderEffects.resize(w, h);
		return true;
	}

	_restoreHostSize() {
		if (!this._hostSizeBackup) return;
		if (typeof shaderEffects !== "undefined" && typeof shaderEffects.resize === "function") {
			shaderEffects.resize(this._hostSizeBackup.width, this._hostSizeBackup.height);
		}
		this._hostSizeBackup = null;
	}

	/**
	 * Copy the active remote scene's canvas into a p5.Graphics (mainCanvas).
	 * Aspect-preserving contain + black letterbox (no stretch / false zoom).
	 * @returns {boolean} true if a frame was captured
	 */
	captureInto(targetGraphics) {
		const scene = this.current();
		if (!scene || scene.type !== "iframe" || scene.shaders === false) return false;

		const frame = this.iframes.get(scene.id);
		if (!frame || !frame.contentWindow) return false;

		let doc;
		try {
			doc = frame.contentDocument;
		} catch (err) {
			this._warnCapture(scene, "cross-origin (use npm start with scene-proxy)");
			return false;
		}
		if (!doc) return false;

		const canvas = doc.querySelector("canvas");
		if (!canvas) return false;

		const ctx = targetGraphics?.drawingContext;
		if (!ctx || typeof ctx.drawImage !== "function") return false;

		this.syncHostToSource();

		try {
			const dw = ctx.canvas.width;
			const dh = ctx.canvas.height;
			const sw = canvas.width;
			const sh = canvas.height;
			if (sw < 1 || sh < 1) return false;

			const scale = Math.min(dw / sw, dh / sh);
			const tw = sw * scale;
			const th = sh * scale;
			const ox = (dw - tw) / 2;
			const oy = (dh - th) / 2;

			ctx.save();
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.fillStyle = "#000";
			ctx.fillRect(0, 0, dw, dh);
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(canvas, 0, 0, sw, sh, ox, oy, tw, th);
			ctx.restore();

			if (!this._captureOk.has(scene.id)) {
				this._captureOk.add(scene.id);
				console.log(`[sceneManager] shader capture OK for ${scene.label || scene.id} (${sw}×${sh} → ${dw}×${dh})`);
			}
			return true;
		} catch (err) {
			this._warnCapture(scene, err.message || "drawImage blocked");
			return false;
		}
	}

	_warnCapture(scene, reason) {
		if (this._captureWarned.has(scene.id)) return;
		this._captureWarned.add(scene.id);
		console.warn(
			`[sceneManager] cannot capture "${scene.label || scene.id}" into shaders (${reason}). ` +
				`Falling back to raw iframe. Run \`npm start\` (dev-server with /scene-proxy).`,
		);
	}

	/**
	 * @param {number} index
	 * @param {{silent?:boolean}} [opts]
	 */
	show(index, opts = {}) {
		if (!this.scenes.length) return this;

		const next = ((index % this.scenes.length) + this.scenes.length) % this.scenes.length;
		const scene = this.scenes[next];
		this.index = next;

		const isLocal = scene.type === "local";
		const useShaders = !isLocal && scene.shaders !== false;

		for (const [id, frame] of this.iframes) {
			const active = !isLocal && id === scene.id;
			if (active) this._ensureIframeLoaded(scene);
			frame.hidden = !active;
			frame.classList.toggle("is-active", active);
			frame.classList.toggle("is-shader-source", active && useShaders);
		}

		document.body.classList.toggle("scene-remote-active", !isLocal);
		document.body.classList.toggle("scene-shader-capture", useShaders);

		// Keep draw loop running when capturing into shaders; pause only for raw iframe view
		if (isLocal || useShaders) {
			this._resumeLocal();
		} else {
			this._pauseLocal();
		}

		if (isLocal) {
			this._restoreHostSize();
		}

		this._updateLabel(scene);

		if (!opts.silent) {
			console.log(`[sceneManager] → ${next}: ${scene.label || scene.id}`);
		}
		return this;
	}

	showById(id) {
		const idx = this.scenes.findIndex((s) => s.id === id);
		if (idx < 0) {
			console.warn(`[sceneManager] unknown scene id: ${id}`);
			return this;
		}
		return this.show(idx);
	}

	next() {
		return this.show(this.index + 1);
	}

	prev() {
		return this.show(this.index - 1);
	}

	handleKey(key) {
		if (key < "0" || key > "9") return false;
		const n = key === "0" ? 0 : parseInt(key, 10) - 1;
		if (n < 0 || n >= this.scenes.length) return false;
		this.show(n);
		return true;
	}

	toggleLabel() {
		this.controls.showLabel = !this.controls.showLabel;
		if (this.labelEl) this.labelEl.hidden = !this.controls.showLabel;
		return this;
	}

	_updateLabel(scene) {
		if (!this.labelEl) return;
		const mode = scene.type === "iframe" && scene.shaders !== false ? " + shaders" : "";
		this.labelEl.textContent = `${this.index + 1}/${this.scenes.length} · ${scene.label || scene.id}${mode}`;
	}

	_pauseLocal() {
		if (this.localPaused) return;
		this.localPaused = true;
		if (typeof noLoop === "function") noLoop();
	}

	_resumeLocal() {
		if (!this.localPaused) return;
		this.localPaused = false;
		if (typeof loop === "function") loop();
	}

	_attachMidi() {
		if (!navigator.requestMIDIAccess) return;

		const onMessage = (event) => {
			const data = event.data;
			if (!data || data.length < 3) return;
			const [status, controller, value] = data;
			if ((status & 0xf0) !== 0xb0) return;
			const channel = status & 0x0f;
			if (channel !== this.controls.midiChannel) return;
			if (value <= 0) return;

			const sceneIndex = this.controls.midiCcs.indexOf(controller);
			if (sceneIndex < 0 || sceneIndex >= this.scenes.length) return;
			this.show(sceneIndex);
		};

		const attach = (input) => {
			if (this._midiAttached.has(input)) return;
			input.addEventListener("midimessage", onMessage);
			this._midiAttached.add(input);
			console.log(`[sceneManager] MIDI listening: "${input.name}"`);
		};

		navigator
			.requestMIDIAccess({sysex: false})
			.then((midi) => {
				for (const input of midi.inputs.values()) attach(input);
				midi.addEventListener("statechange", (e) => {
					if (e.port?.type === "input" && e.port.state === "connected") {
						attach(e.port);
					}
				});
			})
			.catch((err) => {
				console.warn("[sceneManager] MIDI access failed:", err);
			});
	}
}

const sceneManager = new SceneManager();
