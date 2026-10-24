#!/usr/bin/env node
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Development sources include shared TypeScript controllers; Docker ships compiled .js.
try {
	if (!require.extensions[".ts"]) require("ts-node").register({ transpileOnly: true, files: true, project: require("path").join(__dirname, "..", "tsconfig.json") });
} catch (err) {
	if (err.code !== "MODULE_NOT_FOUND") throw err;
}

const { z } = require("zod");
const { McpServer } = require("@modelcontextprotocol/server");
const { version } = require("../package.json");

const { getAdminClient, getDataClient, getAlphaDataClient } = require("./lib/clients");
const { getScopedAuthClient } = require("./lib/auth");
const cache = require("./lib/cache");
const rateLimit = require("./lib/rateLimit");
const guard = require("./lib/guard");
const ledger = require("./lib/ledger");
const { registerDashboardTools } = require("./lib/tools");
const setup = require("../lib/setupCheck");
setup.onCredentialsChange(require("../controllers/ga4Service").resetClients);

const INSTRUCTIONS = `GA4 quota is shared and small. Spend it carefully.

Limits per property, per pool (core, realtime and funnel are separate pools):
- 200,000 tokens per day, reset at midnight Pacific.
- 40,000 tokens per hour (rolling), and 14,000 per hour for the whole GCP project. MetriBee uses the same project budget.
- 10 concurrent requests, 10 server errors (500/503) per project per hour, 120 potentially thresholded requests per hour.
- Cost grows with rows, dimensions, metrics, filters, date range length and high-cardinality dimensions. GA4 360 properties get 10x.

Rules:
- Work on one property per question. Use list_properties to find current site/account names and get_capabilities to choose a report. Never loop reports over many properties. The server refuses after ${guard.MAX_PROPERTIES} distinct properties in ${guard.WINDOW_MS / 60000} minutes.
- Ask for the smallest report that answers: orderBys plus a small limit, a dimensionFilter instead of pulling rows to filter, the shortest date range, few dimensions. High-cardinality dimensions (pagePath, pageLocation, pageTitle, landingPage*, customEvent:*, customUser:*) need orderBys and limit at most 50.
- Every GA4 result has quota: {cost, projectHourLeft, hourLeft, dayLeft, status}. On status low, finish with what you have and tell the user. On a quota_low error, do not retry; report the reset time from the error.
- Results are cached (report 1h, realtime 60s, metadata 6h). Repeating the same call is free.
- Use get_rate_limit_status to see quota per property without spending tokens.`;

const DASHBOARD_INSTRUCTIONS = `Prefer the focused dashboard tools for pages, events, journeys, retention, site status, funnels and metric widgets; they share the page's report logic and cache. Standard reports accept at most 90 calendar days; native widget periods support at most 366 days. Every analysis makes at most 20 scoped GA4 calls with per-call quota and concurrency checks. apiCalls counts those analysis requests; property discovery may separately refresh Admin metadata. Shared-cache hits spend no report tokens. Inspect warnings, fetchedAt/reportStatus, quota and truncation before making claims.
Journeys are referrer pageview pairs, never complete session paths. Events are aggregates, never individual logs. Retention uses first-visit cohorts and cannot apply audience filters. Funnel/widget definitions are local application data; saving and deleting them requires explicit user intent. Widget previews never enable sharing or generate keys. Do not claim a download click is an installation. Never add currencies across properties without conversion. Use get_setup_status to diagnose configuration without exposing credentials.`;

