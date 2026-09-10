// sketch.js — generative artwork entry point
//
// SECTIONS (search by number or name)
//   1. Configuration      — tunable constants and runtime config
//   2. State              — module-level variables
//   3. Canvas & layout    — sizing, pixel density, canvas creation
//   4. Scenes             — the swappable visual content (see public/scene/)
//   5. Audio & MIDI       — reactive shader uniforms and knob smoothing
//   6. UI controls        — FPS toggle and mobile controls
//   7. Rendering          — per-frame compositing and display output
//   8. p5 lifecycle       — setup, draw, keyPressed
//
// This file is the HOST. It owns the canvases, the shader FX pipeline, audio,
// MIDI and the panels. It draws no content of its own: everything visible
// comes from the active scene, which the compositor blits into mainCanvas.

// ============================================================================
// 1. CONFIGURATION
// ============================================================================

const CANVAS_CONFIG = {
	BASE_WIDTH: 1000,
	// Long : short edge (e.g. 1.77). Combined with ORIENTATION → 1.77:1 or 1:1.77
	ARTWORK_RATIO: 1.0,
	ORIENTATION: "horizontal", // "horizontal" | "vertical"
	ARTWORK_PADDING: 0.1,
	WRAP_PADDING_FACTOR: 0.05,
	SCALE_FACTOR_X: 1.0,
	SCALE_FACTOR_Y: 1.0,
	FORCE_SIZE: false,
	FIXED_WIDTH: 966,
	FIXED_HEIGHT: 96,
	// Shader output framing (final pass only).
	// fitCanvas: true = no crop (full texture). false = object-fit cover with width:height.
	// matchArtwork: true = derive width/height from ARTWORK_RATIO + ORIENTATION (or FIXED_*).
	SHADER_RENDER: {fitCanvas: false, matchArtwork: true, width: 1, height: 1},
	// Master shader animation speed — 1.0 = default, 0.5 = half, 2.0 = double
	SHADER_ANIMATION_SPEED: 1.0,
};

// localStorage: keep shader effects panel edits (effect params + output framing) across refresh
const PERSIST_SHADER_PANEL = true;

// How long to wait after a digit key before resolving the buffered scene number.
const SCENE_KEY_TIMEOUT_MS = 500;

const DEBUG_CONFIG = {
	DEFAULT_PIXEL_DENSITY_DESKTOP: 1,
	DEFAULT_PIXEL_DENSITY_MOBILE: 1,
	HELP_TEXT: "Controls: D debug · E shaders · L loop · C controls · G symmetry debug · M S-1 MIDI map · V scene params · digits = scene",
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

// Scene key selection (see keyPressed)
let sceneKeyBuffer = "";
let sceneKeyTimer = null;

// Canvas
let mainCanvas = null;
let shaderCanvas = null;
let pixel_density = 1;

// Layout (derived from canvas dimensions at setup)
let ARTWORK_RATIO = 1.0;
let DIM = 0;
let MULTIPLIER = 1;

// Independent rAF for panels / audio / MIDI so they stay live if draw() stops
let panelLoopId = null;

// ============================================================================
// 3. CANVAS & LAYOUT
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

	const viewportDim = min(windowWidth, windowHeight);
	const layout = {
		orientation: CANVAS_CONFIG.ORIENTATION === "vertical" ? "vertical" : "horizontal",
		ratio: Math.max(Number(CANVAS_CONFIG.ARTWORK_RATIO) || 1, 0.01),
		baseSize: CANVAS_CONFIG.BASE_WIDTH,
	};

	if (typeof computeArtworkLayout === "function") {
		const sized = computeArtworkLayout(viewportDim, layout);
		return {width: sized.width, height: sized.height};
	}

	// Fallback if artworkLayout.js is missing: ratio = long:short
	const r = layout.ratio;
	if (layout.orientation === "vertical") {
		return {width: viewportDim / r, height: viewportDim};
	}
	return {width: viewportDim, height: viewportDim / r};
}

/**
 * Resolve shader output framing from CANVAS_CONFIG.SHADER_RENDER.
 * With matchArtwork, width/height follow ARTWORK_RATIO + ORIENTATION (or FIXED_*).
 */
