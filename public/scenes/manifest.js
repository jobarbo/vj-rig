// manifest.js — the ordered scene list.
//
// Adding a scene = create the folder + add one line here. Deliberately manual
// rather than auto-discovered: ordering must be deterministic (scene 3 has to
// be scene 3 every night), and per-scene fit/size/keys can't be inferred from
// a directory listing.
//
// Fields:
//   id     required, unique. Also the default folder name under /scenes/.
//   name   label shown in logs and (later) the panel.
//   kind   "p5" | "glsl"   (media kinds arrive in a later phase)
//   path   optional override, server-absolute. Defaults to `/scenes/<id>`.
//   entry  optional module filename. Defaults to `index.js`.
//   size   "host" (follow mainCanvas) | [width, height] (fixed resolution)
//   fit    "cover" | "contain" | "stretch"
//   smooth compositor imageSmoothingEnabled for this scene
//
// `meta` exported by the scene module supplies defaults for size/fit/smooth;
// anything set here wins.

export const SCENES = [
	{id: "orbit", name: "Orbit", kind: "p5"},
	{id: "plasma", name: "Plasma", kind: "glsl"},
	{id: "_spike", name: "Spike (dev)", kind: "p5"},
];

export default SCENES;
