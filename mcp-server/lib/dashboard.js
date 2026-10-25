const { getAnalyticsCatalog, getAnalyticsCardConfig } = require("../../controllers/analyticsRecipes");
const { todayInZone, validDate, createRetentionHandler } = require("../../controllers/retention");
const { createRybbitHandler } = require("../../controllers/rybbit");
const { createEventsHandlers } = require("../../controllers/eventsController");
const { createFunnels } = require("../../controllers/funnels");
const { createQuotaHandlers } = require("../../controllers/quota");
const { createFunnelStore } = require("../../lib/funnelStore");
const clients = require("./clients");
const ga4 = require("../../controllers/ga4Service");
const reportCache = require("../../controllers/reportCache");
const defaultGuard = require("./guard");
const defaultLedger = require("./ledger");
const defaultRateLimit = require("./rateLimit");
const { comparisonWindow, metricChanges, paginateReport } = require('./results');
const { createPortfolio } = require('./portfolio');
const LOCAL_FUNNEL_OPERATIONS = ['list_saved_funnels', 'get_funnel', 'validate_funnel', 'duplicate_funnel', 'import_funnels', 'export_funnels', 'save_funnel', 'delete_funnel'];

const DAY = 86400000;
const RANGES = { today: 1, "7d": 7, "28d": 28, "30d": 30, "90d": 90 };
const REPORTS = [
	...getAnalyticsCatalog().map((card) => card.type),
	"overview",
	"time-series",
	"what-changed",
	"spikes",
	"visitors",
	"diagnostics",
	"live-spike",
	"live-users",
];
const FILTER_PARAMETERS = [
	"pathname",
	"page_title",
	"entry_page",
	"hostname",
	"country",
	"region",
	"city",
	"language",
	"browser",
	"browser_version",
	"operating_system",
	"operating_system_version",
	"device_type",
	"dimensions",
	"referrer",
	"channel",
	"utm_source",
	"utm_medium",
	"utm_campaign",
	"utm_content",
	"utm_term",
	"event_name",
];
const LIMITATIONS = [
	"Events are aggregates; individual event/session records require BigQuery export or a separate collector. Session replay needs a replay collector and is unavailable through GA4 Data API.",
	"Journeys are same-site referrer-to-page pairs counted as pageviews, not reconstructed multi-step sessions; exits are unavailable.",
	"Retention uses GA4 firstSessionDate cohorts in the property's time zone; incomplete return periods are excluded from weighted averages. Audience filters are not supported.",
	"Funnels count ordered active users, not independent event counts. Saving definitions changes only local dashboard data, never GA4.",
	"Revenue uses each property's currency. Optional AdSense values come from saved snapshots only when the requested dates are covered.",
	"Live spikes cover the whole property's last 30 minutes, independently of historical dates, and do not accept audience filters.",
	"Live users cover the whole property's past 5 minutes, independently of historical dates, without audience filters. Country, device and page rows are aggregates, not individual sessions; page user counts overlap.",
];

