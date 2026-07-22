/**
 * Sketch Shader Effects
 *
 * A modular, plug-and-play shader effects system for p5.js projects.
 * This file contains all shader-related code and configuration, keeping sketch.js clean.
 *
 * Features:
 * - Easy configuration of multiple shader effects
 * - Dynamic enable/disable of effects
 * - Animated shader parameters with time control
 * - Seamless integration with ShaderManager and ShaderPipeline
 * - Reusable across projects with minimal setup
 *
 * Usage:
 * 1. In async setup(): await shaderEffects.preload(window)
 * 2. Then: shaderEffects.setup(width, height, mainCanvas, shaderCanvas)
 * 3. To apply shaders: shaderEffects.apply()
 * 4. To update time: shaderEffects.updateTime()
 */
class ShaderEffects {
	constructor() {
		// Shader animation control
		this.continueShadersAfterCompletion = false; // Set to false to stop shaders when sketch is done
		this.applyShadersDuringSketch = true; // Set to true to apply shaders while sketching
		this.shaderFrameRate = 60; // Target shader animation rate (see advanceShaderClock)
		this.shaderApplyInterval = 1; // Run full pipeline every N p5 frames during sketch (1 = every frame)
		this.shaderFrameCounter = 0;
		this.lastShaderUpdateTime = 0;

		// Animation state
		this.shaderTime = 0;
		this.shaderSeed = 0;
		this.particleAnimationComplete = false;

		// Translation state tracking (to prevent position jumps when speed changes)
		this.translationPhase = {
			symmetry: {x: 0, y: 0},
			symmetry2: {x: 0, y: 0},
		};
		this.lastTranslationSpeed = {
			symmetry: null,
			symmetry2: null,
		};

		// Rotation state tracking (to prevent angle jumps when speed changes)
		this.rotationPhase = {
			symmetry: 0,
			symmetry2: 0,
		};
		this.lastRotationSpeed = {
			symmetry: null,
			symmetry2: null,
		};
		this.lastRotationOscillationSpeed = {
			symmetry: null,
			symmetry2: null,
		};
		this.currentRotationAngle = {
			symmetry: 0,
			symmetry2: 0,
		};

		// Canvas references
		this.mainCanvas = null;
		this.shaderCanvas = null;
		this.pixelDensity = 1;

		// Shader system references
		this.shaderManager = null;
		this.shaderPipeline = null;
		this.p5Instance = null;

		// Output framing — passed to shaderManager.setRenderRatio() in setup()
		this.renderRatio = {
			fitCanvas: false,
			width: 1,
			height: 1,
		};
		// When true: NEAREST texture sampling + CSS pixelated upscale (no blur between colors)
		this.crispPixels = true;

		// localStorage key for shaderEffectsPanel persistence (save/load/clear)
		this.persistStorageKey = "shaderEffectsPanelConfig";

		// Master loop — wall-clock cycle with optional pause before restart
		this.loopConfig = {
			enabled: true,
			mode: "yoyo", // "yoyo" = smooth ping-pong | "reset" = hard restart
			// Easing per yoyo half: linear | sine | easeIn | easeOut | easeInOut | bounce
			easing: "easeInOut",
			durationSeconds: 5,
			pauseSeconds: 0,
			showCountdown: true,
			warnAtSeconds: 3,
		};
		this.loopStartTime = 0;
		this.loopPaused = false;
		this.loopPauseStartTime = 0;
		this.loopShaderTimeMax = 0;
		this.loopOverlayElement = null;

		// Effects configuration - customize these for your sketch
		this.effectsConfig = {
			deform: {
				enabled: false,
				amount: 0.1,
				timeMultiplier: 0.0,
				octave: 4.0,
				uniforms: {
					uTime: "shaderTime * timeMultiplier",
					uSeed: "shaderSeed",
					uAmount: "amount",
					uOctave: "octave",
				},
			},

			collage: {
				enabled: false,
				amount: 1.0,
				tileSize: 255.0,
				tileSize2: 50.0,
				tileSize3: 100.0,
				sizeNoise: 23.0,
				rotNoise: 24.0,
				timeMultiplier: 0.0,
				uniforms: {
					uSeed: "shaderSeed + 2222.0",
					uTileSize1: "tileSize",
					uTileSize2: "tileSize2",
					uTileSize3: "tileSize3",
					uSizeNoise: "sizeNoise",
					uRotNoise: "rotNoise",
					uAmount: "amount",
					uResolution: "[width, height]",
				},
			},

			symmetry: {
				enabled: true,
				symmetryMode: 3.0, // 0=horizontal, 1=vertical, 2=2-line, 3=4-line, 4=8-line, 5=16-line, 6=radial
				amount: 1.0, // Blend strength [0..1]
				debug: 0.0, // 0.0 = normal, 1.0 = debug mode (shows fold lines and center)
				center: [0.5, 0.5], // symmetry center in normalized coords
				translationEnabled: 1.0, // Master toggle for translation
				translationSpeedX: 0.5, // Horizontal translation speed (0 = none)
				translationSpeedY: 0.5, // Vertical translation speed (0 = none)
				translationMode: 3.0, // 0=sine, 1=noise, 2=FBM, 3=vector field, 4=continuous scroll
				translationNoiseScale: 0.5, // Scale of noise variation (lower = smoother, higher = more frequent changes)
				translationPhaseX: -0.5, // Accumulated phase for X (internal — not shown in panel)
				translationPhaseY: 0.5, // Accumulated phase for Y (internal — not shown in panel)
				rotationEnabled: 1.0, // Master toggle for animated rotation
				rotationSpeed: 0.81, // Speed of rotation
				rotationOscillationSpeed: 0.5, // Speed of oscillation (controls how fast it alternates between positive/negative)
				rotationStartingAngle: 0.0, // Static rotation amount in degrees [0..360] (applied even when animation is off)
				rotationMode: 1.0, // 0=cosine oscillation, 1=noise, 2=FBM
				rotationNoiseScale: 0.1, // Scale of rotation noise (lower = smoother, higher = more frequent changes)
				rotationPhase: 0.0, // Accumulated phase for rotation (prevents jumps)
				rotationAmplitude: 50.0, // Fixed amplitude - speed controls phase accumulation rate, not amplitude
				timeMultiplier: 0.5, // Time multiplier for animation
				uniforms: {
					uResolution: "[width, height]",
					uSeed: "shaderSeed + 1234.0",
					uSymmetryMode: "symmetryMode",
					uAmount: "amount",
					uDebug: "debug",
					uCenter: "center",
					uTime: "shaderTime * timeMultiplier",
					uTranslationEnabled: "translationEnabled",
					uTranslationSpeedX: "translationSpeedX",
					uTranslationSpeedY: "translationSpeedY",
					uTranslationMode: "translationMode",
					uTranslationNoiseScale: "translationNoiseScale",
					uTranslationPhaseX: "translationPhaseX",
					uTranslationPhaseY: "translationPhaseY",
					uRotationEnabled: "rotationEnabled",
					uRotationSpeed: "rotationSpeed",
					uRotationOscillationSpeed: "rotationOscillationSpeed",
					uRotationStartingAngle: "rotationStartingAngle * 0.017453292519943295", // deg → rad
					uRotationMode: "rotationMode",
					uRotationNoiseScale: "rotationNoiseScale",
					uRotationPhase: "rotationPhase",
					uRotationAmplitude: "rotationAmplitude",
				},
			},
			symmetry2: {
				enabled: true,
				symmetryMode: 5.0, // 0=horizontal, 1=vertical, 2=2-line, 3=4-line, 4=8-line, 5=16-line, 6=radial
				amount: 1.0, // Blend strength [0..1]
				debug: 0.0, // 0.0 = normal, 1.0 = debug mode (shows fold lines and center)
				center: [0.5, 0.5], // symmetry center in normalized coords
				translationEnabled: 1.0, // Master toggle for translation
				translationSpeedX: 1.5, // Horizontal translation speed (0 = none)
				translationSpeedY: 1.5, // Vertical translation speed (0 = none)
				translationMode: 3.0, // 0=sine, 1=noise, 2=FBM, 3=vector field, 4=continuous scroll
				translationNoiseScale: 0.2, // Scale of noise variation (lower = smoother, higher = more frequent changes)
				translationPhaseX: -0.5, // Accumulated phase for X (internal — not shown in panel)
				translationPhaseY: 0.5, // Accumulated phase for Y (internal — not shown in panel)
				rotationEnabled: 1.0, // Master toggle for animated rotation
				rotationSpeed: 0.0, // Speed of rotation
				rotationOscillationSpeed: 0.1, // Speed of oscillation (controls how fast it alternates between positive/negative)
				rotationStartingAngle: 0.0, // Static rotation amount in degrees [0..360] (applied even when animation is off)
				rotationMode: 1.0, // 0=cosine oscillation, 1=noise, 2=FBM
				rotationNoiseScale: 0.01, // Scale of rotation noise (lower = smoother, higher = more frequent changes)
				rotationPhase: 0.0, // Accumulated phase for rotation (prevents jumps)
				rotationAmplitude: 50.0, // Fixed amplitude - speed controls phase accumulation rate, not amplitude
				timeMultiplier: 0.1, // Time multiplier for animation
				uniforms: {
					uResolution: "[width, height]",
					uSeed: "shaderSeed + 1234.0",
					uCenter: "center",
					uSymmetryMode: "symmetryMode",
					uAmount: "amount",
					uDebug: "debug",
					uTime: "shaderTime * timeMultiplier",
					uTranslationEnabled: "translationEnabled",
					uTranslationSpeedX: "translationSpeedX",
					uTranslationSpeedY: "translationSpeedY",
					uTranslationMode: "translationMode",
					uTranslationNoiseScale: "translationNoiseScale",
					uTranslationPhaseX: "translationPhaseX",
					uTranslationPhaseY: "translationPhaseY",
					uRotationEnabled: "rotationEnabled",
					uRotationSpeed: "rotationSpeed",
					uRotationOscillationSpeed: "rotationOscillationSpeed",
					uRotationStartingAngle: "rotationStartingAngle * 0.017453292519943295", // deg → rad
					uRotationMode: "rotationMode",
					uRotationNoiseScale: "rotationNoiseScale",
					uRotationPhase: "rotationPhase",
					uRotationAmplitude: "rotationAmplitude",
				},
			},
			wave: {
				enabled: true,
				timeMultiplier: 1.1,
				center: [0.5, 0.5], // wave origin in normalized UV (0–1, p5 coords: y=0 top)
				amount: 1.0, // Overall mix [0..1]
				spiralAmount: 1.0, // Spiral displacement strength
				spiralFrequency: 12.0, // Ring density
				spiralSpeed: 1.0, // Spiral animation rate
				falloff: 1.414, // Radial falloff (√2 = full diagonal)
				pulseAmount: 0.0, // Extra pulse modulation (0 = legacy look)
				pulseSpeed: 1.7, // Pulse oscillation rate
				waveAmount: 0.0, // Cartesian ripple (0 ≈ legacy nearly-off)
				waveFrequency: 1.0, // Ripple spatial frequency
				uniforms: {
					uTime: "shaderTime * timeMultiplier",
					uResolution: "[width, height]",
					uCenter: "center",
					uAmount: "amount",
					uSpiralAmount: "spiralAmount",
					uSpiralFrequency: "spiralFrequency",
					uSpiralSpeed: "spiralSpeed",
					uFalloff: "falloff",
					uPulseAmount: "pulseAmount",
					uPulseSpeed: "pulseSpeed",
					uWaveAmount: "waveAmount",
					uWaveFrequency: "waveFrequency",
				},
			},
			pixelGrid: {
				enabled: true,
				gridSize: [240.0, 24.0],
				cellRatio: 0.0,
				gridMode: 0.0,
				diffuse: 0.0,
				gapSize: 0.0,
				gapBrightness: 1.0,
				uniforms: {
					uResolution: "[width, height]",
					uGridSize: "gridSize",
					uCellRatio: "cellRatio",
					uMode: "gridMode",
					uDiffuse: "diffuse",
					uGapSize: "gapSize",
					uGapBrightness: "gapBrightness",
				},
			},

			pixelSort: {
				enabled: false,
				angle: 0.0, // 0x = vertical, Math.PI/2 = horizontal
				threshold: 0.3,
				sortAmount: 2.8,
				sampleCount: 1.0, // Number of samples (8-64, higher = better quality but slower)
				invert: 1.0, // 0.0 = sort bright pixels, 1.0 = sort dark pixels
				sortMode: 1.0, // 1.0 = sine wave, 2.0 = noise, 3.0 = FBM, 4.0 = vector field
				timeMultiplier: 0.3,
				uniforms: {
					uTime: "shaderTime * timeMultiplier",
					uSeed: "shaderSeed + 999.0",
					uAngle: "angle",
					uThreshold: "threshold",
					uSortAmount: "sortAmount",
					uSampleCount: "sampleCount",
					uInvert: "invert",
					uSortMode: "sortMode",
					uResolution: "[width, height]",
				},
			},
			colorQuantize: {
				enabled: false,
				levels: 2.0, // shader: max(levels, 2) … 256
				mix: 0.0, // 0 = original, 1 = full quantize
				uniforms: {
					uLevels: "levels",
					uMix: "mix",
				},
			},
			dither: {
				enabled: false,
				ditherMode: 0.0, // 0=bayer4, 1=bayer8, 2=hash, 3=line, 4=clustered
				levels: 2.0, // shader: max(levels, 2)
				mix: 1.0, // shader clamps 0–1
				strength: 1.0,
				scale: 0.1,
				colorMode: 0.0, // 0=luma quantize, 1=per-channel quantize
				uniforms: {
					uResolution: "[width, height]",
					uDitherMode: "ditherMode",
					uLevels: "levels",
					uMix: "mix",
					uStrength: "strength",
					uScale: "scale",
					uColorMode: "colorMode",
					uSeed: "shaderSeed + 4321.0",
				},
			},

			zoom: {
				enabled: false,
				zoomAmount: 0.0, // Static zoom level (1.0 = no zoom, 2.0 = 2x in, 0.5 = 2x out)
				zoomSpeed: 0.8, // Animation speed
				zoomOutAmount: 2.25, // Min zoom when animating
				zoomInAmount: 4.5, // Max zoom when animating
				animateZoom: 1.0, // 0.0 = static, 1.0 = animate between out/in
				easingMode: 4.0, // 0=sine, 1=linear, 2=ease-in, 3=ease-out, 4=ease-in-out, 5=bounce
				outOfBoundsMode: 2.0, // 0=black, 1=clamp, 2=mirror, 3=transparent
				center: [0.5, 0.5], // Zoom center point (normalized 0-1)
				timeMultiplier: 0.0,
				uniforms: {
					uTime: "shaderTime * timeMultiplier",
					uZoomSpeed: "zoomSpeed",
					uZoomAmount: "zoomAmount",
					uZoomOutAmount: "zoomOutAmount",
					uZoomInAmount: "zoomInAmount",
					uAnimateZoom: "animateZoom",
					uCenter: "center",
					uEasingMode: "easingMode",
					uOutOfBoundsMode: "outOfBoundsMode",
				},
			},
			chromatic: {
				enabled: false,
				amount: 0.0015,
				timeMultiplier: 2.0,
				uniforms: {
					uTime: "shaderTime * timeMultiplier",
					uSeed: "shaderSeed + 777.0",
					uAmount: "amount",
				},
			},

			crtDisplay: {
				enabled: false,
				brightness: 0.0,
				cellSize: 3.0,
				gapOpacity: 0.2,
				rgbOpacity: 0.5,
				rgbGain: [1.0, 1.0, 1.0],
				dotRadius: 0.41,
				dotFalloff: 0.4,
				filterMode: 1.0,
				uniforms: {
					uResolution: "[width, height]",
					uBrightness: "brightness",
					uCellSize: "cellSize",
					uGapOpacity: "gapOpacity",
					uRgbOpacity: "rgbOpacity",
					uDotRadius: "dotRadius",
					uDotFalloff: "dotFalloff",
					uFilterMode: "filterMode",
				},
			},
			glitchDisplacement: {
				enabled: false,
				timeMultiplier: 0.1,
				intensity: 100.6,
				lineDensity: 100.0,
				speed: 100.0,
				threshold: 0.85,
				uniforms: {
					uTime: "shaderTime * timeMultiplier",
					uResolution: "[width, height]",
					uIntensity: "intensity",
					uLineDensity: "lineDensity",
					uSpeed: "speed",
					uThreshold: "threshold",
				},
			},
			blur: {
				enabled: false,
				blurMode: 1.0, // 0=gaussian, 1=radial, 2=directional
				blurAmount: 43.0, // Blur radius/intensity in pixels
				blurQuality: 120.0, // Sampling quality (1-8, higher = better but slower)
				blurDirection: 0, // Angle in radians for directional mode
				blurCenter: [0.5, 0.5], // Center for radial mode (normalized 0-1)
				blurStart: 0.6, // Radial mode: starting radius (0-1, blur kicks in beyond this distance)
				blurCrt: 1.0, // Radial mode: 0.0 = circular, 1.0 = super-ellipse (CRT shape)
				blurCrtPower: 27.0, // Super-ellipse exponent (2.0 = ellipse, 4.0+ = more rectangular/CRT-like)
				blurMin: 0.0, // Radial mode: minimum blur amount at blurStart (0 = sharp center, >0 = always some blur)
				uniforms: {
					uResolution: "[width, height]",
					uBlurMode: "blurMode",
					uBlurAmount: "blurAmount",
					uBlurQuality: "blurQuality",
					uBlurDirection: "blurDirection",
					uBlurCenter: "blurCenter",
					uBlurStart: "blurStart",
					uBlurCrt: "blurCrt",
					uBlurCrtPower: "blurCrtPower",
					uBlurMin: "blurMin",
				},
			},

			crtWarp: {
				enabled: false,
				warpAmount: 0.25,
				aspectCorrect: 0.0,
				borderColor: 2.0,
				vignette: 0.0,
				cornerSmooth: 0.015,
				cornerRadius: 0.1,
				boundsInset: 0.075,
				rgbGain: [1.0, 1.0, 1.0],
				uniforms: {
					uResolution: "[width, height]",
					uWarpAmount: "warpAmount",
					uAspectCorrect: "aspectCorrect",
					uCornerRadius: "cornerRadius",
					uCornerSmooth: "cornerSmooth",
					uBorderColor: "borderColor",
					uVignette: "vignette",
					uBoundsInset: "boundsInset",
					uRgbGain: "rgbGain",
				},
			},
			grain: {
				enabled: false,
				amount: 0.1,
				timeMultiplier: 0.0,
				// Spatial threshold (UV 0-1): grain visible only inside this rectangle
				thresholdMinX: 0.0, // left [0..1]
				thresholdMaxX: 1.0, // right [0..1]
				thresholdMinY: 0.0, // bottom [0..1]
				thresholdMaxY: 1.0, // top [0..1]
				thresholdSmooth: 0.001, // soft edge at boundaries (0 = hard edge)
				uniforms: {
					uTime: "shaderTime * timeMultiplier",
					uSeed: "shaderSeed + 345.0",
					uAmount: "amount",
					uThresholdMinX: "thresholdMinX",
					uThresholdMaxX: "thresholdMaxX",
					uThresholdMinY: "thresholdMinY",
					uThresholdMaxY: "thresholdMaxY",
					uThresholdSmooth: "thresholdSmooth",
				},
			},
		};

		// Default templates for create-from-dropdown (survive delete of last instance)
		this.effectTemplates = {};
		for (const [name, cfg] of Object.entries(this.effectsConfig)) {
			const root = String(name).replace(/\d+$/, "") || name;
			if (this.effectTemplates[root]) continue;
			const template = JSON.parse(JSON.stringify(cfg));
			template.enabled = false;
			template.pass = cfg.pass || root;
			delete template._initialTranslationPhaseX;
			delete template._initialTranslationPhaseY;
			delete template._initialRotationPhase;
			this.effectTemplates[root] = template;
		}

		// Snapshot of built-in defaults, used by resetToDefaultPanelConfig()
		this._defaultPanelConfig = this._buildPanelConfigSnapshot();

		// Cache for last enabled effects (to detect changes)
		this.lastEnabledEffects = null;

		// FPS tracking
		this.showFPS = typeof isSafariMobile === "function" && isSafariMobile() ? false : true;
		this.lastFrameTime = performance.now();
		this.currentFPS = 0;
		this.fpsElement = null;
	}

