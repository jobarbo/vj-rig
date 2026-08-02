// orbit — the rig's original artwork, ported to a scene.
//
// This is the reference example for porting an existing p5 project: the drawing
// code moved into sibling modules untouched, and only the plumbing (canvas
// creation, palette setup, frame counting) moved into setup/draw hooks.

import {Mover} from "./mover.js";
import {loadHslPalette} from "./palette.js";

export const meta = {
	name: "Orbit",
	kind: "p5",
	renderer: "P2D",
	size: "host",
	fit: "cover",
	smooth: false, // nearest-neighbour, matching the rig's original look
};

function buildMovers(p, palette) {
	const cx = p.width / 2;
	const cy = p.height / 2;
	const rectSize = Math.min(p.width, p.height) * 0.425;
	return [new Mover(cx, cy, rectSize, palette)];
}

export function setup(ctx) {
	const p = ctx.p;
	p.colorMode(p.HSB, 360, 100, 100, 100);
	ctx.palette = loadHslPalette("hex_palette");
	ctx.movers = buildMovers(p, ctx.palette);
}

export function draw(ctx) {
	const p = ctx.p;
	p.background(330, 100, 0, 100);

	for (const mover of ctx.movers) {
		mover.show(p);
		mover.move(ctx.frame);
	}
}

export function resize(ctx) {
	// The host used to capture cx/cy once at setup and never re-run, so the
	// artwork drifted off-centre after every output resize. Rebuilding here
	// fixes that for free.
	ctx.movers = buildMovers(ctx.p, ctx.palette);
}
