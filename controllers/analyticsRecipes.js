const DATE_RANGES = {
  today: { startDate: "today", endDate: "today" },
  "7d": { startDate: "6daysAgo", endDate: "today" },
  "28d": { startDate: "27daysAgo", endDate: "today" },
  "30d": { startDate: "29daysAgo", endDate: "today" },
  "90d": { startDate: "89daysAgo", endDate: "today" },
};

const CARD_CONFIGS = {
  "new-users-by-date": {
    dimensions: ["date"],
    metrics: ["newUsers", "sessions", "totalRevenue"],
    limit: 28,
    timeSeries: true,
  },
  "traffic-sources": {
    dimensions: ["sessionSource", "sessionMedium"],
    metrics: ["sessions", "activeUsers"],
    limit: 10,
  },
  "landing-pages": {
    dimensions: ["landingPagePlusQueryString"],
    metrics: ["sessions", "activeUsers"],
    limit: 10,
  },
  countries: {
    dimensions: ["country", "countryId"],
    metrics: ["sessions", "activeUsers"],
    limit: 250,
    cacheVersion: 2,
  },
  regions: {
    dimensions: ["countryId", "region"],
    metrics: ["sessions", "activeUsers"],
    limit: 20,
  },
  cities: {
    dimensions: ["countryId", "region", "city"],
    metrics: ["sessions", "activeUsers"],
    limit: 20,
  },
  languages: {
    dimensions: ["languageCode"],
    metrics: ["sessions", "activeUsers"],
    limit: 20,
  },
  events: {
    dimensions: ["eventName"],
    metrics: ["eventCount"],
    limit: 12,
  },
  browsers: {
    dimensions: ["browser"],
    metrics: ["sessions", "activeUsers"],
    limit: 8,
    cacheVersion: 2,
  },
  "operating-systems": {
    dimensions: ["operatingSystem"],
    metrics: ["sessions", "activeUsers"],
    limit: 12,
  },
  "screen-resolutions": {
    dimensions: ["screenResolution"],
    metrics: ["sessions", "activeUsers"],
    limit: 20,
  },
  "page-paths": {
    dimensions: ["pagePath"],
    metrics: ["screenPageViews", "activeUsers"],
    limit: 12,
  },
  devices: {
    dimensions: ["deviceCategory"],
    metrics: ["sessions", "activeUsers"],
    limit: 5,
  },
  "revenue-by-source": {
    dimensions: ["sessionSource", "sessionMedium"],
    metrics: ["totalRevenue", "totalAdRevenue"],
    fallbackMetrics: ["purchaseRevenue"],
    limit: 10,
  },
  /* ── New Reports-section cards ─────────────────────────── */
  "source-engagement": {
    kind: "engagement",
    dimensions: ["sessionSource", "sessionMedium"],
    metrics: ["sessions"],
    limit: 12,
  },
  "hourly-traffic": {
    dimensions: ["dateHour"],
    metrics: ["activeUsers", "screenPageViews"],
    limit: 48,
    timeSeries: true,
  },
  "content-engagement": {
    kind: "engagement",
    dimensions: ["pagePath"],
    metrics: ["sessions"],
    limit: 12,
  },
  "traffic-anomalies": {
    dimensions: ["sessionSource"],
    metrics: ["sessions", "activeUsers"],
    limit: 15,
  },
  /* Report extras (built by controllers/reportExtras.js) */
  referrers: {
    kind: "referrers",
    dimensions: ["pageReferrer"],
    metrics: ["sessions"],
    limit: 50,
  },
  "source-split": {
    kind: "split",
    dimensions: ["sessionSource"],
    metrics: ["sessions"],
    segments: { source: "sessionSource", medium: "sessionMedium", platform: "platform" },
    limit: 15,
  },
  "bot-traffic": {
    kind: "bots",
    dimensions: ["country", "city", "sessionSource", "deviceCategory"],
    metrics: ["sessions"],
    limit: 100,
  },
  "revenue-key-events": {
    kind: "revenue",
    dimensions: [],
    metrics: ["keyEvents"],
    limit: 20,
  },
};

