// plasma — the reference GLSL scene.
//
// A GLSL scene is usually just a meta block plus a .frag. The fragment shader
// runs on the scene's own WEBGL p5 instance and its output flows through the
// rig's post chain like any other scene. This is content GLSL, distinct from
// the host FX stack.

export const meta = {
	name: "Plasma",
	kind: "glsl",
	frag: "plasma.frag",
	// vert defaults to /scene/passthrough.vert
	size: [512, 512], // fixed resolution: a quarter of the fragments of a 1024² canvas
	fit: "cover",
	smooth: true,
	flipY: false,
	params: [
		{name: "speed", label: "Speed", min: 0, max: 4, value: 1},
		{name: "scale", label: "Scale", min: 1, max: 40, value: 8},
		{name: "warp", label: "Warp", min: 0, max: 2, value: 0.4},
	],
};
