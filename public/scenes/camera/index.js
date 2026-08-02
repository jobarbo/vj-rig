// camera — the reference media scene. No p5 instance, no params: the runtime
// (public/scene/runtime/mediaScene.js) opens getUserMedia() and hands the
// compositor the <video> element directly. Pick a device from the scene
// panel (V) when more than one is available.

export const meta = {
	name: "Camera",
	kind: "camera",
	fit: "cover",
	mirror: true, // flip horizontally — front cameras read as a mirror otherwise
};