	/**
	 * Load shaders — call from async setup() (p5.js 2.x no longer runs preload()).
	 * Customize the shaders you load for your sketch.
	 * @param {p5} p5Instance - The p5 instance (window in global mode)
	 */
	async preload(p5Instance) {
		this.p5Instance = p5Instance;

		// Initialize the global shader manager instance
		shaderManager.init(p5Instance);

		// Set default vertex shader
		shaderManager.setDefaultVertex("chromatic-aberration/vertex.vert");

		// Load shaders - customize this list for your sketch
		await Promise.all([
			shaderManager.loadShader("copy", "copy/fragment.frag", "copy/vertex.vert"),
			shaderManager.loadShader("deform", "deform/fragment.frag", "deform/vertex.vert"),
			shaderManager.loadShader("glitchDisplacement", "glitch-displacement/fragment.frag", "glitch-displacement/vertex.vert"),
			shaderManager.loadShader("chromatic", "chromatic-aberration/fragment.frag", "chromatic-aberration/vertex.vert"),
			shaderManager.loadShader("grain", "grain/fragment.frag", "grain/vertex.vert"),
			shaderManager.loadShader("collage", "collage-rotate/fragment.frag", "collage-rotate/vertex.vert"),
			shaderManager.loadShader("pixelSort", "pixel-sort/fragment.frag", "pixel-sort/vertex.vert"),
			shaderManager.loadShader("crtDisplay", "pixel-checker/fragment.frag", "pixel-checker/vertex.vert"),
			shaderManager.loadShader("symmetry", "symmetry/fragment.frag", "symmetry/vertex.vert"),
			shaderManager.loadShader("symmetry2", "symmetry/fragment.frag", "symmetry/vertex.vert"),
			shaderManager.loadShader("pixelGrid", "pixel-grid/fragment.frag", "pixel-grid/vertex.vert"),
			shaderManager.loadShader("blur", "blur/fragment.frag", "blur/vertex.vert"),
			shaderManager.loadShader("zoom", "zoom/fragment.frag", "zoom/vertex.vert"),
			shaderManager.loadShader("crtWarp", "crt-warp/fragment.frag", "crt-warp/vertex.vert"),
			shaderManager.loadShader("wave", "wave/fragment.frag", "wave/vertex.frag"),
			shaderManager.loadShader("colorQuantize", "color-quantize/fragment.frag", "color-quantize/vertex.vert"),
			shaderManager.loadShader("dither", "dither/fragment.frag", "dither/vertex.vert"),
		]);

		this.shaderManager = shaderManager;

		return this;
	}

