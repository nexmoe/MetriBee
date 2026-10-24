/**
 * reportExtras.js
 * Report-page cards that need more than one flat GA4 query: referrers with
 * engagement, engagement tables (source / medium / platform), suspected bot
 * traffic and revenue plus key events. Pure helpers are exported for tests;
 * `runExtraCard` takes the GA4 runner as an argument so it can be faked.
 */

const { classifyReferralSource } = require("./spikeDetector");

const ENGAGEMENT_METRICS = ["sessions", "engagedSessions", "userEngagementDuration", "activeUsers", "keyEvents"];
const ENGAGEMENT_FALLBACK = ["sessions", "engagedSessions", "userEngagementDuration", "activeUsers"];
const ENGAGEMENT_HEADERS = ["sessions", "engagementRatePct", "avgEngagementSeconds", "keyEvents"];

const DATACENTER_CITIES = new Set([
  "ashburn", "boardman", "council bluffs", "the dalles", "moses lake", "lanzhou", "santa clara",
]);

const REVENUE_METRICS = [
  "totalAdRevenue", "publisherAdImpressions", "publisherAdClicks", "purchaseRevenue", "keyEvents", "eventValue",
];
const REVENUE_FALLBACK = ["purchaseRevenue", "keyEvents", "eventValue"];

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Engagement rate (0-1) and average engagement seconds per user. */
function engagementStats({ sessions = 0, engagedSessions = 0, duration = 0, users = 0 }) {
  return {
    engagementRate: sessions > 0 ? engagedSessions / sessions : 0,
    avgEngagement: users > 0 ? duration / users : 0,
  };
}

function bareHost(host) {
  return String(host || "").toLowerCase().replace(/^www\./, "");
}

function hostOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isOwnHost(host, ownHost) {
  const h = bareHost(host);
  const own = bareHost(ownHost);
  if (!h || !own) return false;
  return h === own || h.endsWith("." + own);
}

/** Maps GA4 rows (dims + metric values in ENGAGEMENT_METRICS order) to engagement rows. */
function toEngagementRow(dims, values, metricNames) {
  const get = (name) => {
    const i = metricNames.indexOf(name);
    return i >= 0 ? num(values[i]) : 0;
  };
  const sessions = get("sessions");
  const stats = engagementStats({
    sessions,
    engagedSessions: get("engagedSessions"),
    duration: get("userEngagementDuration"),
    users: get("activeUsers"),
  });
  return {
    dims,
    sessions,
    engagementRate: stats.engagementRate,
    avgEngagement: stats.avgEngagement,
    keyEvents: metricNames.includes("keyEvents") ? get("keyEvents") : null,
  };
}

const platformOf = (host) => classifyReferralSource(host);

/**
 * Groups referrer rows by platform. Drops empty referrers and the property's own domain.
 * Input rows: { url, sessions, engagementRate, avgEngagement, keyEvents }.
 */
function groupReferrers(rows, ownHost) {
  const groups = new Map();
  for (const row of rows || []) {
    const url = String(row.url || "").trim();
    if (!url || url === "(not set)") continue;
    const host = hostOf(url);
    if (!host || isOwnHost(host, ownHost)) continue;
    const cls = platformOf(host);
    const key = cls.category === "other" ? "host:" + bareHost(host) : cls.category;
    if (!groups.has(key)) {
      groups.set(key, {
        name: cls.category === "other" ? bareHost(host) : cls.name,
        category: cls.category,
        shape: cls.shape,
        sessions: 0,
        rows: [],
      });
    }
    const g = groups.get(key);
    g.sessions += row.sessions || 0;
    g.rows.push({ ...row, url });
  }
  return [...groups.values()]
    .map((g) => ({ ...g, rows: g.rows.sort((a, b) => b.sessions - a.sessions) }))
    .sort((a, b) => b.sessions - a.sessions);
}

/**
 * Bot heuristic. Returns a short reason string or null.
 * Row: { city, sessions, engagedSessions, duration }. Avg engagement is per session.
 */
