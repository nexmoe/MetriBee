const { z } = require("zod");
const { getDashboardService, capabilities, REPORTS, FILTER_PARAMETERS } = require("./dashboard");
const { validDate } = require("../../controllers/retention");

const propertyId = z.string().regex(/^\d+$/).describe("Numeric GA4 property ID. Select one with list_properties.");
const date = z.string().refine(validDate, "Use a valid YYYY-MM-DD calendar date.");
const range = z.enum(["today", "7d", "28d", "30d", "90d"]);
const limit = z.number().int().min(1).max(100).default(20);
const filter = z
	.object({
		parameter: z.enum(FILTER_PARAMETERS),
		type: z.enum([
			"equals",
			"contains",
			"starts_with",
			"ends_with",
			"regex",
			"not_equals",
			"not_contains",
			"not_starts_with",
			"not_ends_with",
			"not_regex",
		]),
		value: z.array(z.string().min(1).max(500)).min(1).max(100),
	})
	.strict();
const period = { propertyId, range: range.default("7d"), startDate: date.optional(), endDate: date.optional() };
const rollingPeriod = { ...period, pastMinutes: z.number().int().min(1).max(129600).optional().describe('Rolling historical window in minutes; 1440 = Last 24 Hours. Do not combine with explicit dates. GA4 processing delay applies.') };
const audience = { filters: z.array(filter).max(20).default([]) };
const step = z
	.object({
		type: z.enum(["page", "event"]),
		value: z.string().min(1).max(500),
		name: z.string().max(120).optional(),
		hostname: z.string().max(253).optional(),
		propertyFilters: z
			.array(
				z
					.object({ key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,39}$/), value: z.union([z.string().min(1).max(500), z.number()]) })
					.strict(),
			)
			.max(10)
			.optional(),
	})
	.strict();
const steps = z.array(step).min(2).max(10);
const funnelId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const NEW_TOOL_NAMES = [
	"get_capabilities",
	"list_properties",
	"get_search_console_quota",
	"get_search_console_report",
	"get_dashboard_report",
	"get_pages_report",
	"get_events_report",
	"get_event_activity",
	"get_journeys_report",
	"get_retention_report",
	"get_site_status",
	"list_saved_funnels",
	"save_funnel",
	"delete_funnel",
	"analyze_funnel",
	"list_saved_widgets",
	"save_widget",
	"delete_widget",
	"get_widget_report",
	"refresh_property_quota",
	"get_setup_status",
];