	/**
	 * Setup shader effects - call this in p5 setup()
	 * @param {number} width - Canvas width
	 * @param {number} height - Canvas height
	 * @param {p5.Graphics} mainCanvas - Main graphics buffer for artwork
	 * @param {p5.Graphics} shaderCanvas - WEBGL canvas for shader effects
	 */
	setup(width, height, mainCanvas, shaderCanvas, pixelDensity = 1) {
		if (!this.shaderManager || !this.p5Instance) {
			throw new Error("shaderEffects.preload() must be awaited before setup()");
		}

		this.mainCanvas = mainCanvas;
		this.shaderCanvas = shaderCanvas;
		this.pixelDensity = pixelDensity ?? mainCanvas?.pixelDensity?.() ?? 1;

		if (this.shaderManager) {
			this.shaderManager.setRenderRatio(this.renderRatio);
			this.setCrispPixels(this.crispPixels);
		}

		// Initialize shader seed with fxhash if available
		if (typeof fxrand === "function") {
			this.shaderSeed = fxrand() * 10000;
		} else {
			this.shaderSeed = Math.random() * 10000;
		}

		// Initialize shader pipeline with enabled effects
		const enabledEffects = Object.keys(this.effectsConfig).filter((name) => this.effectsConfig[name].enabled);

		this.shaderPipeline = new ShaderPipeline(this.shaderManager, this.p5Instance).init(width, height, enabledEffects, this.pixelDensity);

		// Make it globally accessible (for backward compatibility)
		window.shaderPipeline = this.shaderPipeline;

		if (this.loopConfig.enabled) {
			this.loopStartTime = performance.now();
			this.loopPaused = false;
			this.snapshotInitialPhases();
			this.updateLoopShaderTimeMax();
		}

		return this;
	}

