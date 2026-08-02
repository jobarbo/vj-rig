// compositor.js — blits scene surfaces into mainCanvas.
//
// This is the ONLY point of contact between the scene system and the rig.
// Whatever lands in mainCanvas gets the whole 19-shader post chain for free.
//
// Two slots exist from day one so an A/B crossfade is later just a matter of
// tweening `mix` — no structural change.

/**
 * Letterbox math. Returns the destination rect for a sw x sh source drawn into
 * a dw x dh target.
 */
export function fitRect(sw, sh, dw, dh, mode = "cover") {
	if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0)) return {x: 0, y: 0, w: 0, h: 0};
	if (mode === "stretch") return {x: 0, y: 0, w: dw, h: dh};
	const s = mode === "contain" ? Math.min(dw / sw, dh / sh) : Math.max(dw / sw, dh / sh);
	const w = sw * s;
	const h = sh * s;
	return {x: (dw - w) / 2, y: (dh - h) / 2, w, h};
}

/** Intrinsic size of any drawImage-able element, or null if it isn't ready yet. */
export function surfaceSize(el) {
	if (!el) return null;
	const w = el.videoWidth || el.naturalWidth || el.width || 0;
	const h = el.videoHeight || el.naturalHeight || el.height || 0;
	return w > 0 && h > 0 ? {w, h} : null;
}

export class Compositor {
	constructor() {
		// {surface, fit, smooth, alpha, blend, mirror, _errors}
		this.slots = [null, null];
		this.mix = 0; // 0 = A only, 1 = B only
	}

	setSlot(i, entry) {
		this.slots[i] = entry;
		return this;
	}

	clearSlot(i) {
		this.slots[i] = null;
		return this;
	}

	/**
	 * Draw every slot into `target` (a p5.Graphics 2D).
	 *
	 * TOTAL FUNCTION — never throws. p5's redraw() awaits draw(), and the next
	 * requestAnimationFrame is scheduled AFTER that await, so a rejection here
	 * would never re-arm the rAF chain and the rig would freeze permanently.
	 */
	render(target) {
		const g = target?.drawingContext;
		if (!g) return;

		const dw = target.width;
		const dh = target.height;
		const density = typeof target.pixelDensity === "function" ? target.pixelDensity() : 1;
		const mixAlpha = [1 - this.mix, this.mix];

		for (let i = 0; i < this.slots.length; i++) {
			const slot = this.slots[i];
			if (!slot || !slot.surface) continue;

			const alpha = mixAlpha[i] * (slot.alpha ?? 1);
			if (alpha <= 0.001) continue;

			try {
				g.save();

				const el = slot.surface;
				// A <video> below HAVE_CURRENT_DATA draws nothing, silently.
				if (el.tagName === "VIDEO" && el.readyState < 2) continue;

				const size = surfaceSize(el);
				if (!size) continue;

				const r = fitRect(size.w, size.h, dw, dh, slot.fit || "cover");
				if (!(r.w > 0 && r.h > 0)) continue;

				// configureArtworkCanvas() applies translate(w/2,h/2) -> scale(SX,SY) ->
				// translate(-w/2,-h/2) once at setup and never resets it. SX/SY are 1.0
				// today, but a non-identity value would silently offset every drawImage.
				// Pin the CTM to the buffer's device basis so fitRect is the ONLY thing
				// positioning a scene. restore() hands the host CTM back untouched.
				g.setTransform(density, 0, 0, density, 0, 0);

				g.globalAlpha = alpha;
				g.globalCompositeOperation = slot.blend || "source-over";
				// mainCanvas runs with imageSmoothingEnabled=false (nearest neighbour),
				// which destroys scaled video/camera. Opt in per slot; it is part of
				// the save/restore pair so the host default is preserved.
				g.imageSmoothingEnabled = slot.smooth !== false;

				if (slot.mirror) {
					g.translate(dw, 0);
					g.scale(-1, 1);
				}

				g.drawImage(el, r.x, r.y, r.w, r.h);
			} catch (err) {
				slot._errors = (slot._errors || 0) + 1;
				if (slot._errors === 1 || slot._errors % 300 === 0) {
					console.warn(`[compositor] slot ${i} draw failed (${slot._errors}x):`, err);
				}
			} finally {
				try {
					g.restore();
				} catch (_) {
					/* context is gone; nothing useful to do */
				}
			}
		}
	}
}
