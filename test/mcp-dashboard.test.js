const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDashboardService, capabilities, dateWindow } = require("../mcp-server/lib/dashboard");
const { createFunnelStore } = require("../lib/funnelStore");
const realGuard = require("../mcp-server/lib/guard");

const properties = [
	{
		id: "123",
		site: "Main site",
		domain: "example.com",
		accountId: "7",
		accountName: "Main account",
		timeZone: "Asia/Kolkata",
		currencyCode: "INR",
	},
	{ id: "456", site: "Other site", domain: "other.example", accountId: "8", accountName: "Other account", timeZone: "UTC" },
];
const now = () => new Date("2026-10-22T04:00:00Z");
const row = (dimensions, metrics) => ({
	dimensionValues: dimensions.map((value) => ({ value })),
	metricValues: metrics.map((value) => ({ value: String(value) })),
});

function report(request) {
	if (request.cohortSpec) {
		const rows = request.cohortSpec.cohorts.map((cohort) => row([cohort.name, "0"], [10, 10]));
		return { rows, rowCount: rows.length };
	}
	const dimensions = request.dimensions.map((d) => d.name),
		metrics = request.metrics.map((m) => m.name);
	const values = {
		pagePath: "/pricing",
		pageTitle: "Pricing",
		landingPage: "/pricing",
		country: "India",
		countryId: "IN",
		hostName: "example.com",
		pageReferrer: "https://example.com/start",
		eventName: "purchase",
		date: "20261021",
		dateHour: "2026102104",
		deviceCategory: "desktop",
		sessionSource: "google",
		sessionMedium: "organic",
		nthDay: "0",
	};
	const rows = [
		row(
			dimensions.map((d) => values[d] || "Test"),
			metrics.map((m) => (/rate/i.test(m) ? 0.5 : 10)),
		),
	];
	return {
		rows,
		rowCount: rows.length,
		metadata: { timeZone: "Asia/Kolkata", currencyCode: "INR" },
		dimensionHeaders: dimensions.map((name) => ({ name })),
		metricHeaders: metrics.map((name) => ({ name })),
	};
}

function harness(options = {}) {
	const calls = [],
		records = [],
		cache = new Map(),
		callOptions = [];
	const ledger = {
		...require("../lib/quotaLedger"),
		list: () => [],
		get: () => null,
		cooldowns: () => [],
		status: () => ({ status: "ok", projectHourLeft: 13000 }),
		blocked: () => null,
		block() {},
		record: (...args) => records.push(args),
		...options.ledger,
	};
	const guard = { ...realGuard, checkPropertySpread: () => null, checkQuota: () => null, ...options.guard };
	const beta = {
		async runReport(request, rpcOptions) {
			calls.push(request);
			callOptions.push(rpcOptions);
			return [await (options.report || report)(request)];
		},
		async runRealtimeReport(request) {
			calls.push(request);
			return [report({ ...request, dimensions: request.dimensions || [], metrics: request.metrics || [] })];
		},
	};
	const alpha = {
		async runFunnelReport(request) {
			calls.push(request);
			return [
				{
					funnelTable: {
						dimensionHeaders: [{ name: "funnelStepName" }],
						metricHeaders: [{ name: "activeUsers" }],
						rows: request.funnel.steps.map((step, i) => row([`${i + 1}. ${step.name}`], [10 - i * 2])),
					},
				},
			];
		},
	};
	const service = createDashboardService({
		properties: async () => ({ properties, source: "cached" }),
		read: async (namespace, key) => cache.get(`${namespace}:${key}`) || null,
		write: async (namespace, key, value) => cache.set(`${namespace}:${key}`, structuredClone(value)),
		now,
		dataClient: () => beta,
		alphaClient: () => alpha,
		adminClient: () => ({
			getProperty: async () => {
				throw new Error("Unexpected Admin API call");
			},
		}),
		throttle: (_family, call) => call(),
		guard,
		ledger,
		snapshot: async () => ({ snapshot: null, adsense: null }),
		...options.deps,
	});
	return { service, calls, records, cache, callOptions };
}

