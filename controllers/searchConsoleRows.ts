export type SearchDimension = "page" | "country" | "device";
export type SearchMetrics = { clicks: number; impressions: number; ctr: number | null; position: number | null };
export type SearchRow = SearchMetrics & { date?: string; page?: string; country?: string; countryCode?: string | null; device?: string; query?: string };
export type AnalyticsRow = { value: string; count: number; percentage: number; pageviews?: number; pageviews_percentage?: number; active_users?: number; bounce_rate?: number; time_on_page_seconds?: number };
export type JoinedSearchRow = { key: string; analytics?: AnalyticsRow; search?: SearchMetrics; url?: string };
export type PageSearchMetrics = SearchMetrics & { clickSharePct: number | null; impressionSharePct: number | null; partial: boolean };

export function pageKey(value: string) {
  try {
    const path = new URL(value, "https://analytics.invalid").pathname;
    // decodeURI preserves escaped path separators, while matching Unicode paths.
    try { return decodeURI(path); } catch { return path; }
  } catch { return value; }
}

/** Join comparable dimensions only; missing top results remain unknown, never zero. */
export function joinSearchRows(analytics: AnalyticsRow[], search: SearchRow[], dimension: SearchDimension): JoinedSearchRow[] {
  const rows = new Map<string, JoinedSearchRow>();
  for (const row of analytics) {
    const key = dimension === "page" ? pageKey(row.value) : dimension === "country" ? row.value.toUpperCase() : row.value.toLowerCase();
    if (!rows.has(key)) rows.set(key, { key, analytics: row });
  }
  const weights = new Map<string, { sum: number; impressions: number }>();
  for (const row of search) {
    const key = dimension === "page" ? pageKey(row.page || "") : dimension === "country"
      ? row.countryCode?.toUpperCase() || `gsc:${row.country || "unknown"}` : (row.device || "unknown").toLowerCase();
    const joined: JoinedSearchRow = rows.get(key) || { key };
    const previous = joined.search;
    const clicks = (previous?.clicks || 0) + row.clicks;
    const impressions = (previous?.impressions || 0) + row.impressions;
    const weight = weights.get(key) || { sum: 0, impressions: 0 };
    if (row.position != null && row.impressions > 0) { weight.sum += row.position * row.impressions; weight.impressions += row.impressions; }
    weights.set(key, weight);
    joined.search = { clicks, impressions, ctr: impressions ? clicks / impressions : null,
      position: weight.impressions ? weight.sum / weight.impressions : null };
    if (dimension === "page") joined.url ||= row.page;
    rows.set(key, joined);
  }
  return [...rows.values()];
}

/** A section uses the same first-segment identity as the native Pages report. */
export function searchSection(path: string) {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 1 ? '/' + parts[0] : path;
}

export function pageSearchLookup(search: SearchRow[], totals: SearchMetrics | null, truncated = false) {
  const pages = new Map(joinSearchRows([], search, 'page').map(row => [row.key, row.search!]));
  const sections = new Map(joinSearchRows([], search.map(row => ({ ...row, page: searchSection(pageKey(row.page || '')) })), 'page')
    .map(row => [row.key, row.search!]));
  return (row: { kind: 'page' | 'section'; key: string }): PageSearchMetrics | undefined => {
    const metric = (row.kind === 'section' ? sections : pages).get(pageKey(row.key));
    if (!metric) return undefined;
    return { ...metric, clickSharePct: totals && totals.clicks > 0 ? metric.clicks / totals.clicks * 100 : null,
      impressionSharePct: totals && totals.impressions > 0 ? metric.impressions / totals.impressions * 100 : null,
      partial: row.kind === 'section' && truncated };
  };
}

/** GSC days stay Pacific calendar labels; rates are recomputed for larger buckets. */
export function bucketSearchTrend(rows: SearchRow[], bucket: 'day' | 'week' | 'month' | 'year') {
  const groups = new Map<string, { clicks: number; impressions: number; positionSum: number; positionWeight: number }>();
  for (const row of rows) {
    if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    const day = new Date(row.date + 'T00:00:00Z');
    if (!Number.isFinite(day.getTime())) continue;
    if (bucket === 'week') day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
    if (bucket === 'month' || bucket === 'year') day.setUTCDate(1);
    if (bucket === 'year') day.setUTCMonth(0);
    const date = day.toISOString().slice(0, 10);
    const group = groups.get(date) || { clicks: 0, impressions: 0, positionSum: 0, positionWeight: 0 };
    group.clicks += row.clicks; group.impressions += row.impressions;
    if (row.position != null && row.impressions > 0) { group.positionSum += row.position * row.impressions; group.positionWeight += row.impressions; }
    groups.set(date, group);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([date, group]) => ({ date, clicks: group.clicks,
    impressions: group.impressions, ctr: group.impressions ? group.clicks / group.impressions : null,
    position: group.positionWeight ? group.positionSum / group.positionWeight : null }));
}
