// _spike — Phase 0 architecture probe. Not a real scene; safe to delete once
// the scene system is trusted.
//
// It exists to prove, in one vertical slice: async draw() awaited by the host,
// instance-mode p5 driven by redraw(), drawImage into mainCanvas, the CSS
// containment override, and freeze-immunity when a scene throws.

export const meta = {
	name: "Spike (dev)",
	kind: "p5",
	renderer: "P2D",
	size: "host",
	fit: "cover",
	smooth: true,
};

// Flip to true in the console (`sceneHost.current.ctx.boom = true`) to run the
// pitfall-1 regression test: the rig must keep running at 60fps.
export function setup(ctx) {
	const p = ctx.p;
	p.colorMode(p.HSB, 360, 100, 100, 100);
	p.noStroke();
	ctx.boom = false;
}

export function draw(ctx) {
	if (ctx.boom) throw new Error("[_spike] deliberate failure");

	const {p, time} = ctx;
	const cols = 24;
	const cw = p.width / cols;
	const ch = p.height / cols;

	p.background(280, 60, 8);
	for (let y = 0; y < cols; y++) {
		for (let x = 0; x < cols; x++) {
			const d = Math.sin(x * 0.4 + time * 1.2) + Math.cos(y * 0.4 - time * 0.9);
			const hue = (200 + d * 60 + time * 20) % 360;
			p.fill(hue, 70, 40 + d * 25);
			p.rect(x * cw, y * ch, cw + 1, ch + 1);
		}
	}

	p.fill(0, 0, 100);
	p.rect(p.width / 2 - 60, p.height / 2 + Math.sin(time * 2) * 200 - 6, 120, 12);
}
