// flux — three luminous ribbons over a domain-warped fbm field.
//
// Port of a Shadertoy written for a 240×20 LED ceiling. The LED quantisation is
// kept behind the `pixelate` toggle (off by default: the rig's output is a
// regular screen); turn it on and set ledColumns/ledRows to match the matrix.

export const meta = {
	name: "Flux",
	kind: "glsl",
	frag: "flux.frag",
	size: [960, 540],
	fit: "cover",
	smooth: true,
	flipY: false,
	params: [
		{name: "speed", label: "Speed", min: 0, max: 2, value: 0.24, step: 0.001},
		{name: "brightness", label: "Brightness", min: 0, max: 3, value: 0.85, step: 0.01},
		{name: "saturation", label: "Saturation", min: 0, max: 2, value: 1, step: 0.01},
		{name: "warp", label: "Warp", min: 0, max: 1.5, value: 0.3, step: 0.001},
		{name: "ribbonWidth", label: "Ribbon width", min: 0.2, max: 4, value: 1, step: 0.01},
		{name: "atmosphere", label: "Atmosphere", min: 0, max: 1, value: 0.075, step: 0.001},
		{name: "beatAmt", label: "Beat pulse", min: 0, max: 2, value: 0, step: 0.01},
		{name: "ratio", label: "X ratio", min: 0.25, max: 4, value: 4 / 3.8, step: 0.001},
		{name: "pixelate", label: "LED grid", min: 0, max: 1, value: 0, integer: true},
		{name: "ledColumns", label: "LED columns", min: 1, max: 480, value: 240, integer: true},
		{name: "ledRows", label: "LED rows", min: 1, max: 270, value: 20, integer: true},
	],
};
