// mediaScene.js — image, video and camera scenes.
//
// None of these use a p5 instance. The surface is the <img>/<video> element
// itself, which the compositor's drawingContext.drawImage already accepts
// uniformly alongside canvases (verified: p5's own image() throws on a raw
// canvas because it does `u || (u = e.canvas || e.elt)`, but drawImage has no
// such requirement).

const READY_TIMEOUT_MS = 8000;
const CAMERA_DEVICE_KEY = "scene:cameraDeviceId";

function withTimeout(promise, ms, label) {
	return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`[mediaScene] ${label} timeout after ${ms}ms`)), ms))]);
}

async function createImageSurface(ctx, meta) {
	const img = new Image();
	img.decoding = "async";
	const ready = new Promise((resolve, reject) => {
		img.onload = () => resolve();
		img.onerror = () => reject(new Error(`failed to load image "${meta.src}"`));
	});
	img.src = ctx.asset(meta.src);
	await withTimeout(ready, READY_TIMEOUT_MS, "image load");
	return img;
}

async function createVideoSurface(ctx, meta) {
	const video = document.createElement("video");
	video.muted = meta.muted !== false;
	video.loop = meta.loop !== false;
	video.playsInline = true;
	video.autoplay = true;
	video.preload = "auto";

	const ready = new Promise((resolve, reject) => {
		video.addEventListener("loadeddata", () => resolve(), {once: true});
		video.addEventListener("error", () => reject(new Error(`failed to load video "${meta.src}"`)), {once: true});
	});
	video.src = ctx.asset(meta.src);
	await withTimeout(ready, READY_TIMEOUT_MS, "video load");
	try {
		await video.play();
	} catch (err) {
		console.warn(`[mediaScene] video autoplay blocked for "${ctx.id}":`, err);
	}
	return video;
}

/** Chosen camera device, set by the panel's device picker. */
export function getCameraDevicePreference() {
	return localStorage.getItem(CAMERA_DEVICE_KEY) || null;
}

export function setCameraDevicePreference(deviceId) {
	if (deviceId) localStorage.setItem(CAMERA_DEVICE_KEY, deviceId);
	else localStorage.removeItem(CAMERA_DEVICE_KEY);
}

async function createCameraSurface(ctx) {
	// getUserMedia requires a secure context: localhost is fine, a bare LAN IP
	// (http://<ip>:3301) is not. Throwing here — rather than at draw time — lets
	// switchTo's existing try/catch report it and keep the previous scene up.
	if (!window.isSecureContext) {
		throw new Error("camera scenes require a secure context (localhost or https)");
	}

	const deviceId = getCameraDevicePreference();
	const stream = await navigator.mediaDevices.getUserMedia({
		video: deviceId ? {deviceId: {exact: deviceId}} : true,
		audio: false,
	});

	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.autoplay = true;
	video.srcObject = stream;

	const ready = new Promise((resolve, reject) => {
		video.addEventListener("loadeddata", () => resolve(), {once: true});
		video.addEventListener("error", () => reject(new Error("camera stream failed")), {once: true});
	});
	await withTimeout(ready, READY_TIMEOUT_MS, "camera stream");
	try {
		await video.play();
	} catch (err) {
		console.warn(`[mediaScene] camera autoplay blocked for "${ctx.id}":`, err);
	}
	video._stream = stream;
	return video;
}

export async function createMediaScene(mod, {node, ctx}) {
	const meta = mod.meta || {};
	let el;

	if (meta.kind === "image") el = await createImageSurface(ctx, meta);
	else if (meta.kind === "video") el = await createVideoSurface(ctx, meta);
	else if (meta.kind === "camera") el = await createCameraSurface(ctx);
	else throw new Error(`[mediaScene] unknown media kind "${meta.kind}"`);

	node.appendChild(el);
	if (typeof mod.setup === "function") await mod.setup(ctx);

	return {
		kind: meta.kind,
		meta,
		get surface() {
			return el;
		},
		fit: meta.fit || "cover",
		smooth: meta.smooth !== false,
		mirror: !!meta.mirror,

		async render() {
			mod.draw?.(ctx);
		},

		// Media surfaces don't resize themselves — the compositor's fitRect
		// already re-fits any source size into the current output each frame.
		resize() {},

		dispose() {
			try {
				mod.dispose?.(ctx);
			} catch (err) {
				console.warn(`[mediaScene] dispose hook failed for "${ctx.id}":`, err);
			}
			if (el.tagName === "VIDEO") {
				el.pause();
				const stream = el._stream || el.srcObject;
				if (stream?.getTracks) for (const track of stream.getTracks()) track.stop();
				el.srcObject = null;
				el.removeAttribute("src");
				el.load();
			}
			el.remove();
		},
	};
}