function botReason(row) {
  const sessions = row.sessions || 0;
  if (sessions <= 0) return null;
  const rate = (row.engagedSessions || 0) / sessions;
  const avg = (row.duration || 0) / sessions;
  if (sessions >= 10 && rate < 0.1 && avg < 2) return "Low engagement";
  if (DATACENTER_CITIES.has(String(row.city || "").trim().toLowerCase()) && rate < 0.2) return "Datacenter city";
  return null;
}

function flagBots(rows, totalSessions) {
  const total = totalSessions || (rows || []).reduce((a, r) => a + (r.sessions || 0), 0);
  return (rows || [])
    .map((r) => ({ ...r, reason: botReason(r) }))
    .filter((r) => r.reason)
    .map((r) => ({ ...r, share: total > 0 ? r.sessions / total : 0 }))
    .sort((a, b) => b.sessions - a.sessions);
}

/** True when at least one revenue / key-event metric is non-zero. */
function hasRevenueData(summary) {
  return Object.values(summary || {}).some((v) => num(v) !== 0);
}

function metricNamesOf(response, fallback) {
  return (response.usedMetrics || fallback.map((name) => ({ name }))).map((m) => m.name);
}

function engagementPayload(rows) {
  return rows.map((r) => ({
    dims: r.dims,
    metrics: [
      r.sessions,
      Math.round(r.engagementRate * 1000) / 10,
      Math.round(r.avgEngagement),
      r.keyEvents ?? 0,
    ],
  }));
}

async function runEngagement({ run, propertyId, dateRange, dimensions, limit, dimensionFilter = null }) {
  const response = await run({
    propertyId,
    dimensions: dimensions.map((name) => ({ name })),
    metrics: ENGAGEMENT_METRICS.map((name) => ({ name })),
    fallbackMetrics: ENGAGEMENT_FALLBACK.map((name) => ({ name })),
    dateRange,
    limit,
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    dimensionFilter,
  });
  if (!response.ok) throw new Error(response.error || "Report query failed");
  const names = metricNamesOf(response, ENGAGEMENT_METRICS);
  return (response.rows || []).map((row) =>
    toEngagementRow(
      row.dimensionValues.map((d) => d.value),
      row.metricValues.map((m) => m.value),
      names,
    ),
  );
}

/**
 * Builds the payload for a card config with a `kind`. `run` is runSafeHistoricalReport.
 * Returns an object that also carries generic `rows` / `metricHeaders` for CSV export.
 */