	/**
	 * Update output framing (delegates to shaderManager).
	 * @param {object} options - { fitCanvas, width, height }
	 */
	setRenderRatio(options = {}) {
		this.renderRatio = {
			fitCanvas: options.fitCanvas !== undefined ? Boolean(options.fitCanvas) : this.renderRatio.fitCanvas,
			width: Math.max(options.width ?? this.renderRatio.width, 0.0001),
			height: Math.max(options.height ?? this.renderRatio.height, 0.0001),
		};
		if (this.shaderManager) {
			this.shaderManager.setRenderRatio(this.renderRatio);
		}
		return this;
	}

	getRenderRatio() {
		return {...this.renderRatio};
	}

	/**
	 * Resize artwork + display canvases and rebuild the shader pipeline.
	 * @param {number} width
	 * @param {number} height
	 */
	resize(width, height) {
		const w = Math.max(16, Math.min(4096, Math.round(Number(width) || 16)));
		const h = Math.max(16, Math.min(4096, Math.round(Number(height) || 16)));

		const cur = this.getCanvasSize();
		if (Math.round(cur.width) === w && Math.round(cur.height) === h) {
			return this;
		}

		const p5 = this.p5Instance || (typeof window !== "undefined" ? window : null);

		// Artwork offscreen buffer
		if (this.mainCanvas) {
			if (typeof this.mainCanvas.resizeCanvas === "function") {
				this.mainCanvas.resizeCanvas(w, h);
			} else if (typeof this.mainCanvas.resize === "function") {
				this.mainCanvas.resize(w, h);
			}
		}

		// Main WEBGL display canvas (global-mode p5 exposes resizeCanvas on window)
		if (typeof resizeCanvas === "function") {
			resizeCanvas(w, h);
		} else if (p5 && typeof p5.resizeCanvas === "function") {
			p5.resizeCanvas(w, h);
		}

		this.shaderCanvas = p5 || this.shaderCanvas;
		this.lastEnabledEffects = null;
		this.reinitializePipeline();

		if (typeof updateLayoutMetrics === "function") {
			updateLayoutMetrics(w, h);
		}

		console.log(`[ShaderEffects] resized to ${w}×${h} (main=${this.mainCanvas?.width}×${this.mainCanvas?.height})`);
		return this;
	}

	getCanvasSize() {
		const w = this.mainCanvas?.width ?? this.p5Instance?.width ?? 0;
		const h = this.mainCanvas?.height ?? this.p5Instance?.height ?? 0;
		return {width: w, height: h};
	}

	/**
	 * Sharp pixel look when the buffer is upscaled (CSS + WebGL NEAREST sampling).
	 * @param {boolean} enabled
	 */
	setCrispPixels(enabled) {
		this.crispPixels = Boolean(enabled);
		if (this.shaderManager) {
			this.shaderManager.crispPixels = this.crispPixels;
		}
		if (typeof document !== "undefined") {
			document.querySelectorAll("canvas.p5Canvas").forEach((el) => {
				el.classList.toggle("is-smooth", !this.crispPixels);
			});
		}
		if (this.mainCanvas?.drawingContext) {
			this.mainCanvas.drawingContext.imageSmoothingEnabled = !this.crispPixels;
		}
		return this;
	}

	getCrispPixels() {
		return !!this.crispPixels;
	}

	/**
	 * Serializable snapshot of panel-editable state (per-effect params + output framing).
	 * Excludes "uniforms" (static mapping, not user-editable) and internal phase-tracking fields.
	 */
	_buildPanelConfigSnapshot() {
		const effects = {};
		for (const [name, effect] of Object.entries(this.effectsConfig)) {
			const {uniforms, ...rest} = effect;
			effects[name] = JSON.parse(JSON.stringify(rest));
		}
		return {
			effects,
			effectOrder: Object.keys(this.effectsConfig),
			renderRatio: {...this.renderRatio},
			crispPixels: this.crispPixels,
		};
	}

	/**
	 * Persist the current shaderEffectsPanel state (effect params + output framing) to localStorage.
	 * Called by shaderEffectsPanel on every control change (debounced).
	 */
	savePersistedPanelConfig() {
		try {
			localStorage.setItem(this.persistStorageKey, JSON.stringify(this._buildPanelConfigSnapshot()));
		} catch (error) {
			console.warn("[ShaderEffects] failed to save panel config:", error);
		}
		return this;
	}

	/**
	 * Restore panel state saved by savePersistedPanelConfig(). Applies matching params onto the
	 * already-loaded effectsConfig (effects no longer present in this build are skipped).
	 * @returns {object|null} the restored snapshot, or null if nothing valid was saved
	 */
	loadPersistedPanelConfig() {
		let saved;
		try {
			const raw = localStorage.getItem(this.persistStorageKey);
			if (!raw) return null;
			saved = JSON.parse(raw);
		} catch (error) {
			console.warn("[ShaderEffects] failed to parse saved panel config:", error);
			return null;
		}
		if (!saved || typeof saved !== "object" || !saved.effects) return null;

		for (const [name, values] of Object.entries(saved.effects)) {
			if (!this.effectsConfig[name]) continue;
			for (const [key, value] of Object.entries(values)) {
				if (key === "uniforms") continue;
				this.effectsConfig[name][key] = value;
			}
		}

		if (Array.isArray(saved.effectOrder) && saved.effectOrder.length) {
			this.reorderEffects(saved.effectOrder);
		}

		if (saved.renderRatio) this.setRenderRatio(saved.renderRatio);
		if (typeof saved.crispPixels === "boolean") this.setCrispPixels(saved.crispPixels);

		this.lastEnabledEffects = null;
		console.log("[ShaderEffects] restored panel config from localStorage");
		return saved;
	}

	/**
	 * Remove any saved panel config from localStorage.
	 */
	clearPersistedPanelConfig() {
		try {
			localStorage.removeItem(this.persistStorageKey);
		} catch (error) {
			console.warn("[ShaderEffects] failed to clear saved panel config:", error);
		}
		return this;
	}

	/**
	 * Restore effect params + output framing to the sketch's built-in defaults (pre-persistence).
	 */
	resetToDefaultPanelConfig() {
		if (!this._defaultPanelConfig) return this;
		const defaults = this._defaultPanelConfig;

		const nextEffects = {};
		for (const name of defaults.effectOrder) {
			const root = String(name).replace(/\d+$/, "") || name;
			const uniforms = this.effectTemplates[root]?.uniforms || this.effectsConfig[name]?.uniforms || {};
			nextEffects[name] = {...JSON.parse(JSON.stringify(defaults.effects[name])), uniforms};
		}
		this.effectsConfig = nextEffects;

		this.setRenderRatio(defaults.renderRatio);
		this.setCrispPixels(defaults.crispPixels);
		this.lastEnabledEffects = null;
		this.reinitializePipeline();
		console.log("[ShaderEffects] reset panel config to defaults");
		return this;
	}

	/**
	 * Configure master shader loop (wall-clock duration + optional pause).
	 * @param {object} options
	 */
	setLoopConfig(options = {}) {
		const prev = this.loopConfig;
		this.loopConfig = {
			enabled: options.enabled !== undefined ? Boolean(options.enabled) : prev.enabled,
			mode: options.mode ?? prev.mode ?? "yoyo",
			easing: options.easing ?? prev.easing ?? "easeInOut",
			durationSeconds: Math.max(options.durationSeconds ?? prev.durationSeconds, 0.1),
			pauseSeconds: Math.max(options.pauseSeconds ?? prev.pauseSeconds, 0),
			showCountdown: options.showCountdown !== undefined ? Boolean(options.showCountdown) : prev.showCountdown,
			warnAtSeconds: Math.max(options.warnAtSeconds ?? prev.warnAtSeconds, 0),
		};
		if (this.loopConfig.enabled) {
			this.loopStartTime = performance.now();
			this.loopPaused = false;
			this.snapshotInitialPhases();
			this.updateLoopShaderTimeMax();
		}
		return this;
	}

	getLoopConfig() {
		return {...this.loopConfig};
	}

