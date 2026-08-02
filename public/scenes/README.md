# Scenes

A **scene** is the visual content of the rig. It renders into its own off-screen
surface; the compositor blits that surface into `mainCanvas`, and `mainCanvas`
flows through the existing 19-shader post chain untouched.

Scenes never see the shader chain, and the shader chain never sees scenes. The
only point of contact is one `drawImage` per frame.

```
public/scenes/<id>/index.js   ← your scene
public/scene/                 ← the engine (don't edit to add a scene)
```

Add a scene = create a folder + add one line to [`manifest.js`](manifest.js).

---

## Keys

Digits jump to a scene by its 1-indexed position in [`manifest.js`](manifest.js).
Keystrokes buffer like a vim count: press `1` then `2` within half a second and
it resolves to scene 12, not scene 1 followed by scene 2.

| Keys | Action |
| --- | --- |
| `1` | Scene 1 |
| `1` `2` (within 500ms) | Scene 12 |

Taken elsewhere and unavailable: `D` `E` `L` `M` `G` `C`, plus `g` and `Cmd+S`
which are bound at document level inside the library submodule.

---

## A p5 scene

```js
// public/scenes/myscene/index.js
import {Thing} from "./thing.js";        // subfolders are plain ES modules

export const meta = {
	name: "My Scene",
	kind: "p5",
	renderer: "P2D",   // or "WEBGL"
	size: "host",      // "host" follows mainCanvas | [1920, 1080] pins a resolution
	fit: "cover",      // cover | contain | stretch
	smooth: true,      // antialias when the compositor scales this scene
	params: [
		{name: "speed", label: "Speed", min: 0, max: 4, value: 1},
	],
};

export async function setup(ctx) {
	const p = ctx.p;
	p.colorMode(p.HSB, 360, 100, 100, 100);
	ctx.things = [new Thing(p.width / 2, p.height / 2)];
}

export function draw(ctx) {
	const p = ctx.p;
	p.background(0);
	for (const t of ctx.things) t.show(p, ctx.time * ctx.params.speed);
}

export function resize(ctx) {}   // optional — called after an output resize
export function dispose(ctx) {}  // optional — release anything you allocated
```

Only `meta` and `draw` are required.

### `ctx`

One live object, mutated in place. **Read through `ctx` every frame; never
destructure numbers out of it in `setup`** — you'd capture a stale copy. Object
properties (`params`, `audio`) keep a stable identity, so `const {params} = ctx`
in `setup` is fine.

| Field | |
| --- | --- |
| `p` | your p5 instance (`null` for image/video/camera scenes) |
| `width`, `height` | your surface size |
| `frame` | frames since **this scene** started (not the rig's `frameCount`) |
| `time`, `dt` | seconds since this scene started / since last frame (`dt` clamped to 0.1) |
| `params` | your declared params, live values |
| `audio` | `bass mid treble energy volume subBass lowMid highMid presence beat beatPulse` |
| `host` | `{width, height}` of `mainCanvas` — may differ from your surface |
| `id`, `base`, `asset(name)` | your scene id, folder URL, and an asset path helper |

Load assets with `ctx.asset()` so the scene folder stays relocatable:

```js
ctx.img = await new Promise((r) => ctx.p.loadImage(ctx.asset("bg.png"), r));
```

---

## Porting an existing p5 sketch

A standalone p5 `index.html` cannot drop in unchanged — that would need iframes
again. Porting is the standard, documented **instance-mode conversion**, which
is a mechanical find-replace, not a rewrite.

1. Copy the project into `public/scenes/<id>/`, rename its entry to `index.js`.
2. Delete `createCanvas(...)`, `pixelDensity(...)`, `frameRate(...)`,
   `noLoop()` and `windowResized()` — the rig owns all of those.
3. `function setup() {` → `export async function setup(ctx) { const p = ctx.p;`
4. `function draw() {` → `export function draw(ctx) { const p = ctx.p;`
5. Prefix p5 calls with `p.`:
   ```
   \b(background|fill|stroke|noStroke|noFill|rect|ellipse|circle|line|arc|point
   |push|pop|translate|rotate|scale|width|height|mouseX|mouseY|random|noise|map
   |lerp|dist|constrain|color|colorMode|blendMode|text|textSize|textAlign|image
   |beginShape|vertex|endShape|rectMode|ellipseMode|TWO_PI|PI|HALF_PI|CENTER
   |CORNER|CLOSE|HSB|HSL|RGB)\b
   ```
   → `p.$1`. **p5 constants count** (`CENTER`, `HSL`, …): in instance mode they
   live on `p`, not on `window`.
6. `frameCount` → `ctx.frame`, `millis() / 1000` → `ctx.time`.
7. Move top-level state into `ctx` (e.g. `ctx.things`) or module scope. Classes
   and helpers go in sibling files and take `p` as an argument — see
   [`orbit/mover.js`](orbit/mover.js), the reference port.
8. Add `export const meta` and one line in `manifest.js`.

There is deliberately no attempt to fake global mode: `with()` is illegal in
modules, and proxy auto-binding breaks on `this`-sensitive calls.

---

## A GLSL scene

Usually just a `meta` block and a `.frag`:

```js
// public/scenes/myshader/index.js
export const meta = {
	name: "My Shader",
	kind: "glsl",
	frag: "shader.frag",   // vert defaults to /scene/passthrough.vert
	size: [512, 512],      // a quarter of the fragments of a 1024² canvas
	fit: "cover",
	params: [{name: "speed", min: 0, max: 4, value: 1}],
};
```

```glsl
// GLSL ES 1.00 — no #version. Same dialect as library/shaders/, so fragments
// are copy-pasteable in both directions.
precision highp float;
varying vec2 vTexCoord;

uniform vec2  uResolution;
uniform float uTime;
uniform float uFrame;
uniform vec4  uAudio;   // bass, mid, treble, energy
uniform float uBeat;    // decaying 0..1 pulse

uniform float uSpeed;   // one uniform per param: name -> "u" + PascalCase

void main() {
	gl_FragColor = vec4(vec3(sin(vTexCoord.x * 10.0 + uTime * uSpeed)), 1.0);
}
```

`setUniform` on an undeclared uniform is a silent no-op, so a `.frag` may
declare fewer uniforms than the scene has params. Always write `alpha = 1.0`.

A GLSL scene gets its **own** WEBGL p5 instance and its own shader — a
`p5.Shader` throws if used on a second context, so scene shaders can never be
registered with the global `shaderManager`.

---

## Rules the engine enforces for you

You cannot get these wrong; the loader handles them:

- `pixelDensity(1)` is forced after `createCanvas` (p5 otherwise defaults to
  `ceil(devicePixelRatio)`, silently rendering at 4× on retina).
- `noLoop()` — the master `draw()` drives your scene via `redraw()`.
- Readiness — your `draw` is not wired until the instance can actually render.
- Errors — a scene that throws is caught, logged, and quarantined after 5
  failures. It can never freeze the rig.
- Disposal — `p.remove()` on switch, so WebGL contexts don't leak.

## Gotchas

- **Assets**: `.mp4`/`.webm` are not in the dev server's MIME map yet and it has
  no HTTP Range support, so video scenes need those added first.
- **Media files** belong in `public/scenes/media/`, which is gitignored.
- **`import()` caches by URL** for the page lifetime. Live reload does a full
  `location.reload()`, so this only matters if you hot-swap by hand.
- **Use `.js`**, never `.mjs` — `.mjs` is missing from the dev server MIME map.
