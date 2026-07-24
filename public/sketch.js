// sketch.js — generative artwork entry point
//
// SECTIONS (search by number or name)
//   1. Configuration      — tunable constants and runtime config
//   2. State              — module-level variables
//   3. Color utilities    — palette conversion helpers
//   4. Canvas & layout    — sizing, pixel density, canvas creation
//   5. Particles          — mover initialization
//   6. Audio & MIDI       — reactive shader uniforms and knob smoothing
//   7. UI controls        — FPS toggle and mobile controls
//   8. Rendering          — per-frame artwork and display output
//   9. p5 lifecycle       — preload, setup, draw, keyPressed
//

// ============================================================================
// 1. CONFIGURATION
// ============================================================================

const CANVAS_CONFIG = {
	BASE_WIDTH: 1000,
	ARTWORK_RATIO: 1.0,
	ARTWORK_PADDING: 0.1,
	WRAP_PADDING_FACTOR: 0.05,
	SCALE_FACTOR_X: 1.0,
	SCALE_FACTOR_Y: 1.0,
	FORCE_SIZE: true,
	FIXED_WIDTH: 966,
	FIXED_HEIGHT: 96,
};

// localStorage: keep shader effects panel edits (effect params + output framing) across refresh
const PERSIST_SHADER_PANEL = true;

const DEBUG_CONFIG = {
	DEFAULT_PIXEL_DENSITY_DESKTOP: 1,
	DEFAULT_PIXEL_DENSITY_MOBILE: 1,
	HELP_TEXT: "Controls: 0–9 scenes · S scene label · D debug · E shaders · L loop · C controls · G symmetry debug · M MIDI clock",
};

const MIDI_CLOCK_CONFIG = {
	ENABLED: true,
	WS_URL: "ws://localhost:3302",
	SHOW_OVERLAY: true,
};

const config = {
	animation: {
		maxFrames: null,
		useFrameMode: true,
	},
};

// ============================================================================
// 2. STATE
// ============================================================================

// Lifecycle
let executionTimer = new ExecutionTimer();
let sketchFrame = 0;
let hasDisplayedFirstFrame = false;

// Particles
let movers = [];
let baseHSLPalette = [];

// Canvas
let mainCanvas = null;
let shaderCanvas = null;
let pixel_density = 1;

// Layout (derived from canvas dimensions at setup)
let ARTWORK_RATIO = 1.0;
let DIM = 0;
let MULTIPLIER = 1;

// ============================================================================
// 3. COLOR UTILITIES
// ============================================================================

function hexToHsl(hex) {
	const r = parseInt(hex.slice(1, 3), 16) / 255;
	const g = parseInt(hex.slice(3, 5), 16) / 255;
	const b = parseInt(hex.slice(5, 7), 16) / 255;
	const max = Math.max(r, g, b),
		min = Math.min(r, g, b);
	let h,
		s,
		l = (max + min) / 2;
	if (max === min) {
		h = s = 0;
	} else {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r:
				h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
				break;
			case g:
				h = ((b - r) / d + 2) / 6;
				break;
			case b:
				h = ((r - g) / d + 4) / 6;
				break;
		}
	}
	return {h: h * 360, s: s * 100, l: l * 100};
}

// ============================================================================
// 4. CANVAS & LAYOUT
// ============================================================================

function getPixelDensity() {
	return typeof isSafariMobile === "function" && isSafariMobile() ? DEBUG_CONFIG.DEFAULT_PIXEL_DENSITY_MOBILE : DEBUG_CONFIG.DEFAULT_PIXEL_DENSITY_DESKTOP;
}

function getCanvasDimensions() {
	if (CANVAS_CONFIG.FORCE_SIZE) {
		return {
			width: CANVAS_CONFIG.FIXED_WIDTH,
			height: CANVAS_CONFIG.FIXED_HEIGHT,
		};
	}

	const ratio = CANVAS_CONFIG.ARTWORK_RATIO;
	const viewportDim = min(windowWidth, windowHeight);
	return {
		width: viewportDim / ratio,
		height: viewportDim,
	};
}

function updateLayoutMetrics(canvasW, canvasH) {
	ARTWORK_RATIO = canvasW / canvasH;
	const baseHeight = CANVAS_CONFIG.BASE_WIDTH * ARTWORK_RATIO;
	const defaultSize = min(CANVAS_CONFIG.BASE_WIDTH, baseHeight);
	DIM = min(canvasW, canvasH);
	MULTIPLIER = DIM / defaultSize;
	console.log(MULTIPLIER);
}

function createArtworkCanvas(canvasW, canvasH) {
	mainCanvas = createGraphics(canvasW, canvasH);
	mainCanvas.pixelDensity(pixel_density);
}

