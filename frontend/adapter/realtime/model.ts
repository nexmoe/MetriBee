export type SpikeRule = { z: number; lift: number };
export const PRESETS: Record<string, SpikeRule> = {
  sensitive: { z: 2.5, lift: 1.3 },
  normal: { z: 3, lift: 1.5 },
  strict: { z: 4, lift: 2 },
};
export type LiveProperty = {
  propertyId: string;
  siteName?: string;
  domain?: string;
  url?: string;
  websiteUrl?: string;
  accountId?: string | null;
  accountName?: string | null;
  activeUsers?: number | null;
  pageViews?: number | null;
  series?: number[] | null;
  baseline?: number | null;
  baselineSd?: number | null;
  baselineKind?: string | null;
  error?: string | boolean | null;
  errorMessage?: string;
};
// Missing reports must never be presented as a successful zero-user observation.
export function feedHealth(rows: LiveProperty[], refreshFailed = false) {
  const available = rows.filter(row => !row.error && !row.errorMessage);
  const failed = rows.length - available.length;
  const known = available.length > 0 && !refreshFailed;
  return {
    status: refreshFailed || (rows.length > 0 && !available.length)
      ? "unavailable" : failed ? "partial" : "ready",
    available: available.length,
    failed,
    activeUsers: known ? available.reduce((sum, row) => sum + (row.activeUsers || 0), 0) : null,
    pageViews: known ? available.reduce((sum, row) => sum + (row.pageViews || 0), 0) : null,
    withTraffic: known ? available.filter(row => (row.activeUsers || 0) > 0).length : null,
  };
}
export function clampRule(
  rule: Partial<SpikeRule> | null | undefined
): SpikeRule {
  const number = (
    value: unknown,
    min: number,
    max: number,
    fallback: number
  ) => {
    const parsed = parseFloat(String(value));
    return Number.isFinite(parsed)
      ? Math.round(Math.min(max, Math.max(min, parsed)) * 100) / 100
      : fallback;
  };
  return { z: number(rule?.z, 1.5, 6, 3), lift: number(rule?.lift, 1, 5, 1.5) };
}
// Same variance and thresholds as the server's scoreSpike. Changing the viewer's
// rule rescales the current feed without another GA4 request.
export function scoreProperty(row: LiveProperty, rule: SpikeRule) {
  const error = row.errorMessage || (row.error ? String(row.error) : null);
  const active = row.activeUsers || 0;
  const baseline = row.baseline;
  if (error || !baseline) return { ...row, error, score: null };
  const z =
    (active - baseline) /
    Math.sqrt(Math.max(baseline + 1, row.baselineSd ? row.baselineSd ** 2 : 0));
  const ratio = active / baseline;
  const isSpike = z >= rule.z && ratio >= rule.lift;
  return {
    ...row,
    error,
    score: { z, ratio, isSpike, above: !isSpike && z >= 2 && ratio >= 1.15 },
  };
}
export type ScoredProperty = ReturnType<typeof scoreProperty>;
export type Sort = "unusual" | "active" | "name";
export function sortProperties(rows: ScoredProperty[], sort: Sort) {
  return [...rows].sort((a, b) => {
    if (sort === "name")
      return (a.siteName || a.domain || a.propertyId).localeCompare(
        b.siteName || b.domain || b.propertyId
      );
    if (sort === "unusual") {
      const delta = (b.score?.z ?? -Infinity) - (a.score?.z ?? -Infinity);
      if (delta) return delta;
    }
    return (b.activeUsers || 0) - (a.activeUsers || 0);
  });
}
export function groupProperties(rows: ScoredProperty[], grouped: boolean) {
  const groups = new Map<
    string,
    { key: string; name: string; rows: ScoredProperty[] }
  >();
  for (const row of rows) {
    const key = grouped ? row.accountId || row.accountName || "unknown" : "all";
    const group = groups.get(key) || {
      key,
      name: grouped
        ? row.accountName || "Google Analytics 4"
        : "All properties",
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}
// Floor the displayed multiplier, so 1.49 never appears to meet a 1.5× rule.
export const ratioText = (ratio: number) =>
  (Math.floor(ratio * 10) / 10).toFixed(1);
export const meterPercent = (ratio: number, rule: SpikeRule) =>
  Math.max(0, Math.min(100, (ratio / (rule.lift / 0.75)) * 100));
export function combinedSeries(rows: ScoredProperty[]) {
  const available = rows.filter(
    (row) => !row.error && Array.isArray(row.series) && row.series.length === 30
  );
  return available.length
    ? Array.from({ length: 30 }, (_, i) =>
        available.reduce((sum, row) => sum + (row.series![i] || 0), 0)
      )
    : null;
}