function createServer(options = {}) {
	const server = new McpServer({ name: "ga4-mcp-server", version }, { instructions: `${INSTRUCTIONS}\n\n${DASHBOARD_INSTRUCTIONS}` });
	function registerTool(name, config, callback) {
		const write = ["request_indexing", "save_funnel", "delete_funnel", "save_widget", "delete_widget"].includes(name);
		return server.registerTool(name, { ...config, annotations: {
			readOnlyHint: !write, destructiveHint: ["delete_funnel", "delete_widget", "request_indexing"].includes(name),
			idempotentHint: !write || name === "delete_funnel" || name === "delete_widget", openWorldHint: !["get_capabilities", "get_cache_status", "get_rate_limit_status", "list_saved_funnels", "save_funnel", "delete_funnel", "list_saved_widgets", "delete_widget"].includes(name),
			...config.annotations,
		} }, async (...args) => {
			try { setup.syncEnvFile(); return await callback(...args); }
			catch (error) { return asText({ error: "tool_failed", message: error.message }); }
		});
	}

	const propertyName = (propertyId) => `properties/${propertyId}`;

	/**
	 * Cache, then guards, then rate limit, then the call. Shared by every GA4 tool.
	 * - propertyId: property-scoped tools; adds the distinct-properties check and the per-property concurrency cap.
	 * - pool: set on tools whose responses carry propertyQuota; adds the shared quota gate and ledger record.
	 *   fn then returns { value, propertyQuota }.
	 * - validate: optional function returning a guard error or null, run on a cache miss only.
	 * Guard errors come back as the result (not thrown) and are never cached.
	 */
	async function cachedCall({ toolName, params, tier, family, fn, propertyId, pool, validate }) {
		const hit = cache.get(toolName, params, tier);
		if (hit) {
			const out = { ...hit.value, _cache: { hit: true, ageSeconds: hit.ageSeconds, ttlSeconds: hit.ttlSeconds } };
			if (pool) out.quota = ledger.status(propertyId, pool);
			return out;
		}
		const refused =
			(validate && validate()) ||
			(propertyId != null && guard.checkPropertySpread(propertyId)) ||
			(pool && guard.checkQuota(propertyId, pool));
		if (refused) return refused;
		const cooldown = pool && ledger.blocked(propertyId, pool);
		if (cooldown) {
			return {
				error: "rate_limited",
				gcpProject: cooldown.gcpProject,
				scope: cooldown.scope,
				retryAfter: new Date(cooldown.until).toISOString(),
				reason: cooldown.reason,
				hint: "GA4 is paused after a rate-limit or server error. Do not retry. Tell the user the project and the time above.",
			};
		}

		const call = () => rateLimit.withRateLimit(family, fn);
		let result;
		try {
			result = propertyId != null ? await guard.inflight(propertyId, call) : await call();
		} catch (err) {
			if (pool) ledger.block(propertyId, pool, err, "mcp");
			const exhausted = pool && guard.exhaustedError(propertyId, pool, err);
			if (exhausted) return exhausted;
			throw err;
		}
		const _cache = { hit: false, ageSeconds: 0, ttlSeconds: cache.TTL_SECONDS[tier] };
		if (!pool) {
			cache.set(toolName, params, tier, result);
			return { ...result, _cache };
		}
		const { value, propertyQuota } = result;
		ledger.record(propertyId, pool, propertyQuota, "mcp");
		cache.set(toolName, params, tier, value);
		const quota = propertyQuota ? ledger.summarize({ at: Date.now(), quota: propertyQuota }) : { status: "unknown" };
		return { ...value, quota, _cache };
	}

	/** Compact JSON, cut to MCP_MAX_RESULT_BYTES by dropping rows from the end. */
	function asText(value) {
		const text = guard.fitResult(value);
		const structuredContent = JSON.parse(text);
		return { content: [{ type: "text", text }], structuredContent,
			...(structuredContent?.error || value?.ok === false ? { isError: true } : {}) };
	}

	const FUNNEL_MAX_ROWS = 100;
	const MONEY_METRIC = /revenue|purchase|value|ltv/i;

	/** Adds the property currency to a report result when any metric is money. Skips guard errors. */
	async function withCurrency(result, propertyId, metrics) {
		if (result.error || !metrics.some((m) => MONEY_METRIC.test(m))) return result;
		const details = await getPropertyDetailsCached(propertyId);
		return details.currencyCode ? { ...result, currencyCode: details.currencyCode } : result;
	}

	/** GA4 rows to compact { headers, rows } arrays. */
	function compactRows(response, dimensions, metrics) {
		return {
			headers: [...dimensions, ...metrics],
			rows: (response.rows || []).map((row) => [
				...(row.dimensionValues || []).map((d) => d.value),
				...(row.metricValues || []).map((m) => m.value),
			]),
		};
	}

	const MATCH_TYPES = ["EXACT", "BEGINS_WITH", "ENDS_WITH", "CONTAINS", "FULL_REGEXP"];
	const dimensionFilterSchema = z.object({
		dimension: z.string().describe("Dimension to filter on, e.g. \"pagePath\""),
		matchType: z.enum(MATCH_TYPES).default("EXACT"),
		value: z.string(),
		caseSensitive: z.boolean().optional(),
	});

	/** One or more simple dimension filters to a GA4 FilterExpression (ANDed). */
	function toFilterExpression(filters) {
		const exprs = filters.map((f) => ({
			filter: {
				fieldName: f.dimension,
				stringFilter: { matchType: f.matchType, value: f.value, caseSensitive: Boolean(f.caseSensitive) },
			},
		}));
		if (!exprs.length) return undefined;
		return exprs.length === 1 ? exprs[0] : { andGroup: { expressions: exprs } };
	}

	// ---------------------------------------------------------------------------
	// Account + property info
	// ---------------------------------------------------------------------------

	registerTool(
		"get_account_summaries",
		{
			description:
				"Lists every GA4 account and its properties for the credentials in use. Admin API, no GA4 tokens. Call it once per session to find a property ID, then work on that one property.",
		},
		async () => {
			const result = await cachedCall({
				toolName: "get_account_summaries",
				params: {},
				tier: "properties",
				family: "admin",
				fn: async () => {
					const [summaries] = await getAdminClient().listAccountSummaries({});
					return {
						accounts: summaries.map((s) => ({
							account: s.account,
							displayName: s.displayName,
							properties: (s.propertySummaries || []).map((p) => ({
								property: p.property,
								displayName: p.displayName,
								propertyType: p.propertyType,
							})),
						})),
					};
				},
			});
			return asText(result);
		},
	);

	/** Shared by the get_property_details tool and the currencyCode lookup on revenue reports below. */
	async function getPropertyDetailsCached(propertyId) {
		return cachedCall({
			toolName: "get_property_details",
			params: { propertyId },
			tier: "properties",
			family: "admin",
			propertyId,
			fn: async () => {
				const [property] = await getAdminClient().getProperty({ name: propertyName(propertyId) });
				return {
					name: property.name,
					displayName: property.displayName,
					timeZone: property.timeZone,
					currencyCode: property.currencyCode,
					industryCategory: property.industryCategory,
					propertyType: property.propertyType,
					createTime: property.createTime,
					parent: property.parent,
				};
			},
		});
	}

	registerTool(
		"get_property_details",
		{
			description:
				"Returns details (display name, time zone, currency, industry, create time) for one GA4 property. Admin API, no GA4 tokens; cached 5 minutes.",
			inputSchema: z.object({ propertyId: z.string().describe("Numeric GA4 property ID, e.g. 123456789") }),
		},
		async ({ propertyId }) => asText(await getPropertyDetailsCached(propertyId)),
	);

	registerTool(
		"list_google_ads_links",
		{
			description: "Lists the Google Ads accounts linked to a GA4 property. Admin API, no GA4 tokens; cached 6h.",
			inputSchema: z.object({ propertyId: z.string().describe("Numeric GA4 property ID") }),
		},
		async ({ propertyId }) => {
			const result = await cachedCall({
				toolName: "list_google_ads_links",
				params: { propertyId },
				tier: "metadata",
				family: "admin",
				propertyId,
				fn: async () => {
					const [links] = await getAdminClient().listGoogleAdsLinks({ parent: propertyName(propertyId) });
					return {
						links: links.map((l) => ({
							name: l.name,
							customerId: l.customerId,
							canManageClients: l.canManageClients,
							createTime: l.createTime,
						})),
					};
				},
			});
			return asText(result);
		},
	);

	// ---------------------------------------------------------------------------
	// Core + funnel reports
	// ---------------------------------------------------------------------------

	registerTool(
		"run_report",
		{
			description:
				"Runs a GA4 core report: dimensions x metrics over a date range. Pool: core. " +
				"Cost grows with rows, dimensions, date range and cardinality, so use orderBys, a small limit and a dimensionFilter.",
			inputSchema: z.object({
				propertyId: z.string().describe("Numeric GA4 property ID"),
				startDate: z.string().describe("e.g. 7daysAgo, 28daysAgo, today, or YYYY-MM-DD. Range max 93 days."),
				endDate: z.string().describe("e.g. today, yesterday, or YYYY-MM-DD"),
				dimensions: z.array(z.string()).describe("Max 4, e.g. [\"country\", \"sessionSource\"]"),
				metrics: z.array(z.string()).describe("Max 6, e.g. [\"sessions\", \"activeUsers\"]"),
				limit: z.number().int().positive().max(250).default(10).describe("Rows to return. Max 50 with a high-cardinality dimension."),
				offset: z.number().int().min(0).default(0).describe("Row offset for paging"),
				orderBys: z
					.array(
						z.object({
							metric: z.string().optional().describe("Metric name to sort by, e.g. \"totalAdRevenue\""),
							dimension: z.string().optional().describe("Dimension name to sort by instead of a metric"),
							desc: z.boolean().default(true),
						}),
					)
					.optional()
					.describe("Sort rows server-side, e.g. top pages by revenue. Required with pagePath, pageTitle, landingPage and custom dimensions."),
				dimensionFilter: dimensionFilterSchema.optional().describe("Filter rows server-side instead of pulling them and filtering"),
				dimensionFilters: z.array(dimensionFilterSchema).optional().describe("Several filters, ANDed"),
			}),
		},
		async ({ propertyId, startDate, endDate, dimensions, metrics, limit, offset, orderBys, dimensionFilter, dimensionFilters }) => {
			const filters = [...(dimensionFilter ? [dimensionFilter] : []), ...(dimensionFilters || [])];
			const params = { propertyId, startDate, endDate, dimensions, metrics, limit, offset, orderBys, filters };
			const result = await cachedCall({
				toolName: "run_report",
				params,
				tier: "report",
				family: "data",
				propertyId,
				pool: "core",
				validate: () => guard.validateReport({ dimensions, metrics, limit, startDate, endDate, orderBys }),
				fn: async () => {
					const [response] = await getDataClient().runReport({
						property: propertyName(propertyId),
						dateRanges: [{ startDate, endDate }],
						dimensions: dimensions.map((name) => ({ name })),
						metrics: metrics.map((name) => ({ name })),
						limit,
						offset,
						orderBys: (orderBys || []).map((o) => ({
							...(o.metric ? { metric: { metricName: o.metric } } : { dimension: { dimensionName: o.dimension } }),
							desc: o.desc,
						})),
						dimensionFilter: toFilterExpression(filters),
						returnPropertyQuota: true,
					});
					const { headers, rows } = compactRows(response, dimensions, metrics);
					const rowCount = response.rowCount ?? rows.length;
					return {
						value: { headers, rows, rowCount, returned: rows.length, truncated: rowCount > offset + rows.length },
						propertyQuota: response.propertyQuota,
					};
				},
			});
			return asText(await withCurrency(result, propertyId, metrics));
		},
	);

	registerTool(
		"run_funnel_report",
		{
			description:
				"Runs a GA4 funnel report: how many users completed each step of an ordered event sequence. Pool: funnel. " +
				"Use few steps and the shortest date range; rows are capped at 100.",
			inputSchema: z.object({
				propertyId: z.string().describe("Numeric GA4 property ID"),
				startDate: z.string().describe("e.g. 7daysAgo or YYYY-MM-DD"),
				endDate: z.string().describe("e.g. today or YYYY-MM-DD"),
				steps: z
					.array(z.object({ name: z.string(), eventName: z.string() }))
					.min(2)
					.describe("Ordered funnel steps, each matched by a single eventName"),
			}),
		},
		async ({ propertyId, startDate, endDate, steps }) => {
			const params = { propertyId, startDate, endDate, steps };
			const result = await cachedCall({
				toolName: "run_funnel_report",
				params,
				tier: "report",
				family: "alpha",
				propertyId,
				pool: "funnel",
				fn: async () => {
					const [response] = await getAlphaDataClient().runFunnelReport({
						property: propertyName(propertyId),
						dateRanges: [{ startDate, endDate }],
						funnel: {
							steps: steps.map((step) => ({
								name: step.name,
								filterExpression: {
									funnelFieldFilter: {
										fieldName: "eventName",
										stringFilter: { value: step.eventName },
									},
								},
							})),
						},
						returnPropertyQuota: true,
					});
					const table = response.funnelTable || {};
					const dims = (table.dimensionHeaders || []).map((h) => h.name);
					const mets = (table.metricHeaders || []).map((h) => h.name);
					const { headers, rows } = compactRows(table, dims, mets);
					const capped = rows.slice(0, FUNNEL_MAX_ROWS);
					return {
						value: { headers, rows: capped, rowCount: rows.length, returned: capped.length, truncated: rows.length > capped.length },
						propertyQuota: response.propertyQuota,
					};
				},
			});
			return asText(result);
		},
	);

	registerTool(
		"get_custom_dimensions_and_metrics",
		{
			description:
				"Lists the custom dimensions and custom metrics defined on a GA4 property. Pool: core (getMetadata spends a few core tokens, no quota is returned). Cached 6h, so call it once.",
			inputSchema: z.object({ propertyId: z.string().describe("Numeric GA4 property ID") }),
		},
		async ({ propertyId }) => {
			const result = await cachedCall({
				toolName: "get_custom_dimensions_and_metrics",
				params: { propertyId },
				tier: "metadata",
				family: "data",
				propertyId,
				fn: async () => {
					const [meta] = await getDataClient().getMetadata({ name: `${propertyName(propertyId)}/metadata` });
					const pluck = (d) => ({ apiName: d.apiName, uiName: d.uiName, description: d.description });
					return {
						customDimensions: meta.dimensions.filter((d) => d.customDefinition).map(pluck),
						customMetrics: meta.metrics.filter((m) => m.customDefinition).map(pluck),
					};
				},
			});
			return asText(result);
		},
	);

	// ---------------------------------------------------------------------------
	// Realtime report
	// ---------------------------------------------------------------------------

	registerTool(
		"run_realtime_report",
		{
			description:
				"Runs a GA4 realtime report covering the last N minutes (max 30). Pool: realtime. " +
				"Keep dimensions few and the limit small; results are cached 60s.",
			inputSchema: z.object({
				propertyId: z.string().describe("Numeric GA4 property ID"),
				dimensions: z.array(z.string()).default(["country"]),
				metrics: z.array(z.string()).default(["activeUsers"]),
				minutesAgo: z.number().int().min(1).max(30).default(29),
				limit: z.number().int().positive().max(250).default(10),
			}),
		},
		async ({ propertyId, dimensions, metrics, minutesAgo, limit }) => {
			const params = { propertyId, dimensions, metrics, minutesAgo, limit };
			const result = await cachedCall({
				toolName: "run_realtime_report",
				params,
				tier: "realtime",
				family: "realtime",
				propertyId,
				pool: "realtime",
				fn: async () => {
					const [response] = await getDataClient().runRealtimeReport({
						property: propertyName(propertyId),
						dimensions: dimensions.map((name) => ({ name })),
						metrics: metrics.map((name) => ({ name })),
						minuteRanges: [{ startMinutesAgo: minutesAgo, endMinutesAgo: 0 }],
						limit,
						returnPropertyQuota: true,
					});
					const { headers, rows } = compactRows(response, dimensions, metrics);
					const rowCount = response.rowCount ?? rows.length;
					return {
						value: { headers, rows, rowCount, returned: rows.length, truncated: rowCount > rows.length },
						propertyQuota: response.propertyQuota,
					};
				},
			});
			return asText(await withCurrency(result, propertyId, metrics));
		},
	);

	// ---------------------------------------------------------------------------
	// PageSpeed Insights: real-world page speed, e.g. spot-check after a deploy
	// ---------------------------------------------------------------------------

	registerTool(
		"run_pagespeed_insights",
		{
			description:
				"Runs a PageSpeed Insights audit for one URL (Lighthouse performance/SEO/accessibility/best-practices scores).",
			inputSchema: z.object({
				url: z.string().url(),
				strategy: z.enum(["mobile", "desktop"]).default("mobile"),
				categories: z
					.array(z.enum(["performance", "accessibility", "best-practices", "seo"]))
					.default(["performance"]),
			}),
		},
		async ({ url, strategy, categories }) => {
			if (!process.env.PSI_API_KEY) {
				return asText({ error: "PSI_API_KEY not set. Add it to the root .env (see .env.example)." });
			}
			const params = { url, strategy, categories };
			const result = await cachedCall({
				toolName: "run_pagespeed_insights",
				params,
				tier: "psi",
				family: "psi",
				fn: async () => {
					const qs = new URLSearchParams({ url, strategy, key: process.env.PSI_API_KEY });
					categories.forEach((c) => qs.append("category", c));
					const res = await fetch(`https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`);
					const body = await res.json();
					if (!res.ok) {
						const err = new Error(body.error?.message || `PSI request failed (${res.status})`);
						err.code = res.status === 429 ? 8 : undefined; // map to rate-limit retry path
						throw err;
					}
					const categoryScores = {};
					for (const [key, cat] of Object.entries(body.lighthouseResult?.categories || {})) {
						categoryScores[key] = cat.score != null ? Math.round(cat.score * 100) : null;
					}
					const audits = body.lighthouseResult?.audits || {};
					const metric = (id) => audits[id]?.displayValue ?? null;
					return {
						url: body.id,
						strategy,
						scores: categoryScores,
						coreWebVitals: {
							lcp: metric("largest-contentful-paint"),
							cls: metric("cumulative-layout-shift"),
							tbt: metric("total-blocking-time"),
							fcp: metric("first-contentful-paint"),
						},
					};
				},
			});
			return asText(result);
		},
	);

	// ---------------------------------------------------------------------------
	// Web Search Indexing API: request a (re)crawl right after deploying changes
	// ---------------------------------------------------------------------------

	registerTool(
		"request_indexing",
		{
			description:
				"Notifies Google's Indexing API that a URL changed, so it can be recrawled sooner. " +
				"Requires the GA service account to be added as an Owner of the URL's property in Search Console, " +
				"otherwise this returns a 403 ownership error. Not cached (it's an action, not a query).",
			inputSchema: z.object({
				url: z.string().url(),
				type: z.enum(["URL_UPDATED", "URL_DELETED"]).default("URL_UPDATED"),
			}),
		},
		async ({ url, type }) => {
			const result = await rateLimit.withRateLimit("indexing", async () => {
				const client = await getScopedAuthClient(["https://www.googleapis.com/auth/indexing"]);
				const res = await client.request({
					url: "https://indexing.googleapis.com/v3/urlNotifications:publish",
					method: "POST",
					data: { url, type },
				});
				return res.data;
			}).catch((err) => ({
				error: err.response?.data?.error?.message || err.message,
				hint: "Add the service account as an Owner in Search Console for this URL's property, then retry.",
			}));
			return asText(result);
		},
	);

	// ---------------------------------------------------------------------------
	// Inspection utilities, no GA4 API calls
	// ---------------------------------------------------------------------------

	registerTool(
		"get_cache_status",
		{ description: "Lists every cached tool response on disk: which tool, params, age, TTL, and whether it's still fresh." },
		async () => asText({ entries: cache.status() }),
	);

	registerTool(
		"get_rate_limit_status",
		{
			description:
				"Shows GA4 quota left per property and pool (from the shared ledger the dashboard also writes), the reserve thresholds, " +
				"Google's limits and the local throttle state. Costs no GA4 tokens.",
			inputSchema: z.object({ propertyId: z.string().regex(/^\d+$/).optional(), pool: z.enum(["core", "realtime", "funnel"]).optional() }),
		},
		async ({ propertyId, pool }) =>
			asText({
				gcpProject: ledger.gcpProject(),
				rateLimited: ledger.cooldowns().filter(row => row.scope === "project" || !propertyId || String(row.propertyId) === propertyId),
				local: rateLimit.status(),
				ga4: ledger.list().filter(row => (!propertyId || String(row.propertyId) === propertyId) && (!pool || row.pool === pool)),
				nextDailyReset: guard.dailyResetIso(),
				reserve: ledger.RESERVE,
				limits: ledger.STANDARD,
			}),
	);

	// ---------------------------------------------------------------------------

	registerDashboardTools(server, { registerTool, asText, service: options.dashboardService, instructions: DASHBOARD_INSTRUCTIONS });
	return server;
}

module.exports = { createServer };

if (require.main === module) {
	require("./lib/http").startStandalone().then(({ url, close }) => {
		console.log(`ga4-mcp-server running on Streamable HTTP: ${url}`);
		let stopping = false;
		for (const signal of ["SIGINT", "SIGTERM"]) {
			process.once(signal, () => {
				if (stopping) return;
				stopping = true;
				close().then(() => process.exit(0)).catch((err) => {
					console.error("Error stopping ga4-mcp-server:", err.message);
					process.exit(1);
				});
			});
		}
	}).catch((err) => {
		console.error("Fatal error starting ga4-mcp-server:", err.message);
		process.exitCode = 1;
	});
}