describe("MCP native dashboard integration", function () {
	this.timeout(10000);
	it("executes a native report through the official MCP client with defaults and structured results", async () => {
		const { createMcpHandler } = require("@modelcontextprotocol/server");
		const { Client, StreamableHTTPClientTransport } = require("@modelcontextprotocol/client");
		const { createServer } = require("../mcp-server");
		const { service, calls, callOptions } = harness();
		const handler = createMcpHandler(() => createServer({ dashboardService: service }));
		const client = new Client({ name: "native-report-test", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
		try {
			await client.connect(
				new StreamableHTTPClientTransport(new URL("http://mcp.test/mcp"), {
					fetch: (input, init) => handler.fetch(new Request(input, init)),
				}),
			);
			const result = await client.callTool({ name: "get_dashboard_report", arguments: { propertyId: "123", report: "overview" } });
			assert.equal(result.isError, undefined);
			assert.equal(result.structuredContent.data.sessions, 10);
			assert.deepEqual(result.structuredContent, JSON.parse(result.content[0].text));
			assert.equal(calls[0].dateRanges[0].startDate, "2026-10-16");
			assert.equal(callOptions[0].retry, null);
			assert.equal(callOptions[0].timeout, 20000);
		} finally {
			await client.close();
			await handler.close();
		}
	});
	it("discovers current reports without UI-only metadata or Google calls", () => {
		const catalog = capabilities();
		for (const name of ["countries", "revenue-key-events", "regions", "cities", "operating-systems"])
			assert.ok(catalog.reports.some((report) => report.id === name));
		assert.ok(catalog.additionalReports.includes("what-changed"));
		assert.ok(catalog.additionalReports.includes("live-users"));
		assert.equal(catalog.limits.propertiesPerQuestion, 1);
		assert.equal(catalog.reports[0].icon, undefined);
	});

	it("serves live user aggregates through realtime quota guards and the shared cache", async () => {
		let low = false;
		const { service, calls } = harness({ guard: { checkQuota: (_id, pool) => low && pool === "realtime" ? { error: "quota_low" } : null } });
		const args = { propertyId: "123", report: "live-users", limit: 1 };
		const first = await service.execute("get_dashboard_report", args);
		assert.equal(first.error, undefined, JSON.stringify(first));
		assert.equal(first.data.activeUsers, 10);
		assert.equal(first.apiCalls, 4);
		assert.ok(first.quota.realtime);
		assert.ok(calls.every(call => call.property === "properties/123" && call.minuteRanges[0].startMinutesAgo === 4 && call.returnPropertyQuota));
		assert.match(first.limitations[0], /past 5 minutes/);
		low = true;
		const cached = await service.execute("get_dashboard_report", args);
		assert.equal(cached.error, undefined);
		assert.equal(cached.apiCalls, 0);
		assert.ok(cached.quota.realtime);
		const refused = await service.execute("get_dashboard_report", { ...args, propertyId: "456" });
		assert.equal(refused.error, "quota_low");
		assert.equal(calls.length, 4);
		const filtered = await service.execute("get_dashboard_report", { ...args, filters: [{ parameter: "country", type: "equals", value: ["US"] }] });
		assert.ok(filtered.error);
		assert.equal(calls.length, 4);
	});

	it("limits each live user group and preserves explicit truncation", async () => {
		const { service } = harness({ deps: { dataClient: () => ({ runRealtimeReport: async request => [{
			rows: request.dimensions.length ? [row(["One", "US"], [3]), row(["Two", "CN"], [2])] : [row([], [5, 8])],
			rowCount: request.dimensions.length ? 80 : 1,
		}] }) } });
		const result = await service.execute("get_dashboard_report", { propertyId: "123", report: "live-users", limit: 1 });
		assert.equal(result.error, undefined, JSON.stringify(result));
		for (const key of ["countries", "devices", "pages"]) {
			assert.equal(result.data[key].rows.length, 1);
			assert.equal(result.data[key].returned, 1);
			assert.equal(result.data[key].totalCount, 80);
			assert.equal(result.data[key].truncated, true);
		}
		assert.equal(result.dataQuality.truncated, true);
	});

	it("searches and paginates the dashboard's property/account metadata", async () => {
		const { service, calls } = harness();
		const page = await service.listProperties({ search: "main account", limit: 1 });
		assert.deepEqual(
			page.properties.map((p) => p.propertyId),
			["123"],
		);
		assert.equal(page.properties[0].accountName, "Main account");
		assert.equal(page.total, 1);
		assert.equal(calls.length, 0);
		assert.deepEqual(
			(await service.listProperties({ accountId: "8" })).properties.map((p) => p.propertyId),
			["456"],
		);
	});

	it("resolves dates in the property time zone and validates the 90-day budget", () => {
		assert.deepEqual(dateWindow({ range: "7d" }, { timeZone: "Pacific/Kiritimati" }, new Date("2026-10-22T20:00Z")), {
			start_date: "2026-10-17",
			end_date: "2026-10-23",
		});
		for (const args of [{ startDate: "2026-02-30" }, { startDate: "2026-01-01", endDate: "2026-10-22" }, { startDate: "2026-10-23" }])
			assert.throws(() => dateWindow(args, properties[0], now()));
	});

	it("uses native overview calculations, filters, currency, shared cache and fresh quota", async () => {
		const { service, calls } = harness();
		const args = { propertyId: "123", report: "overview", range: "7d", filters: [{ parameter: "country", type: "equals", value: ["IN"] }] };
		const first = await service.execute("get_dashboard_report", args);
		assert.equal(first.data.sessions, 10);
		assert.equal(first.data.currency_code, "INR");
		assert.equal(first.apiCalls, 1);
		assert.equal(first.quota.core.status, "ok");
		assert.equal(calls[0].property, "properties/123");
		assert.equal(calls[0].returnPropertyQuota, true);
		assert.equal(calls[0].dimensionFilter.filter.fieldName, "countryId");
		const second = await service.execute("get_dashboard_report", args);
		assert.equal(second.apiCalls, 0);
		assert.equal(second.reportStatus.cacheStatus, "cached");
		assert.equal(second.quota.core.status, "ok");
		assert.equal(calls.length, 1);
	});

	it("shares rolling 24-hour dashboard queries and their cache through MCP", async () => {
		const { service, calls } = harness();
		const args = { propertyId: '123', report: 'overview', pastMinutes: 1440 };
		const first = await service.execute('get_dashboard_report', args);
		assert.equal(first.data.sessions, 10);
		assert.equal(first.apiCalls, 1);
		assert.equal(calls[0].dimensionFilter.filter.fieldName, 'dateHourMinute');
		const regex = new RegExp(`^(?:${calls[0].dimensionFilter.filter.stringFilter.value})$`);
		assert.equal(regex.test('202610210930'), true);
		assert.equal(regex.test('202610220929'), true);
		assert.equal(regex.test('202610220930'), false);
		assert.equal((await service.execute('get_dashboard_report', args)).apiCalls, 0);
		const unsupported = await service.execute('get_retention_report', { propertyId: '123', pastMinutes: 1440 });
		assert.ok(unsupported.error);
		assert.equal(calls.length, 1);
	});

	for (const [tool, extra, expected] of [
		["get_pages_report", { view: "entry", limit: 1 }, (result) => result.data.data[0].entries === 10],
		[
			"get_events_report",
			{ report: "names/stats", limit: 1 },
			(result) => result.data[0].eventName === "purchase" && Array.isArray(result.data[0].series),
		],
		["get_event_activity", { eventName: "purchase" }, (result) => result.rows[0].name === "purchase"],
		[
			"get_journeys_report",
			{ limit: 10 },
			(result) =>
				result.journeys[0].path[0] === "/start" &&
				result.metric === "screenPageViews" &&
				result.totalPageviews === 10 &&
				result.totalSessions === undefined,
		],
		["get_retention_report", { bucket: "week" }, (result) => result.cohorts.length > 0 && result.timeZone === "Asia/Kolkata"],
		["get_site_status", { compare: true }, (result) => !!result.data],
	]) {
		it(`serves ${tool} through the existing native domain logic`, async () => {
			const { service, calls } = harness();
			const result = await service.execute(tool, { propertyId: "123", range: "7d", ...extra });
			assert.equal(result.error, undefined, JSON.stringify(result));
			assert.ok(expected(result), JSON.stringify(result));
			assert.ok(calls.length > 0);
			assert.ok(calls.every((call) => call.property === "properties/123"));
		});
	}
	it("exposes ordered Journey paths and exact session membership without aggregate queries or quota reads", async () => {
		const records = Array.from({ length: 5 }, (_, i) => ({ session_id: `session-${i}`, user_id: `visitor-${i}`, country: "US",
			events: ["/", "/docs", "/pricing", "/signup", "/done"].map((pathname, index) => ({ type: "pageview", pathname, timestamp: `2026-10-20 10:00:0${index}` })) }));
		const { service, calls } = harness({ deps: { journeySessions: async () => records }, ledger: { status: () => { throw new Error("Ordered journeys must not read GA4 quota"); } } });
		const args = { propertyId: "123", range: "7d", mode: "sessions", steps: 4, limit: 2 };
		const result = await service.execute("get_journeys_report", args);
		assert.equal(result.error, undefined, JSON.stringify(result));
		assert.equal(result.metric, "sessions");
		assert.deepEqual(result.journeys[0].path, ["/", "/docs", "/pricing", "/signup"]);
		assert.equal(result.summary.avgPathLength, 5);
		assert.equal(result.summary.topExit.page, "/done");
		assert.equal(result.apiCalls, 0);
		assert.deepEqual(result.quota, {});
		const drawer = await service.execute("get_journeys_report", { ...args, path: result.journeys[0].path, offset: 1 });
		assert.equal(drawer.returned, 2);
		assert.equal(drawer.truncated, true);
		assert.equal(drawer.data[0].session_id, "session-1");
		assert.equal(calls.length, 0);
	});

	it("preserves GA4 truncation and privacy observations on native report cache hits", async () => {
		const { service } = harness({
			report: (request) => ({ ...report(request), rowCount: 500, metadata: { subjectToThresholding: true, samplingMetadatas: [{}] } }),
		});
		const args = { propertyId: "123", report: "traffic-sources", range: "7d" };
		for (let attempt = 0; attempt < 2; attempt++) {
			const result = await service.execute("get_dashboard_report", args);
			assert.deepEqual(result.dataQuality, { truncated: true, thresholded: true, sampled: true });
			assert.equal(result.apiCalls, attempt === 0 ? 1 : 0);
		}
	});

	it("refuses unknown properties, unsupported filters and invalid windows before reports", async () => {
		const { service, calls } = harness();
		const missing = await service.execute("get_dashboard_report", { propertyId: "999", report: "overview" });
		assert.equal(missing.error, "property_not_found");
		for (const args of [
			{ filters: [{ parameter: "not_supported", type: "equals", value: ["x"] }] },
			{ segment: "unknown" },
			{ startDate: "2020-01-01", endDate: "2026-01-01" },
		]) {
			const result = await service.execute("get_dashboard_report", { propertyId: "123", report: "overview", ...args });
			assert.ok(result.error);
		}
		assert.equal(calls.length, 0);
	});

	it("blocks cache misses at the shared quota gate while still serving cached data", async () => {
		let low = false;
		const { service, calls } = harness({
			guard: { checkQuota: () => (low ? { error: "quota_low", retryAfter: "within the hour" } : null) },
		});
		const args = { propertyId: "123", report: "overview", range: "7d" };
		await service.execute("get_dashboard_report", args);
		low = true;
		assert.equal((await service.execute("get_dashboard_report", args)).apiCalls, 0);
		const refused = await service.execute("get_dashboard_report", { ...args, range: "28d" });
		assert.equal(refused.error, "quota_low");
		assert.equal(refused.retryAfter, "within the hour");
		assert.equal(calls.length, 1);
	});

	it("shares simultaneous identical analyses rather than duplicating Google calls", async () => {
		const { service, calls } = harness({
			report: async (request) => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				return report(request);
			},
		});
		await Promise.all(Array.from({ length: 5 }, () => service.execute("get_dashboard_report", { propertyId: "123", report: "overview" })));
		assert.equal(calls.length, 1);
	});
	it("refreshes quota for only the selected property even when reserve is low", async () => {
		const requests = [];
		const quota = {
			tokensPerDay: { remaining: 190000 },
			tokensPerHour: { remaining: 39000 },
			tokensPerProjectPerHour: { remaining: 13000 },
		};
		const { service, records } = harness({
			guard: { checkQuota: () => ({ error: "quota_low" }) },
			deps: {
				isDemo: () => false,
				alphaClient: () => ({
					async getPropertyQuotasSnapshot(request) {
						requests.push(request);
						return [{ corePropertyQuota: quota, realtimePropertyQuota: quota, funnelPropertyQuota: quota }];
					},
				}),
			},
		});
		const result = await service.execute("refresh_property_quota", { propertyId: "123" });
		assert.equal(result.refresh.total, 1);
		assert.equal(result.refresh.refreshed, 1);
		assert.equal(requests.length, 1);
		assert.equal(requests[0].name, "properties/123/propertyQuotasSnapshot");
		assert.deepEqual(
			records.map((item) => item[1]),
			["core", "realtime", "funnel"],
		);
	});

	it("stops native directory fan-out after the 20-call analysis budget", async () => {
		const { service, calls } = harness({
			report: (request) => {
				const value = report(request);
				if (request.dimensions[0]?.name === "pagePath") {
					value.rows = Array.from({ length: 50 }, (_, index) =>
						row(
							request.dimensions.map((d) => (d.name === "pagePath" ? `/section-${Math.floor(index / 2)}/page-${index}` : "Title")),
							request.metrics.map(() => 10),
						),
					);
					value.rowCount = value.rows.length;
				}
				return value;
			},
		});
		const result = await service.execute("get_pages_report", { propertyId: "123", group: "section" });
		assert.equal(result.error, "analysis_budget_exceeded");
		assert.equal(result.apiCalls, 20);
		assert.equal(calls.length, 20);
	});
});

describe("MCP durable funnels", () => {
	let directory;
	afterEach(() => {
		if (directory) fs.rmSync(directory, { recursive: true, force: true });
	});
	it("shares native create/update/list/analyze/delete definitions without spending report tokens on writes", async () => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-funnels-"));
		const store = createFunnelStore({ directory });
		const { service, calls } = harness({ deps: { store } });
		const steps = [
			{ type: "page", value: "/pricing", name: "Pricing" },
			{ type: "event", value: "purchase", name: "Purchase", propertyFilters: [{ key: "plan", value: "pro" }] },
		];
		const saved = await service.execute("save_funnel", { propertyId: "123", name: "Signup", steps });
		assert.equal(saved.success, true, JSON.stringify(saved));
		assert.equal(calls.length, 0);
		const listed = await service.execute("list_saved_funnels", { propertyId: "123" });
		assert.equal(listed.data[0].steps[1].propertyFilters[0].key, "plan");
		const analyzed = await service.execute("analyze_funnel", { propertyId: "123", funnelId: saved.funnelId, range: "7d" });
		assert.equal(analyzed.ordered, true);
		assert.deepEqual(
			analyzed.data.map((step) => step.users),
			[10, 8],
		);
		assert.equal(analyzed.data[0].sessions, undefined);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].funnel.isOpenFunnel, false);
		assert.ok(calls[0].funnel.steps[1].filterExpression.funnelEventFilter.funnelParameterFilterExpression);
		await service.execute("save_funnel", { propertyId: "123", name: "Renamed", funnelId: saved.funnelId, steps });
		assert.equal((await store.list("123"))[0].name, "Renamed");
		await service.execute("delete_funnel", { propertyId: "123", funnelId: saved.funnelId });
		assert.deepEqual(await store.list("123"), []);
		assert.equal(calls.length, 1);
		assert.equal((await service.execute("analyze_funnel", { propertyId: "123", funnelId: saved.funnelId })).error, "report_unavailable");
	});
	it("reuses native saved metric widgets and previews without enabling sharing", async () => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-widgets-"));
		const widgetStore = require("../lib/embedStore").createEmbedStore({ directory });
		const { service, calls } = harness({ deps: { widgetStore } });
		const config = { ...require("../controllers/widgetConfig").defaultWidgetConfig(), name: "MCP test", period: { preset: "last7" } };
		const saved = await service.execute("save_widget", { propertyId: "123", config });
		assert.ok(saved.data?.id, JSON.stringify(saved));
		assert.equal(calls.length, 0);
		assert.equal((await widgetStore.get("123")).embedEnabled, false);
		assert.equal((await service.execute("list_saved_widgets", { propertyId: "123", search: "MCP" })).total, 1);
		const preview = await service.execute("get_widget_report", { propertyId: "123", widgetId: saved.data.id });
		assert.equal(preview.error, undefined, JSON.stringify(preview));
		assert.equal(preview.data.values.activeUsers, 10);
		assert.equal(preview.data.values.bounceRate, 50);
		assert.equal(preview.data.currencyCode, "INR");
		assert.equal(calls.length, 3);
		const cached = await service.execute("get_widget_report", { propertyId: "123", widgetId: saved.data.id });
		assert.equal(cached.apiCalls, 0);
		assert.equal((await widgetStore.get("123")).embedEnabled, false);
		await service.execute("delete_widget", { propertyId: "123", widgetId: saved.data.id });
		assert.equal(await widgetStore.getWidget("123", saved.data.id), null);
	});
});

