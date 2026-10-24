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
		timeWindows: { pastMinutes: 'Rolling minute window, e.g. 1440 for Last 24 Hours. Available on dashboard, pages, events, journeys and site status reports; calendar-only reports reject it.', precision: 'minute', freshness: 'GA4 historical processing delay applies; use realtime for live traffic.' },
		workflow: [
			"Use list_properties to select one property, and get_capabilities to choose a report.",
			"Use a short date range and one focused high-level tool. Shared dashboard cache hits spend no GA4 tokens.",
			"Inspect returned quota, apiCalls, warnings and truncation. Stop on quota_low or rate_limited; never loop reports over properties.",
		],
		limitations: LIMITATIONS,
		funnels: {
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
		const offset = args.offset || 0,
			limit = args.limit || 50;
		return {
			properties: rows.slice(offset, offset + limit),
			total: rows.length,
			offset,
			source: loaded.source,
			nextOffset: offset + limit < rows.length ? offset + limit : null,
		};
	}

	async function execute(operation, args) {
		const mutating = ["save_funnel", "delete_funnel", "save_widget", "delete_widget", "refresh_property_quota"].includes(operation);
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

	async function perform(operation, args) {
		let context;
		try {
			if (!/^\d+$/.test(args.propertyId || "")) throw new Error("Choose a numeric property ID.");
			const loaded = await properties();
			let property = loaded.properties.find((item) => String(item.id) === args.propertyId);
			if (!property)
				return { error: "property_not_found", propertyId: args.propertyId, hint: "Use list_properties to choose a connected property." };
			property = { ...property };
			if (operation === 'get_search_console_quota') {
				require('../../lib/setupCheck').syncEnvFile();
				const result = await (deps.gsc || require('../../controllers/searchConsole').getSearchConsole()).quota([property],
					{ demo: (deps.isDemo || require('../../controllers/demoData').enabled)() });
				return { ...result, source: 'gsc', propertyId: args.propertyId, ga4ApiCalls: 0, quotaSource: 'gsc' };
			}
			if (operation === 'get_search_console_report') {
				if ((deps.isDemo || require('../../controllers/demoData').enabled)()) return { source: 'gsc', propertyId: args.propertyId, data: null, connection: { connected: false, reason: 'demo' }, ga4ApiCalls: 0 };
				require('../../lib/setupCheck').syncEnvFile();
				const query = { ...dateWindow(args, { ...property, timeZone: 'America/Los_Angeles' }, now()),
					filters: JSON.stringify(args.filters || []), dimensions: args.dimension || 'query' };
				const result = await (deps.gsc || require('../../controllers/searchConsole').getSearchConsole()).report(property, args.report || 'summary', query);
				if (Array.isArray(result.data)) {
					const count = result.data.length;
					result.data = result.data.slice(0, args.limit || 20);
					result.returned = result.data.length;
					result.truncated ||= count > result.data.length;
				}
				return { ...result, propertyId: args.propertyId, ga4ApiCalls: 0, quotaSource: 'gsc' };
			}
			context = { calls: 0, pools: new Set(), refusal: null, quality: { truncated: false, thresholded: false, sampled: false } };
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
				"list_saved_funnels",
				"save_funnel",
				"delete_funnel",
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
			const funnels = createFunnels({ properties: scopedProperties, now, client: () => alpha, store });
			const gateway = createRybbitHandler({
				properties: scopedProperties,
				read: observedRead,
				write,
				now,
				run,
				retention,
				funnels,
				...(deps.gsc ? { gsc: deps.gsc } : {}),
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
			const window = definitionOnly || operation === "get_widget_report" ? {} : dateWindow(args, property, now());
			const query = { ...window, filters: JSON.stringify(args.filters || []) };
			const request = (action, extra = {}) => invoke(gateway, { path: `/sites/${args.propertyId}/${action}`, query, ...extra });
			let result;
			if (operation === "get_dashboard_report") {
				if (!REPORTS.includes(args.report)) throw new Error("Choose a report from get_capabilities.");
				if (args.segment && !Object.hasOwn(getAnalyticsCardConfig(args.report)?.segments || {}, args.segment))
					throw new Error("Choose a segment listed for this report in get_capabilities.");
				if (args.report === "live-spike" && args.filters?.length) throw new Error("Live spikes do not accept historical audience filters.");
				if (args.report === "live-users" && args.filters?.length) throw new Error("Live users do not accept historical audience filters.");
				const action =
					args.report === "overview" ? "overview" : args.report === "time-series" ? "overview/time-series" : `ga4/${args.report}`;
				result = await request(action, { query: { ...query, segment: args.segment, bucket: args.bucket || "day" } });
				if (Array.isArray(result.data?.rows))
					result.data = {
						...result.data,
						rows: result.data.rows.slice(0, args.limit || 20),
						returned: Math.min(result.data.rows.length, args.limit || 20),
						truncated: result.data.rows.length > (args.limit || 20) || result.data.rowCount > result.data.rows.length,
					};
				if (args.report === "live-spike") result.limitations = [LIMITATIONS[5]];
				if (args.report === "live-users") {
					for (const key of ["countries", "devices", "pages"]) {
						const group = result.data[key], limit = args.limit || 20;
						result.data[key] = { ...group, rows: group.rows.slice(0, limit), returned: Math.min(group.rows.length, limit), truncated: group.truncated || group.rows.length > limit };
					}
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
					},
				});
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
				result = await request("journeys", {
					query: {
						...query,
						groupBy: args.groupBy || "page",
						stepFilters: JSON.stringify({ 0: args.from, 1: args.to }),
						endsAt: args.endsAt,
						limit: args.limit || 20,
					},
				});
				const { totalSessions, ...native } = result;
				result = { ...native, totalPageviews: totalSessions, metric: "screenPageViews" };
				result.limitations = [LIMITATIONS[1]];
			} else if (operation === "get_retention_report") {
				if (args.filters?.length) throw new Error("GA4 cohort reports cannot apply audience filters.");
				result = await invoke(retention, {
					params: { propertyId: args.propertyId },
					query: { start: window.start_date, end: window.end_date, bucket: args.bucket || "week", range: "30d" },
				});
				result.limitations = [LIMITATIONS[2]];
			} else if (operation === "get_site_status") {
				const days = (Date.parse(window.end_date) - Date.parse(window.start_date)) / DAY + 1;
				const comparison =
					args.compare === false
						? undefined
						: args.pastMinutes ? { past_minutes_start: args.pastMinutes * 2, past_minutes_end: args.pastMinutes } : {
								start_date: new Date(Date.parse(window.start_date) - days * DAY).toISOString().slice(0, 10),
								end_date: new Date(Date.parse(window.start_date) - DAY).toISOString().slice(0, 10),
						  };
				result = await invoke(gateway, {
					method: "POST",
					path: "/organizations/ga4/site-status",
					query: { ...query, bucket: args.bucket || "day", time_zone: property.timeZone },
					body: { siteIds: [args.propertyId], comparison },
				});
			} else if (["list_saved_funnels", "save_funnel", "delete_funnel", "analyze_funnel"].includes(operation)) {
				let steps = args.steps;
				if (operation === "analyze_funnel" && args.funnelId) {
					const saved = (await store.list(args.propertyId)).find((item) => item.id === args.funnelId);
					if (!saved) throw new Error("Funnel not found.");
					steps = saved.steps;
				}
				const action = operation === "delete_funnel" ? String(args.funnelId) : operation === "analyze_funnel" ? "analyze" : "definitions";
				result = await invoke(funnels, {
					method: operation === "delete_funnel" ? "DELETE" : operation === "list_saved_funnels" ? "GET" : "POST",
					params: { propertyId: args.propertyId, action },
					query,
					body: { name: args.name, reportId: args.funnelId, steps },
				});
				if (operation === "analyze_funnel" && Array.isArray(result.data)) result.data = result.data.map(({ sessions, ...step }) => step);
				if (operation === "list_saved_funnels" && Array.isArray(result.data)) {
					const selected = result.data.filter((item) => !args.search || item.name.toLowerCase().includes(args.search.toLowerCase()));
					const offset = args.offset || 0,
						limit = args.limit || 20;
					result = {
						...result,
						data: selected.slice(offset, offset + limit),
						total: selected.length,
						offset,
						nextOffset: offset + limit < selected.length ? offset + limit : null,
					};
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
						const offset = args.offset || 0,
							limit = args.limit || 20;
						result = {
							...result,
							data: selected.slice(offset, offset + limit),
							total: selected.length,
							offset,
							nextOffset: offset + limit < selected.length ? offset + limit : null,
						};
					}
				}
			} else if (operation === "refresh_property_quota") {
				result = await invoke(
					createQuotaHandlers({ properties: scopedProperties, client: () => alpha, ledger, isDemo: deps.isDemo }).refresh,
					{},
				);
			} else throw new Error("Unsupported dashboard operation.");
			if (Array.isArray(result.data) && args.limit && result.data.length > args.limit) {
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
			if (!definitionOnly && !context.pools.size) context.pools.add(args.report === "live-users" ? "realtime" : operation === "analyze_funnel" ? "funnel" : "core");
			return {
				...result,
				propertyId: args.propertyId,
				apiCalls: context.calls,
				dataQuality: context.quality,
				quota: context.refusal?.quota || Object.fromEntries([...context.pools].map((pool) => [pool, ledger.status(args.propertyId, pool)])),
			};
		} catch (error) {
			return {
				...(context?.refusal || error.mcpResult || { error: "report_unavailable", message: error.message }),
				propertyId: args.propertyId,
				apiCalls: context?.calls || 0,
			};
		}
	}
	return { listProperties, execute };
}

let singleton;
function getDashboardService() {
	return (singleton ||= createDashboardService());
}

module.exports = { createDashboardService, getDashboardService, capabilities, REPORTS, FILTER_PARAMETERS, LIMITATIONS, dateWindow };
