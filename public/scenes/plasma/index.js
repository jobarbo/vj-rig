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
		{name: "speed", label: "Speed", min: 0, max: 4, value: 1, step: 0.01},
		{name: "timeDiv", label: "Time div", min: 0.1, max: 12, value: 3, step: 0.01},
		{name: "scale", label: "Scale", min: 0.25, max: 20, value: 2, step: 0.01},
		{name: "zoom", label: "Zoom", min: 0.1, max: 8, value: 2.5, step: 0.01},
		{name: "thickness", label: "Thickness", min: 0, max: 1, value: 0.1, step: 0.001},
		{name: "frequency", label: "Frequency", min: 0.1, max: 20, value: 3.1415, step: 0.01},
		{name: "edge", label: "Edge", min: 0, max: 80, value: 30, step: 0.1},
		{name: "softness", label: "Softness", min: 0, max: 80, value: 28.15, step: 0.01},
		{name: "spread", label: "Spread", min: 0, max: 80, value: 38.15, step: 0.01},
		{name: "bend", label: "Bend", min: 0, max: 8, value: 2, step: 0.01},
		{name: "gain", label: "Gain", min: 0, max: 80, value: 30, step: 0.1},
	],
};