const CARD_CATALOG = [
  {
    type: "new-users-by-date",
    title: "Growth Trend",
    group: "Audience",
    wide: true,
    chartCard: true,
    sub: "New users, sessions, revenue. Click a legend item to switch",
    color: "#059669",
    bg: "rgba(5, 150, 105, 0.1)",
    icon: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  },
  {
    type: "traffic-sources",
    title: "Traffic Sources",
    group: "Acquisition",
    sub: "Sessions and active users by source / medium",
    color: "#1348dc",
    bg: "rgba(19, 72, 220, 0.1)",
    icon: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  },
  {
    type: "landing-pages",
    title: "Landing Pages",
    group: "Content",
    sub: "Entry pages by sessions and active users",
    color: "#2b7fff",
    bg: "rgba(43, 127, 255, 0.1)",
    icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  },
  {
    type: "countries",
    title: "Countries",
    group: "Audience",
    sub: "Sessions and active users by country",
    color: "#059669",
    bg: "rgba(5, 150, 105, 0.1)",
    icon: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  },
  {
    type: "events",
    title: "Events",
    group: "Behavior",
    sub: "Event count by event name",
    color: "#d97706",
    bg: "rgba(217, 119, 6, 0.1)",
    icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  },
  {
    type: "browsers",
    title: "Browsers",
    group: "Technology",
    sub: "Sessions and active users by browser",
    color: "#5d636f",
    bg: "rgba(93, 99, 111, 0.12)",
    icon: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  },
  {
    type: "page-paths",
    title: "Top Pages",
    group: "Content",
    sub: "Pageviews and active users by path",
    color: "#2b7fff",
    bg: "rgba(43, 127, 255, 0.1)",
    icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  },
  {
    type: "devices",
    title: "Devices",
    group: "Technology",
    sub: "Sessions and active users by device type",
    color: "#1348dc",
    bg: "rgba(19, 72, 220, 0.1)",
    icon: '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  },
  {
    type: "revenue-by-source",
    title: "Revenue by Source",
    group: "Revenue",
    sub: "Revenue by traffic source",
    color: "#d97706",
    bg: "rgba(217, 119, 6, 0.1)",
    icon: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  },
  /* ── New Report cards ──────────────────────────────────── */
  {
    type: "source-engagement",
    title: "Traffic Quality",
    group: "Reports",
    sub: "Engagement rate, avg time and key events by source / medium",
    color: "#8b5cf6",
    bg: "rgba(139, 92, 246, 0.1)",
    icon: '<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>',
  },
  {
    type: "hourly-traffic",
    title: "Hourly Activity",
    group: "Reports",
    wide: true,
    chartCard: true,
    sub: "Active users and pageviews per hour",
    color: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.1)",
    icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  },
  {
    type: "content-engagement",
    title: "Content Engagement",
    group: "Reports",
    sub: "Top pages by sessions, engagement rate and avg time",
    color: "#06b6d4",
    bg: "rgba(6, 182, 212, 0.1)",
    icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  },
  {
    type: "traffic-anomalies",
    title: "Traffic Anomalies",
    group: "Reports",
    sub: "Unusual traffic sources or spikes in activity",
    color: "#ef4444",
    bg: "rgba(239, 68, 68, 0.1)",
    icon: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  },
  /* ── Report extras ─────────────────────────────────────── */
  {
    type: "referrers",
    title: "Referrers",
    group: "Acquisition",
    wide: true,
    sub: "Full referring URLs by platform, with engagement and key events",
    color: "#4f46e5",
    bg: "rgba(79, 70, 229, 0.1)",
    icon: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  },
  {
    type: "source-split",
    title: "Source, Medium, Platform",
    group: "Acquisition",
    sub: "Sessions with engagement rate, avg time and key events",
    color: "#0891b2",
    bg: "rgba(8, 145, 178, 0.1)",
    icon: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  },
  {
    type: "bot-traffic",
    title: "Suspected Bot Traffic",
    group: "Audience",
    sub: "Heuristic: low engagement or datacenter city",
    color: "#b45309",
    bg: "rgba(180, 83, 9, 0.1)",
    icon: '<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16.01"/><line x1="16" y1="16" x2="16" y2="16.01"/>',
  },
  {
    type: "revenue-key-events",
    title: "Revenue and Key Events",
    group: "Revenue",
    sub: "Ad and purchase revenue, key events by name",
    color: "#15803d",
    bg: "rgba(21, 128, 61, 0.1)",
    icon: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  },
];

CARD_CATALOG.push(
  { type: "regions", title: "Regions", group: "Audience", sub: "Sessions by geographic region", icon: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/>' },
  { type: "cities", title: "Cities", group: "Audience", sub: "Sessions by city and region", icon: '<path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/>' },
  { type: "languages", title: "Languages", group: "Audience", sub: "Browser or device language settings", icon: '<path d="M4 5h12M10 2v3M6 5c0 6 5 10 9 11M14 5c0 6-5 10-10 12M14 22l4-10 4 10M16 18h4"/>' },
  { type: "operating-systems", title: "Operating Systems", group: "Technology", sub: "Sessions by operating system", icon: '<rect x="3" y="3" width="18" height="14"/><path d="M8 21h8M12 17v4"/>' },
  { type: "screen-resolutions", title: "Screen Dimensions", group: "Technology", sub: "Monitor screen resolution reported by GA4", icon: '<rect x="3" y="3" width="18" height="14"/><path d="M7 7h3M7 7v3M17 13h-3M17 13v-3M8 21h8M12 17v4"/>' },
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDateRange(range) {
  return clone(DATE_RANGES[range] || DATE_RANGES["28d"]);
}

// Same-length window right before getDateRange(range).
const PREV_RANGES = {
  today: { startDate: "yesterday", endDate: "yesterday" },
  "7d": { startDate: "13daysAgo", endDate: "7daysAgo" },
  "28d": { startDate: "55daysAgo", endDate: "28daysAgo" },
  "30d": { startDate: "59daysAgo", endDate: "30daysAgo" },
  "90d": { startDate: "179daysAgo", endDate: "90daysAgo" },
};

function getPreviousDateRange(range) {
  return clone(PREV_RANGES[range] || PREV_RANGES["28d"]);
}

// Adds `prev` (metric array, or null when the row is absent) to each row, matched on joined dims.
function attachPrev(rows, prevRows) {
  const byKey = new Map(prevRows.map(r => [r.dims.join("\u0001"), r.metrics]));
  return rows.map(r => ({ ...r, prev: byKey.get(r.dims.join("\u0001")) || null }));
}

function getAnalyticsCardConfig(type) {
  const config = CARD_CONFIGS[type];
  return config ? clone(config) : null;
}

function getAnalyticsCardCacheKey(propertyId, type, range, seg) {
  const version = CARD_CONFIGS[type]?.cacheVersion;
  return `${propertyId}:${type}:${range}` + (seg ? `:${seg}` : "") + (version ? `:v${version}` : "");
}

function getAnalyticsCatalog() {
  return clone(CARD_CATALOG);
}

module.exports = {
  CARD_CONFIGS,
  CARD_CATALOG,
  DATE_RANGES,
  getAnalyticsCardConfig,
  getAnalyticsCardCacheKey,
  getAnalyticsCatalog,
  getDateRange,
  getPreviousDateRange,
  attachPrev,
};
