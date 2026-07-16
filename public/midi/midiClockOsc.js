/**
 * MIDI clock detector — WebSocket client for osc-bridge.js
 * Receives OSC-normalized MIDI messages and displays a debug overlay.
 */

const MIDI_TYPES = {
	248: "clock",
	250: "start",
	251: "continue",
	252: "stop",
	242: "songPosition",
};

class MidiClockOsc {
	constructor() {
		this.ws = null;
		this.wsUrl = "ws://localhost:3302";
		this.connectionState = "disconnected";
		this.reconnectTimer = null;
		this.reconnectDelayMs = 2000;

		this.transport = "stopped";
		this.tickCount = 0;
		this.bpm = null;
		this.ticksPerSecond = 0;
		this.msSinceLastTick = null;
		this.lastAddress = "";
		this.lastType = "";
		this.lastStatus = null;
		this.messageRate = 0;

		this._tickIntervals = [];
		this._maxIntervals = 12;
		this._minTicksForBpm = 4;
		this._lastTickTime = 0;
		this._messageCount = 0;
		this._messageCountWindowStart = performance.now();
		this._recentMessages = [];

		this.showOverlay = true;
		this.overlayElement = null;
	}

	connect(url) {
		if (url) this.wsUrl = url;
		this.disconnect(false);
		this.connectionState = "reconnecting";
		this._renderOverlay();

		try {
			this.ws = new WebSocket(this.wsUrl);
		} catch (err) {
			console.warn("[midiClockOsc] connect failed:", err);
			this._scheduleReconnect();
			return this;
		}

		this.ws.onopen = () => {
			this.connectionState = "connected";
			console.log("[midiClockOsc] connected to", this.wsUrl);
			this._renderOverlay();
		};

		this.ws.onmessage = (event) => {
			try {
				const payload = JSON.parse(event.data);
				this._handleMessage(payload);
			} catch (err) {
				console.warn("[midiClockOsc] invalid message:", err);
			}
		};

		this.ws.onclose = () => {
			this.connectionState = "disconnected";
			this.ws = null;
			this._renderOverlay();
			this._scheduleReconnect();
		};

		this.ws.onerror = () => {
			this.connectionState = "disconnected";
		};

		return this;
	}

	disconnect(clearReconnect = true) {
		if (clearReconnect && this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			this.ws.onclose = null;
			this.ws.close();
			this.ws = null;
		}
		if (clearReconnect) {
			this.connectionState = "disconnected";
			this._renderOverlay();
		}
		return this;
	}

