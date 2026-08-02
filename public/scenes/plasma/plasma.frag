// GLSL ES 1.00 — same dialect as library/shaders/, so fragments are
// copy-pasteable in both directions. No #version directive.
precision highp float;

varying vec2 vTexCoord;

uniform vec2 uResolution;
uniform float uTime;
uniform vec4 uAudio; // bass, mid, treble, energy
uniform float uBeat;

// One uniform per declared param: name -> "u" + PascalCase.
// setUniform on an undeclared uniform is a silent no-op, so a .frag may use
// fewer than the scene declares.
uniform float uSpeed;
uniform float uScale;
uniform float uWarp;

void main() {
	vec2 uv = (vTexCoord - 0.5) * uScale;
	uv.x *= uResolution.x / max(uResolution.y, 1.0);

	float t = uTime * uSpeed;
	float warp = uWarp * (0.35 + uAudio.x * 2.0);

	uv += warp * vec2(sin(uv.y * 3.0 + t), cos(uv.x * 3.0 - t));

	float v = sin(uv.x + t) + sin(uv.y * 1.3 - t * 0.7) + sin((uv.x + uv.y) * 0.7 + t * 0.4) + sin(length(uv) * 2.0 - t * 1.1);
	v *= 0.25;

	vec3 col = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + v + t * 0.05));
	col *= 0.55 + 0.45 * uAudio.w;
	col += uBeat * 0.12;

	gl_FragColor = vec4(col, 1.0);
}
