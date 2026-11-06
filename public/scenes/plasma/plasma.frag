// GLSL ES 1.00 — same dialect as library/shaders/. No #version directive.
// Port of a Shadertoy line field: iResolution → uResolution, iTime → uTime,
// fragCoord rebuilt from vTexCoord, gl_FragColor instead of an out parameter.
precision highp float;

varying vec2 vTexCoord;

uniform vec2 uResolution;
uniform float uTime;

// One uniform per declared param: name -> "u" + PascalCase.
// uTime and uResolution stay driven by the scene runtime.
uniform float uSpeed;
uniform float uTimeDiv;
uniform float uScale;
uniform float uZoom;
uniform float uThickness;
uniform float uFrequency;
uniform float uEdge;
uniform float uSoftness;
uniform float uSpread;
uniform float uBend;
uniform float uGain;

float hash(float n) {
	return fract(sin(n) * 43758.5453);
}

float noise(vec2 x) {
	vec2 p = floor(x);
	vec2 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	float n = p.x + p.y * 57.0;
	return mix(mix(hash(n + 0.0), hash(n + 1.0), f.x), mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y);
}

mat2 rotate2d(float angle) {
	return mat2(cos(angle), -cos(angle), sin(angle), cos(angle));
}

float lines(vec2 pos, float b) {
	pos *= uScale;
	return smoothstep(uEdge, uSoftness + b * uSpread, abs((sin(pos.x * uFrequency) + b * uBend) * uGain));
}

void main() {
	// Shadertoy's fragCoord is pixels, origin bottom-left.
	vec2 fragCoord = vec2(vTexCoord.x, 1.0 - vTexCoord.y) * uResolution;

	vec2 uv = fragCoord / uResolution.xy;
	uv.y *= uResolution.y / uResolution.x;

	vec2 pos = uv * vec2(uZoom);
	pos = rotate2d(noise(pos + uTime * uSpeed / max(uTimeDiv, 0.0001))) * pos;
	float pattern = lines(pos, uThickness);

	gl_FragColor = vec4(vec3(pattern), 1.0);
}
