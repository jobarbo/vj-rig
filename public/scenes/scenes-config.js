/**
 * Scene registry — local sketch + remote iframes.
 * Add an entry here (+ a MIDI CC in SCENE_CONTROLS.midiCcs) to register a new scene.
 *
 * iframe + shaders:true (default) loads via /scene-proxy so the host can capture
 * the remote canvas into the local shader pipeline. Requires `npm start` (dev-server).
 * Set shaders:false to show the raw iframe only (no host FX).
 */
const SCENES = [
	{id: "local", type: "local", label: "VJ Rig"},
	{
		id: "ex-lignis",
		type: "iframe",
		url: "https://ex-lignis.netlify.app/",
		label: "Ex Lignis",
		shaders: true,
	},
];

const SCENE_CONTROLS = {
	// Keyboard: "1".."9" / "0" → scene index (0 = local)
	// MIDI: CC press (value > 0) on channel 0 — midiCcs[i] → scene i
	midiCcs: [40, 41, 42, 43, 44, 45, 46, 47], // CC40 = scene 0, CC41 = scene 1, …
	midiChannel: 0, // Grid page 1 only (matches knob.js page gate)
	showLabel: true, // corner label; toggle with key "S"
};
