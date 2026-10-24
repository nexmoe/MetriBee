const { runSafeHistoricalReport } = require("./ga4Service");

function numberAt(row, index) {
  return Number(row?.metricValues?.[index]?.value || 0);
}

function valueAt(row, index, fallback = "(not set)") {
  return row?.dimensionValues?.[index]?.value || fallback;
}

function slug(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function visitorLabel(type) {
  if (type === "new") return "New visitors";
  if (type === "returning") return "Returning visitors";
  return "Unclassified visitors";
}

function inferIntent({ type, channel, keyEvents, avgEngagementSeconds }) {
  if (keyEvents > 0) return "Conversion intent";
  if (type === "returning" && avgEngagementSeconds >= 20) return "Evaluation";
  if (/organic|referral|social/i.test(channel)) return "Discovery";
  if (/direct|email/i.test(channel)) return "Recall";
  return "Browsing";
}

function buildVisitorPersonas({ segmentRows = [], pageRows = [], timelineRows = [] }) {
  const topPages = pageRows.slice(0, 8).map((row) => ({
    path: valueAt(row, 0, "/"),
    views: numberAt(row, 0),
    engagementSeconds: numberAt(row, 1),
    events: numberAt(row, 2),
  }));

  const timeline = timelineRows.map((row) => ({
    date: valueAt(row, 0, ""),
    activeUsers: numberAt(row, 0),
    sessions: numberAt(row, 1),
    engagementSeconds: numberAt(row, 2),
    avgEngagementSeconds: numberAt(row, 0) ? Math.round(numberAt(row, 2) / numberAt(row, 0)) : 0,
    revenue: numberAt(row, 3),
  }));

  return segmentRows
    .map((row) => {
      const type = valueAt(row, 0, "unknown");
      const channel = valueAt(row, 1, "(not set)");
      const activeUsers = numberAt(row, 0);
      const sessions = numberAt(row, 1);
      const engagedSessions = numberAt(row, 2);
      const engagementSeconds = numberAt(row, 3);
      const keyEvents = numberAt(row, 4);
      const avgEngagementSeconds = activeUsers
        ? Math.round(engagementSeconds / activeUsers)
        : 0;

      return {
        id: `${slug(type)}-${slug(channel)}`,
        type,
        visitType: type === "new" ? "First visit" : type === "returning" ? "Revisit" : "Unclassified visit",
        label: visitorLabel(type),
        channel,
        activeUsers,
        sessions,
        engagedSessions,
        engagementRate: sessions ? Math.round((engagedSessions / sessions) * 100) : 0,
        avgEngagementSeconds,
        keyEvents,
        intent: inferIntent({ type, channel, keyEvents, avgEngagementSeconds }),
        topPages,
        timeline,
      };
    })
    .filter((persona) => persona.activeUsers > 0)
    .sort((a, b) => b.activeUsers - a.activeUsers);
}

async function getVisitorInsights(propertyId, range = "28d") {
  const dateRange =
    range === "today"
      ? { startDate: "today", endDate: "today" }
      : range === "7d"
        ? { startDate: "6daysAgo", endDate: "today" }
        : { startDate: "27daysAgo", endDate: "today" };

  const [segments, pages, timeline] = await Promise.all([
    runSafeHistoricalReport({
      propertyId,
      dimensions: [{ name: "newVsReturning" }, { name: "firstUserDefaultChannelGroup" }],
      metrics: [
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "engagedSessions" },
        { name: "userEngagementDuration" },
        { name: "keyEvents" },
      ],
      fallbackMetrics: [
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "engagedSessions" },
        { name: "userEngagementDuration" },
        { name: "eventCount" },
      ],
      dateRange,
      limit: 8,
    }),
    runSafeHistoricalReport({
      propertyId,
      dimensions: [{ name: "pagePath" }],
      metrics: [
        { name: "screenPageViews" },
        { name: "userEngagementDuration" },
        { name: "eventCount" },
      ],
      dateRange,
      limit: 8,
    }),
    runSafeHistoricalReport({
      propertyId,
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "userEngagementDuration" },
        { name: "totalRevenue" },
      ],
      fallbackMetrics: [
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "userEngagementDuration" },
      ],
      dateRange,
      limit: range === "today" ? 1 : range === "7d" ? 7 : 28,
      orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
    }),
  ]);

  if (!segments.ok && !pages.ok && !timeline.ok) {
    throw new Error(segments.error || pages.error || timeline.error || "Visitor insight reports failed");
  }

  return {
    ok: true,
    range,
    personas: buildVisitorPersonas({
      segmentRows: segments.rows || [],
      pageRows: pages.rows || [],
      timelineRows: timeline.rows || [],
    }),
    supportedMode: "aggregate",
    note: "GA4 Data API reports aggregate visitor segments. It does not expose identifiable per-user page histories unless your property implements User-ID and registered custom dimensions.",
  };
}

module.exports = {
  buildVisitorPersonas,
  getVisitorInsights,
};
