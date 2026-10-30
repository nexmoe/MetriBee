const assert = require("node:assert/strict");
const { once } = require("node:events");
const { spawn } = require("node:child_process");
const { Client, StreamableHTTPClientTransport } = require("@modelcontextprotocol/client");
const { createMcpEndpoint, startStandalone } = require("../mcp-server/lib/http");
const cache = require("../mcp-server/lib/cache");
const { NEW_TOOL_NAMES } = require("../mcp-server/lib/tools");
const { ACCOUNT_TOOL_NAMES, ACCOUNT_WRITE_TOOL_NAMES } = require('../mcp-server/lib/accountTools');

const TOOLS = [
	"get_account_summaries", "get_property_details", "list_google_ads_links", "run_report",
	"run_funnel_report", "get_custom_dimensions_and_metrics", "run_realtime_report",
	"run_pagespeed_insights", "request_indexing", "get_cache_status", "get_rate_limit_status",
	...NEW_TOOL_NAMES,
    ...ACCOUNT_TOOL_NAMES,
];
let transportToken;
const HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
const payload = (result) => JSON.parse(result.content[0].text);

// node:http preserves custom Host headers for proxy validation tests.
function rawPost(url, headers) {
	return new Promise((resolve, reject) => {
		const req = require("node:http").request(url, { method: "POST", headers: { ...HEADERS,Authorization:`Bearer ${transportToken}`, ...headers } }, (res) => {
			res.resume();
			res.on("end", () => resolve(res.statusCode));
		});
		req.on("error", reject);
		req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
	});
}

