// p5Scene.js — instance-mode p5 wrapper.
//
// Everything an author could get wrong about readiness, pixel density and the
// render loop is handled here, once. Authors only write setup(ctx)/draw(ctx).
//
// Verified p5 2.3.0 mechanics this depends on:
//   - `new p5(fn, node)` in instance mode never writes to window (the global
//     property-copy loop is in the else branch).
//   - redraw() is `async` and early-returns while `!this._setupDone`, so a
//     scene rendered before that point is silently black.
//   - createCanvas returns a promise when the renderer exposes contextReady
//     (WEBGL). Awaiting it is required there and harmless in 2D.
//   - New instances default to Math.ceil(devicePixelRatio) density — NOT 1,
//     NOT inherited from the host. On retina every scene would silently render
//     at 4x the pixels.

const READY_TIMEOUT_MS = 4000;

async function waitFor(predicate, ms = READY_TIMEOUT_MS, label = "readiness") {
	const t0 = performance.now();
	while (!predicate()) {
		if (performance.now() - t0 > ms) throw new Error(`[p5Scene] ${label} timeout after ${ms}ms`);
		await new Promise((r) => requestAnimationFrame(r));
	}
}

export async function createP5Scene(mod, {node, width, height, ctx, pixelDensity = 1}) {
	const meta = mod.meta || {};
	const P5 = window.p5;
	if (typeof P5 !== "function") throw new Error("[p5Scene] p5 global not found");

	let p = null;
	let resolveReady;
	let rejectReady;
	const authorReady = new Promise((res, rej) => {
		resolveReady = res;
		rejectReady = rej;
	});

	new P5((inst) => {
		p = inst;

		inst.setup = async () => {
			try {
				await inst.createCanvas(width, height, meta.renderer === "WEBGL" ? inst.WEBGL : inst.P2D);
				inst.pixelDensity(pixelDensity); // must come AFTER createCanvas, which resets it
				inst.noLoop(); // the master draw() drives this instance via redraw()

				ctx.p = inst;
				ctx.width = inst.width;
				ctx.height = inst.height;

				if (typeof mod.setup === "function") await mod.setup(ctx);
				resolveReady();
			} catch (err) {
				rejectReady(err);
			}
		};

		// Stub: p5 may run one automatic frame before noLoop() takes effect.
		inst.draw = () => {};
	}, node);

	// Author errors surface here, at load time, instead of mid-frame.
	await authorReady;
	await waitFor(() => p._setupDone === true, READY_TIMEOUT_MS, "_setupDone");

	// Only wire the real draw once the instance can actually render.
	p.draw = () => {
		mod.draw?.(ctx);
	};

	return {
		kind: "p5",
		meta,
		get surface() {
			return p?._renderer?.canvas || p?.canvas || null;
		},
		fit: meta.fit || "cover",
		smooth: meta.smooth !== false,

		async render() {
			if (p?._setupDone) await p.redraw();
		},

		resize(w, h) {
			if (!p) return;
			// 3rd arg = noRedraw. Without it resizeCanvas fires a stray redraw() and
			// the author's draw() runs outside the master frame with a stale dt.
			p.resizeCanvas(w, h, true);
			ctx.width = p.width;
			ctx.height = p.height;
			mod.resize?.(ctx);
		},

		dispose() {
			try {
				mod.dispose?.(ctx);
			} catch (err) {
				console.warn(`[p5Scene] dispose hook failed for "${ctx.id}":`, err);
			} finally {
				// Releases the WebGL context. Browsers cap these at ~16.
				p?.remove();
				p = null;
			}
		},
	};
}
