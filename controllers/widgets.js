const { createHash } = require("node:crypto");
const { handlers: embeds } = require("./embeds");
const {
  normalizeWidgetConfig,
  resolveWidgetPeriod,
  WIDGET_METRICS,
} = require("./widgetConfig");
const { runSafeHistoricalReport } = require("./ga4Service");
const { cacheGetEntry, cacheSet } = require("./reportCache");

const failure = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const exact = (fieldName, value) => ({
  filter: {
    fieldName,
    stringFilter: { matchType: "EXACT", value, caseSensitive: true },
  },
});
function widgetFilter(filters) {
  const expressions = [
    filters.pagePath && exact("pagePath", filters.pagePath),
    filters.country && exact("countryId", filters.country),
    filters.device && exact("deviceCategory", filters.device),
  ].filter(Boolean);
  return expressions.length > 1
    ? { andGroup: { expressions } }
    : expressions[0];
}
function valuesFor(row, metrics) {
  return Object.fromEntries(
    metrics.map((name, index) => {
      const raw = row?.metricValues?.[index]?.value;
      const value = raw == null || raw === "" ? null : Number(raw);
      const rate = WIDGET_METRICS[name].format === "percent";
      return [
        name,
        value != null && Number.isFinite(value)
          ? value * (rate ? 100 : 1)
          : rate
          ? null
          : 0,
      ];
    })
  );
}
function seriesFor(rows, metrics, range, bucket) {
  const map = new Map(
    (rows || []).map((row) => [
      row.dimensionValues?.[0]?.value,
      valuesFor(row, metrics),
    ])
  );
  const keys = new Set();
  for (
    let time = Date.parse(range.startDate);
    time <= Date.parse(range.endDate);
    time += 86400000
  ) {
    const iso = new Date(time).toISOString().slice(0, 10),
      key = iso.replace(/-/g, "").slice(0, bucket === "month" ? 6 : 8);
    keys.add(key);
  }
  return [...keys].map((key) => ({
    date: `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8) || "01"}`,
    values: map.get(key) || valuesFor(null, metrics),
  }));
}
function createWidgetHandlers(deps = {}) {
  const store = deps.store || embeds.store;
  const propertyFor = deps.propertyFor || embeds.propertyFor;
  const timeZoneFor = deps.timeZoneFor || embeds.timeZoneFor;
  const run = deps.run || runSafeHistoricalReport;
  const read = deps.read || cacheGetEntry,
    write = deps.write || cacheSet;
  const now = deps.now || (() => new Date());
  const pending = new Map(),
    waiting = [];
  let active = 0;
  async function report(
    propertyId,
    range,
    metrics,
    dimensions,
    dimensionFilter
  ) {
    const key =
      "metric-widget-v1:" +
      createHash("sha256")
        .update(
          JSON.stringify({
            propertyId,
            range,
            metrics,
            dimensions,
            dimensionFilter,
          })
        )
        .digest("hex");
    if (!pending.has(key)) {
      const task = (async () => {
        const hit = await read("widget", key);
        if (hit) return { ...hit.data, fetchedAt: hit.cachedAt };
        if (active >= 3) await new Promise((resolve) => waiting.push(resolve));
        else active++;
        try {
          const response = await run({
            propertyId,
            dateRange: range,
            dimensions: dimensions.map((name) => ({ name })),
            metrics: metrics.map((name) => ({ name })),
            dimensionFilter,
            limit: dimensions.length ? 400 : 1,
            ...(dimensions.length
              ? {
                  orderBys: [
                    {
                      dimension: { dimensionName: dimensions[0] },
                      desc: false,
                    },
                  ],
                }
              : {}),
          });
          if (!response.ok)
            throw failure(
              response.error || "GA4 widget report unavailable.",
              response.errorCode === 8 ? 429 : 502
            );
          const fetchedAt = now().toISOString();
          await write("widget", key, response, { cachedAt: fetchedAt });
          return { ...response, fetchedAt };
        } finally {
          if (waiting.length) waiting.shift()();
          else active--;
        }
      })().finally(() => pending.delete(key));
      pending.set(key, task);
    }
    return pending.get(key);
  }
  async function analyze(property, config) {
    const timeZone = await timeZoneFor(property);
    const { range, previous } = resolveWidgetPeriod(
      config.period,
      timeZone,
      now()
    );
    const metrics = config.metrics.map((item) => item.metric);
    const dimensionFilter = widgetFilter(config.filters);
    const query = (period, dimensions = []) =>
      report(String(property.id), period, metrics, dimensions, dimensionFilter);
    const wantsSeries = config.layout === "card" && config.showChart;
    const [current, before, trend] = await Promise.all([
      query(range),
      config.comparison ? query(previous).catch(() => null) : null,
      wantsSeries
        ? query(range, [config.bucket === "month" ? "yearMonth" : "date"])
        : null,
    ]);
    const times = [current, before, trend]
      .filter(Boolean)
      .map((item) => item.fetchedAt)
      .filter(Boolean)
      .sort();
    return {
      range,
      previousRange: config.comparison ? previous : null,
      values: valuesFor(current.rows?.[0], metrics),
      previous: before ? valuesFor(before.rows?.[0], metrics) : null,
      series: wantsSeries
        ? seriesFor(trend.rows, metrics, range, config.bucket)
        : [],
      timeZone,
      currencyCode:
        current.metadata?.currencyCode || property.currencyCode || "",
      fetchedAt: times[0] || now().toISOString(),
      comparisonUnavailable: config.comparison && !before,
      limited: [current, before, trend].some(
        (item) =>
          item &&
          (item.metadata?.subjectToThresholding ||
            item.metadata?.dataLossFromOtherRow ||
            item.metadata?.samplingMetadatas?.length)
      ),
    };
  }
  const handle = (task) => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      return await task(req, res);
    } catch (error) {
      return res
        .status(error.status || 502)
        .json({ error: error.message || "Widget unavailable." });
    }
  };
  const management = (task) =>
    handle(async (req, res) => {
      if (req.headers?.["x-private-key"] || req.headers?.["x-private-site"])
        throw failure("Shared dashboards are read-only.", 403);
      const property = await propertyFor(req.params.siteId);
      return task(req, res, property);
    });
  async function publicWidget(req) {
    const property = await propertyFor(req.params.siteId);
    if (!/^[a-f0-9]{12}$/.test(req.params.widgetId || ""))
      throw failure("Widget not found.", 404);
    if (!(await store.get(property.id)).embedEnabled)
      throw failure("Embed widget is not enabled for this site.", 403);
    const widget = await store.getWidget(property.id, req.params.widgetId);
    if (!widget) throw failure("Widget not found.", 404);
    if (!widget.config.enabled) throw failure("This widget is disabled.", 403);
    return { property, widget };
  }
  return {
    analyze,
    list: management(async (req, res, property) =>
      res.json({ data: await store.listWidgets(property.id) })
    ),
    save: management(async (req, res, property) => {
      const config = normalizeWidgetConfig(req.body?.config);
      resolveWidgetPeriod(config.period, await timeZoneFor(property), now());
      const data = await store.saveWidget(
        property.id,
        config,
        req.params.widgetId
      );
      return res.json({ data });
    }),
    remove: management(async (req, res, property) => {
      await store.removeWidget(property.id, req.params.widgetId);
      return res.json({ success: true });
    }),
    preview: management(async (req, res, property) =>
      res.json({
        data: await analyze(property, normalizeWidgetConfig(req.body?.config)),
      })
    ),
    data: handle(async (req, res) => {
      const { property, widget } = await publicWidget(req);
      return res.json({
        data: await analyze(property, widget.config),
        config: widget.config,
      });
    }),
    page: handle(async (req, res) => {
      const { widget } = await publicWidget(req);
      req.metricWidget = {
        siteId: String(req.params.siteId),
        widgetId: widget.id,
        config: widget.config,
      };
      res.set({
        "Content-Security-Policy": "frame-ancestors *",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
      });
      return require("./workspace").workspaceView(req, res, (error) => {
        throw error;
      });
    }),
    previewPage: handle(async (req, res) => {
      req.metricWidget = { preview: true };
      res.set({
        "Content-Security-Policy": "frame-ancestors 'self'",
        "X-Robots-Tag": "noindex, nofollow",
      });
      return require("./workspace").workspaceView(req, res, (error) => {
        throw error;
      });
    }),
  };
}
module.exports = { createWidgetHandlers, widgetFilter, valuesFor, seriesFor };