	updateLoopShaderTimeMax() {
		this.loopShaderTimeMax = this.loopConfig.durationSeconds * (this.shaderFrameRate / 100);
	}

	/**
	 * Apply loop easing to normalized time t ∈ [0, 1].
	 * Matches zoom shader easing modes where applicable.
	 * @param {number} t
	 * @returns {number}
	 */
	applyLoopEasing(t) {
		const x = Math.max(0, Math.min(1, t));
		const mode = this.loopConfig.easing ?? "linear";

		switch (mode) {
			case "sine":
				return 0.5 - 0.5 * Math.cos(x * Math.PI);
			case "easeIn":
				return x * x * x;
			case "easeOut": {
				const inv = 1 - x;
				return 1 - inv * inv * inv;
			}
			case "easeInOut":
				return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
			case "bounce": {
				const b = 1 - x;
				if (b < 1 / 2.75) return 1 - 7.5625 * b * b;
				if (b < 2 / 2.75) {
					const bb = b - 1.5 / 2.75;
					return 1 - (7.5625 * bb * bb + 0.75);
				}
				if (b < 2.5 / 2.75) {
					const bb = b - 2.25 / 2.75;
					return 1 - (7.5625 * bb * bb + 0.9375);
				}
				const bb = b - 2.625 / 2.75;
				return 1 - (7.5625 * bb * bb + 0.984375);
			}
			case "linear":
			default:
				return x;
		}
	}

	/**
	 * Triangle-wave loop position (0→1→0 for yoyo, 0→1 for reset).
	 * Yoyo applies configured easing per half (smooth at turnaround when easing has zero slope at 0/1).
	 * @param {number} elapsed - Seconds since loop start (pause-adjusted)
	 */
	getLoopProgress(elapsed) {
		const dur = this.loopConfig.durationSeconds;
		if (this.loopConfig.mode === "yoyo") {
			const cyclePos = elapsed % (dur * 2);
			if (cyclePos < dur) {
				const t = cyclePos / dur;
				const progress = this.applyLoopEasing(t);
				return {progress, halfRemaining: dur - cyclePos};
			}
			const t = (cyclePos - dur) / dur;
			const progress = 1 - this.applyLoopEasing(t);
			return {progress, halfRemaining: dur * 2 - cyclePos};
		}
		const progress = Math.min(elapsed / dur, 1);
		return {progress, halfRemaining: Math.max(dur - elapsed, 0)};
	}

	/**
	 * Effects that drive translation/rotation phase accumulation (symmetry overdubs included).
	 */
	getPhaseTrackedEffectNames() {
		return Object.keys(this.effectsConfig).filter((name) => {
			const effect = this.effectsConfig[name];
			return (
				effect &&
				(effect.translationSpeedX !== undefined ||
					effect.translationSpeedY !== undefined ||
					effect.translationSpeed !== undefined ||
					effect.rotationSpeed !== undefined)
			);
		});
	}

	_ensurePhaseTracking(effectName) {
		if (!this.translationPhase[effectName]) this.translationPhase[effectName] = {x: 0, y: 0};
		if (this.lastTranslationSpeed[effectName] === undefined) this.lastTranslationSpeed[effectName] = null;
		if (this.rotationPhase[effectName] === undefined) this.rotationPhase[effectName] = 0;
		if (this.lastRotationSpeed[effectName] === undefined) this.lastRotationSpeed[effectName] = null;
		if (this.lastRotationOscillationSpeed[effectName] === undefined) this.lastRotationOscillationSpeed[effectName] = null;
		if (this.currentRotationAngle[effectName] === undefined) this.currentRotationAngle[effectName] = 0;
	}

	/**
	 * Restore symmetry effect phases to their configured initial values.
	 */
	restoreInitialPhases() {
		for (const effectName of this.getPhaseTrackedEffectNames()) {
			const effect = this.effectsConfig[effectName];
			if (!effect) continue;
			if (effect._initialTranslationPhaseX !== undefined) {
				effect.translationPhaseX = effect._initialTranslationPhaseX;
				effect.translationPhaseY = effect._initialTranslationPhaseY;
				effect.rotationPhase = effect._initialRotationPhase;
			}
		}
	}

	snapshotInitialPhases() {
		for (const effectName of this.getPhaseTrackedEffectNames()) {
			const effect = this.effectsConfig[effectName];
			if (!effect) continue;
			effect._initialTranslationPhaseX = effect.translationPhaseX ?? 0;
			effect._initialTranslationPhaseY = effect.translationPhaseY ?? 0;
			effect._initialRotationPhase = effect.rotationPhase ?? 0;
		}
	}

	/**
	 * Reset all time-driven shader state at loop boundary.
	 */
	resetLoopState() {
		this.shaderTime = 0;
		this.restoreInitialPhases();

		this.translationPhase = {};
		this.lastTranslationSpeed = {};
		this.rotationPhase = {};
		this.lastRotationSpeed = {};
		this.lastRotationOscillationSpeed = {};
		this.currentRotationAngle = {};
		for (const name of this.getPhaseTrackedEffectNames()) {
			this._ensurePhaseTracking(name);
		}

		this.loopStartTime = performance.now();
		this.loopPaused = false;
	}

	/**
	 * Elapsed loop seconds, excluding active pause time.
	 */
	getLoopElapsedSeconds(now = performance.now()) {
		let elapsed = (now - this.loopStartTime) / 1000;
		if (this.loopPaused) {
			elapsed -= (now - this.loopPauseStartTime) / 1000;
		}
		return Math.max(elapsed, 0);
	}

	/**
	 * Seconds remaining in the current loop cycle or inter-loop pause.
	 * @returns {{ remaining: number, paused: boolean } | null}
	 */
	getLoopCountdown() {
		if (!this.loopConfig.enabled || !this.loopStartTime) return null;

		const now = performance.now();
		if (this.loopPaused) {
			const pauseElapsed = (now - this.loopPauseStartTime) / 1000;
			return {
				remaining: Math.max(this.loopConfig.pauseSeconds - pauseElapsed, 0),
				paused: true,
			};
		}

		const elapsed = this.getLoopElapsedSeconds(now);
		const {halfRemaining} = this.getLoopProgress(elapsed);
		return {
			remaining: halfRemaining,
			paused: false,
		};
	}

	/**
	 * Add a new shader effect programmatically
	 * @param {string} effectName - Name of the effect
	 * @param {object} config - Effect configuration
	 */
	addEffect(effectName, config) {
		this.effectsConfig[effectName] = {
			enabled: config.enabled || false,
			...config,
			uniforms: config.uniforms || {},
		};
		return this;
	}

	/**
	 * Enable or disable an effect
	 * @param {string} effectName - Name of the effect
	 * @param {boolean} enabled - Enable or disable
	 */
	setEffectEnabled(effectName, enabled) {
		if (this.effectsConfig[effectName]) {
			this.effectsConfig[effectName].enabled = enabled;
			this.reinitializePipeline();
		}
		return this;
	}

	/**
	 * Update an effect parameter
	 * @param {string} effectName - Name of the effect
	 * @param {string} paramName - Parameter name
	 * @param {*} value - New value
	 */
	updateEffectParam(effectName, paramName, value) {
		if (this.effectsConfig[effectName] && this.effectsConfig[effectName][paramName] !== undefined) {
			this.effectsConfig[effectName][paramName] = value;
		}
		return this;
	}

	/**
	 * Reorder effects in the render stack (Object key order = pass order).
	 * @param {string[]} orderedNames - Effect names top→bottom = first→last pass
	 */
	reorderEffects(orderedNames) {
		if (!Array.isArray(orderedNames) || !orderedNames.length) return this;

		const prev = this.effectsConfig;
		const next = {};
		const seen = new Set();

		for (const name of orderedNames) {
			if (prev[name] !== undefined && !seen.has(name)) {
				next[name] = prev[name];
				seen.add(name);
			}
		}
		// Keep any effects omitted from the list at the end
		for (const name of Object.keys(prev)) {
			if (!seen.has(name)) next[name] = prev[name];
		}

		this.effectsConfig = next;
		this.lastEnabledEffects = null; // force pass list rebuild on next apply()
		this.reinitializePipeline();
		return this;
	}

