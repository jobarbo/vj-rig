// GLSL ES 1.00 — same dialect as library/shaders/. No #version directive.
// Port of a Shadertoy plasma: iResolution → uResolution, iTime → uTime,
// fragCoord rebuilt from vTexCoord, gl_FragColor instead of an out parameter.
precision highp float;

varying vec2 vTexCoord;

uniform vec2 uResolution;
uniform float uTime;

// One uniform per declared param: name -> "u" + PascalCase.
uniform float uSpeed;
uniform float uScale;
uniform float uWarp;

float channel(vec2 fragCoord, float z) {
	vec2 p = fragCoord / uResolution;
	vec2 uv = p;
	p -= 0.5;
	p.x *= uResolution.x / uResolution.y;
	float l = length(p);
	uv += (p / l) * (sin(z) + 1.0) * abs(sin(l * uScale - z - z)) * uWarp;
	return 0.01 / length(mod(uv, 1.0) - 0.5);
}

void main() {
	// Shadertoy's fragCoord is pixels, origin bottom-left.
	vec2 fragCoord = vec2(vTexCoord.x, 1.0 - vTexCoord.y) * uResolution;

	float z = uTime * uSpeed;
	vec3 c = vec3(
		channel(fragCoord, z + 0.05),
		channel(fragCoord, z + 0.10),
		channel(fragCoord, z + 0.15)
	);

	vec2 p = fragCoord / uResolution - 0.5;
	p.x *= uResolution.x / uResolution.y;
	gl_FragColor = vec4(c / length(p), 1.0);
}