function capabilities() {
	const widgets = require("../../controllers/widgetConfig");
	return {
		reports: getAnalyticsCatalog().map(({ type, title, group, sub }) => ({
			id: type,
			title,
			group,
			description: sub,
			segments: Object.keys(getAnalyticsCardConfig(type)?.segments || {}),
		})),
		additionalReports: REPORTS.filter((id) => !getAnalyticsCardConfig(id)),
		filters: {
			parameters: FILTER_PARAMETERS,
			operators: [
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
			],
			maxFilters: 20,
		},
		limits: { maxDays: 90, maxRequestedRows: 100, maxApiCallsPerAnalysis: 20, propertiesPerQuestion: 1 },
		comparison: { presets: ['previous_period', 'previous_year'], custom: { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' },
			budget: 'Both periods share 20 uncached GA4 calls. Previous data and scalar/matched-row changes are returned under comparison; missing/failed matches remain unknown.' },
		pagination: { offset: true, collection: 'Dashboard reports accept a collection name. _pagination describes each pageable collection; follow its nextOffset. sourceTruncated means upstream top rows are incomplete, not further pageable.',
			outputBudget: 'The transport recalculates continuation when it trims a page. Cached native reports are never shortened.' },
		portfolio: { tool: 'get_cached_sites_report', source: 'Saved snapshots and cached metadata only; never schedules Google calls or refreshes missing data.' },
		timeWindows: { pastMinutes: 'Rolling minute window, e.g. 1440 for Last 24 Hours. Available on dashboard, pages, events, journeys and site status reports; calendar-only reports reject it.', precision: 'minute', freshness: 'GA4 historical processing delay applies; use realtime for live traffic.' },
		workflow: [
			"Use list_properties to select one property, and get_capabilities to choose a report.",
			"Use a short date range and one focused high-level tool. Shared dashboard cache hits spend no GA4 tokens.",
			"Inspect returned quota, apiCalls, warnings and truncation. Stop on quota_low or rate_limited; never loop reports over properties.",
		],
		limitations: LIMITATIONS,
		journeys: {
			tool: "get_journeys_report",
			steps: 2,
			metric: "screenPageViews",
			filters: "from and to filter the two aggregate columns. * matches one nonempty path segment; ** matches any number. Section grouping uses patterns such as /docs/**.",
			nativeParity: "Full Rybbit multi-step journeys, ordered session lists and exit counts require an ordered event-level source. Aggregate pair reports do not provide native journey semantics.",
			orderedSessions: { mode: "sessions", minSteps: 2, maxSteps: 10, defaultSteps: 4,
				available: require("../../controllers/demoData").enabled(),
				source: require("../../controllers/demoData").enabled() ? "synthetic demo session events" : "not connected",
				pathDetails: "Pass path to list its matching sessions. The same step filters, grouping and end-page truncation apply." },
		},
		funnels: {
			tools: [...LOCAL_FUNNEL_OPERATIONS, 'get_funnel_events', 'get_funnel_summary', 'analyze_funnel'],
			maxSaved: 100, maxSummaryPage: 9, partialUpdates: ['name', 'description', 'steps'],
			import: 'Single-property, atomic, deduplicated imports; dryRun previews. export_funnels.data is accepted as import_funnels.definitions.',
			minSteps: 2,
			maxSteps: 10,
			audienceParameters: Object.keys(require("../../controllers/funnels").FUNNEL_FIELDS),
			stepTypes: ["page", "event"],
			eventParameters: "Up to 10 exact string/number conditions per event step.",
		},
		widgets: {
			metrics: widgets.WIDGET_METRICS,
			periods: widgets.WIDGET_PERIODS,
			defaultConfig: widgets.defaultWidgetConfig(),
			maxDays: 366,
			sharing:
				"MCP manages local definitions and private previews only. It never enables site-wide embeds or generates public/private sharing keys.",
		},
		searchConsole: { tool: 'get_search_console_report', reports: ['summary', 'time-series', 'data'], dimensions: ['query', 'page', 'country', 'device'],
			connectionTool: 'get_search_console_connection', joinedTool: 'get_search_analytics_report', joinedDimensions: ['country', 'device'],
			quotaTool: 'get_search_console_quota', quotaScope: 'Current process only; Google does not return actual remaining quota or query load.',
			pagesTool: { tool: 'get_pages_report', option: 'includeSearch', shares: 'Percent of whole-period GSC totals, independent of displayed pages.', sectionTotals: 'Reported top search pages only; partial when truncated.' },
			timeZone: 'America/Los_Angeles', source: 'gsc', maxRows: 500,
			limitations: ['Final Google Search web data can be delayed. Clicks differ from GA4 sessions.', 'Top dimension rows omit private queries and are not property totals.', 'Only hostname, exact/contains page paths and device filters are supported.'] },
	};
}

function dateWindow(args, property, now) {
	if (args.pastMinutes !== undefined) {
		if (!Number.isInteger(args.pastMinutes) || args.pastMinutes < 1 || args.pastMinutes > 90 * 1440 || args.startDate || args.endDate) throw new Error('Choose 1–129600 past minutes without calendar dates.');
		return { past_minutes_start: args.pastMinutes, past_minutes_end: 0 };
	}
	const today = todayInZone(now, property.timeZone);
	const days = RANGES[args.range || "7d"];
	if (!days) throw new Error("Choose today, 7d, 28d, 30d or 90d.");
	const endDate = args.endDate || today;
	const startDate = args.startDate || new Date(Date.parse(endDate + "T00:00:00Z") - (days - 1) * DAY).toISOString().slice(0, 10);
	if (
		!validDate(startDate) ||
		!validDate(endDate) ||
		startDate < "2015-01-01" ||
		endDate > today ||
		startDate > endDate ||
		(Date.parse(endDate) - Date.parse(startDate)) / DAY >= 90
	) {
		throw new Error("Choose valid calendar dates covering 1–90 days, ending no later than today in the property's time zone.");
	}
	return { start_date: startDate, end_date: endDate };
}

async function invoke(handler, req) {
	let value,
		status = 200;
	await handler(
		{ method: "GET", query: {}, params: {}, body: {}, ...req },
		{
			set() {
				return this;
			},
			status(code) {
				status = code;
				return this;
			},
			json(data) {
				value = data;
				return data;
			},
		},
	);
	if (value === undefined) throw new Error("The dashboard report returned no result.");
	return status >= 400 ? { ...value, error: value.error || "Report unavailable", status } : value;
}

function createDashboardService(deps = {}) {
	const properties = deps.properties || ((options) => require("../../controllers/apiController").ensureProperties(options));
	const read = deps.read || reportCache.cacheGet,
		write = deps.write || reportCache.cacheSet;
	const now = deps.now || (() => new Date());
	const guard = deps.guard || defaultGuard,
		ledger = deps.ledger || defaultLedger;
	const throttle = deps.throttle || ((family, call) => defaultRateLimit.withRateLimit(family, call));
	const store = deps.store || createFunnelStore();
	const widgetStore = deps.widgetStore || require("../../lib/embedStore").createEmbedStore();
	const pending = new Map();
	const cachedSites = createPortfolio({
		readProperties: deps.cachedProperties || (() => require('../../controllers/apiController').readCachedProperties()),
		loadSnapshot: deps.snapshot || (options => require('../../controllers/sitesController').loadSitesSnapshot(options)),
		now, resolveDates: dateWindow,
	});

	async function listProperties(args = {}) {
		const loaded = await properties({ force: args.refresh === true });
		const search = (args.search || "").toLowerCase();
		const rows = loaded.properties
			.filter(
				(property) =>
					(!args.accountId || String(property.accountId) === args.accountId) &&
					(!search ||
						[property.id, property.site, property.domain, property.accountName].some((value) =>
							String(value || "")
								.toLowerCase()
								.includes(search),
						)),
			)
			.map((property) => ({
				propertyId: String(property.id),
				name: property.site,
				domain: property.domain || null,
				url: property.url || null,
				accountId: property.accountId || null,
				accountName: property.accountName || null,
				timeZone: property.timeZone || null,
				currencyCode: property.currencyCode || null,
			}));
		return paginateReport({
			properties: rows,
			total: rows.length,
			source: loaded.source,
		}, { ...args, limit: args.limit || 50 });
	}

	async function execute(operation, args) {
		const mutating = ["save_funnel", "delete_funnel", 'duplicate_funnel', 'import_funnels', "save_widget", "delete_widget", "refresh_property_quota"].includes(operation);
		const key = JSON.stringify([operation, args]);
		if (!mutating && pending.has(key)) return pending.get(key);
		const work = perform(operation, args);
		if (!mutating) {
			pending.set(key, work);
			work
				.finally(() => {
					if (pending.get(key) === work) pending.delete(key);
				})
				.catch(() => {});
		}
		return work;
	}

	async function perform(operation, args, sharedContext, windowOverride) {
		const context = sharedContext || { calls: 0, pools: new Set(), refusal: null, quality: { truncated: false, thresholded: false, sampled: false } };
		let previousWindow;
		const complete = async result => {
			if (args.comparison && operation !== 'get_site_status' && !result.error && !context.refusal) {
				const previous = result.data === null ? { error: 'comparison_unavailable', message: 'Current source data is unavailable.' }
					: await perform(operation, { ...args, comparison: undefined }, context, previousWindow);
				result = { ...result, comparison: { window: previousWindow, previous,
					...(previous.error ? { unavailable: true } : { changes: metricChanges(result.data, previous.data) }) } };
			}
			return { ...result, ...(result.ga4ApiCalls === 0 ? {} : { apiCalls: context.calls }),
				...(context.pools.size ? { quota: Object.fromEntries([...context.pools].map(pool => [pool, ledger.status(args.propertyId, pool)])) } : {}) };
		};
		try {
			if (!/^\d+$/.test(args.propertyId || "")) throw new Error("Choose a numeric property ID.");
			const loaded = await properties();
			let property = loaded.properties.find((item) => String(item.id) === args.propertyId);
			if (!property)
				return { error: "property_not_found", propertyId: args.propertyId, hint: "Use list_properties to choose a connected property." };
			property = { ...property };
			if (operation === 'get_search_console_connection') {
				require('../../lib/setupCheck').syncEnvFile();
				const { match, ...connection } = await (deps.gsc || require('../../controllers/searchConsole').getSearchConsole()).connection(property);
				return { ...connection, propertyId: args.propertyId, source: 'gsc', ga4ApiCalls: 0 };
			}
			if (operation === 'get_search_console_quota') {
				require('../../lib/setupCheck').syncEnvFile();
				const result = await (deps.gsc || require('../../controllers/searchConsole').getSearchConsole()).quota([property],
					{ demo: (deps.isDemo || require('../../controllers/demoData').enabled)() });
				return { ...result, source: 'gsc', propertyId: args.propertyId, ga4ApiCalls: 0, quotaSource: 'gsc' };
			}
			if (operation === 'get_search_console_report') {
				if ((deps.isDemo || require('../../controllers/demoData').enabled)()) return { source: 'gsc', propertyId: args.propertyId, data: null, connection: { connected: false, reason: 'demo' }, ga4ApiCalls: 0 };
				require('../../lib/setupCheck').syncEnvFile();
				const currentWindow = windowOverride || dateWindow(args, { ...property, timeZone: 'America/Los_Angeles' }, now());
				previousWindow = comparisonWindow(currentWindow, args.comparison, dates => dateWindow(dates, { timeZone: 'America/Los_Angeles' }, now()));
				const query = { ...currentWindow,
					filters: JSON.stringify(args.filters || []), dimensions: args.dimension || 'query' };
				const result = await (deps.gsc || require('../../controllers/searchConsole').getSearchConsole()).report(property, args.report || 'summary', query);
				return complete({ ...(Array.isArray(result.data) ? paginateReport(result, args) : result), propertyId: args.propertyId, ga4ApiCalls: 0, quotaSource: 'gsc' });
			}
			const observe = (data) => {
				if (!data || typeof data !== "object") return data;
				context.quality.truncated ||= (Array.isArray(data.rows) && data.rowCount > data.rows.length) || !!data.truncated;
				context.quality.thresholded ||= !!data.metadata?.subjectToThresholding || !!data.thresholded;
				context.quality.sampled ||= !!data.metadata?.samplingMetadatas?.length || !!data.sampled;
				return data;
			};
			const observedRead = async (...args) => observe(await read(...args));
			const refuse = (value) => {
				context.refusal ||= value;
				throw Object.assign(new Error(value.hint || value.error), { mcpResult: value, code: 8 });
			};
			const guarded =
				(getter, method, pool, family) =>
				async (request, ...options) => {
					const requestedId = /^properties\/(\d+)(?:\/|$)/.exec(request.property || request.name || "")?.[1];
					if (requestedId !== args.propertyId) throw new Error("The report must stay on the selected property.");
					return guard.inflight(args.propertyId, () => {
						if (context.refusal) refuse(context.refusal);
						return throttle(family, async () => {
							if (context.refusal) refuse(context.refusal);
							if (pool || method === "getPropertyQuotasSnapshot") {
								const spread = guard.checkPropertySpread(args.propertyId);
								if (spread) refuse(spread);
							}
							if (pool) {
								context.pools.add(pool);
								const low = guard.checkQuota(args.propertyId, pool);
								if (low) refuse(low);
								const cooldown = ledger.blocked(args.propertyId, pool);
								if (cooldown) refuse({ error: "rate_limited", retryAfter: new Date(cooldown.until).toISOString(), hint: cooldown.reason });
							}
							if (context.calls >= 20)
								refuse({
									error: "analysis_budget_exceeded",
									hint: "This analysis reached 20 GA4 calls. Choose a shorter range or a narrower report.",
								});
							context.calls++;
							try {
								const callOptions = { timeout: 20000, ...options[0], retry: null };
								const result = await getter()[method](
									{ ...request, ...(pool ? { returnPropertyQuota: true } : {}) },
									callOptions,
									...options.slice(1),
								);
								observe(result[0]);
								if (pool && result[0]?.propertyQuota) ledger.record(args.propertyId, pool, result[0].propertyQuota, "mcp");
								return result;
							} catch (error) {
								if (pool) {
									ledger.block(args.propertyId, pool, error, "mcp");
									const exhausted = guard.exhaustedError(args.propertyId, pool, error);
									if (exhausted) refuse(exhausted);
								}
								throw error;
							}
						});
					});
				};
			const beta = {
				runReport: guarded(deps.dataClient || clients.getDataClient, "runReport", "core", "data"),
				runRealtimeReport: guarded(deps.dataClient || clients.getDataClient, "runRealtimeReport", "realtime", "realtime"),
			};
			const alpha = {
				runFunnelReport: guarded(deps.alphaClient || clients.getAlphaDataClient, "runFunnelReport", "funnel", "alpha"),
				getPropertyQuotasSnapshot: guarded(deps.alphaClient || clients.getAlphaDataClient, "getPropertyQuotasSnapshot", null, "alpha"),
			};
			const admin = { getProperty: guarded(deps.adminClient || clients.getAdminClient, "getProperty", null, "admin") };
			const definitionOnly = [
				...LOCAL_FUNNEL_OPERATIONS,
				"list_saved_widgets",
				"save_widget",
				"delete_widget",
				"refresh_property_quota",
			].includes(operation);
			if (!definitionOnly && !property.timeZone) {
				let metadata = await read("retention-meta", args.propertyId);
				if (!metadata?.timeZone) {
					const [meta] = await admin.getProperty({ name: `properties/${args.propertyId}` });
					metadata = { timeZone: meta.timeZone, currencyCode: meta.currencyCode, createTime: meta.createTime };
					if (!metadata.timeZone) throw new Error("Property time zone is unavailable.");
					await write("retention-meta", args.propertyId, metadata);
				}
				property = { ...property, ...metadata };
			}
			const scopedProperties = async () => ({ properties: [property] });
			const run = (query) => ga4.runSafeHistoricalReport({ ...query, client: beta });
			const retention = createRetentionHandler({
				loadProperties: scopedProperties,
				read: observedRead,
				write,
				now,
				dataClient: () => beta,
				adminClient: () => admin,
			});
			const funnels = createFunnels({ properties: scopedProperties, now, client: () => alpha, store,
				events: async (propertyId, dateRange) => {
					const result = await run({ propertyId, dateRange, dimensions: [{ name: 'eventName' }], metrics: [{ name: 'totalUsers' }],
						limit: 100, orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }] });
					if (!result.ok) throw new Error(result.error || 'Event discovery failed.');
					return (result.rows || []).map(row => ({ eventName: row.dimensionValues?.[0]?.value || '', users: Number(row.metricValues?.[0]?.value) || 0 }))
						.filter(row => row.eventName && row.eventName !== '(not set)');
				} });
			const gateway = createRybbitHandler({
				backgroundRefresh: false,
				properties: scopedProperties,
				read: observedRead,
				write,
				now,
				run,
				retention,
				funnels,
				...(deps.gsc ? { gsc: deps.gsc } : {}),
				...(deps.journeySessions ? { journeySessions: deps.journeySessions } : {}),
				realtime: (query) => ga4.runSafeRealtimeReport({ ...query, client: beta }),
				client: () => beta,
				admin: () => admin,
				...(!deps.read
					? {
							readEntry: async (...args) => {
								const entry = await reportCache.cacheGetEntry(...args);
								observe(entry?.data);
								return entry;
							},
					  }
					: {}),
				baseline: (prop) =>
					require("../../controllers/spikeDetector").propertyBaseline(prop, {
						timeZone: async () => property.timeZone,
						now: now(),
						fetchHistory: async (propertyId) => {
							const response = await run({
								propertyId,
								dimensions: [{ name: "dateHour" }],
								metrics: [{ name: "activeUsers" }],
								dateRange: { startDate: "7daysAgo", endDate: "yesterday" },
								limit: 168,
							});
							if (!response.ok) throw new Error(response.error);
							return response.rows;
						},
					}),
				...(deps.snapshot ? { snapshot: deps.snapshot } : {}),
			});
			if (args.pastMinutes !== undefined && !['get_dashboard_report', 'get_pages_report', 'get_events_report', 'get_journeys_report', 'get_site_status'].includes(operation)) throw new Error('This report requires calendar dates.');
			const window = definitionOnly || operation === "get_widget_report" ? {} : windowOverride || dateWindow(args, property, now());
			if (args.comparison && ['live-users', 'live-spike'].includes(args.report)) throw new Error('Realtime reports do not support historical comparisons.');
			previousWindow = comparisonWindow(window, args.comparison, dates => dateWindow(dates, property, now()));
			const query = { ...window, filters: JSON.stringify(args.filters || []) };
			const request = (action, extra = {}) => invoke(gateway, { path: `/sites/${args.propertyId}/${action}`, query, ...extra });
			let result;
			if (operation === 'get_search_analytics_report') {
				const dimension = args.dimension;
				if (!['country', 'device'].includes(dimension)) throw new Error('Choose country or device.');
				const analytics = await request('metric', { query: { ...query, parameter: dimension === 'country' ? 'country' : 'device_type', limit: 10000 } });
				if (analytics.error) return complete(analytics);
				let search;
				try {
					require('../../lib/setupCheck').syncEnvFile();
					search = await (deps.gsc || require('../../controllers/searchConsole').getSearchConsole()).report(property, 'data', { ...query, dimensions: dimension });
				} catch (error) { search = { data: null, error: error.message }; }
				const rows = require('../../controllers/searchConsoleRows').joinSearchRows(analytics.data.data, search.data || [], dimension);
				const metric = row => ['sessions', 'pageviews', 'users'].includes(args.sort || 'sessions')
					? row.analytics?.[({ sessions: 'count', pageviews: 'pageviews', users: 'active_users' })[args.sort || 'sessions']] : row.search?.[args.sort];
				rows.sort((a, b) => {
					const x = metric(a), y = metric(b);
					if (x == null || y == null) return x == null ? y == null ? a.key.localeCompare(b.key) : 1 : -1;
					return (args.order === 'asc' ? x - y : y - x) || a.key.localeCompare(b.key);
				});
				result = { data: rows, search: { connection: search.connection, error: search.error, range: search.range, reportStatus: search.reportStatus, truncated: !!search.truncated },
					reportStatus: analytics.reportStatus, source: 'ga4+gsc', timeZones: { ga4: property.timeZone, gsc: 'America/Los_Angeles' },
					truncated: analytics.data.totalCount > analytics.data.data.length || !!search.truncated,
					limitations: ['Missing GA4 or GSC matches remain unknown.', 'Sources retain their own calendars, processing delays and privacy limits.', ...(search.limitations || [])] };
			} else if (operation === "get_dashboard_report") {
				if (!REPORTS.includes(args.report)) throw new Error("Choose a report from get_capabilities.");
				if (args.segment && !Object.hasOwn(getAnalyticsCardConfig(args.report)?.segments || {}, args.segment))
					throw new Error("Choose a segment listed for this report in get_capabilities.");
				if (args.report === "live-spike" && args.filters?.length) throw new Error("Live spikes do not accept historical audience filters.");
				if (args.report === "live-users" && args.filters?.length) throw new Error("Live users do not accept historical audience filters.");
				const action =
					args.report === "overview" ? "overview" : args.report === "time-series" ? "overview/time-series" : `ga4/${args.report}`;
				result = await request(action, { query: { ...query, segment: args.segment, bucket: args.bucket || "day" } });
				if (args.report === "live-spike") result.limitations = [LIMITATIONS[5]];
				if (args.report === "live-users") {
					result.limitations = [LIMITATIONS[6]];
				}
			} else if (operation === "get_pages_report") {
				result = await request("pages", {
					query: {
						...query,
						mode: args.view === "entry" ? "entry" : "all",
						include_gsc: args.includeSearch ? 1 : undefined,
						group: args.group,
						section: args.section,
						search: args.search,
						sort: args.sort,
						order: args.order,
						limit: args.limit || 20,
						page: args.page || 1,
						offset: args.offset,
					},
				});
				if (!result.error) {
					const offset = args.offset ?? ((args.page || 1) - 1) * (args.limit || 20);
					result._pagination = [{ path: 'data.data', offset, returned: result.data.data.length,
						totalAvailable: result.data.totalCount, sourceTruncated: context.quality.truncated }];
					require('./results').syncPagination(result);
				}
			} else if (operation === "get_events_report") {
				result = await request(`events/${args.report || "names/stats"}`, {
					query: { ...query, bucket: args.bucket || "day", limit: args.limit || 20, type: args.type },
				});
				if (result.data?.events && result.data?.buckets) {
					const { buckets, events } = result.data;
					result.data = events.map(({ trend, ...event }) => ({
						...event,
						series: buckets.map((time, index) => ({ time, count: trend[index] })),
					}));
				}
			} else if (operation === "get_event_activity") {
				if (args.startDate || args.endDate) throw new Error("Event activity uses range and offset rather than explicit dates.");
				result = await invoke(createEventsHandlers({ run, read: observedRead, write, now, loadProperties: scopedProperties }).activity, {
					params: { propertyId: args.propertyId },
					query: { range: args.range || "7d", offset: String(args.offset || 0), event: args.eventName },
				});
			} else if (operation === "get_journeys_report") {
				if (args.mode === "sessions") {
					const limit = args.limit || 20;
					const sessionQuery = { ...query, mode: "sessions", steps: args.steps || 4,
						groupBy: args.groupBy === "section" ? "section" : "path", goalId: args.goalId,
						stepFilters: JSON.stringify({ ...args.stepFilters, ...(args.from ? { 0: args.from } : {}), ...(args.to ? { 1: args.to } : {}) }), endsAt: args.endsAt };
					if (args.path) {
						result = await request("journeys/sessions", { query: { ...sessionQuery, path: JSON.stringify(args.path), offset: args.offset || 0,
							limit: Math.min(limit + 1, 100), replays_only: args.replaysOnly ? "true" : undefined } });
						const extraRow = limit === 100 && result.data.length === 100 ? await request("journeys/sessions", {
							query: { ...sessionQuery, path: JSON.stringify(args.path), offset: (args.offset || 0) + 100, limit: 1, replays_only: args.replaysOnly ? "true" : undefined },
						}) : null;
						result = { ...result, returned: Math.min(limit, result.data.length), truncated: result.data.length > limit || !!extraRow?.data.length,
							data: result.data.slice(0, limit), metric: "sessions" };
					} else {
						const paths = await request("journeys", { query: { ...sessionQuery, limit: limit + 1 } });
						const summary = await request("journeys/summary", { query: sessionQuery });
						const context = await request("journeys/context", { query: sessionQuery });
						result = { ...paths, journeys: paths.journeys.slice(0, limit), truncated: paths.journeys.length > limit,
							summary: summary.data, context: context.data, metric: "sessions" };
					}
					result.limitations = require("../../controllers/demoData").enabled() ? ["Synthetic demo session events; not live GA4 session data."] : [];
				} else {
					result = await request("journeys", {
						query: {
							...query,
							groupBy: args.groupBy || "page",
							stepFilters: JSON.stringify({ 0: args.from, 1: args.to }),
							endsAt: args.endsAt,
							limit: 500,
						},
					});
					const { totalSessions, ...native } = result;
					result = { ...native, totalPageviews: totalSessions, metric: "screenPageViews" };
					result.limitations = [LIMITATIONS[1]];
					result.truncated ||= result.journeys?.length === 500;
					if (!result.error) result = paginateReport(result, args);
				}
			} else if (operation === "get_retention_report") {
				if (args.filters?.length) throw new Error("GA4 cohort reports cannot apply audience filters.");
				result = await invoke(retention, {
					params: { propertyId: args.propertyId },
					query: { start: window.start_date, end: window.end_date, bucket: args.bucket || "week", range: "30d" },
				});
				result.limitations = [LIMITATIONS[2]];
			} else if (operation === "get_site_status") {
				if (args.comparison && args.compare === false) throw new Error('Do not combine comparison with compare=false.');
				const days = (Date.parse(window.end_date) - Date.parse(window.start_date)) / DAY + 1;
				const comparison =
					args.compare === false
						? undefined
						: previousWindow || (args.pastMinutes ? { past_minutes_start: args.pastMinutes * 2, past_minutes_end: args.pastMinutes } : {
								start_date: new Date(Date.parse(window.start_date) - days * DAY).toISOString().slice(0, 10),
								end_date: new Date(Date.parse(window.start_date) - DAY).toISOString().slice(0, 10),
							  });
				result = await invoke(gateway, {
					method: "POST",
					path: "/organizations/ga4/site-status",
					query: { ...query, bucket: args.bucket || "day", time_zone: property.timeZone },
					body: { siteIds: [args.propertyId], comparison },
				});
			} else if (operation === 'validate_funnel') {
				result = { valid: true, data: { steps: require('../../controllers/funnels').normalizeSteps(args.steps).map(({ filterExpression, ...step }) => step) } };
			} else if (operation === 'import_funnels') {
				if (!Array.isArray(args.definitions) || !args.definitions.length || args.definitions.length > 100) throw new Error('Import 1–100 definitions into one property.');
				const definitions = args.definitions.map(definition => {
					if (typeof definition.name !== 'string' || !definition.name.trim() || definition.name.trim().length > 120
						|| (definition.description !== undefined && (typeof definition.description !== 'string' || definition.description.length > 2000))) throw new Error('Invalid funnel name or description.');
					return { name: definition.name.trim(), description: definition.description,
						steps: require('../../controllers/funnels').normalizeSteps(definition.steps).map(({ filterExpression, ...step }) => step) };
				});
				const imported = await store.importDefinitions(args.propertyId, definitions, { dryRun: !!args.dryRun });
				result = { data: imported, dryRun: !!args.dryRun, added: imported.filter(item => item.status === 'added').length,
					existing: imported.filter(item => item.status === 'existing').length };
			} else if (operation === 'export_funnels') {
				const saved = await store.list(args.propertyId);
				if (args.funnelIds?.some(id => !saved.some(item => item.id === id))) throw new Error('Funnel not found in this property.');
				result = paginateReport({ version: 1, data: saved.filter(item => !args.funnelIds || args.funnelIds.includes(item.id))
					.map(({ name, steps, description }) => ({ name, steps, ...(description !== undefined ? { description } : {}) })) }, args);
			} else if (operation === 'get_funnel_summary') {
				const definitions = await store.list(args.propertyId), offset = args.offset || 0, limit = args.limit || 5;
				if (limit > 9) throw new Error('Summarize up to 9 funnels per page.');
				const selected = definitions.slice(offset, offset + limit);
				result = await request('funnels/summary', { query: { ...query, funnel_ids: JSON.stringify(selected.map(item => item.id)) } });
				if (!result.error) {
					result.data.funnels = result.data.funnels.map(funnel => ({ ...funnel,
						name: selected.find(item => item.id === funnel.funnel_id)?.name,
						steps: funnel.steps.map(({ sessions, ...step }) => ({ ...step, users: sessions })) }));
					result.summaryScope = 'Selected page of saved funnels; union entrants are not a sum across pages.';
					result._pagination = [{ path: 'data.funnels', offset, returned: selected.length, totalAvailable: definitions.length,
						nextOffset: offset + selected.length < definitions.length ? offset + selected.length : null, sourceTruncated: false }];
					require('./results').syncPagination(result);
				}
			} else if (operation === 'get_funnel_events') {
				result = await request('funnels/events');
				if (result.data?.length === 100) result.truncated = true;
			} else if ([...LOCAL_FUNNEL_OPERATIONS, "analyze_funnel"].includes(operation)) {
				let steps = args.steps;
				let source;
				if (["analyze_funnel", 'duplicate_funnel'].includes(operation) && args.funnelId) {
					const saved = (await store.list(args.propertyId)).find((item) => item.id === args.funnelId);
					if (!saved) throw new Error("Funnel not found.");
					steps = saved.steps;
					source = saved;
				}
				const action = ['get_funnel', 'delete_funnel'].includes(operation) ? String(args.funnelId) : operation === "analyze_funnel" ? "analyze" : "definitions";
				result = await invoke(funnels, {
					method: operation === "delete_funnel" ? "DELETE" : ['get_funnel', 'list_saved_funnels'].includes(operation) ? "GET" : "POST",
					params: { propertyId: args.propertyId, action },
					query,
					body: { name: operation === 'duplicate_funnel' ? args.name || `${source.name.slice(0, 113)} (copy)` : args.name,
						reportId: operation === 'duplicate_funnel' ? undefined : args.funnelId, steps,
						description: operation === 'duplicate_funnel' ? source.description : args.description },
				});
				if (['save_funnel', 'duplicate_funnel'].includes(operation) && result.success) result.data = (await store.list(args.propertyId)).find(item => item.id === result.funnelId);
				if (operation === 'get_funnel' && !result.error) result = paginateReport(result, { ...args, limit: args.limit || 10, collection: 'steps' });
				if (operation === "analyze_funnel" && Array.isArray(result.data)) result.data = result.data.map(({ sessions, ...step }) => step);
				if (operation === "list_saved_funnels" && Array.isArray(result.data)) {
					const selected = result.data.filter((item) => !args.search || item.name.toLowerCase().includes(args.search.toLowerCase()));
					result = paginateReport({ ...result, data: selected, total: selected.length }, args);
				}
			} else if (["list_saved_widgets", "save_widget", "delete_widget", "get_widget_report"].includes(operation)) {
				const { normalizeWidgetConfig } = require("../../controllers/widgetConfig");
				const widgets = require("../../controllers/widgets").createWidgetHandlers({
					store: widgetStore,
					propertyFor: async (id) => {
						if (String(id) !== args.propertyId) throw new Error("Choose the selected property.");
						return property;
					},
					timeZoneFor: async () => property.timeZone,
					run,
					now,
					write,
					read: async (namespace, key) => {
						const entry = deps.read
							? { data: await observedRead(namespace, key), cachedAt: null }
							: await reportCache.cacheGetEntry(namespace, key);
						observe(entry?.data);
						return entry?.data ? entry : null;
					},
				});
				if (operation === "get_widget_report") {
					const saved = args.widgetId ? await widgetStore.getWidget(args.propertyId, args.widgetId) : null;
					if (args.widgetId && !saved) throw new Error("Widget not found.");
					result = { data: await widgets.analyze(property, normalizeWidgetConfig(saved?.config || args.config)) };
				} else {
					// Definition writes use the same validation as the UI; no sharing switch or key API is called.
					if (operation === "save_widget" && !property.timeZone) {
						const [metadata] = await admin.getProperty({ name: `properties/${args.propertyId}` });
						if (!metadata.timeZone) throw new Error("Property time zone is unavailable.");
						property.timeZone = metadata.timeZone;
					}
					const handler = operation === "list_saved_widgets" ? widgets.list : operation === "save_widget" ? widgets.save : widgets.remove;
					result = await invoke(handler, { params: { siteId: args.propertyId, widgetId: args.widgetId }, body: { config: args.config } });
					if (operation === "list_saved_widgets" && Array.isArray(result.data)) {
						const selected = result.data.filter(
							(item) => !args.search || item.config.name.toLowerCase().includes(args.search.toLowerCase()),
						);
						result = paginateReport({ ...result, data: selected, total: selected.length }, args);
					}
				}
			} else if (operation === "refresh_property_quota") {
				result = await invoke(
					createQuotaHandlers({ properties: scopedProperties, client: () => alpha, ledger, isDemo: deps.isDemo }).refresh,
					{},
				);
			} else throw new Error("Unsupported dashboard operation.");
			if (['get_dashboard_report', 'get_events_report', 'get_funnel_events', 'get_search_analytics_report'].includes(operation) && !result.error) {
				result = paginateReport(result, args);
			} else if (Array.isArray(result.data) && args.limit && result.data.length > args.limit && !result._pagination) {
				const total = result.data.length;
				result = {
					...result,
					data: result.data.slice(0, args.limit),
					returned: Math.min(total, args.limit),
					totalRows: total,
					truncated: total > args.limit,
				};
			}
			if (context.refusal) result = context.refusal;
			context.quality.truncated ||= !!result.truncated;
			if (!definitionOnly && !(operation === "get_journeys_report" && args.mode === "sessions") && !context.pools.size) context.pools.add(args.report === "live-users" ? "realtime" : ['analyze_funnel', 'get_funnel_summary'].includes(operation) ? "funnel" : "core");
			return complete({
				...result,
				propertyId: args.propertyId,
				apiCalls: context.calls,
				dataQuality: context.quality,
				quota: context.refusal?.quota || Object.fromEntries([...context.pools].map((pool) => [pool, ledger.status(args.propertyId, pool)])),
			});
		} catch (error) {
			return {
				...(context?.refusal || error.mcpResult || { error: "report_unavailable", message: error.message }),
				propertyId: args.propertyId,
				apiCalls: context?.calls || 0,
			};
		}
	}
	return { listProperties, execute, cachedSites };
}

let singleton;
function getDashboardService() {
	return (singleton ||= createDashboardService());
}

module.exports = { createDashboardService, getDashboardService, capabilities, REPORTS, FILTER_PARAMETERS, LIMITATIONS, dateWindow };
