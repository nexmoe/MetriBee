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
const comparison = z.union([z.enum(['previous_period', 'previous_year']), z.object({ startDate: date, endDate: date }).strict()])
	.optional().describe('Optional previous equal period, prior calendar year, or explicit comparison dates. Both periods share one 20-call analysis budget.');
const pagination = { offset: z.number().int().min(0).max(100000).default(0), limit };
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
	"get_search_console_connection",
	"get_cached_sites_report",
	"get_search_analytics_report",
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
	"get_funnel",
	"validate_funnel",
	"duplicate_funnel",
	"import_funnels",
	"export_funnels",
	"get_funnel_events",
	"get_funnel_summary",
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
const WRITE_TOOL_NAMES = ['request_indexing', 'save_funnel', 'delete_funnel', 'duplicate_funnel', 'import_funnels', 'save_widget', 'delete_widget'];

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
		'get_search_console_connection',
		'Inspect the GSC connection and hostname/property match for one connected GA4 site. May query cached Search Console sites.list; no GA4 report calls. Never returns credentials.',
		{ propertyId },
	);
	registerTool('get_cached_sites_report', {
		description: 'Read a multi-site status report from saved daily snapshots and cached property metadata only. Never queries Google or refreshes missing data. Includes coverage errors, account grouping, sorting and continuation. Snapshot dates can be more limited than dashboard reports.',
		inputSchema: z.object({ range: range.default('7d'), startDate: date.optional(), endDate: date.optional(), comparison,
			search: z.string().max(200).optional(), accountId: z.string().regex(/^\d+$/).optional(),
			groupBy: z.enum(['site', 'account']).default('site'), sort: z.enum(['sessions', 'change', 'name']).default('sessions'),
			order: z.enum(['asc', 'desc']).default('desc'), ...pagination }).strict(),
		annotations: { openWorldHint: false },
	}, async args => asText(await service.cachedSites(args)));
	add(
		'get_search_analytics_report',
		'Join GA4 sessions/pageviews/users with GSC clicks/impressions/CTR/weighted position for country or device rows, using the same native UI join. Missing matches remain unknown. GSC errors do not block GA4. Dates are calendar labels: GA4 uses its property zone, GSC uses Pacific. Sort before pagination; do not interpret clicks as sessions.',
		{ ...period, ...audience, comparison, dimension: z.enum(['country', 'device']), ...pagination,
			sort: z.enum(['sessions', 'pageviews', 'users', 'clicks', 'impressions', 'ctr', 'position']).default('sessions'), order: z.enum(['asc', 'desc']).default('desc') },
	);
	add(
		'get_search_console_quota',
		'Read published GSC limits, process-local request/cache/error observations, and cooldowns without querying Google. Other processes/apps are excluded; actual remaining quota and query load are unknown. Site rows are restricted to the chosen connected property.',
		{ propertyId },
	);
	add(
		'get_search_console_report',
		'Read Google Search Console data matched to one GA4 website: property summary, daily trend, or top queries/pages/countries/devices. Shares Analytics caches; uses no GA4 tokens. Final data uses Pacific calendar days. Dimension rows omit private queries and do not sum to totals. Only hostname, page-path and device filters have GSC equivalents.',
		{ ...period, ...audience, comparison, report: z.enum(['summary', 'time-series', 'data']).default('summary'),
			dimension: z.enum(['query', 'page', 'country', 'device']).default('query'), ...pagination },
	);
	add(
		"get_dashboard_report",
		"Get one native dashboard report: overview, time-series, acquisition, content, audience, technology, revenue/key events, traffic quality, visitors, what-changed or spike diagnostics. Use get_capabilities for report IDs and segments. Shares the page's cache and calculations. One property, at most 90 calendar days and 20 uncached GA4 calls; simple reports usually cost 1 call. Inspect apiCalls, quota and truncation.",
		{
			...rollingPeriod,
			...audience,
			comparison,
			report: z.enum(REPORTS),
			segment: z.string().max(100).optional(),
			bucket: z.enum(["minute", "hour", "day", "week", "month", "year"]).default("day"),
			...pagination,
			collection: z.string().regex(/^[a-z_]+(?:\.rows)?$/).optional().describe('Optional collection to page, e.g. rows, sources or countries.rows. See returned _pagination paths.'),
		},
	);
	add(
		"get_pages_report",
		"Query native page traffic or landing pages, optionally grouping by directory or filtering a path/title. Includes pageviews, sessions, entries, bounce and engagement. includeSearch adds GSC clicks, impressions, CTR, rank and shares of whole-period GSC totals. Section search values can be partial when top pages are truncated. GA4 does not expose exits. Use focused searches to bound directory queries.",
		{
			...rollingPeriod,
			...audience,
			comparison,
			view: z.enum(["all", "entry"]).default("all"),
			group: z.enum(["page", "section"]).default("page"),
			section: z.string().max(500).optional(),
			search: z.string().max(200).optional(),
			includeSearch: z.boolean().default(false),
			sort: z.enum(["pageviews", "sessions", "entries", "bounce_rate", "time_on_page", "search_clicks", "search_impressions", "search_ctr", "search_position"]).default("pageviews"),
			order: z.enum(["asc", "desc"]).default("desc"),
			page: z.number().int().min(1).max(1000).default(1),
			offset: z.number().int().min(0).max(100000).optional().describe('Optional exact row offset, overriding page. Follow nextOffset after byte-budget trimming.'),
			limit,
		},
	);
	add(
		"get_events_report",
		"Get aggregated custom-event overview, names and trends, all event-type counts, or outbound links. Matches native dashboard event definitions; names/stats and overview focus on custom events, while count includes supported automatic types. These are aggregates, never individual event logs. Usually 1–3 core calls on a shared-cache miss.",
		{
			...rollingPeriod,
			...audience,
			comparison,
			report: z.enum(["overview", "names", "names/stats", "time-series", "count", "outbound", "autocapture"]).default("names/stats"),
			bucket: z.enum(["minute", "hour", "day", "week", "month"]).default("day"),
			type: z.enum(["pageview", "outbound", "custom_event", "button_click", "copy", "form_submit"]).optional(),
			...pagination,
		},
	);
	add(
		"get_event_activity",
		"Inspect hourly aggregated activity for one event name in a preset period, optionally offset into the past. Includes GA4 sampling/threshold flags. This is not an individual event log. Shares the dashboard's events cache.",
		{ propertyId, range: range.default("7d"), offset: z.number().int().min(0).max(365).default(0), eventName: z.string().min(1).max(100) },
	);
	add(
		"get_journeys_report",
		"Read the Journeys page for one property. Default mode=transitions reports GA4 same-site referrer pairs as pageviews. mode=sessions uses native 2–10-step Rybbit semantics with ordered events, summary and exits; pass path for its session list. Ordered events are currently available in DEMO=1 as explicitly synthetic data; live connections without an event source return an unavailable error. * matches one segment; ** matches multiple. Aggregate mode usually uses one core report on a shared-cache miss.",
		{
			...rollingPeriod,
			...audience,
			comparison,
			groupBy: z.enum(["page", "section"]).default("page"),
			mode: z.enum(["transitions", "sessions"]).default("transitions"),
			steps: z.number().int().min(2).max(10).default(4).describe("Maximum depth for mode=sessions."),
			stepFilters: z.record(z.string().regex(/^\d+$/), z.string().max(2048)).optional().describe("Zero-based step index to a page pattern, for mode=sessions."),
			goalId: z.number().int().positive().optional(),
			path: z.array(z.string().max(2048)).min(1).max(10).optional().describe("List sessions counted in this exact shaped path, for mode=sessions."),
			offset: z.number().int().min(0).max(100000).default(0),
			replaysOnly: z.boolean().default(false),
			from: z.string().max(500).optional(),
			to: z.string().max(500).optional(),
			endsAt: z.string().max(500).optional(),
			limit,
		},
	);
	add(
		"get_retention_report",
		"Read native GA4 first-visit cohorts, weighted retention curves and previous-period summaries. Uses the property's calendar and Sunday-based GA4 weeks; excludes incomplete return periods from averages. No audience filters. Default weekly/30d usually uses one core batch; daily/90d can use 15. Shares the Retention cache.",
		{ ...period, comparison, range: range.default("30d"), bucket: z.enum(["day", "week"]).default("week") },
	);
	add(
		"get_site_status",
		"Read one property's native homepage health/status, historical metrics, heatmap buckets and optional saved AdSense earnings, with equal-period comparison. Makes at most three core reports on a cache miss. AdSense only appears with full saved-date coverage. Never scans other sites.",
		{ ...rollingPeriod, ...audience, comparison, compare: z.boolean().default(true), bucket: z.enum(["minute", "hour", "day", "week", "month"]).default("day") },
	);
	add(
		"list_saved_funnels",
		"Search/paginate locally saved funnel definitions for one connected property. No report calls and no changes to GA4. New properties start empty; reading never creates a definitions file.",
		{ propertyId, search: z.string().max(200).optional(), offset: z.number().int().min(0).max(1000).default(0), limit },
	);
	const funnelName = z.string().trim().min(1).max(120), description = z.string().max(2000);
	add('get_funnel', 'Read one saved funnel with ordered steps, description and timestamps. offset/limit page its steps; follow nextOffset if the output budget shortens a large definition. Local definitions only; no report calls.', { propertyId, funnelId, offset: pagination.offset, limit: z.number().int().min(1).max(10).default(10) });
	add('validate_funnel', 'Validate and normalize an ad hoc funnel without saving it or running reports. Property discovery may independently refresh Admin metadata. Page patterns, hostnames and event parameter conditions use the native validator.', { propertyId, steps });
	add('duplicate_funnel', 'Copy one saved funnel in the same property. Requires explicit user intent to create a local definition. Copies steps and description, never GA4 data or another property.', { propertyId, funnelId, name: funnelName.optional() });
	add('import_funnels', 'Import JSON funnel definitions into ONE connected property, deduplicating measurement rules and preserving existing names/IDs. Accepts the data array from export_funnels. Validate the entire batch before an atomic write. dryRun previews without saving; requires explicit intent for writes.', {
		propertyId, dryRun: z.boolean().default(false), definitions: z.array(z.object({ name: funnelName, steps, description: description.optional() }).strict()).min(1).max(100),
	});
	add('export_funnels', 'Export a pageable JSON array of native definitions for ONE property. Pass returned data as import_funnels.definitions to round-trip them. No server file paths, sharing keys or report calls.', {
		propertyId, funnelIds: z.array(funnelId).min(1).max(100).optional(), ...pagination,
	});
	add('get_funnel_events', 'Discover event names and total users for building funnel steps. Uses the native funnel event picker, ordered by users; not independent funnel conversions. One guarded core call, with pagination over the top 100 events.', { ...period, ...pagination });
	add('get_funnel_summary', 'Read native summary conversions for a bounded page of saved funnels. Includes union entrants without double counting. Up to 9 funnels and one union request per period, all guarded within the same 20-call budget. No definition writes.', {
		...period, ...audience, comparison, offset: pagination.offset, limit: z.number().int().min(1).max(9).default(5),
	});
	registerTool('save_funnel', {
		description: 'Create a local funnel with name and steps, or partially update name, description and/or steps by funnelId. Omitted fields are preserved; empty description clears it. Native validation, no report calls, never modifies GA4. Requires user intent to save.',
		inputSchema: z.object({ propertyId, name: funnelName.optional(), steps: steps.optional(), description: description.optional(), funnelId: funnelId.optional() }).strict()
			.refine(args => args.funnelId ? args.name !== undefined || args.steps !== undefined || args.description !== undefined : args.name !== undefined && args.steps !== undefined,
				'Create requires name and steps; update requires funnelId and at least one changed field.'),
	}, async args => asText(await service.execute('save_funnel', args)));
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
				.object({ ...period, ...audience, comparison, funnelId: funnelId.optional(), steps: steps.optional() })
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
					searchConsole: { configured: !!require('../../controllers/searchConsole').credentials(env), connectionTool: 'get_search_console_connection' },
					pageSpeed: { configured: !!env.PSI_API_KEY },
					journeys: { orderedEvents: require('../../controllers/demoData').enabled() ? 'synthetic_demo' : 'not_connected', replay: false },
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
						text: `Analyze GA4 property ${args.propertyId}: ${args.question}\nRead ga4://capabilities or get_capabilities, inspect quota, and choose the smallest matching report for this question. Use shared caches and one property only. Use comparison for period changes and _pagination.nextOffset for continuation; do not treat sourceTruncated top rows as complete totals. Explain data freshness, date range, currency, thresholds and limitations. Stop on quota warnings. Do not save/delete/duplicate/import funnels, save/delete widgets, or request indexing, unless I explicitly ask.`,
					},
				},
			],
		}),
	);
}

module.exports = { registerDashboardTools, NEW_TOOL_NAMES, WRITE_TOOL_NAMES };
