// stage.js — the hidden DOM host for scene surfaces.
//
// Every scene renders into its own element (canvas / video / img) parked here,
// off-screen. The compositor is the only thing that ever reads those pixels.
//
// This must NOT be display:none — a hidden <video> stops decoding frames.
// See the #scene-stage rules in style.css for the sizing override that defeats
// the global `canvas.p5Canvas { width:100vw !important }` rule.

const STAGE_ID = "scene-stage";

export function getStage() {
	let el = document.getElementById(STAGE_ID);
	if (!el) {
		el = document.createElement("div");
		el.id = STAGE_ID;
		document.body.appendChild(el);
	}
	return el;
}

/** A per-scene sub-container, so disposing a scene is one node removal. */
export function createSlot(id) {
	const node = document.createElement("div");
	node.className = "scene-slot";
	node.dataset.sceneId = id;
	getStage().appendChild(node);
	return node;
}

export function removeSlot(node) {
	try {
		node?.remove();
	} catch (err) {
		console.warn("[stage] slot removal failed:", err);
	}
}