function initDisplayCanvas(canvasW, canvasH) {
	if (typeof shaderEffects === "undefined") {
		createCanvas(canvasW, canvasH);
		pixelDensity(pixel_density);
		return null;
	}

	try {
		const displayCanvas = createCanvas(canvasW, canvasH, WEBGL);
		displayCanvas.pixelDensity(pixel_density);

		let restoredPanel = null;
		if (PERSIST_SHADER_PANEL && typeof shaderEffects.loadPersistedPanelConfig === "function") {
			restoredPanel = shaderEffects.loadPersistedPanelConfig();
			if (restoredPanel) console.log("[sketch] restored shader panel config from localStorage");
		}

		// Render ratio is configured in shaderManager (constructor or setRenderRatio).
		// To override from the sketch, set CANVAS_CONFIG.SHADER_RENDER before setup runs.
		// Skipped when a persisted panel config already restored its own render ratio.
		if (!restoredPanel && CANVAS_CONFIG.SHADER_RENDER) {
			shaderManager.setRenderRatio(CANVAS_CONFIG.SHADER_RENDER);
		}
		shaderEffects.setup(width, height, mainCanvas, displayCanvas, pixel_density);
		console.log("Shader effects initialized successfully");
		return displayCanvas;
	} catch (error) {
		console.warn("Failed to initialize shader effects:", error);
		console.log("Falling back to sketch without shaders");
		createCanvas(canvasW, canvasH);
		pixelDensity(pixel_density);
		return null;
	}
}

function configureArtworkCanvas() {
	mainCanvas.colorMode(HSB, 360, 100, 100, 100);
	colorMode(HSB, 360, 100, 100, 100);
	mainCanvas.drawingContext.imageSmoothingEnabled = false;
	mainCanvas.drawingContext.globalCompositeOperation = "source-over";

	mainCanvas.translate(width / 2, height / 2);
	mainCanvas.scale(CANVAS_CONFIG.SCALE_FACTOR_X, CANVAS_CONFIG.SCALE_FACTOR_Y);
	mainCanvas.translate(-width / 2, -height / 2);
}

function logStartupInfo() {
	console.log(DEBUG_CONFIG.HELP_TEXT);
	if (typeof shaderEffects !== "undefined" && shaderCanvas) {
		console.log(`Shader pipeline: every ${shaderEffects.getShaderApplyInterval()} frame(s) during sketch (setShaderApplyInterval to tune)`);
	} else {
		console.log("Running without shader effects");
	}
}

// ============================================================================
// 5. PARTICLES
// ============================================================================

function initializeParticles() {
	movers = [];

	const hexPalette = getPalette("hex_palette");
	baseHSLPalette = hexPalette.map(hexToHsl);

	const cx = mainCanvas.width / 2;
	const cy = mainCanvas.height / 2;
	const rectSize = min(mainCanvas.width, mainCanvas.height) * 0.425;

	movers.push(new Mover(cx, cy, rectSize, baseHSLPalette));
}

// ============================================================================
// 6. AUDIO & MIDI
// ============================================================================

function setupAudioReactive() {
	if (typeof audioKnob === "undefined") return;

	audioKnob
		.setSource("microphone") // or 'chime'
		// energy is already volume^1.4 — keep stepFrom moderate or the param stays pegged at outMin
		.map("energy", "zoom", "zoomOutAmount", 1.0, 5.4, 0, 1, 1.4, 0.35)
		.map("bass", "pixelSort", "sortAmount", 0, 28, 0, 1, 2.2, 0.65)
		// higher energy → lower threshold (more pixels sorted)
		.map("energy", "pixelSort", "threshold", 0.55, 0.1, 0, 1, 1.2, 0.35);

	if (typeof debugPanel !== "undefined") {
		debugPanel.init({
			audio: typeof audioAnalyzer !== "undefined" ? audioAnalyzer : null,
			shaders: typeof shaderEffects !== "undefined" ? shaderEffects : null,
		});
	}

	if (typeof shaderEffectsPanel !== "undefined" && typeof shaderEffects !== "undefined") {
		shaderEffectsPanel.init(shaderEffects);
	}
}

function setupMidiKnobs() {
	if (typeof shaderEffects === "undefined") return;

	const initAngle = shaderEffects.effectsConfig.symmetry.rotationStartingAngle;
	addKnobSmooth(32, "symmetry", "rotationStartingAngle", initAngle, 0.08);
}

function setupMidiClockOsc() {
	if (!MIDI_CLOCK_CONFIG.ENABLED || typeof midiClockOsc === "undefined") return;
	midiClockOsc.connect(MIDI_CLOCK_CONFIG.WS_URL);
	midiClockOsc.setOverlayVisible(MIDI_CLOCK_CONFIG.SHOW_OVERLAY);
}

// ============================================================================
// 7. UI CONTROLS
// ============================================================================

function toggleLoopCountdown() {
	if (typeof shaderEffects === "undefined") return;
	shaderEffects.toggleLoopCountdown();
	if (typeof debugPanel !== "undefined" && shaderEffects.loopConfig?.showCountdown) {
		debugPanel.show();
	}
}

// ============================================================================
// 8. RENDERING
// ============================================================================

