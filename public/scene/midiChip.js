// midiChip.js — the MIDI learn pill next to each param in panel V.
//
// One pill per param, three states, rendered from state every frame (so it can
// never get stuck on "…" when another param starts learning):
//   idle      "MIDI"            click → learn
//   learning  "turn…" (pulses)  click or Esc → cancel
//   bound     "CC74" / "C4"     click → re-learn, × → unbind
//
// Only one learn can be armed at a time (scene params and panel E's midiLearn),
// otherwise a single knob turn would bind in two places at once.

function learners() {
	return [window.midiLearn || window.sceneMidi, window.sceneParamMidi].filter(Boolean);
}

/** Cancel every armed learn. Returns true if one was armed. */
export function cancelAllLearns() {
	let any = false;
	for (const m of learners()) {
		if (m.learning) {
			m.cancelLearn();
			any = true;
		}
	}
	return any;
}

if (!window.__midiChipEsc) {
	window.__midiChipEsc = true;
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && cancelAllLearns()) e.stopPropagation();
	});
}

/**
 * @param {{onLearn: () => void, onCancel: () => void, onClear: () => void, hint?: string}} opts
 * @returns {{root: HTMLElement, render: (s: {learning: boolean, label: string|null, title?: string}) => void}}
 */
export function createMidiChip({onLearn, onCancel, onClear, hint = "Click, then press an S-1 key or turn a knob"}) {
	const root = document.createElement("span");
	root.className = "midi-chip-wrap";

	const chip = document.createElement("button");
	chip.type = "button";
	chip.className = "midi-chip";

	const clear = document.createElement("button");
	clear.type = "button";
	clear.className = "midi-chip__clear";
	clear.textContent = "×";
	clear.title = "Remove this MIDI binding";
	clear.tabIndex = -1;

	let state = {learning: false, label: null};

	chip.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (state.learning) {
			onCancel();
		} else {
			cancelAllLearns();
			onLearn();
		}
	});
	clear.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		onClear();
	});

	root.append(chip, clear);

	let last = "";
	function render(next) {
		state = next;
		const key = `${next.learning}|${next.label}|${next.title}`;
		if (key === last) return; // cheap: called every frame
		last = key;
		chip.classList.toggle("is-learning", !!next.learning);
		chip.classList.toggle("is-bound", !next.learning && !!next.label);
		root.classList.toggle("is-bound", !!next.label);
		chip.textContent = next.learning ? "turn…" : next.label || "MIDI";
		chip.title = next.learning
			? "Listening — press a key or turn a knob (Esc or click to cancel)"
			: next.label
				? `${next.title || next.label} — click to re-learn`
				: hint;
	}
	render(state);

	return {root, render};
}
