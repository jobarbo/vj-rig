// GLSL ES 1.00 — same dialect as library/shaders/. No #version directive.
// Port of a Shadertoy "flux" ribbon shader made for a 240×20 LED ceiling:
// iTime → uTime, iResolution → uResolution, #define controls → params.
precision highp float;

varying vec2 vTexCoord;

uniform vec2 uResolution;
uniform float uTime;
uniform float uBeat;

uniform float uSpeed;
uniform float uBrightness;
uniform float uSaturation;
uniform float uWarp;
uniform float uRibbonWidth;
uniform float uAtmosphere;
uniform float uBeatAmt;
uniform float uRatio;
uniform float uPixelate;
uniform float uLedColumns;
uniform float uLedRows;

#define PI 3.14159265359

float hash21(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);

	float a = hash21(i);
	float b = hash21(i + vec2(1.0, 0.0));
	float c = hash21(i + vec2(0.0, 1.0));
	float d = hash21(i + vec2(1.0, 1.0));

	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
	float value = 0.0;
	float amplitude = 0.5;
	for (int i = 0; i < 4; i++) {
		value += amplitude * noise(p);
		p = p * 2.02 + vec2(13.1, 7.7);
		amplitude *= 0.5;
	}
	return value;
}

vec3 palette(float t) {
	vec3 a = vec3(0.48, 0.43, 0.53);
	vec3 b = vec3(0.45, 0.40, 0.44);
	vec3 c = vec3(1.0, 1.0, 1.0);
	vec3 d = vec3(0.55, 0.22, 0.05);
	return a + b * cos(2.0 * PI * (c * t + d));
}

vec3 renderFlux(vec2 uv, float t, float beat) {
	vec2 warp = vec2(
		fbm(uv * 2.0 + vec2(t * 0.3, -t * 0.2)),
		fbm(uv * 2.0 + vec2(-t * 0.2, t * 0.25) + 8.0)
	);

	vec2 p = uv + (warp - 0.5) * uWarp;

	vec3 color = vec3(0.0);

	// Three independent flowing ribbons
	for (int i = 0; i < 3; i++) {
		float fi = float(i);
		float phase = fi * 2.1;

		float center = 0.5
			+ 0.22 * sin(p.x * 3.5 + t * 0.8 + phase)
			+ 0.10 * sin(p.x * 8.0 - t * 0.5 + phase);

		float dist = abs(p.y - center);

		float width = 0.07 + 0.035 * sin(p.x * 4.0 + t + phase);
		width = max(width, 0.02) * uRibbonWidth;

		// Smooth luminous body + narrow brighter core
		float glow = exp(-dist * dist / (width * width * 1.5));
		float core = exp(-dist * dist / (width * width * 0.135));

		// Traveling intensity variations
		float pulse = 2.65 + 0.35 * sin(p.x * 12.0 - t * 1.5 + phase);

		float grain = fbm(p * vec2(5.0, 3.0) + vec2(-t * 0.35, t * 0.1) + phase);

		float intensity = (glow * 0.40 + core * 0.65) * pulse * (0.65 + grain * 0.7);

		vec3 ribbonColor = palette(p.x * 0.25 + fi * 0.19 + t * 0.045);

		color += ribbonColor * intensity;
	}

	// Subtle background atmosphere
	float atmosphere = fbm(p * 2.5 + vec2(t * 0.12, 0.0));
	color += palette(t * 0.025 + p.x * 0.15) * pow(atmosphere, 3.0) * uAtmosphere;

	color *= uBrightness * (1.0 + beat);

	// Soft tone mapping
	color = 1.0 - exp(-color * 1.4);

	float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
	return mix(vec3(luma), color, uSaturation);
}

void main() {
	// Shadertoy's fragCoord convention: 0..1, origin bottom-left.
	vec2 uv = vec2(vTexCoord.x, 1.0 - vTexCoord.y);

	// Optional LED-matrix quantisation (original target: 240×20 ceiling).
	if (uPixelate > 0.5) {
		vec2 grid = max(vec2(uLedColumns, uLedRows), vec2(1.0));
		uv = (floor(uv * grid) + 0.5) / grid;
	}

	// Ratio correction around the centre
	uv.x = (uv.x - 0.5) * uRatio + 0.5;

	vec3 color = renderFlux(uv, uTime * uSpeed, uBeat * uBeatAmt);

	gl_FragColor = vec4(color, 1.0);
}