	/**
	 * Next free name: prefers root ("wave") if free, else wave2 / wave3…
	 */
	_nextCloneName(sourceName) {
		const root = String(sourceName).replace(/\d+$/, "") || sourceName;
		if (!this.effectsConfig[root]) return root;
		let n = 2;
		while (this.effectsConfig[root + n]) n++;
		return root + n;
	}

	/**
	 * Template names available for createEffect (from initial effectsConfig).
	 * @returns {string[]}
	 */
	getEffectTemplateNames() {
		return Object.keys(this.effectTemplates || {}).sort();
	}

	/**
	 * Create a new stack instance from a template (e.g. "symmetry", "wave").
	 * @param {string} templateName
	 * @param {object} [options]
	 * @param {boolean} [options.enabled=true]
	 * @returns {string|null} new effect name
	 */
	createEffect(templateName, options = {}) {
		const root = String(templateName).replace(/\d+$/, "") || templateName;
		const template = this.effectTemplates?.[root];
		if (!template) {
			console.warn(`[ShaderEffects] createEffect: unknown template "${templateName}"`);
			return null;
		}

		const newName = this._nextCloneName(root);
		const created = JSON.parse(JSON.stringify(template));
		created.enabled = options.enabled !== undefined ? Boolean(options.enabled) : true;
		created.pass = template.pass || root;

		this.effectsConfig[newName] = created;
		this._ensurePhaseTracking(newName);
		if (created.translationPhaseX !== undefined || created.rotationPhase !== undefined) {
			created._initialTranslationPhaseX = created.translationPhaseX ?? 0;
			created._initialTranslationPhaseY = created.translationPhaseY ?? 0;
			created._initialRotationPhase = created.rotationPhase ?? 0;
		}

		this.lastEnabledEffects = null;
		this.reinitializePipeline();
		console.log(`[ShaderEffects] created "${newName}" from template "${root}" (pass: ${created.pass})`);
		return newName;
	}

	/**
	 * Remove an effect from the stack.
	 * @param {string} effectName
	 */
	removeEffect(effectName) {
		if (!this.effectsConfig[effectName]) {
			console.warn(`[ShaderEffects] removeEffect: "${effectName}" not found`);
			return this;
		}

		delete this.effectsConfig[effectName];

		delete this.translationPhase?.[effectName];
		delete this.lastTranslationSpeed?.[effectName];
		delete this.rotationPhase?.[effectName];
		delete this.lastRotationSpeed?.[effectName];
		delete this.lastRotationOscillationSpeed?.[effectName];
		delete this.currentRotationAngle?.[effectName];

		this.lastEnabledEffects = null;
		this.reinitializePipeline();
		console.log(`[ShaderEffects] removed "${effectName}"`);
		return this;
	}

	/**
	 * Deep-clone an effect as a new stack instance (visual overdub).
	 * Shares the same GL program via `pass` (defaults to the source effect's program).
	 * @param {string} sourceName
	 * @param {object} [options]
	 * @param {boolean} [options.enabled=true]
	 * @param {boolean} [options.insertAfter=true] - place clone right after the source in the stack
	 * @returns {string|null} new effect name
	 */
	cloneEffect(sourceName, options = {}) {
		const source = this.effectsConfig[sourceName];
		if (!source) {
			console.warn(`[ShaderEffects] cloneEffect: "${sourceName}" not found`);
			return null;
		}

		const newName = this._nextCloneName(sourceName);
		const cloned = JSON.parse(JSON.stringify(source));
		cloned.enabled = options.enabled !== undefined ? Boolean(options.enabled) : true;
		// GL program key — reuse source program (symmetry2 → same as symmetry, or its own loaded name)
		cloned.pass = source.pass || String(sourceName).replace(/\d+$/, "") || sourceName;

		const insertAfter = options.insertAfter !== false;
		if (insertAfter) {
			const next = {};
			for (const name of Object.keys(this.effectsConfig)) {
				next[name] = this.effectsConfig[name];
				if (name === sourceName) next[newName] = cloned;
			}
			if (!next[newName]) next[newName] = cloned;
			this.effectsConfig = next;
		} else {
			this.effectsConfig[newName] = cloned;
		}

		this._ensurePhaseTracking(newName);
		if (cloned.translationPhaseX !== undefined || cloned.rotationPhase !== undefined) {
			cloned._initialTranslationPhaseX = cloned.translationPhaseX ?? 0;
			cloned._initialTranslationPhaseY = cloned.translationPhaseY ?? 0;
			cloned._initialRotationPhase = cloned.rotationPhase ?? 0;
		}

		this.lastEnabledEffects = null;
		this.reinitializePipeline();
		console.log(`[ShaderEffects] cloned "${sourceName}" → "${newName}" (pass: ${cloned.pass})`);
		return newName;
	}

	/**
	 * Reinitialize shader pipeline when effects change
	 */
	reinitializePipeline() {
		if (this.shaderPipeline && this.shaderManager && this.mainCanvas) {
			const enabledEffects = Object.keys(this.effectsConfig).filter((name) => this.effectsConfig[name].enabled);
			const density = this.mainCanvas.pixelDensity?.() ?? this.pixelDensity ?? 1;
			this.pixelDensity = density;
			this.shaderPipeline.init(this.mainCanvas.width, this.mainCanvas.height, enabledEffects, density);
		}
		return this;
	}

	/**
	 * Set shader frame rate
	 * @param {number} fps - Frame rate (1-120)
	 */
	setFrameRate(fps) {
		this.shaderFrameRate = Math.max(1, Math.min(120, fps));
		console.log(`Shader frame rate set to ${this.shaderFrameRate}fps`);
		return this;
	}

	/**
	 * How often to run the full shader pipeline during sketching (1 = every frame).
	 * Skipped frames keep the last shader output on screen; p5 still draws every frame.
	 * @param {number} interval - Integer >= 1
	 */
	setShaderApplyInterval(interval) {
		this.shaderApplyInterval = Math.max(1, Math.floor(interval));
		this.shaderFrameCounter = 0;
		console.log(`Shader apply interval set to every ${this.shaderApplyInterval} frame(s)`);
		return this;
	}

	getShaderApplyInterval() {
		return this.shaderApplyInterval;
	}

	/**
	 * Advance shader time from the real clock (replaces fixed 0.01 per frame).
	 * Calibrated so 60fps ≈ +0.01 per frame, same as before.
	 */
	advanceShaderClock() {
		const now = performance.now();
		if (!this.lastShaderUpdateTime) {
			this.lastShaderUpdateTime = now;
			if (this.loopConfig.enabled && !this.loopStartTime) {
				this.loopStartTime = now;
				this.snapshotInitialPhases();
				this.updateLoopShaderTimeMax();
			}
			return 0;
		}

		const dt = Math.min((now - this.lastShaderUpdateTime) / 1000, 0.1);
		this.lastShaderUpdateTime = now;

		if (this.loopConfig.enabled) {
			if (!this.loopStartTime) {
				this.loopStartTime = now;
				this.snapshotInitialPhases();
				this.updateLoopShaderTimeMax();
			}

			if (this.loopPaused) {
				const pauseElapsed = (now - this.loopPauseStartTime) / 1000;
				if (pauseElapsed >= this.loopConfig.pauseSeconds) {
					this.loopStartTime += now - this.loopPauseStartTime;
					this.loopPaused = false;
					if (this.loopConfig.mode === "reset") {
						this.resetLoopState();
					}
				}
				return 0;
			}

			const elapsed = this.getLoopElapsedSeconds(now);
			const dur = this.loopConfig.durationSeconds;

			if (this.loopConfig.mode === "reset") {
				if (elapsed >= dur) {
					if (this.loopConfig.pauseSeconds > 0) {
						this.loopPaused = true;
						this.loopPauseStartTime = now;
						return 0;
					}
					this.resetLoopState();
				}

				const delta = dt * (this.shaderFrameRate / 100);
				if (delta > 0) {
					this.shaderTime += delta;
					this.updateTranslationPhases(delta);
					this.updateRotationPhases(delta);
				}
				return delta;
			}

			// Yoyo: map wall-clock to triangle wave — shader time runs forward then backward
			const prevElapsed = Math.max(elapsed - dt, 0);
			const {progress} = this.getLoopProgress(elapsed);
			const prevProgress = this.getLoopProgress(prevElapsed).progress;
			const targetShaderTime = progress * this.loopShaderTimeMax;
			const prevShaderTime = prevProgress * this.loopShaderTimeMax;
			const deltaShaderTime = targetShaderTime - prevShaderTime;

			if (this.loopConfig.pauseSeconds > 0) {
				const fullCycle = dur * 2;
				const prevCyclePos = prevElapsed % fullCycle;
				const cyclePos = elapsed % fullCycle;
				if (prevCyclePos > cyclePos) {
					this.loopPaused = true;
					this.loopPauseStartTime = now;
					return 0;
				}
			}

			this.shaderTime = targetShaderTime;
			if (deltaShaderTime !== 0) {
				this.updateTranslationPhases(deltaShaderTime);
				this.updateRotationPhases(deltaShaderTime);
			}
			return deltaShaderTime;
		}

		const delta = dt * (this.shaderFrameRate / 100);
		if (delta > 0) {
			this.shaderTime += delta;
			this.updateTranslationPhases(delta);
			this.updateRotationPhases(delta);
		}

		return delta;
	}

