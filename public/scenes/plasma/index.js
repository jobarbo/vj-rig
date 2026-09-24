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
		// uSpeed replaces Shadertoy's iTime
		{name: "speed", label: "Speed", min: 0, max: 4, value: 1, step: 0.01},
		// uScale multiplies the line density (Shadertoy used 10)
		{name: "scale", label: "Scale", min: 0.25, max: 4, value: 1, step: 0.01},
	],
};