function updateParticles(maxFrames) {
	if (maxFrames != null && sketchFrame >= maxFrames) return;

	for (let i = 0; i < movers.length; i++) {
		movers[i].show(mainCanvas);
		movers[i].move(sketchFrame, maxFrames);
	}
	sketchFrame++;
}

function onAnimationComplete(maxFrames) {
	if (maxFrames == null || sketchFrame < maxFrames) return;

	executionTimer.stop().logElapsedTime("Sketch completed in");
	if (typeof shaderEffects !== "undefined" && shaderCanvas) {
		shaderEffects.setParticleAnimationComplete(true);
	}
	document.complete = true;
	if (typeof createDownloadButton === "function") {
		createDownloadButton();
	}
}

function renderOutput(isSketchComplete) {
	if (typeof shaderEffects !== "undefined" && shaderCanvas) {
		const shouldContinue = shaderEffects.renderFrame(isSketchComplete, null);
		if (!shouldContinue) noLoop();
		return;
	}

	clear();
	image(mainCanvas, 0, 0);

	if (typeof shaderEffects !== "undefined") {
		shaderEffects.updateFPS();
		shaderEffects.drawFPS();
	}

	if (isSketchComplete) noLoop();
}

function notifyFirstFrameReady() {
	if (hasDisplayedFirstFrame) return;
	hasDisplayedFirstFrame = true;
	window.liveReloadTransition?.onSketchReady?.();
}

// ============================================================================
// 9. P5 LIFECYCLE
// ============================================================================

// p5.js 2.x removed preload() — load assets with async/await in setup instead.
async function setup() {
	executionTimer.start();
	if (typeof fxrand?.reset === "function") fxrand.reset();

	// Global mode exposes p5 APIs on window; pass that as the instance for shaders.
	if (typeof shaderEffects !== "undefined") {
		await shaderEffects.preload(window);
	}

	pixel_density = getPixelDensity();
	const {width: canvasW, height: canvasH} = getCanvasDimensions();
	updateLayoutMetrics(canvasW, canvasH);

	createArtworkCanvas(canvasW, canvasH);
	shaderCanvas = initDisplayCanvas(canvasW, canvasH);
	configureArtworkCanvas();

	randomSeed(fxrand() * 10000);
	noiseSeed(fxrand() * 10000);

	initializeParticles();
	setupAudioReactive();
	setupMidiKnobs();
	setupMidiClockOsc();

	if (typeof sceneManager !== "undefined" && typeof SCENES !== "undefined") {
		sceneManager.init(SCENES, typeof SCENE_CONTROLS !== "undefined" ? SCENE_CONTROLS : {});
	}

	if (typeof createDownloadButton === "function") {
		createDownloadButton();
	}
	logStartupInfo();
}

function draw() {
	const captureRemote = typeof sceneManager !== "undefined" && sceneManager.isShaderCaptureActive();

	if (captureRemote) {
		const ok = sceneManager.captureInto(mainCanvas);
		if (!ok) {
			mainCanvas.background(190, 100, 0, 100);
		}
	} else {
		mainCanvas.background(330, 100, 0, 100);
	}

	if (typeof audioKnob !== "undefined") audioKnob.update();
	if (typeof debugPanel !== "undefined") debugPanel.update();
	if (typeof shaderEffectsPanel !== "undefined") shaderEffectsPanel.update();
	updateKnobSmoothing();
	if (typeof midiClockOsc !== "undefined") midiClockOsc.update();

	const maxFrames = config.animation.maxFrames;
	if (!captureRemote) {
		updateParticles(maxFrames);
		onAnimationComplete(maxFrames);
	}

	const isSketchComplete = maxFrames != null && sketchFrame >= maxFrames;
	renderOutput(isSketchComplete);
	notifyFirstFrameReady();
}

function keyPressed() {
	const tag = document.activeElement?.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable) {
		return;
	}

	if (typeof sceneManager !== "undefined" && sceneManager.handleKey(key)) {
		return;
	}

	if (key === "S" || key === "s") {
		if (typeof sceneManager !== "undefined") sceneManager.toggleLabel();
	}

	if (key === "D" || key === "d") {
		if (typeof debugPanel !== "undefined") debugPanel.toggle();
	}

	if (key === "E" || key === "e") {
		if (typeof shaderEffectsPanel !== "undefined") shaderEffectsPanel.toggle();
	}

	if (key === "L" || key === "l") {
		toggleLoopCountdown();
	}

	if (key === "M" || key === "m") {
		if (typeof midiClockOsc !== "undefined") midiClockOsc.toggleOverlay();
	}

	if (key === "G" || key === "g") {
		if (typeof shaderEffects !== "undefined") {
			const currentDebug = shaderEffects.effectsConfig.symmetry.debug;
			const newDebug = currentDebug > 0.5 ? 0.0 : 1.0;
			shaderEffects.updateEffectParam("symmetry", "debug", newDebug);
			console.log("Symmetry debug toggled: ", newDebug > 0.5);
		}
	}

	if (key === "C" || key === "c") {
		document.getElementById("controls")?.classList.toggle("hide");
	}
}
