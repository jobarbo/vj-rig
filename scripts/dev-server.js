/**
 * Dev server: static public/ + live reload.
 *
 * Usage: node scripts/dev-server.js
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3301;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = path.join(__dirname, "..", "public");
const LR_PATH = "/__livereload";

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".frag": "text/plain; charset=utf-8",
	".vert": "text/plain; charset=utf-8",
	".glsl": "text/plain; charset=utf-8",
};

const lrClients = new Set();

function contentType(filePath) {
	return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function send(res, status, body, headers = {}) {
	res.writeHead(status, headers);
	res.end(body);
}

function serveStatic(req, res, urlPath) {
	let rel = decodeURIComponent(urlPath.split("?")[0]);
	if (rel.endsWith("/")) rel += "index.html";
	if (rel === "/") rel = "/index.html";

	const filePath = path.normalize(path.join(ROOT, rel));
	if (!filePath.startsWith(ROOT)) {
		send(res, 403, "Forbidden");
		return;
	}

	fs.readFile(filePath, (err, data) => {
		if (err) {
			send(res, 404, "Not found");
			return;
		}
		const headers = {
			"Content-Type": contentType(filePath),
			"Cache-Control": "no-store",
		};
		// Inject live-reload client into HTML
		if (filePath.endsWith(".html")) {
			const html = data.toString("utf8");
			const injected = html.includes(LR_PATH)
				? html
				: html.replace(
						/<\/body>/i,
						`<script>(function(){const es=new EventSource("${LR_PATH}");es.onmessage=()=>location.reload();})();</script></body>`,
					);
			send(res, 200, injected, headers);
			return;
		}
		send(res, 200, data, headers);
	});
}

function handleLivereload(req, res) {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});
	res.write("\n");
	lrClients.add(res);
	req.on("close", () => lrClients.delete(res));
}

function broadcastReload() {
	for (const client of lrClients) {
		try {
			client.write("data: reload\n\n");
		} catch (_) {
			lrClients.delete(client);
		}
	}
}

let reloadTimer = null;
function watchPublic() {
	try {
		fs.watch(ROOT, {recursive: true}, (_event, filename) => {
			if (!filename || filename.startsWith(".")) return;
			clearTimeout(reloadTimer);
			reloadTimer = setTimeout(broadcastReload, 120);
		});
		console.log(`[dev-server] watching ${ROOT}`);
	} catch (err) {
		console.warn("[dev-server] fs.watch failed (live reload disabled):", err.message);
	}
}

const server = http.createServer((req, res) => {
	const urlPath = req.url || "/";

	if (urlPath.split("?")[0] === LR_PATH) {
		handleLivereload(req, res);
		return;
	}

	serveStatic(req, res, urlPath);
});

server.listen(PORT, HOST, () => {
	console.log(`[dev-server] http://${HOST}:${PORT}`);
	watchPublic();
});
