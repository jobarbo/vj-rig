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
	".ogg": "audio/ogg",
	".m4a": "audio/mp4",
	".flac": "audio/flac",
	".mp4": "video/mp4",
	".m4v": "video/x-m4v",
	".webm": "video/webm",
	".mov": "video/quicktime",
	".ogv": "video/ogg",
	".avif": "image/avif",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".frag": "text/plain; charset=utf-8",
	".vert": "text/plain; charset=utf-8",
	".glsl": "text/plain; charset=utf-8",
	// NOT ".mjs" — deliberately absent so scene modules stay on ".js", the one
	// extension every static import()/import()-caller here can rely on.
};

const lrClients = new Set();

function contentType(filePath) {
	return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function send(res, status, body, headers = {}) {
	res.writeHead(status, headers);
	res.end(body);
}

/**
 * Parses a single `Range: bytes=...` header against a known size.
 * Returns {start, end} (inclusive) or null if the header is absent/unusable
 * (caller should then fall back to a full 200 response).
 */
function parseRange(rangeHeader, size) {
	const m = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader || "").trim());
	if (!m || (m[1] === "" && m[2] === "")) return null;

	let start;
	let end;
	if (m[1] === "") {
		// suffix range: last N bytes
		const n = Math.min(Number(m[2]), size);
		start = size - n;
		end = size - 1;
	} else {
		start = Number(m[1]);
		end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
	}
	if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= size) {
		return {invalid: true};
	}
	return {start, end};
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

	// HTML keeps the buffered read/write path: the live-reload client has to be
	// injected into the body, which needs the whole file in memory anyway.
	if (filePath.endsWith(".html")) {
		fs.readFile(filePath, (err, data) => {
			if (err) {
				send(res, 404, "Not found");
				return;
			}
			const html = data.toString("utf8");
			const injected = html.includes(LR_PATH)
				? html
				: html.replace(
						/<\/body>/i,
						`<script>(function(){const es=new EventSource("${LR_PATH}");es.onmessage=()=>location.reload();})();</script></body>`,
					);
			send(res, 200, injected, {"Content-Type": contentType(filePath), "Cache-Control": "no-store"});
		});
		return;
	}

	// Everything else is streamed, with Range support — video scenes need
	// 206 partial responses to seek/loop; without Accept-Ranges, <video> only
	// ever gets a single buffered 200 and playback stalls on longer clips.
	fs.stat(filePath, (statErr, stat) => {
		if (statErr || !stat.isFile()) {
			send(res, 404, "Not found");
			return;
		}

		const size = stat.size;
		const baseHeaders = {
			"Content-Type": contentType(filePath),
			"Cache-Control": "no-store",
			"Accept-Ranges": "bytes",
		};

		const range = req.headers.range ? parseRange(req.headers.range, size) : null;
		if (range?.invalid) {
			res.writeHead(416, {"Content-Range": `bytes */${size}`});
			res.end();
			return;
		}

		if (range) {
			res.writeHead(206, {
				...baseHeaders,
				"Content-Range": `bytes ${range.start}-${range.end}/${size}`,
				"Content-Length": range.end - range.start + 1,
			});
			if (req.method === "HEAD") {
				res.end();
				return;
			}
			fs.createReadStream(filePath, {start: range.start, end: range.end})
				.on("error", () => res.destroy())
				.pipe(res);
			return;
		}

		res.writeHead(200, {...baseHeaders, "Content-Length": size});
		if (req.method === "HEAD") {
			res.end();
			return;
		}
		fs.createReadStream(filePath)
			.on("error", () => res.destroy())
			.pipe(res);
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

// Copying a large media file into public/scenes/media/ fires a burst of watch
// events while it's still being written — reloading on each one is both
// noisy and pointless since the file isn't done yet.
const WATCH_IGNORE = /\.(mp4|m4v|webm|mov|ogv|part|crdownload|download|tmp)$|~$/i;

let reloadTimer = null;
function watchPublic() {
	try {
		fs.watch(ROOT, {recursive: true}, (_event, filename) => {
			if (!filename || filename.startsWith(".")) return;
			if (WATCH_IGNORE.test(filename)) return;
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
