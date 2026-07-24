/**
 * Dev server: static public/ + /scene-proxy/<host>/… for same-origin iframes
 * (needed so the host can read remote canvases into the shader pipeline) + live reload.
 *
 * Usage: node scripts/dev-server.js
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const {URL} = require("url");

const PORT = Number(process.env.PORT) || 3301;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = path.join(__dirname, "..", "public");
const PROXY_PREFIX = "/scene-proxy/";
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

function parseProxyTarget(urlPath) {
	// /scene-proxy/ex-lignis.netlify.app/foo → https://ex-lignis.netlify.app/foo
	const rest = urlPath.slice(PROXY_PREFIX.length);
	if (!rest) return null;
	const slash = rest.indexOf("/");
	const host = slash === -1 ? rest : rest.slice(0, slash);
	const pathname = slash === -1 ? "/" : rest.slice(slash);
	if (!host || host.includes("..")) return null;
	return new URL(`https://${host}${pathname}`);
}

function injectBaseHref(html, baseHref) {
	html = html.replace(/<base\s[^>]*>/gi, "");
	const tag = `<base href="${baseHref}">`;
	if (/<head[^>]*>/i.test(html)) {
		return html.replace(/<head[^>]*>/i, (m) => `${m}\n${tag}`);
	}
	return tag + html;
}

/** Keep relative + absolute remote URLs on the same-origin proxy (avoids CORS on fetch/loadShader). */
function rewriteProxiedHtml(html, target) {
	const proxyBase = `${PROXY_PREFIX}${target.host}/`;
	const remoteOrigin = target.origin;

	html = injectBaseHref(html, proxyBase);

	// Absolute links to the remote site → proxy paths
	html = html.split(`${remoteOrigin}/`).join(proxyBase);
	html = html.split(remoteOrigin).join(proxyBase.replace(/\/$/, ""));

	return html;
}

function proxyScene(req, res, urlPath) {
	const target = parseProxyTarget(urlPath.split("?")[0]);
	if (!target) {
		send(res, 400, "Bad proxy path");
		return;
	}

	const lib = target.protocol === "http:" ? http : https;
	const headers = {
		"User-Agent": req.headers["user-agent"] || "vj-rig-scene-proxy",
		Accept: req.headers.accept || "*/*",
	};

	const upstream = lib.request(
		target,
		{method: "GET", headers},
		(up) => {
			const ct = up.headers["content-type"] || "";
			const chunks = [];
			up.on("data", (c) => chunks.push(c));
			up.on("end", () => {
				let body = Buffer.concat(chunks);
				const outHeaders = {
					"Cache-Control": "no-store",
					"Content-Type": ct || "application/octet-stream",
					// Allow iframe parent + same-origin fetches from the proxied page
					"Access-Control-Allow-Origin": "*",
					"Content-Security-Policy": "frame-ancestors *",
				};

				if (ct.includes("text/html")) {
					let html = body.toString("utf8");
					html = rewriteProxiedHtml(html, target);
					body = Buffer.from(html, "utf8");
					outHeaders["Content-Type"] = "text/html; charset=utf-8";
				}

				res.writeHead(up.statusCode || 200, outHeaders);
				res.end(body);
			});
		},
	);

	upstream.on("error", (err) => {
		console.warn("[scene-proxy]", target.href, err.message);
		send(res, 502, `Proxy error: ${err.message}`);
	});
	upstream.end();
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

	if (urlPath.startsWith(PROXY_PREFIX)) {
		proxyScene(req, res, urlPath);
		return;
	}

	serveStatic(req, res, urlPath);
});

server.listen(PORT, HOST, () => {
	console.log(`[dev-server] http://${HOST}:${PORT}`);
	console.log(`[dev-server] scene proxy: /scene-proxy/<host>/…`);
	watchPublic();
});
