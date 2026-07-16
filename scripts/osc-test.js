/**
 * Quick OSC → WebSocket pipeline test (no TouchDesigner needed).
 * Usage: npm run osc:test
 * Requires osc:bridge running in another terminal.
 */

const WebSocket = require("ws");
const dgram = require("dgram");
const osc = require("osc");

const wsUrl = `ws://localhost:${process.env.OSC_WS_PORT || 3302}`;
const oscPort = Number(process.env.OSC_PORT || process.env.OSC_PORTS?.split(",")[0] || 1337);

const ws = new WebSocket(wsUrl);
const sock = dgram.createSocket("udp4");
let received = 0;

ws.on("message", (data) => {
	received++;
	console.log("[osc-test] WebSocket received:", data.toString());
});

ws.on("open", () => {
	console.log("[osc-test] connected to", wsUrl);
	const buf = osc.writePacket({address: "/midi", args: [{type: "i", value: 250}]}, {metadata: true});
	const payload = osc.nativeBuffer(buf);
	sock.send(payload, 0, payload.length, oscPort, "127.0.0.1", (err) => {
		if (err) {
			console.error("[osc-test] UDP send failed:", err.message);
			process.exit(1);
		}
		console.log(`[osc-test] sent test OSC to 127.0.0.1:${oscPort}`);
		setTimeout(() => {
			console.log(received > 0 ? "[osc-test] OK — pipeline works" : "[osc-test] FAIL — bridge not receiving UDP");
			ws.close();
			sock.close();
			process.exit(received > 0 ? 0 : 1);
		}, 500);
	});
});

ws.on("error", (err) => {
	console.error("[osc-test] WebSocket error:", err.message);
	console.error("[osc-test] Is osc:bridge running? (npm run osc:bridge)");
	process.exit(1);
});

setTimeout(() => {
	console.error("[osc-test] timeout");
	process.exit(1);
}, 3000);