function registerDashboardTools(server, { registerTool, asText, service = getDashboardService(), instructions }) {
	const add = (name, description, shape) =>
		registerTool(name, { description, inputSchema: z.object(shape).strict() }, async (args) => asText(await service.execute(name, args)));
	registerTool(
		"get_capabilities",
		{
			description:
				"Discover the dashboard's current report catalog, segment names, audience filters, usage limits and GA4 data limitations. No Google calls.",
		},
		async () => asText(capabilities()),
	);
	registerTool(
		"list_properties",
		{
			description:
				"Find current connected GA4 sites, account names and domains, with search and pagination. Shares the dashboard's five-minute metadata refresh. Admin API only; refresh=true explicitly refreshes metadata and does not run reports.",
			inputSchema: z
				.object({
					search: z.string().max(200).optional(),
					accountId: z.string().regex(/^\d+$/).optional(),
					limit: limit.default(50),
					offset: z.number().int().min(0).max(10000).default(0),
					refresh: z.boolean().default(false),
				})
				.strict(),
		},
		async (args) => asText(await service.listProperties(args)),
	);
	add(
		'get_search_console_quota',
		'Read published GSC limits, process-local request/cache/error observations, and cooldowns without querying Google. Other processes/apps are excluded; actual remaining quota and query load are unknown. Site rows are restricted to the chosen connected property.',
		{ propertyId },
	);
	add(
		'get_search_console_report',
		'Read Google Search Console data matched to one GA4 website: property summary, daily trend, or top queries/pages/countries/devices. Shares Analytics caches; uses no GA4 tokens. Final data uses Pacific calendar days. Dimension rows omit private queries and do not sum to totals. Only hostname, page-path and device filters have GSC equivalents.',
		{ ...period, ...audience, report: z.enum(['summary', 'time-series', 'data']).default('summary'),
			dimension: z.enum(['query', 'page', 'country', 'device']).default('query'), limit },
	);
	add(
		"get_dashboard_report",
		"Get one native dashboard report: overview, time-series, acquisition, content, audience, technology, revenue/key events, traffic quality, visitors, what-changed or spike diagnostics. Use get_capabilities for report IDs and segments. Shares the page's cache and calculations. One property, at most 90 calendar days and 20 uncached GA4 calls; simple reports usually cost 1 call. Inspect apiCalls, quota and truncation.",
		{
			...rollingPeriod,
			...audience,
			report: z.enum(REPORTS),
			segment: z.string().max(100).optional(),
			bucket: z.enum(["minute", "hour", "day", "week", "month", "year"]).default("day"),
			limit,
		},
	);
	add(
		"get_pages_report",
		"Query native page traffic or landing pages, optionally grouping by directory or filtering a path/title. Includes pageviews, sessions, entries, bounce and engagement. includeSearch adds GSC clicks, impressions, CTR, rank and shares of whole-period GSC totals. Section search values can be partial when top pages are truncated. GA4 does not expose exits. Use focused searches to bound directory queries.",
		{
			...rollingPeriod,
			...audience,
			view: z.enum(["all", "entry"]).default("all"),
			group: z.enum(["page", "section"]).default("page"),
			section: z.string().max(500).optional(),
			search: z.string().max(200).optional(),
			includeSearch: z.boolean().default(false),
			sort: z.enum(["pageviews", "sessions", "entries", "bounce_rate", "time_on_page", "search_clicks", "search_impressions", "search_ctr", "search_position"]).default("pageviews"),
			order: z.enum(["asc", "desc"]).default("desc"),
			page: z.number().int().min(1).max(1000).default(1),
			limit,
		},
	);
	add(
		"get_events_report",
		"Get aggregated custom-event overview, names and trends, all event-type counts, or outbound links. Matches native dashboard event definitions; names/stats and overview focus on custom events, while count includes supported automatic types. These are aggregates, never individual event logs. Usually 1–3 core calls on a shared-cache miss.",
		{
			...rollingPeriod,
			...audience,
			report: z.enum(["overview", "names", "names/stats", "time-series", "count", "outbound", "autocapture"]).default("names/stats"),
			bucket: z.enum(["minute", "hour", "day", "week", "month"]).default("day"),
			type: z.enum(["pageview", "outbound", "custom_event", "button_click", "copy", "form_submit"]).optional(),
			limit,
		},
	);
	add(
		"get_event_activity",
		"Inspect hourly aggregated activity for one event name in a preset period, optionally offset into the past. Includes GA4 sampling/threshold flags. This is not an individual event log. Shares the dashboard's events cache.",
		{ propertyId, range: range.default("7d"), offset: z.number().int().min(0).max(365).default(0), eventName: z.string().min(1).max(100) },
	);
	add(
		"get_journeys_report",
		"Read same-site referrer-to-page transitions, optionally grouped by directory and filtered at either end (* wildcard supported). Counts pageviews for two-page pairs; cannot reconstruct complete sessions or identify exits. Usually one core report on a shared-cache miss.",
		{
			...rollingPeriod,
			...audience,
			groupBy: z.enum(["page", "section"]).default("page"),
			from: z.string().max(500).optional(),
			to: z.string().max(500).optional(),
			endsAt: z.string().max(500).optional(),
			limit,
		},
	);
	add(
		"get_retention_report",
		"Read native GA4 first-visit cohorts, weighted retention curves and previous-period summaries. Uses the property's calendar and Sunday-based GA4 weeks; excludes incomplete return periods from averages. No audience filters. Default weekly/30d usually uses one core batch; daily/90d can use 15. Shares the Retention cache.",
		{ ...period, range: range.default("30d"), bucket: z.enum(["day", "week"]).default("week") },
	);
	add(
		"get_site_status",
		"Read one property's native homepage health/status, historical metrics, heatmap buckets and optional saved AdSense earnings, with equal-period comparison. Makes at most three core reports on a cache miss. AdSense only appears with full saved-date coverage. Never scans other sites.",
		{ ...rollingPeriod, ...audience, compare: z.boolean().default(true), bucket: z.enum(["minute", "hour", "day", "week", "month"]).default("day") },
	);
	add(
		"list_saved_funnels",
		"Search/paginate locally saved funnel definitions for one connected property. No report calls and no changes to GA4. Built-in defaults may be initialized on first access.",
		{ propertyId, search: z.string().max(200).optional(), offset: z.number().int().min(0).max(1000).default(0), limit },
	);
	add(
		"save_funnel",
		"Create a named local funnel, or update it by funnelId. Only use when the user asks to save/change a funnel. Page steps support one-segment * patterns; event steps accept up to 10 exact string/number parameter conditions. Definitions are shared with the UI and never change GA4. No report calls.",
		{ propertyId, name: z.string().trim().min(1).max(120), steps, funnelId: funnelId.optional() },
	);
	add(
		"delete_funnel",
		"Delete one locally saved funnel definition. Requires explicit user intent to delete. Changes durable dashboard data only, never GA4; no report calls.",
		{ propertyId, funnelId },
	);
	registerTool(
		"analyze_funnel",
		{
			description:
				"Analyze a saved funnelId OR an ad hoc 2–10 step sequence. Uses native ordered, closed GA4 funnel active users, including page patterns and event parameter conditions. Does not save definitions. One funnel-pool call; never treat step counts as independent events or a download click as an installation.",
			inputSchema: z
				.object({ ...period, ...audience, funnelId: funnelId.optional(), steps: steps.optional() })
				.strict()
				.refine((args) => Boolean(args.funnelId) !== Boolean(args.steps), "Provide funnelId or steps, exactly one."),
		},
		async (args) => asText(await service.execute("analyze_funnel", args)),
	);
	const widgetId = z.string().regex(/^[a-f0-9]{12}$/);
	const config = z
		.record(z.string(), z.unknown())
		.describe(
			"Native widget config. Read get_capabilities.widgets.defaultConfig, metrics and periods; submit supported fields only. Native validation rejects arbitrary metrics, expressions and styles.",
		);
	add(
		"list_saved_widgets",
		"Search/paginate saved native metric widgets for one property. Reads local definitions only; never returns sharing keys or enables embeds.",
		{ propertyId, search: z.string().max(200).optional(), offset: z.number().int().min(0).max(1000).default(0), limit },
	);
	add(
		"save_widget",
		"Create or update a local metric widget using the native UI validator. Requires explicit user intent to save. Use get_capabilities.widgets for defaults and supported metrics/periods. Does not enable site-wide sharing or generate sharing keys. Validation may read property time zone through Admin; no report calls.",
		{ propertyId, widgetId: widgetId.optional(), config },
	);
	add(
		"delete_widget",
		"Delete a saved local metric widget by ID. Requires explicit user intent; removes durable application data and revokes that widget's existing URL. Does not change GA4.",
		{ propertyId, widgetId },
	);
	registerTool(
		"get_widget_report",
		{
			description:
				"Privately preview a saved widgetId OR a supplied native config, without publishing/enabling it. Shares UI calculations and cached current/prior totals and optional trends. Preset/custom widget periods support at most 366 days; at most three core calls on cache miss. Dates, percentages and currency match the widget builder.",
			inputSchema: z
				.object({ propertyId, widgetId: widgetId.optional(), config: config.optional() })
				.strict()
				.refine((args) => Boolean(args.widgetId) !== Boolean(args.config), "Provide widgetId or config, exactly one."),
		},
		async (args) => asText(await service.execute("get_widget_report", args)),
	);
	add(
		"refresh_property_quota",
		"Explicitly fetch Google's current Core, Realtime and Funnel quota snapshot for ONE property and update the shared ledger. Unlike get_rate_limit_status this makes one Google request. Does not run reports or refresh every property. Project-wide cooldowns still apply.",
		{ propertyId },
	);
	registerTool(
		"get_setup_status",
		{
			description:
				"Inspect local credential availability and supplemental OAuth configuration without exposing keys or tokens. No Google calls by default. verify=true explicitly checks the key and visible-property count through Google's Admin API.",
			inputSchema: z.object({ verify: z.boolean().default(false) }).strict(),
		},
		async ({ verify }) => {
			const { syncEnvFile, checkSetup } = require("../../lib/setupCheck");
			syncEnvFile();
			const { getCredentials } = require("../../lib/credentials");
			const env = process.env;
			return asText({
				configured: !!getCredentials(),
				demo: require("../../controllers/demoData").enabled(),
				transport: "streamable-http",
				supplementalOAuth: {
					configured: !!(env.GA4_OAUTH_CLIENT_ID && env.GA4_OAUTH_CLIENT_SECRET && env.GA4_OAUTH_REFRESH_TOKEN),
					accountAllowlist: !!env.GA4_OAUTH_ACCOUNT_IDS,
					propertyAllowlist: !!env.GA4_OAUTH_PROPERTY_IDS,
				},
				...(verify ? { verification: await checkSetup() } : {}),
			});
		},
	);
	server.registerResource(
		"ga4-capabilities",
		"ga4://capabilities",
		{ description: "Current report catalog, filters, budgets and honest GA4 data limits.", mimeType: "application/json" },
		async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(capabilities()) }] }),
	);
	server.registerResource(
		"ga4-query-guide",
		"ga4://query-guide",
		{ description: "How to query one property without wasting quota or overstating GA4 data.", mimeType: "text/plain" },
		async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: instructions }] }),
	);
	server.registerPrompt(
		"analyze_property",
		{
			description: "Plan a focused, read-only analysis of one GA4 property using the current dashboard tools.",
			argsSchema: z.object({ propertyId: z.string().regex(/^\d+$/), question: z.string().min(1).max(2000) }),
		},
		async (args) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Analyze GA4 property ${args.propertyId}: ${args.question}\nRead ga4://capabilities or get_capabilities, inspect quota, and choose the smallest matching report for this question. Use shared caches and one property only. Explain data freshness, date range, currency, thresholds and limitations. Stop on quota warnings. Do not save/delete funnels or widgets, or request indexing, unless I explicitly ask.`,
					},
				},
			],
		}),
	);
}

module.exports = { registerDashboardTools, NEW_TOOL_NAMES };
