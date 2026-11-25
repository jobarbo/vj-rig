/**
 * VJ Rig shader effects — the library's ShaderEffects plus what's specific to this rig.
 *
 * The effect engine, the shader catalog and the panel live in the library:
 *   library/shaders/catalog.js     every effect + its default config (SHADER_CATALOG)
 *   library/utils/shaderEffects.js ShaderEffects (stack, uniforms, persistence, clock, loop)
 * Adding/changing a shader happens there; this file only picks the rig's default
 * stack and values, and adds the rig-only bits:
 *   - "scene" pseudo-effect in updateEffectParam → window.sceneParams
 *   - resize() follows through updateLayoutMetrics() (the rig's only resize seam)
 *   - FPS is displayed by debugPanel, not by the standalone overlay
 *   - crisp-pixel toggle also drives the artwork canvas smoothing
 *
 * Load order (index.html): library/utils/shaderManager.js, shaderPipeline.js,
 * library/shaders/catalog.js, library/utils/shaderEffects.js, then this file.
 */

/**
 * Startup stack — order = pass order. Disabled entries stay in the stack so MIDI
 * note toggles and CC maps (midi/s1Midi.js) have a target without opening the panel.
 * `[name, enabled, overrides?]` — overrides apply on top of the catalog template
 * (+ VJ_SHADER_OVERRIDES). A numbered name ("symmetry2") is a second instance of
 * the catalog entry without the digits, sharing its GL program.
 */
const VJ_SHADER_STACK = [
	["deform", false],
	["collage", false],
	["symmetry", true],
	[
		"symmetry2",
		true,
		{
			symmetryMode: 5.0,
			translationSpeedX: 1.5,
			translationSpeedY: 1.5,
			translationNoiseScale: 0.2,
			rotationSpeed: 0.0,
			rotationOscillationSpeed: 0.1,
			rotationNoiseScale: 0.01,
			timeMultiplier: 0.1,
		},
	],
	["wave", true],
	["pixelGrid", true],
	["pixelSort", false],
	["asdfSort", false],
	["loaderGlitch", false],
	["colorQuantize", false],
	["colorTint", false],
	["pixelShift", false],
	["pixelRing", false],
	["dither", false],
	["zoom", false],
	["chromatic", false],
	["crtDisplay", false],
	["glitchDisplacement", false],
	["blur", false],
	["crtWarp", false],
	["grain", false],
];

/**
 * Rig values that differ from the catalog. Applied to the templates too, so an
 * effect added from the panel's menu starts with the rig's look.
 */
const VJ_SHADER_OVERRIDES = {
	symmetry: {
		symmetryMode: 3.0,
		translationSpeedX: 0.5,
		translationSpeedY: 0.5,
		translationPhaseX: -0.5,
		translationPhaseY: 0.5,
		rotationSpeed: 0.81,
		timeMultiplier: 0.5,
	},
	pixelGrid: {gridSize: [240.0, 24.0], diffuse: 0.0},
	pixelSort: {threshold: 0.3, sortAmount: 2.8, invert: 1.0, timeMultiplier: 0.3},
	colorQuantize: {levels: 2.0, mix: 0.0},
	pixelRing: {ringRadius: 1.05}, // ≈ covers 16:9 corners
	dither: {levels: 2.0, colorMode: 0.0},
	zoom: {zoomAmount: 0.0, animateZoom: 1.0, outOfBoundsMode: 2.0},
	chromatic: {amount: 0.0015, timeMultiplier: 2.0},
	crtDisplay: {cellSize: 3.0, gapOpacity: 0.2, rgbOpacity: 0.5, filterMode: 1.0},
	glitchDisplacement: {timeMultiplier: 0.1, intensity: 100.6, lineDensity: 100.0},
	crtWarp: {vignette: 0.0},
};

class VjShaderEffects extends ShaderEffects {
	constructor() {
		super({
			defaultStack: [], // built below: the rig's stack keeps disabled entries and a symmetry2 instance
			overrides: VJ_SHADER_OVERRIDES,
			storageKey: "shaderEffectsPanelConfig", // pre-library key — keeps saved panel edits
			renderRatio: {fitCanvas: false, width: 1, height: 1},
			crispPixels: true,
			continueAfterCompletion: false,
			applyDuringSketch: true,
			// sketch.js: the rig's resize seam (fitDisplayToViewport assumes a main.main layout)
			onResize: (w, h) => {
				if (typeof updateLayoutMetrics === "function") updateLayoutMetrics(w, h);
			},
		});

		this.effectsConfig = {};
		for (const [name, enabled, overrides] of VJ_SHADER_STACK) {
			const root = String(name).replace(/\d+$/, "") || name;
			const template = this.effectTemplates[root];
			if (!template) {
				console.warn(`[VjShaderEffects] "${name}" is not in SHADER_CATALOG — skipped`);
				continue;
			}
			const cfg = JSON.parse(JSON.stringify(template));
			if (overrides) Object.assign(cfg, JSON.parse(JSON.stringify(overrides)));
			cfg.enabled = enabled;
			cfg.pass = root;
			this.effectsConfig[name] = cfg;
			this._ensurePhaseTracking(name);
		}
		this.defaultEffectsConfig = JSON.parse(JSON.stringify(this.effectsConfig));
	}

	setup(width, height, mainCanvas, shaderCanvas, pixelDensity = 1) {
		if (!this.shaderManager || !this.p5Instance) {
			throw new Error("shaderEffects.preload() must be awaited before setup()");
		}
		super.setup(width, height, mainCanvas, shaderCanvas, pixelDensity);

		// debugPanel shows FPS; with the standalone overlay off, _markFrameForFps()
		// also skips its gl.finish() stall.
		if (typeof debugPanel !== "undefined") this.showFPS = false;
		return this;
	}

	/**
	 * "scene" is a reserved pseudo-effect: audio/MIDI/panel writes go to the active
	 * scene's params. They can't live in effectsConfig — importPanelConfig() replaces
	 * it wholesale and drops unknown keys, and loadPersistedPanelConfig() runs at boot.
	 */
	updateEffectParam(effectName, paramName, value) {
		if (effectName === "scene") {
			window.sceneParams?.set(paramName, value);
			return this;
		}
		return super.updateEffectParam(effectName, paramName, value);
	}

	setRenderRatio(options = {}) {
		// Guard against a 0 ratio typed in the panel (division by zero in the crop).
		const safe = {...options};
		if (safe.width !== undefined) safe.width = Math.max(Number(safe.width) || 0, 0.0001);
		if (safe.height !== undefined) safe.height = Math.max(Number(safe.height) || 0, 0.0001);
		return super.setRenderRatio(safe);
	}

	setCrispPixels(enabled) {
		super.setCrispPixels(enabled);
		if (this.mainCanvas?.drawingContext) {
			this.mainCanvas.drawingContext.imageSmoothingEnabled = !this.crispPixels;
		}
		return this;
	}

	/** debugPanel owns the FPS readout when it is loaded. */
	drawFPS() {
		if (typeof debugPanel !== "undefined") {
			const el = document.getElementById("shader-fps-overlay");
			if (el) el.style.display = "none";
			return;
		}
		super.drawFPS();
	}
}

// Global instance (sketch.js, panels and MIDI modules all read `shaderEffects`)
const shaderEffects = new VjShaderEffects();