	/**
	 * Whether to run the expensive multi-pass pipeline this frame.
	 */
	shouldRunFullShaderApply() {
		if (this.shaderApplyInterval <= 1) return true;
		this.shaderFrameCounter++;
		return this.shaderFrameCounter % this.shaderApplyInterval === 0;
	}

	/**
	 * Update shader time - call this in your animation loop
	 * @param {number} delta - Time delta (default: 0.01)
	 */
	updateTime(delta = 0.01) {
		this.shaderTime += delta;
		this.updateTranslationPhases(delta);
		this.updateRotationPhases(delta);
		return this;
	}

	/**
	 * Update translation phases to prevent position jumps when speed changes
	 * @param {number} delta - Time delta
	 */
	updateTranslationPhases(delta) {
		for (const effectName of this.getPhaseTrackedEffectNames()) {
			const effect = this.effectsConfig[effectName];
			if (!effect || !effect.enabled) continue;
			if (effect.translationEnabled !== undefined && effect.translationEnabled < 0.5) continue;
			this._ensurePhaseTracking(effectName);

			// Prefer per-axis speeds; fall back to legacy translationSpeed
			const legacy = effect.translationSpeed ?? 0;
			const speedX = effect.translationSpeedX !== undefined ? effect.translationSpeedX : legacy;
			const speedY = effect.translationSpeedY !== undefined ? effect.translationSpeedY : legacy;

			if (effect.translationPhaseX === undefined) effect.translationPhaseX = 0;
			if (effect.translationPhaseY === undefined) effect.translationPhaseY = 0;

			const timeMultiplier = effect.timeMultiplier || 0.1;
			const effectiveDelta = delta * timeMultiplier;

			effect.translationPhaseX += effectiveDelta * speedX;
			effect.translationPhaseY += effectiveDelta * speedY;

			this.lastTranslationSpeed[effectName] = {x: speedX, y: speedY};
		}
	}

	/**
	 * Update rotation phases to prevent angle jumps when speed changes
	 * @param {number} delta - Time delta
	 */
	updateRotationPhases(delta) {
		for (const effectName of this.getPhaseTrackedEffectNames()) {
			const effect = this.effectsConfig[effectName];
			if (!effect || !effect.enabled) continue;
			if (effect.rotationEnabled !== undefined && effect.rotationEnabled < 0.5) continue;
			this._ensurePhaseTracking(effectName);

			const currentSpeed = effect.rotationSpeed || 0;
			const currentOscillationSpeed = effect.rotationOscillationSpeed || 0;
			const lastSpeed = this.lastRotationSpeed[effectName];
			const lastOscillationSpeed = this.lastRotationOscillationSpeed[effectName];
			const rotMode = Math.floor(effect.rotationMode || 0);

			// Initialize phase if not set
			if (effect.rotationPhase === undefined) effect.rotationPhase = 0;

			// If speed changed, maintain current angle by adjusting phase
			if (lastSpeed !== null && lastSpeed !== currentSpeed && currentSpeed !== 0) {
				const currentTime = this.shaderTime * (effect.timeMultiplier || 0.1);
				const rotationNoiseScale = effect.rotationNoiseScale || 0.3;

				if (rotMode === 0) {
					// Cosine oscillation mode: maintain angle continuity
					// Calculate what the current angle was with old speed
					const oldOscillation = -Math.cos(currentTime * (lastOscillationSpeed || 0));
					const oldAngle = oldOscillation * lastSpeed;
					// Set phase to maintain the same angle (phase represents the angle directly for cosine mode)
					effect.rotationPhase = oldAngle;
				} else if (rotMode === 1 || rotMode === 2) {
					// Noise/FBM modes: maintain amplitude continuity
					// When speed changes, keep amplitude constant to prevent angle jump
					// Speed only affects phase accumulation rate, not amplitude
					// Initialize amplitude if not set (use current speed as starting point)
					if (effect.rotationAmplitude === undefined) {
						effect.rotationAmplitude = lastSpeed || currentSpeed;
					}
					// Keep amplitude constant - don't change it when speed changes
				}
			}

			// Update phase based on current speed
			const timeMultiplier = effect.timeMultiplier || 0.1;
			const effectiveDelta = delta * timeMultiplier;
			const currentTime = this.shaderTime * timeMultiplier;
			const rotationNoiseScale = effect.rotationNoiseScale || 0.3;

			if (rotMode === 0) {
				// Cosine oscillation mode: phase represents the angle directly
				// Calculate the derivative (rate of change) and integrate it
				const oscillation = -Math.cos(currentTime * currentOscillationSpeed);
				const angleDerivative = oscillation * currentSpeed;
				effect.rotationPhase += effectiveDelta * angleDerivative;
			} else {
				// Noise/FBM: accumulate phase based on speed
				// Phase accumulation rate controls how fast we move through noise space
				// rotationNoiseScale in the shader controls sampling frequency (lower = smoother)
				effect.rotationPhase += effectiveDelta * currentSpeed;

				// Initialize amplitude if not set, but don't change it when speed changes
				// This maintains angle continuity - speed only affects rotation speed, not amplitude
				if (effect.rotationAmplitude === undefined) {
					effect.rotationAmplitude = currentSpeed;
				}
				// Don't update amplitude - keep it constant to prevent angle jumps
			}

			this.lastRotationSpeed[effectName] = currentSpeed;
			this.lastRotationOscillationSpeed[effectName] = currentOscillationSpeed;
		}
	}

	/**
	 * Evaluate uniform value from string expression
	 * @param {string|*} value - Value or expression
	 * @param {object} effect - Effect configuration
	 * @returns {*} Evaluated value
	 */
	evaluateUniformValue(value, effect) {
		if (typeof value === "string") {
			// Handle special cases
			if (value === "[width, height]") {
				return [this.mainCanvas.width, this.mainCanvas.height];
			}

			if (value === "[gridCols, gridRows]") {
				return [effect.gridCols, effect.gridRows];
			}

			// Handle expressions like 'shaderSeed + 777.0'
			if (value.includes("+") || value.includes("-") || value.includes("*") || value.includes("/")) {
				try {
					// Create a safe evaluation context with available variables
					const evalContext = {
						shaderTime: this.shaderTime,
						shaderSeed: this.shaderSeed,
						width: this.mainCanvas.width,
						height: this.mainCanvas.height,
						...effect, // Include effect properties
					};

					// Replace variable names with their values
					let evalString = value;
					for (const [varName, varValue] of Object.entries(evalContext)) {
						if (typeof varValue === "number") {
							evalString = evalString.replace(new RegExp(`\\b${varName}\\b`, "g"), varValue);
						}
					}

					return eval(evalString);
				} catch (error) {
					console.warn(`Failed to evaluate uniform value "${value}":`, error);
					return 0;
				}
			}

			// Handle property references from the effect config
			if (value in effect) {
				return effect[value];
			}

			// Handle global variable references
			if (value === "shaderTime") return this.shaderTime;
			if (value === "shaderSeed") return this.shaderSeed;
			if (value === "width") return this.mainCanvas.width;
			if (value === "height") return this.mainCanvas.height;

			// Try to evaluate as a simple variable reference
			try {
				return eval(value);
			} catch (error) {
				console.warn(`Failed to evaluate uniform value "${value}":`, error);
				return 0;
			}
		}

		return value;
	}

