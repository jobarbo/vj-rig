/**
 * Per-knob input range calibration.
 *
 * Some S-1 controls are stepped selectors that send a few small values instead
 * of 0–127 (LFO Wave Form CC 12, OSC Range CC 14, LFO Rate CC 3 with LFO Sync on).
 * Dividing those by 127 only reaches a sliver of the target range.
 *
 * We remember the highest value seen per (channel, cc). If it stays at or below
 * STEPPED_MAX the control is treated as stepped and normalized by its own max,
 * otherwise by 127. Persisted in localStorage (vjCcMax).
 *
 * Console: ccRange.reset() forgets everything, ccRange.reset(cc) one knob.
 */
(function () {
	const STORAGE_KEY = "vjCcMax";
	const STEPPED_MAX = 16;

	/** @type {Record<string, number>} "channel:cc" -> highest value seen */
	let maxSeen = {};
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) maxSeen = JSON.parse(raw) || {};
	} catch (_) {
		maxSeen = {};
	}

	function persist() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(maxSeen));
		} catch (_) {
			/* ignore */
		}
	}

	const key = (channel, cc) => `${channel}:${cc}`;

	const ccRange = {
		STEPPED_MAX,

		/** Record a raw CC value. Call for every incoming CC before normalizing. */
		observe(channel, cc, value7) {
			const k = key(channel, cc);
			const v = Math.min(127, Math.max(0, Number(value7) || 0));
			if (!(k in maxSeen) || v > maxSeen[k]) {
				maxSeen[k] = v;
				persist();
			}
		},

		/** Raw CC value → 0..1 across the knob's real travel. */
		norm(channel, cc, value7) {
			const v = Math.min(127, Math.max(0, Number(value7) || 0));
			const m = maxSeen[key(channel, cc)];
			if (m > 0 && m <= STEPPED_MAX) return Math.min(1, v / m);
			return v / 127;
		},

		/** Highest value seen for a knob, or null. */
		max(channel, cc) {
			const m = maxSeen[key(channel, cc)];
			return m == null ? null : m;
		},

		reset(cc) {
			if (cc == null) maxSeen = {};
			else for (const k of Object.keys(maxSeen)) if (k.endsWith(`:${cc}`)) delete maxSeen[k];
			persist();
		},
	};

	window.ccRange = ccRange;
})();