function resolveShaderRender() {
	const cfg = CANVAS_CONFIG.SHADER_RENDER || {};
	const fitCanvas = Boolean(cfg.fitCanvas);

	if (fitCanvas) {
		return {fitCanvas: true, width: cfg.width ?? 1, height: cfg.height ?? 1};
	}

	if (cfg.matchArtwork !== false) {
		if (CANVAS_CONFIG.FORCE_SIZE) {
			return {
				fitCanvas: false,
				width: CANVAS_CONFIG.FIXED_WIDTH,
				height: CANVAS_CONFIG.FIXED_HEIGHT,
			};
		}
		const r = Math.max(Number(CANVAS_CONFIG.ARTWORK_RATIO) || 1, 0.01);
		if (CANVAS_CONFIG.ORIENTATION === "vertical") {
			return {fitCanvas: false, width: 1, height: r};
		}
		return {fitCanvas: false, width: r, height: 1};
	}

	return {
		fitCanvas: false,
		width: cfg.width ?? 1,
		height: cfg.height ?? 1,
	};
}

// Called at setup and again from shaderEffects.resize() after the output size
// changes — it is the rig's only resize seam (there is no windowResized()).
function updateLayoutMetrics(canvasW, canvasH) {
	ARTWORK_RATIO = canvasW / canvasH;
	const baseHeight = CANVAS_CONFIG.BASE_WIDTH * ARTWORK_RATIO;
	const defaultSize = min(CANVAS_CONFIG.BASE_WIDTH, baseHeight);
	DIM = min(canvasW, canvasH);
	MULTIPLIER = DIM / defaultSize;

	// shaderEffects.resize() calls mainCanvas.resizeCanvas(), which wipes the
	// CTM, imageSmoothingEnabled and colorMode set at setup. Re-apply them.
	// (Before scenes this silently reverted mainCanvas to RGB + smoothing +
	// identity transform on every panel resize.)
	if (mainCanvas) configureArtworkCanvas();

	window.sceneHost?.resize(canvasW, canvasH);
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

		// Restore panel edits from localStorage before setup (wins over CANVAS_CONFIG output)
		let restoredPanel = false;
		if (PERSIST_SHADER_PANEL && typeof shaderEffects.loadPersistedPanelConfig === "function") {
			restoredPanel = !!shaderEffects.loadPersistedPanelConfig();
			if (restoredPanel) console.log("[sketch] restored shader panel config from localStorage");
		}
		if (!restoredPanel) {
			shaderEffects.setRenderRatio(resolveShaderRender());
			if (typeof shaderEffects.setAnimationSpeed === "function") {
				shaderEffects.setAnimationSpeed(CANVAS_CONFIG.SHADER_ANIMATION_SPEED);
			}
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

// Idempotent: safe to call again after any resize. The explicit setTransform is
// what makes it so — without it the translate/scale below would compound, and
// the compositor's drawImage would drift a little further off every resize.
function configureArtworkCanvas() {
	const density = typeof mainCanvas.pixelDensity === "function" ? mainCanvas.pixelDensity() : 1;
	mainCanvas.drawingContext.setTransform(density, 0, 0, density, 0, 0);

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
// 4. SCENES
// ============================================================================

// The scene system is native ES modules (see public/scene/). The rig stays
// classic-script global scope, so it reaches the modules through one dynamic
// import here rather than through <script type="module"> tags — that keeps the
// whole FX stack from having to become ESM.
async function initScenes(canvasW, canvasH) {
	try {
		const {bootScenes} = await import("./scene/boot.js");
		await bootScenes({width: canvasW, height: canvasH, pixelDensity: pixel_density});
	} catch (error) {
		// A broken scene system must not stop the rig from booting.
		console.warn("[sketch] scene system failed to boot:", error);
	}
}

// ============================================================================
// 5. AUDIO & MIDI
// ============================================================================

function setupAudioReactive() {
	if (typeof audioKnob === "undefined") return;

	audioKnob
		.setSource("s1") // Roland S-1 USB audio; falls back to default mic if not found
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

	// S-1 CC13 (LFO Pitch) → rotation angle, smoothed (see public/midi/s1Midi.js presets)
	const initAngle = shaderEffects.effectsConfig.symmetry.rotationStartingAngle;
	addKnobSmooth(13, "symmetry", "rotationStartingAngle", initAngle, 0.08);
}

function setupMidiClockOsc() {
	if (!MIDI_CLOCK_CONFIG.ENABLED || typeof midiClockOsc === "undefined") return;
	midiClockOsc.connect(MIDI_CLOCK_CONFIG.WS_URL);
	midiClockOsc.setOverlayVisible(MIDI_CLOCK_CONFIG.SHOW_OVERLAY);
}

// Panels / audio / MIDI run on their own rAF so they stay live independently of
// the artwork draw loop (which can stop on completion via noLoop()).
function startPanelLoop() {
	if (panelLoopId !== null) return;
	const tick = () => {
		if (typeof audioKnob !== "undefined") audioKnob.update();
		if (typeof debugPanel !== "undefined") debugPanel.update();
		if (typeof shaderEffectsPanel !== "undefined") shaderEffectsPanel.update();
		window.scenePanel?.update();
		window.midiPanel?.update();
		updateKnobSmoothing();
		if (typeof midiClockOsc !== "undefined") midiClockOsc.update();
		panelLoopId = requestAnimationFrame(tick);
	};
	panelLoopId = requestAnimationFrame(tick);
}

// ============================================================================
// 6. UI CONTROLS
// ============================================================================

function toggleLoopCountdown() {
	if (typeof shaderEffects === "undefined") return;
	shaderEffects.toggleLoopCountdown();
	if (typeof debugPanel !== "undefined" && shaderEffects.loopConfig?.showCountdown) {
		debugPanel.show();
	}
}

// ============================================================================
// 7. RENDERING
// ============================================================================

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
// 8. P5 LIFECYCLE
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

	setupAudioReactive();
	setupMidiKnobs();
	setupMidiClockOsc();

	await initScenes(canvasW, canvasH);

	startPanelLoop();

	if (typeof createDownloadButton === "function") {
		createDownloadButton();
	}
	logStartupInfo();
}

// async because the active scene is rendered with its own p5 instance, and
// p5.redraw() is async — the pixels are not on the scene canvas when it
// returns. p5 2.x awaits the global draw(), so frames cannot overlap.
//
// Nothing awaited here may reject: p5 schedules the next requestAnimationFrame
// AFTER awaiting draw(), so one unhandled rejection would freeze the rig for
// good. sceneHost.update() is a total function by contract.
//
// Panel / audio / MIDI updates live in startPanelLoop(), not here.
async function draw() {
	mainCanvas.background(330, 100, 0, 100);

	const maxFrames = config.animation.maxFrames;
	if (maxFrames == null || sketchFrame < maxFrames) {
		await window.sceneHost?.update();
		window.sceneHost?.render(mainCanvas);
		sketchFrame++;
	}
	onAnimationComplete(maxFrames);

	const isSketchComplete = maxFrames != null && sketchFrame >= maxFrames;
	renderOutput(isSketchComplete);
	notifyFirstFrameReady();
}

function keyPressed() {
	const tag = document.activeElement?.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable) {
		return;
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
		window.midiPanel?.toggle();
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

	if (key === "V" || key === "v") {
		window.scenePanel?.toggle();
	}

	// Scene selection: digits only, buffered like a vim count. "1" then "2"
	// within SCENE_KEY_TIMEOUT_MS means scene 12 (1-indexed into the manifest),
	// not "scene 1" followed by "scene 2". This is the only free key range:
	// D E L M G C are taken above, and g and Cmd+S are additionally bound at
	// document level in library/utils/utils.js.
	if (key >= "0" && key <= "9") {
		clearTimeout(sceneKeyTimer);
		sceneKeyBuffer += key;
		sceneKeyTimer = setTimeout(() => {
			const n = Number.parseInt(sceneKeyBuffer, 10);
			sceneKeyBuffer = "";
			if (Number.isFinite(n) && n >= 1) window.sceneHost?.showIndex(n - 1);
		}, SCENE_KEY_TIMEOUT_MS);
	}
}