	/**
	 * Apply shader effects to the main canvas
	 * Call this in your render loop
	 */
	apply() {
		if (!this.shaderManager || !this.mainCanvas) {
			console.warn("ShaderEffects not properly initialized");
			return this;
		}

		// Clear the shader canvas (use p5Instance for global clear)
		if (this.p5Instance && this.p5Instance.clear) {
			this.p5Instance.clear();
		}

		// Build effect passes dynamically (only rebuild if effects changed)
		const currentEnabledEffects = Object.keys(this.effectsConfig).filter((name) => this.effectsConfig[name].enabled);

		if (JSON.stringify(this.lastEnabledEffects) !== JSON.stringify(currentEnabledEffects)) {
			this.shaderPipeline.clearPasses();

			// Iterate through effectsConfig to build passes
			for (const effectName in this.effectsConfig) {
				const effect = this.effectsConfig[effectName];
				if (effect.enabled) {
					const passName = effect.pass || effectName;
					this.shaderPipeline.addPass(passName, () => {
						const uniforms = {};
						for (const uniformName in effect.uniforms) {
							const value = effect.uniforms[uniformName];
							uniforms[uniformName] = this.evaluateUniformValue(value, effect);
						}
						return uniforms;
					});
				}
			}

			this.lastEnabledEffects = [...currentEnabledEffects];
		}

		// Run pipeline from mainCanvas to the shader canvas
		this.shaderPipeline.run(this.mainCanvas);

		return this;
	}

	/**
	 * Apply copy shader (just display the main canvas without effects)
	 */
	applyCopy() {
		if (!this.shaderManager || !this.mainCanvas) {
			return this;
		}

		if (this.p5Instance && this.p5Instance.clear) {
			this.p5Instance.clear();
		}

		this.shaderManager.apply("copy", {uTexture: this.mainCanvas}, this.p5Instance).drawFullscreenQuad(this.p5Instance);

		return this;
	}

	/**
	 * Load additional shader dynamically
	 * @param {string} name - Shader name
	 * @param {string} fragPath - Fragment shader path
	 * @param {string} vertPath - Vertex shader path (optional)
	 */
	loadShader(name, fragPath, vertPath = null) {
		if (this.shaderManager) {
			this.shaderManager.loadShader(name, fragPath, vertPath);
			console.log(`Loaded shader: ${name}`);
		}
		return this;
	}

	/**
	 * Get list of loaded shader names
	 * @returns {string[]} Array of shader names
	 */
	getLoadedShaders() {
		if (this.shaderManager && this.shaderManager.shaders) {
			return Object.keys(this.shaderManager.shaders);
		}
		return [];
	}

	/**
	 * Mark particle animation as complete
	 */
	setParticleAnimationComplete(complete = true) {
		this.particleAnimationComplete = complete;
		return this;
	}

	/**
	 * Check if shaders should continue after completion
	 * @returns {boolean}
	 */
	shouldContinueAfterCompletion() {
		return this.continueShadersAfterCompletion;
	}

	/**
	 * Set whether shaders should continue after sketch completion
	 * @param {boolean} value - Continue or not
	 */
	setContinueAfterCompletion(value) {
		this.continueShadersAfterCompletion = value;
		return this;
	}

	/**
	 * Set whether to apply shaders during sketch rendering
	 * @param {boolean} value - Apply or not
	 */
	setApplyDuringSketch(value) {
		this.applyShadersDuringSketch = value;
		return this;
	}

	/**
	 * Check if shaders should be applied during sketch
	 * @returns {boolean}
	 */
	shouldApplyDuringSketch() {
		return this.applyShadersDuringSketch;
	}

	/**
	 * Get current shader frame rate
	 * @returns {number}
	 */
	getFrameRate() {
		return this.shaderFrameRate;
	}

	/**
	 * Update FPS counter (always samples; display is owned by debugPanel when present)
	 */
	updateFPS() {
		const now = performance.now();
		const delta = now - this.lastFrameTime;
		this.lastFrameTime = now;
		if (delta > 0) {
			this.currentFPS = Math.round(1000 / delta);
		}
	}

	drawFPS() {
		try {
			// Unified debug panel owns FPS display when present
			if (typeof debugPanel !== "undefined") {
				if (this.fpsElement) {
					this.fpsElement.classList.add("is-hidden");
					this.fpsElement.style.display = "none";
				}
				return;
			}

			if (!this.fpsElement) {
				this.fpsElement = document.getElementById("shader-fps-overlay");
				if (!this.fpsElement) {
					this.fpsElement = document.createElement("div");
					this.fpsElement.id = "shader-fps-overlay";
					document.body.appendChild(this.fpsElement);
				}
			}

			this.fpsElement.classList.toggle("is-hidden", !this.showFPS);
			if (!this.showFPS) return;

			this.fpsElement.textContent = `${this.currentFPS} fps`;
		} catch (error) {
			console.warn("FPS counter failed:", error);
		}
	}

	/**
	 * Toggle FPS display
	 * @param {boolean} show - Show or hide FPS
	 */
	toggleFPS(show = null) {
		if (show === null) {
			this.showFPS = !this.showFPS;
		} else {
			this.showFPS = show;
		}
		return this;
	}

	drawLoopCountdown() {
		try {
			// Unified debug panel owns loop countdown when present
			if (typeof debugPanel !== "undefined") {
				if (this.loopOverlayElement) {
					this.loopOverlayElement.classList.add("is-hidden");
					this.loopOverlayElement.style.display = "none";
				}
				return;
			}

			const show = this.loopConfig.enabled && this.loopConfig.showCountdown;
			if (!this.loopOverlayElement) {
				this.loopOverlayElement = document.getElementById("shader-loop-overlay");
				if (!this.loopOverlayElement) {
					this.loopOverlayElement = document.createElement("div");
					this.loopOverlayElement.id = "shader-loop-overlay";
					document.body.appendChild(this.loopOverlayElement);
				}
			}

			this.loopOverlayElement.classList.toggle("is-hidden", !show);
			if (!show) return;

			const countdown = this.getLoopCountdown();
			if (!countdown) return;

			const seconds = countdown.remaining.toFixed(1);
			this.loopOverlayElement.textContent = countdown.paused ? `loop pause ${seconds}s` : `loop ${seconds}s`;

			const warn = !countdown.paused && countdown.remaining <= this.loopConfig.warnAtSeconds;
			this.loopOverlayElement.classList.toggle("is-warning", warn);
		} catch (error) {
			console.warn("Loop countdown failed:", error);
		}
	}

	toggleLoopCountdown(show = null) {
		if (show === null) {
			this.loopConfig.showCountdown = !this.loopConfig.showCountdown;
		} else {
			this.loopConfig.showCountdown = Boolean(show);
		}
		return this;
	}

	/**
	 * Render frame - handles shader logic for each animation frame
	 * @param {boolean} isSketchComplete - Whether the sketch animation is complete
	 * @param {Function} continueCallback - Callback to continue animation loop
	 * @returns {boolean} Whether to continue the animation loop
	 */
	renderFrame(isSketchComplete, continueCallback) {
		// Update FPS counter
		this.updateFPS();
		this.advanceShaderClock();

		if (isSketchComplete) {
			// Always apply shaders at least once when sketch is complete
			if (!this.shouldApplyDuringSketch()) {
				this.apply();
			}

			if (this.shouldContinueAfterCompletion()) {
				// Keep shaders running even after particles are complete
				this.apply();

				// Draw FPS counter
				this.drawFPS();
				this.drawLoopCountdown();

				// Continue using requestAnimationFrame
				return true;
			} else {
				// Stop everything when sketch is complete
				console.log("Sketch complete - shaders stopped");
				return false;
			}
		}

		// Only apply shaders during sketching if enabled
		if (this.shouldApplyDuringSketch()) {
			if (this.shouldRunFullShaderApply()) {
				this.apply();
			}
			// Skipped frames: leave the last shader output on the WEBGL canvas
		} else {
			// If not applying shaders during sketching, use copy shader to display base sketch
			this.applyCopy();
		}

		// Draw FPS counter
		this.drawFPS();
		this.drawLoopCountdown();

		return true; // Continue animation
	}
}

// Create a global instance for easy access
const shaderEffects = new ShaderEffects();