describe("MCP demo isolation", () => {
	it("never calls live quota methods in demo mode", () => {
		const live = require("../lib/quotaLedger");
		const adapter = require("../mcp-server/lib/ledger");
		const originalDemo = process.env.DEMO;
		const originals = {};
		try {
			process.env.DEMO = "1";
			for (const name of ["record", "get", "list", "status", "blocked", "block", "cooldowns", "gcpProject"]) {
				originals[name] = live[name];
				live[name] = () => {
					throw new Error(`Demo accessed live quota: ${name}`);
				};
			}
			adapter.record("123", "core", {});
			assert.equal(adapter.status("123", "core").status, "demo");
			assert.deepEqual(adapter.list(), []);
			assert.deepEqual(adapter.cooldowns(), []);
			assert.equal(adapter.blocked("123", "core"), null);
			assert.equal(adapter.gcpProject(), "demo");
		} finally {
			Object.assign(live, originals);
			if (originalDemo === undefined) delete process.env.DEMO;
			else process.env.DEMO = originalDemo;
		}
	});
	it("does not serve demo MCP cache entries in live mode", () => {
		const cache = require("../mcp-server/lib/cache");
		const originalDemo = process.env.DEMO;
		const tool = `mcp-isolation-${require("node:crypto").randomUUID()}`;
		const directory = path.resolve(__dirname, "../mcp-server/.cache/demo");
		try {
			process.env.DEMO = "1";
			cache.set(tool, {}, "report", { demo: true });
			assert.deepEqual(cache.get(tool, {}, "report").value, { demo: true });
			process.env.DEMO = "";
			assert.equal(cache.get(tool, {}, "report"), null);
		} finally {
			if (fs.existsSync(directory))
				for (const file of fs.readdirSync(directory).filter((file) => file.includes(tool))) fs.unlinkSync(path.join(directory, file));
			if (originalDemo === undefined) delete process.env.DEMO;
			else process.env.DEMO = originalDemo;
		}
	});
});