	_scheduleReconnect() {
		if (this.reconnectTimer) return;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect(this.wsUrl);
		}, this.reconnectDelayMs);
	}

	_classifyMessage(payload) {
		if (payload.type && payload.type !== "unknown") return payload.type;
		if (payload.status != null) return MIDI_TYPES[payload.status] || "unknown";
		return "unknown";
	}

	_pushRecent(summary) {
		this._recentMessages.unshift(summary);
		if (this._recentMessages.length > 8) this._recentMessages.length = 8;
	}

	_handleMessage(payload) {
		const now = performance.now();
		this._messageCount++;
		const windowElapsed = now - this._messageCountWindowStart;
		if (windowElapsed >= 1000) {
			this.messageRate = Math.round((this._messageCount * 1000) / windowElapsed);
			this._messageCount = 0;
			this._messageCountWindowStart = now;
		}

		const type = this._classifyMessage(payload);
		const status = payload.status ?? payload.args?.[0] ?? null;
		const address = payload.address || "";

		this.lastAddress = address;
		this.lastType = type;
		this.lastStatus = status;

		const argsStr = (payload.args || []).join(", ");
		this._pushRecent(`${status ?? "?"} ${type} ${address}${argsStr ? ` [${argsStr}]` : ""}`);

		switch (type) {
			case "clock":
				this._handleClockTick(now);
				break;
			case "start":
				this.transport = "running";
				this.tickCount = 0;
				this._tickIntervals = [];
				this.bpm = null;
				this._lastTickTime = 0;
				break;
			case "continue":
				this.transport = "running";
				break;
			case "stop":
				this.transport = "stopped";
				this.bpm = null;
				this.ticksPerSecond = 0;
				break;
			default:
				break;
		}

		this._renderOverlay();
	}

	_handleClockTick(now) {
		if (this.transport !== "running") {
			this.transport = "running";
		}

		if (this._lastTickTime > 0) {
			const interval = now - this._lastTickTime;
			this.msSinceLastTick = interval;
			this._tickIntervals.push(interval);
			if (this._tickIntervals.length > this._maxIntervals) {
				this._tickIntervals.shift();
			}

			if (this._tickIntervals.length >= this._minTicksForBpm) {
				const avg = this._tickIntervals.reduce((a, b) => a + b, 0) / this._tickIntervals.length;
				this.bpm = 60000 / (avg * 24);
				this.ticksPerSecond = 1000 / avg;
			}
		}

		this._lastTickTime = now;
		this.tickCount++;
	}

	update() {
		const now = performance.now();
		if (this._lastTickTime > 0 && this.transport === "running") {
			this.msSinceLastTick = now - this._lastTickTime;
		}
		this._renderOverlay();
	}

	getState() {
		return {
			connected: this.connectionState === "connected",
			connectionState: this.connectionState,
			transport: this.transport,
			bpm: this.bpm,
			tickCount: this.tickCount,
			ticksPerSecond: this.ticksPerSecond,
			msSinceLastTick: this.msSinceLastTick,
			lastAddress: this.lastAddress,
			lastType: this.lastType,
			lastStatus: this.lastStatus,
			messageRate: this.messageRate,
			recentMessages: [...this._recentMessages],
		};
	}

	setOverlayVisible(visible) {
		this.showOverlay = Boolean(visible);
		this._renderOverlay();
		return this;
	}

	toggleOverlay() {
		this.showOverlay = !this.showOverlay;
		this._renderOverlay();
		return this;
	}

	_ensureOverlay() {
		if (this.overlayElement) return this.overlayElement;
		this.overlayElement = document.getElementById("midi-clock-overlay");
		if (!this.overlayElement) {
			this.overlayElement = document.createElement("div");
			this.overlayElement.id = "midi-clock-overlay";
			document.body.appendChild(this.overlayElement);
		}
		return this.overlayElement;
	}

	_renderOverlay() {
		const el = this._ensureOverlay();
		if (!this.showOverlay) {
			el.classList.add("is-hidden");
			return;
		}
		el.classList.remove("is-hidden");

		const stale =
			this.transport === "running" &&
			this.msSinceLastTick != null &&
			this.msSinceLastTick > 500;
		const disconnected = this.connectionState !== "connected";

		el.classList.toggle("is-warning", stale && !disconnected);
		el.classList.toggle("is-disconnected", disconnected);
		el.classList.toggle("is-stopped", this.transport === "stopped" && !disconnected);

		const bpmStr = this.bpm != null ? this.bpm.toFixed(1) : "—";
		const tpsStr = this.ticksPerSecond > 0 ? this.ticksPerSecond.toFixed(1) : "—";
		const deltaStr = this.msSinceLastTick != null ? `${this.msSinceLastTick.toFixed(1)}ms` : "—";
		const statusStr = this.lastStatus != null ? this.lastStatus : "?";

		const recent = this._recentMessages.map((line) => `  ${line}`).join("\n");

		const waitingHint =
			this.connectionState === "connected" && this.messageRate === 0 && this._recentMessages.length === 0
				? "  (aucun OSC — TD doit envoyer vers 127.0.0.1:1337 ou 239.255.0.1:1337)"
				: "  (waiting…)";

		el.textContent = [
			"MIDI OSC",
			`ws: ${this.connectionState}`,
			`transport: ${this.transport}`,
			`bpm: ${bpmStr}`,
			`ticks: ${this.tickCount}  (${tpsStr}/s)`,
			`Δtick: ${deltaStr}`,
			`last: ${this.lastAddress || "—"} ${this.lastType} [${statusStr}]`,
			`rate: ${this.messageRate} msg/s`,
			"---",
			recent || waitingHint,
		].join("\n");
	}
}

const midiClockOsc = new MidiClockOsc();
