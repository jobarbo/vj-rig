// glslScene.js — a fragment shader as a scene.
//
// The scene gets its OWN WEBGL p5 instance and its OWN p5.Shader, because a
// p5.Shader throws when used on a second context ("attached to a different
// context. Do you need to copy it to this context first with .copyToContext()")
// and the global shaderManager's shaders are bound to the display canvas.
//
// Reading the surface back is race-free: preserveDrawingBuffer defaults to true
// in p5 and _glAttributes is per-instance, so drawImage can happen at any point
// in the frame.
//
// This is content GLSL, not the host FX stack. The result still flows through
// the full 19-shader post chain like any other scene.
//
// Dialect is GLSL ES 1.00 (attribute / varying / gl_FragColor / texture2D) to
// match library/shaders/, so shaders are copy-pasteable in both directions.

const READY_TIMEOUT_MS = 4000;
const DEFAULT_VERT = "/scene/passthrough.vert";

async function waitFor(predicate, ms = READY_TIMEOUT_MS, label = "readiness") {
	const t0 = performance.now();
	while (!predicate()) {
		if (performance.now() - t0 > ms) throw new Error(`[glslScene] ${label} timeout after ${ms}ms`);
		await new Promise((r) => requestAnimationFrame(r));
	}
}

async function loadText(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`failed to load ${url} (${res.status})`);
	return res.text();
}

/** speed -> uSpeed, warpAmount -> uWarpAmount */
function uniformName(param) {
	return "u" + param.charAt(0).toUpperCase() + param.slice(1);
}

export async function createGlslScene(mod, {node, width, height, ctx, pixelDensity = 1}) {
	const meta = mod.meta || {};
	const P5 = window.p5;
	if (typeof P5 !== "function") throw new Error("[glslScene] p5 global not found");
	if (!meta.frag) throw new Error(`[glslScene] scene "${ctx.id}" has no meta.frag`);

	const [vertSrc, fragSrc] = await Promise.all([loadText(meta.vert ? ctx.asset(meta.vert) : DEFAULT_VERT), loadText(ctx.asset(meta.frag))]);

	let p = null;
	let shader = null;
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
				await inst.createCanvas(width, height, inst.WEBGL);
				inst.pixelDensity(pixelDensity);
				inst.noLoop();

				// Own instance => own GL context => own shader. Never reuse shaderManager's.
				shader = inst.createShader(vertSrc, fragSrc);

				ctx.p = inst;
				ctx.width = inst.width;
				ctx.height = inst.height;

				if (typeof mod.setup === "function") await mod.setup(ctx);
				resolveReady();
			} catch (err) {
				rejectReady(err);
			}
		};

		inst.draw = () => {};
	}, node);

	await authorReady;
	await waitFor(() => p._setupDone === true, READY_TIMEOUT_MS, "_setupDone");

	p.draw = () => {
		p.clear();
		p.shader(shader);

		shader.setUniform("uResolution", [p.width, p.height]);
		shader.setUniform("uTime", ctx.time);
		shader.setUniform("uFrame", ctx.frame);
		shader.setUniform("uAudio", [ctx.audio.bass, ctx.audio.mid, ctx.audio.treble, ctx.audio.energy]);
		shader.setUniform("uBeat", ctx.audio.beatPulse);

		// setUniform on an undeclared uniform is a silent no-op, so declaring
		// fewer uniforms in the .frag than params is safe.
		for (const key of Object.keys(ctx.params)) {
			const v = ctx.params[key];
			shader.setUniform(uniformName(key), typeof v === "boolean" ? (v ? 1 : 0) : v);
		}
		const extra = meta.uniforms?.(ctx);
		if (extra) for (const k of Object.keys(extra)) shader.setUniform(k, extra[k]);

		if (typeof mod.draw === "function") mod.draw(ctx, shader);

		// Clip-space fullscreen quad, mirroring shaderManager.drawFullscreenQuad.
		// passthrough.vert has no MVP matrix, hence resetMatrix() + -1..1 vertices.
		const [top, bottom] = meta.flipY ? [1, 0] : [0, 1];
		p.push();
		p.noStroke();
		p.resetMatrix();
		p.beginShape();
		p.vertex(-1, 1, 0, 0, top);
		p.vertex(1, 1, 0, 1, top);
		p.vertex(1, -1, 0, 1, bottom);
		p.vertex(-1, -1, 0, 0, bottom);
		p.endShape(p.CLOSE);
		p.pop();
	};

	return {
		kind: "glsl",
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
			p.resizeCanvas(w, h, true);
			ctx.width = p.width;
			ctx.height = p.height;
			mod.resize?.(ctx);
		},

		dispose() {
			try {
				mod.dispose?.(ctx);
			} catch (err) {
				console.warn(`[glslScene] dispose hook failed for "${ctx.id}":`, err);
			} finally {
				shader = null;
				p?.remove(); // releases the WebGL context (browsers cap at ~16)
				p = null;
			}
		},
	};
}