describe("MCP Streamable HTTP", function () {
	this.timeout(10000);
	let mcp, authRuntime, database;
	let clients;
	let originals;
	before(async () => {
        database = require('../lib/database').openDatabase(':memory:');
        authRuntime = await (await import('../lib/auth.mjs')).createAuthentication({db:database,env:{PORT:'5483'}});
        const signed = await authRuntime.auth.api.signUpEmail({body:{email:'mcp@example.com',password:'mcp-password',name:'MCP'}});
        const key = await authRuntime.auth.api.createApiKey({body:{userId:signed.user.id,name:'HTTP tests'}});transportToken=key.key;
        const org=database.prepare('SELECT id FROM organization').get().id;
        database.prepare('INSERT INTO property_access(propertyId,organizationId,name,domain) VALUES(?,?,?,?)').run('123',org,'Test','example.com');
        database.prepare('INSERT INTO property_access(propertyId,organizationId,name,domain) VALUES(?,?,?,?)').run('123456789',org,'Defaults','defaults.example');
		mcp = await startStandalone({ authRuntime, env: { MCP_PORT: "0", MCP_ALLOWED_HOSTS: "ga4.example.com", MCP_ALLOWED_ORIGINS: "client.example.com" } });
	});
	after(async () => { await mcp?.close(); });
	beforeEach(() => {
		clients = [];
		originals = { get: cache.get, set: cache.set, status: cache.status };
		// Transport tests must not read/write the user's saved reports or call Google.
		cache.get = () => null;
		cache.set = () => { throw new Error("Unexpected Google API call"); };
		cache.status = () => [];
	});
	afterEach(async () => {
		await Promise.all(clients.map((client) => client.close()));
		Object.assign(cache, originals);
	});

	async function connect(mode = { pin: "2026-07-28" }) {
		const client = new Client({ name: "ga4-http-test", version: "1.0.0" }, { versionNegotiation: { mode } });
		clients.push(client);
		const transport = new StreamableHTTPClientTransport(new URL(mcp.url),{requestInit:{headers:{Authorization:`Bearer ${transportToken}`}}});
		await client.connect(transport);
		return { client, transport };
	}
	function post(body, headers = {}) {
		return fetch(mcp.url, { method: "POST", headers: { ...HEADERS,Authorization:`Bearer ${transportToken}`, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
	}

	for (const [mode, era, protocol] of [[{ pin: "2026-07-28" }, "modern", "2026-07-28"], ["legacy", "legacy", "2025-11-25"]]) {
		it(`lists all tools and calls inspection tools through the ${era} protocol without sessions`, async () => {
			const { client, transport } = await connect(mode);
			assert.equal(client.getProtocolEra(), era);
			assert.equal(client.getNegotiatedProtocolVersion(), protocol);
			assert.equal(client.getServerVersion().name, "metribee");
			assert.match(client.getInstructions(), /quota is shared/);
			assert.equal(transport.sessionId, undefined);
			const { tools } = await client.listTools();
			assert.deepEqual(tools.map((tool) => tool.name), TOOLS);
			for (const tool of tools) assert.equal(tool.inputSchema.type, "object", tool.name);
			assert.deepEqual(payload(await client.callTool({ name: "get_cache_status", arguments: {} })), { entries: [] });
			const quota = payload(await client.callTool({ name: "get_rate_limit_status", arguments: {} }));
			assert.ok(quota.limits && quota.local && Array.isArray(quota.ga4));
		});
	}

	it("applies Zod v4 defaults before the existing cache lookup", async () => {
		const calls = [];
		cache.get = (tool, params, tier) => {
			calls.push({ tool, params, tier });
			return { value: { headers: ["country", "activeUsers"], rows: [["India", "7"]] }, ageSeconds: 2, ttlSeconds: 60 };
		};
		const { client } = await connect();
		const result = payload(await client.callTool({ name: "run_realtime_report", arguments: { propertyId: "123456789" } }));
		assert.deepEqual(calls, [{
			tool: "run_realtime_report", tier: "realtime",
			params: { propertyId: "123456789", dimensions: ["country"], metrics: ["activeUsers"], minutesAgo: 29, limit: 10 },
		}]);
		assert.deepEqual(result.rows, [["India", "7"]]);
		assert.deepEqual(result._cache, { hit: true, ageSeconds: 2, ttlSeconds: 60 });
	});

	it("exposes a current capability catalog as structured content", async () => {
		const { client } = await connect();
		const result = await client.callTool({ name: "get_capabilities", arguments: {} });
		assert.deepEqual(result.structuredContent, payload(result));
		assert.ok(result.structuredContent.reports.some(report => report.id === "revenue-key-events"));
		assert.equal(result.structuredContent.limits.maxDays, 90);
	});

	it("publishes read/write annotations, resources and a focused analysis prompt", async () => {
		const { client } = await connect();
		const { tools } = await client.listTools();
		for (const tool of tools) assert.equal(tool.annotations.readOnlyHint, ![...ACCOUNT_WRITE_TOOL_NAMES, "save_analysis_definition", "delete_analysis_definition", "save_funnel", "delete_funnel", 'duplicate_funnel', 'import_funnels', "save_widget", "delete_widget", "request_indexing"].includes(tool.name), tool.name);
		assert.equal(tools.find(tool => tool.name === "delete_funnel").annotations.destructiveHint, true);
		const resources = await client.listResources();
		assert.deepEqual(resources.resources.map(resource => resource.uri), ["ga4://capabilities", "ga4://query-guide"]);
		const resource = await client.readResource({ uri: "ga4://capabilities" });
		assert.ok(JSON.parse(resource.contents[0].text).reports.length > 20);
		const prompts = await client.listPrompts();
		assert.ok(prompts.prompts.some(prompt => prompt.name === "analyze_property"));
		const prompt = await client.getPrompt({ name: "analyze_property", arguments: { propertyId: "123", question: "Which pages grew?" } });
		assert.match(prompt.messages[0].content.text, /one property only/);
	});

	it("validates new tool dates, unsupported filters and exclusive funnel inputs before services", async () => {
		const { client } = await connect();
		for (const [name, args] of [
			["get_dashboard_report", { propertyId: "123", report: "overview", startDate: "2026-02-30" }],
			["get_retention_report", { propertyId: "123", filters: [] }],
			["analyze_funnel", { propertyId: "123" }],
			["analyze_funnel", { propertyId: "123", funnelId: 1, steps: [{ type: "event", value: "first_visit" }, { type: "event", value: "purchase" }] }],
		]) {
			const result = await client.callTool({ name, arguments: args });
			assert.equal(result.isError, true, name);
			assert.match(result.content[0].text, /validation error/);
		}
	});

	it("reports configuration without returning credentials", async () => {
		const { client } = await connect();
		const result = await client.callTool({ name: "get_setup_status", arguments: {} });
		const status = result.structuredContent;
		assert.equal(typeof status.configured, "boolean");
		assert.equal(status.verification, undefined);
		assert.equal(typeof status.searchConsole.configured, 'boolean');
		assert.equal(typeof status.pageSpeed.configured, 'boolean');
		for (const secret of [process.env.GA4_PRIVATE_KEY, process.env.GA4_OAUTH_REFRESH_TOKEN, process.env.GA4_OAUTH_CLIENT_SECRET, process.env.GSC_PRIVATE_KEY, process.env.PSI_API_KEY].filter(Boolean)) {
			assert.ok(!JSON.stringify(status).includes(secret));
		}
	});

	it("rejects invalid tool arguments before touching Google", async () => {
		cache.get = () => { throw new Error("Validation must run before the cache"); };
		const { client } = await connect();
		for (const args of [{}, { propertyId: 123 }, { propertyId: "123", minutesAgo: 31 }]) {
			const result = await client.callTool({ name: "run_realtime_report", arguments: args });
			assert.equal(result.isError, true);
			assert.match(result.content[0].text, /Input validation error/);
		}
	});

	it("preserves the report size guard through the HTTP transport", async () => {
		const { client } = await connect();
		const result = payload(await client.callTool({ name: "run_report", arguments: {
			propertyId: "123", startDate: "7daysAgo", endDate: "today",
			dimensions: ["pagePath"], metrics: ["sessions"],
		} }));
		assert.equal(result.error, "report_too_big");
		assert.match(result.reason, /orderBys/);
	});

	it("isolates concurrent HTTP calls across clients", async () => {
		const connections = await Promise.all([connect(), connect("legacy"), connect()]);
		const results = await Promise.all(connections.map(async ({ client }) => Promise.all([
			client.listTools(), client.callTool({ name: "get_cache_status", arguments: {} }),
		])));
		for (const [tools, result] of results) {
			assert.equal(tools.tools.length, TOOLS.length);
			assert.deepEqual(payload(result), { entries: [] });
		}
	});

	it("streams POST responses without assigning a session", async () => {
		const response = await post({ jsonrpc: "2.0", id: 7, method: "tools/list" });
		assert.equal(response.status, 200);
		assert.match(response.headers.get("content-type"), /^text\/event-stream/);
		assert.equal(response.headers.get("mcp-session-id"), null);
		assert.equal(response.headers.get("x-accel-buffering"), "no");
		const data = (await response.text()).split("\n").find((line) => line.startsWith("data: "));
		const message = JSON.parse(data.slice(6));
		assert.equal(message.id, 7);
		assert.equal(message.result.tools.length, TOOLS.length);
	});

	it("acknowledges initialized notifications and rejects legacy session operations", async () => {
		const notification = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
		assert.equal(notification.status, 202);
		assert.equal(await notification.text(), "");
		for (const method of ["GET", "DELETE"]) {
			const response = await fetch(mcp.url, { method, headers: { ...HEADERS, Authorization:`Bearer ${transportToken}` } });
			assert.equal(response.status, 405, method);
			assert.ok((await response.json()).error);
		}
	});

	it("returns protocol errors for malformed JSON, large bodies and unsupported versions", async () => {
		const malformed = await post("{broken");
		assert.equal(malformed.status, 400);
		assert.equal((await malformed.json()).error.code, -32700);
		const large = await post({ data: "x".repeat(110000) });
		assert.equal(large.status, 413);
		assert.match((await large.json()).error.message, /too large/);
		const unsupported = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { "MCP-Protocol-Version": "2099-01-01" });
		assert.equal(unsupported.status, 400);
		assert.ok((await unsupported.json()).error);
	});

	it("rejects unapproved hosts and origins and admits configured proxy hostnames", async () => {
		for (const headers of [{ Host: "unapproved.example" }, { Origin: "https://unapproved.example" }, { Origin: "null" }]) {
			assert.equal(await rawPost(mcp.url, headers), 403, JSON.stringify(headers));
		}
		for (const headers of [{ Origin: "http://localhost:5483" }, { Host: "ga4.example.com:443", Origin: "https://client.example.com:8443" }]) {
			assert.equal(await rawPost(mcp.url, headers), 200, JSON.stringify(headers));
		}
	});

	for (const extras of [{}, { MCP_ALLOWED_HOSTS: " extra.example, second.example ", MCP_ALLOWED_ORIGINS: "client.example" }]) {
		it(`allows the public URL hostname with ${Object.keys(extras).length ? "additional allowlists" : "no other proxy configuration"}`, async () => {
			const proxy = await startStandalone({ authRuntime, env: {
				MCP_PORT: "0", MCP_PUBLIC_URL: " https://MetriBee.102417.xyz:8443/mcp ", ...extras,
			} });
			try {
				for (const headers of [
					{ Host: "metribee.102417.xyz" },
					{ Host: "metribee.102417.xyz:8443", Origin: "https://metribee.102417.xyz:8443" },
					{ Origin: "http://localhost:5483" },
					...(extras.MCP_ALLOWED_HOSTS ? [{ Host: "extra.example", Origin: "https://client.example" }, { Host: "second.example" }] : []),
				]) {
					assert.equal(await rawPost(proxy.url, headers), 200, JSON.stringify(headers));
				}
				for (const headers of [
					{ Host: "unapproved.example" },
					{ Host: "metribee.102417.xyz.attacker.example" },
					{ Host: "metribee.102417.xyz", Origin: "https://unapproved.example" },
					{ Origin: "null" },
					{ Host: "unapproved.example", "X-Forwarded-Host": "metribee.102417.xyz" },
					...(!extras.MCP_ALLOWED_HOSTS ? [{ Host: "extra.example" }, { Origin: "https://client.example" }] : []),
				]) {
					assert.equal(await rawPost(proxy.url, headers), 403, JSON.stringify(headers));
				}
				const response = await fetch(proxy.url, { method: "OPTIONS", headers: {
					Origin: "https://metribee.102417.xyz:8443", "Access-Control-Request-Method": "POST",
				} });
				assert.equal(response.status, 204);
				assert.equal(response.headers.get("access-control-allow-origin"), "https://metribee.102417.xyz:8443");
				await response.text();
			} finally {
				await proxy.close();
			}
		});
	}

	it("rejects malformed public URLs before starting the endpoint without exposing their contents", () => {
		for (const url of ["not-a-url", "//ga4.example.com/mcp", "ftp://ga4.example.com/mcp", "file:///mcp", "https://user:secret@ga4.example.com/mcp"]) {
			assert.throws(() => createMcpEndpoint({ env: { MCP_PUBLIC_URL: url } }), (error) => {
				assert.match(error.message, /MCP_PUBLIC_URL must be an absolute http:\/\/ or https:\/\/ URL without credentials/);
				assert.ok(!error.message.includes(url));
				return true;
			});
		}
	});

	it("allows browser preflights only for approved origins", async () => {
		for (const [origin, status] of [["https://client.example.com", 204], ["https://unapproved.example", 403]]) {
			const response = await fetch(mcp.url, { method: "OPTIONS", headers: {
				Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,mcp-protocol-version",
			} });
			assert.equal(response.status, status);
			if (status === 204) {
				assert.equal(response.headers.get("access-control-allow-origin"), origin);
				assert.match(response.headers.get("access-control-allow-headers"), /mcp-protocol-version/);
			}
			await response.text();
		}
	});

	it("exposes standalone health and validates the standalone port", async () => {
		const health = await fetch(new URL("/healthz", mcp.url));
		assert.deepEqual(await health.json(), { ok: true, version: require("../package.json").version, transport: "streamable-http" });
		for (const port of ["bad", "-1", "65536", "1.5"]) {
			await assert.rejects(startStandalone({ env: { MCP_PORT: port } }), /MCP_PORT/);
		}
	});
});

describe("MCP HTTP command", function () {
	this.timeout(10000);
	it("starts from another working directory and stops on SIGTERM", async () => {
		const directory = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'metribee-mcp-cli-'));
		const child = spawn(process.execPath, [require.resolve("../mcp-server/index")], {
			cwd: require("node:os").tmpdir(), env: { ...process.env, DEMO: '1', DATABASE_PATH: require('node:path').join(directory, 'users.sqlite'), MCP_HOST: "127.0.0.1", MCP_PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
		});
		try {
			const url = await new Promise((resolve, reject) => {
				let output = "";
				child.on("error", reject);
				child.on("exit", (code) => reject(new Error(`MCP exited before listening (${code})`)));
				child.stdout.on("data", (chunk) => {
					output += chunk;
					const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/mcp/);
					if (match) resolve(match[0]);
				});
			});
			assert.equal((await fetch(new URL("/healthz", url))).status, 200);
			const exited = once(child, "exit");
			child.kill("SIGTERM");
			assert.deepEqual(await exited, [0, null]);
		} finally {
			if (child.exitCode === null) child.kill("SIGKILL");
			require('node:fs').rmSync(directory, {recursive:true,force:true});
		}
	});
});