async function runExtraCard({ cfg, type, propertyId, dateRange, seg, ownHost, run }) {
  if (cfg.kind === "engagement" || cfg.kind === "split") {
    const dimension = cfg.kind === "split" ? cfg.segments[seg] : null;
    const dims = dimension ? [dimension] : cfg.dimensions;
    const rows = await runEngagement({ run, propertyId, dateRange, dimensions: dims, limit: cfg.limit });
    return {
      ok: true,
      kind: "engagement",
      seg: dimension ? seg : undefined,
      segments: cfg.kind === "split" ? Object.keys(cfg.segments) : undefined,
      dimensionHeaders: dims,
      metricHeaders: ENGAGEMENT_HEADERS,
      rows: engagementPayload(rows),
      totals: [rows.reduce((a, r) => a + r.sessions, 0)],
    };
  }

  if (cfg.kind === "referrers") {
    const own = bareHost(ownHost);
    const filter = own
      ? { notExpression: { filter: { fieldName: "pageReferrer", stringFilter: { matchType: "CONTAINS", value: own } } } }
      : null;
    const rows = await runEngagement({
      run, propertyId, dateRange, dimensions: ["pageReferrer"], limit: cfg.limit, dimensionFilter: filter,
    });
    const groups = groupReferrers(
      rows.map((r) => ({
        url: r.dims[0],
        sessions: r.sessions,
        engagementRate: r.engagementRate,
        avgEngagement: r.avgEngagement,
        keyEvents: r.keyEvents,
      })),
      ownHost,
    );
    const flat = groups.flatMap((g) => g.rows.map((r) => ({ ...r, dims: [r.url, g.name] })));
    return {
      ok: true,
      kind: "referrers",
      groups,
      dimensionHeaders: ["pageReferrer", "platform"],
      metricHeaders: ENGAGEMENT_HEADERS,
      rows: engagementPayload(flat),
      totals: [flat.reduce((a, r) => a + r.sessions, 0)],
    };
  }

  if (cfg.kind === "bots") {
    const metrics = ["sessions", "engagedSessions", "userEngagementDuration", "newUsers"];
    const response = await run({
      propertyId,
      dimensions: cfg.dimensions.map((name) => ({ name })),
      metrics: metrics.map((name) => ({ name })),
      dateRange,
      limit: cfg.limit,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      metricAggregations: ["TOTAL"],
    });
    if (!response.ok) throw new Error(response.error || "Report query failed");
    const totalSessions = num(response.totals?.[0]?.metricValues?.[0]?.value);
    const parsed = (response.rows || []).map((row) => {
      const [country, city, source, device] = row.dimensionValues.map((d) => d.value);
      const v = row.metricValues.map((m) => num(m.value));
      return { country, city, source, device, sessions: v[0], engagedSessions: v[1], duration: v[2], newUsers: v[3] };
    });
    const flagged = flagBots(parsed, totalSessions);
    return {
      ok: true,
      kind: "bots",
      flagged,
      totalSessions,
      dimensionHeaders: ["country", "city", "sessionSource", "deviceCategory", "reason"],
      metricHeaders: ["sessions", "sharePct"],
      rows: flagged.map((r) => ({
        dims: [r.country, r.city, r.source, r.device, r.reason],
        metrics: [r.sessions, Math.round(r.share * 1000) / 10],
      })),
      totals: [flagged.reduce((a, r) => a + r.sessions, 0)],
    };
  }

  if (cfg.kind === "revenue") {
    const summaryRes = await run({
      propertyId,
      dimensions: [],
      metrics: REVENUE_METRICS.map((name) => ({ name })),
      fallbackMetrics: REVENUE_FALLBACK.map((name) => ({ name })),
      dateRange,
      limit: 1,
      orderBys: [],
    });
    if (!summaryRes.ok) return { ok: true, kind: "revenue", hidden: true, rows: [], metricHeaders: [] };
    const names = metricNamesOf(summaryRes, REVENUE_METRICS);
    const values = summaryRes.rows?.[0]?.metricValues || [];
    const summary = Object.fromEntries(names.map((n, i) => [n, num(values[i]?.value)]));
    if (!hasRevenueData(summary)) return { ok: true, kind: "revenue", hidden: true, summary, rows: [], metricHeaders: [] };

    const eventQuery = {
      propertyId,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "keyEvents" }, { name: "eventValue" }],
      dateRange,
      limit: 20,
      orderBys: [{ metric: { metricName: "keyEvents" }, desc: true }],
    };
    let eventsRes = await run({
      ...eventQuery,
      dimensionFilter: { filter: { fieldName: "isKeyEvent", stringFilter: { matchType: "EXACT", value: "true" } } },
    });
    if (!eventsRes.ok) eventsRes = await run(eventQuery);
    const events = (eventsRes.rows || [])
      .map((row) => ({
        name: row.dimensionValues[0].value,
        keyEvents: num(row.metricValues[0].value),
        value: num(row.metricValues[1].value),
      }))
      .filter((e) => e.keyEvents > 0);

    return {
      ok: true,
      kind: "revenue",
      hidden: false,
      summary,
      events,
      dimensionHeaders: ["eventName"],
      metricHeaders: ["keyEvents", "eventValue"],
      rows: events.map((e) => ({ dims: [e.name], metrics: [e.keyEvents, e.value] })),
      totals: [events.reduce((a, e) => a + e.keyEvents, 0)],
    };
  }

  throw new Error(`Unknown card kind for ${type}`);
}

module.exports = {
  DATACENTER_CITIES,
  botReason,
  engagementStats,
  flagBots,
  groupReferrers,
  hasRevenueData,
  isOwnHost,
  runExtraCard,
};
