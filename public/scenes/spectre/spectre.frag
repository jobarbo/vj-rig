// GLSL ES 1.00 — same dialect as library/shaders/. No #version directive.
// Centred audio visualiser. See index.js for the data layout.
precision highp float;

varying vec2 vTexCoord;

uniform vec2 uResolution;
uniform float uTime;
uniform float uBeat;

// Fed from index.js draw()
uniform sampler2D uSpectrum; // x = band (bass → treble), y = history row (ring buffer)
uniform float uHistHead;     // row holding the current frame
uniform float uHistRows;
uniform float uBands;
uniform vec2 uRings[8];      // (birthTime, strength)

// One uniform per declared param
uniform float uBarsAmt;
uniform float uWaterfallAmt;
uniform float uShockAmt;
uniform float uHistoryLength;
uniform float uShockSpeed;
uniform float uShockWidth;
uniform float uBassAtCenter;
uniform float uHue;
uniform float uHueSpread;
uniform float uSaturation;
uniform float uBrightness;
uniform float uBeatAmt;
uniform float uRatio;
uniform float uPixelate;
uniform float uLedColumns;
uniform float uLedRows;

vec3 hsv2rgb(vec3 c) {
	vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
	return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// t in 0..1 along the band axis (0 = centre), age in frames.
float spectrumAt(float t, float age) {
	float band = mix(1.0 - t, t, uBassAtCenter); // bassAtCenter: centre = band 0
	float u = (floor(clamp(band, 0.0, 1.0) * (uBands - 1.0) + 0.5) + 0.5) / uBands;
	float row = mod(uHistHead - floor(age + 0.5), uHistRows);
	float v = (row + 0.5) / uHistRows;
	return texture2D(uSpectrum, vec2(u, v)).r;
}

void main() {
	vec2 uv = vTexCoord;

	// LED-matrix quantisation: 240×20 strips wired in pairs → 240×10 cells.
	if (uPixelate > 0.5) {
		vec2 grid = max(vec2(uLedColumns, uLedRows), vec2(1.0));
		uv = (floor(uv * grid) + 0.5) / grid;
	}

	// Centred, mirrored coordinates: 0 at the centre, 1 at the edge.
	float dx = abs(uv.x - 0.5) * 2.0;
	float dy = abs(uv.y - 0.5) * 2.0;
	// Physical radial distance (x in half-widths; y squashed by the aspect ratio).
	float dist = length(vec2(dx, dy / max(uRatio, 0.001)));

	// ── Bars: column amplitude opens vertically from the middle rows.
	float amp = spectrumAt(dx, 0.0);
	float cell = 1.0 / max(uLedRows, 1.0);
	float bars = smoothstep(dy - cell, dy + cell, amp);

	// ── Waterfall: spectrum is born at the centre and travels outward.
	// x = time (age), y = band (centre rows = bass when bassAtCenter).
	float wf = spectrumAt(dy, dx * uHistoryLength);
	wf *= 1.0 - dx * 0.6; // fade as it travels

	// ── Shockwaves on beat.
	float shock = 0.0;
	for (int i = 0; i < 8; i++) {
		float r = (uTime - uRings[i].x) * uShockSpeed;
		if (r < 0.0 || r > 1.3) continue;
		float d = (dist - r) / max(uShockWidth, 0.001);
		shock += exp(-d * d) * uRings[i].y * (1.0 - r / 1.3);
	}

	float hue = uHue + dist * uHueSpread;
	vec3 colBars = hsv2rgb(vec3(hue, uSaturation, 1.0));
	vec3 colWf = hsv2rgb(vec3(hue + 0.12, uSaturation, 1.0));
	vec3 colShock = hsv2rgb(vec3(hue - 0.08, uSaturation * 0.4, 1.0));

	vec3 color = colBars * bars * uBarsAmt + colWf * wf * uWaterfallAmt + colShock * clamp(shock, 0.0, 1.5) * uShockAmt;
	color *= uBrightness * (1.0 + uBeat * uBeatAmt);

	gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
