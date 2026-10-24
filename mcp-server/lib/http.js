const express = require("express");
const cors = require("cors");
const { createMcpExpressApp } = require("@modelcontextprotocol/express");
const { toNodeHandler } = require("@modelcontextprotocol/node");
const { createMcpHandler, localhostAllowedHostnames, localhostAllowedOrigins } = require("@modelcontextprotocol/server");
const { createServer } = require("../index");
const { version } = require("../../package.json");

const list = (value) => (value || "").split(",").map((item) => item.trim()).filter(Boolean);

/** Mount at /mcp before the dashboard's body parser and setup/boot gates. */
function createMcpEndpoint({ env = process.env } = {}) {
	const app = createMcpExpressApp({
		allowedHosts: [...localhostAllowedHostnames(), ...list(env.MCP_ALLOWED_HOSTS)],
		allowedOrigins: [...localhostAllowedOrigins(), ...list(env.MCP_ALLOWED_ORIGINS)],
	});
	// Origin has already been validated by the SDK before reflecting it for browser clients.
	app.use(cors({ origin: true, methods: ["GET", "POST", "DELETE"], exposedHeaders: ["Mcp-Session-Id", "MCP-Protocol-Version"] }));
	// A fresh server per request; Google clients, caches and quota guards remain shared modules.
	const handler = createMcpHandler(createServer, { responseMode: "sse" });
	const node = toNodeHandler(handler);
	app.all("/", (req, res) => {
		res.set("X-Accel-Buffering", "no");
		return node(req, res, req.body);
	});
	app.use((err, _req, res, next) => {
		if (res.headersSent) return next(err);
		const parseError = err.type === "entity.parse.failed";
		res.status(err.status || 500).json({
			jsonrpc: "2.0",
			id: null,
			error: {
				code: parseError ? -32700 : -32603,
				message: parseError ? "Parse error" : err.status === 413 ? "Request body too large" : "Internal server error",
			},
		});
	});
	return { app, close: () => handler.close() };
}

async function startStandalone({ env = process.env } = {}) {
	const host = env.MCP_HOST || "127.0.0.1";
	const port = Number(env.MCP_PORT ?? 5484);
	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		throw new Error("MCP_PORT must be an integer between 0 and 65535.");
	}
	const endpoint = createMcpEndpoint({ env });
	const app = express();
	app.get("/healthz", (_req, res) => res.json({ ok: true, version, transport: "streamable-http" }));
	app.use("/mcp", endpoint.app);
	const server = app.listen(port, host);
	try {
		await new Promise((resolve, reject) => {
			server.once("listening", resolve);
			server.once("error", reject);
		});
	} catch (err) {
		await endpoint.close();
		throw err;
	}
	const hostname = host.includes(":") ? `[${host}]` : host;
	return {
		server,
		url: `http://${hostname}:${server.address().port}/mcp`,
		close: () => Promise.all([
			endpoint.close(),
			new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
		]),
	};
}

module.exports = { createMcpEndpoint, startStandalone };
