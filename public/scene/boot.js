// boot.js — the single module entry point for the scene system.
//
// The rig stays classic-script global scope (p5, the library, shaderEffects).
// Only the scene system is ES modules, dynamically imported from setup(), so
// no <script> tags change and the FX stack is never rewritten as ESM.

import {SceneHost, registerRuntime} from "./sceneHost.js";
import {SCENES} from "../scenes/manifest.js";
import {createGlslScene} from "./runtime/glslScene.js";
import {createMediaScene} from "./runtime/mediaScene.js";
import "./sceneParams.js"; // side effect: window.sceneParams
import {scenePanel} from "./scenePanel.js";
import {sceneMidi} from "./sceneMidi.js";

registerRuntime("glsl", createGlslScene);
registerRuntime("image", createMediaScene);
registerRuntime("video", createMediaScene);
registerRuntime("camera", createMediaScene);

/**
 * Build the host, expose it as `window.sceneHost`, and activate the first
 * scene. Resolves once something is on screen (or after a failed load — it
 * never rejects, so a broken scene can't stop the rig from booting).
 */
export async function bootScenes({width, height, pixelDensity = 1, initial} = {}) {
	const host = new SceneHost({
		manifest: SCENES,
		hostSize: {width, height},
		pixelDensity,
	});

	window.sceneHost = host;

	const startId = initial || SCENES[0]?.id;
	if (startId) {
		const ok = await host.switchTo(startId);
		if (!ok) console.warn(`[boot] initial scene "${startId}" failed to load`);
	} else {
		console.warn("[boot] manifest is empty — nothing to show");
	}

	scenePanel.init();
	sceneMidi.init(); // async; scene switching/params work before it resolves

	console.log(`[boot] scene system ready — ${SCENES.length} scene(s), active: ${host.currentId}`);
	return host;
}
