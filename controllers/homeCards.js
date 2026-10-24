const { runSafeHistoricalReport } = require("./ga4Service");
const { cacheGet, cacheSet } = require("./reportCache");

// GA4 includes both endpoints, so seven days starts six days ago.
const RANGES = {
  today: { startDate: "today", dimension: "hour", points: 24 },
  "7d": { startDate: "6daysAgo", dimension: "nthDay", points: 7 },
  "28d": { startDate: "27daysAgo", dimension: "nthDay", points: 28 },
};

function createHomeCardsHandler(deps = {}) {
  const run = deps.run || runSafeHistoricalReport;
  const read = deps.read || cacheGet;
  const write = deps.write || cacheSet;
  const loadProperties = deps.loadProperties || (() => require("./apiController").ensureProperties());
  const inFlight = new Map();

  async function report(propertyId, range) {
    const key = `${propertyId}:${range}`;
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = (async () => {
      const cached = await read("home", key);
      if (cached) return { ...cached, cached: true };
      const cfg = RANGES[range];
      const query = {
        propertyId,
        dimensions: [{ name: cfg.dimension }],
        metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
        dateRange: { startDate: cfg.startDate, endDate: "today" },
        orderBys: [{ dimension: { dimensionName: cfg.dimension }, desc: false }],
        metricAggregations: ["TOTAL"],
        limit: cfg.points,
      };
      const response = await run(query);
      if (!response.ok) throw new Error(response.error || "Report query failed");

      let totals = response.totals?.[0]?.metricValues;
      if (!totals && response.rows.length) {
        // Users can appear in several buckets. Never sum them for the period total.
        const summary = await run({ ...query, dimensions: [], orderBys: [], limit: 1 });
        if (!summary.ok) throw new Error(summary.error || "Report totals unavailable");
        totals = summary.rows?.[0]?.metricValues;
        if (!totals) throw new Error("Report totals unavailable");
      }
      const series = Array(cfg.points).fill(0);
      for (const row of response.rows) {
        const index = Number.parseInt(row.dimensionValues?.[0]?.value, 10);
        if (index >= 0 && index < series.length) {
          series[index] = Number.parseInt(row.metricValues?.[0]?.value, 10) || 0;
        }
      }
      const payload = {
        activeUsers: Number.parseInt(totals?.[0]?.value, 10) || 0,
        pageViews: Number.parseInt(totals?.[1]?.value, 10) || 0,
        series,
        fetchedAt: Date.now(),
        cached: false,
      };
      await write("home", key, payload);
      return payload;
    })();
    inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      inFlight.delete(key);
    }
  }

  return async (req, res) => {
    const range = req.query.range;
    if (typeof range !== "string" || !Object.prototype.hasOwnProperty.call(RANGES, range)) {
      return res.status(400).json({ ok: false, error: "Choose today, 7d or 28d" });
    }
    try {
      const { properties } = await loadProperties();
      const data = Array(properties.length);
      let next = 0;
      // Bound GA4 fan-out; concurrent viewers share each property/range request.
      await Promise.all(Array.from({ length: Math.min(3, properties.length) }, async () => {
        while (next < properties.length) {
          const index = next++;
          const property = properties[index];
          const base = {
            propertyId: property.id,
            siteName: property.site,
            accountId: property.accountId || null,
            accountName: property.accountName || null,
            domain: property.domain || null,
            url: property.url || null,
          };
          try {
            data[index] = { ...base, ...await report(property.id, range) };
          } catch (err) {
            data[index] = { ...base, error: err.message || "Report query failed" };
          }
        }
      }));
      const timestamps = data.filter(row => !row.error).map(row => row.fetchedAt);
      if (data.length && !timestamps.length) {
        return res.status(502).json({ ok: false, range, data, error: "Property reports unavailable" });
      }
      const cacheStates = new Set(data.filter(row => !row.error).map(row => row.cached));
      return res.json({ ok: true, range, data, fetchedAt: timestamps.length ? Math.min(...timestamps) : null,
        cacheStatus: cacheStates.size > 1 ? "mixed" : cacheStates.has(true) ? "cached" : "fresh" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  };
}

module.exports = { createHomeCardsHandler };
