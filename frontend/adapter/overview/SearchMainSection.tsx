import { useEffect, useRef } from "react";
import { DateTime } from "luxon";
import { useExtracted } from "../extracted";
import { MainSection } from "../../rybbit/src/app/[site]/main/components/MainSection/MainSection";
import { Stat } from "../../rybbit/src/app/[site]/main/components/MainSection/Overview";
import { useGetGSCConnection } from "../../rybbit/src/api/gsc/hooks/useGetGSCConnection";
import { useAnalyticsQuery } from "../../rybbit/src/api/analytics/useAnalyticsQuery";
import { useComparisonEnabled, useStore, useTimezone } from "../../rybbit/src/lib/store";
import { percentDelta, pointDelta } from "../../rybbit/src/lib/delta";
import { TimeSeriesChart } from "../../rybbit/src/components/charts/TimeSeriesChart";
import { ChartTooltip } from "../../rybbit/src/components/charts/ChartTooltip";
import { bucketsBetween, shiftBuckets } from "../../rybbit/src/components/charts/timeSeriesChartUtils";
import { ErrorState } from "../../rybbit/src/components/ErrorState";
import { Skeleton } from "../../rybbit/src/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../rybbit/src/components/ui/select";
import { StandardSectionEmpty } from "../../rybbit/src/app/[site]/components/shared/StandardSection/StandardSection";
import { bucketSearchTrend, type SearchRow, type SearchMetrics } from "../../../controllers/searchConsoleRows";
import { useSearchSummary } from "./SearchSummary";

type Metric = keyof SearchMetrics;
type SearchStat = `gsc_${Metric}`;
type Bucket = "day" | "week" | "month" | "year";
type Trend = { data: SearchRow[] | null; range?: { startDate: string; endDate: string; requestedStart: string }; truncated?: boolean };
const METRICS: Metric[] = ["clicks", "impressions", "ctr", "position"];
const LABELS: Record<Metric, string> = { clicks: "Search clicks", impressions: "Search impressions", ctr: "Search CTR", position: "Search position" };
const isSearch = (stat: string): stat is SearchStat => METRICS.some(metric => stat === `gsc_${metric}`);
const normalizeBucket = (bucket: string): Bucket => ["day", "week", "month", "year"].includes(bucket) ? bucket as Bucket : "day";
const format = (metric: Metric, value: number) => metric === "ctr" ? `${(value * 100).toFixed(2)}%` : metric === "position" ? value.toFixed(1) : value.toLocaleString();

function useSearchTrend(previous = false, enabled = true) {
  return useAnalyticsQuery<Trend>({ key: "gsc-report", path: "gsc/time-series", unwrap: false,
    periodTime: previous ? "previous" : "current", staleTime: 60 * 60 * 1000, placeholder: false, enabled });
}

function SearchChart({ metric, currentQuery, previousQuery, bucket }: {
  metric: Metric; currentQuery: ReturnType<typeof useSearchTrend>; previousQuery: ReturnType<typeof useSearchTrend>; bucket: Bucket;
}) {
  const t = useExtracted(), timezone = useTimezone(), comparing = useComparisonEnabled();
  const currentRows = bucketSearchTrend(currentQuery.data?.data || [], bucket);
  const previousRows = comparing ? bucketSearchTrend(previousQuery.data?.data || [], bucket) : [];
  const range = currentQuery.data?.range, previousRange = previousQuery.data?.range;
  const start = range ? DateTime.fromISO(range.startDate, { zone: timezone }).startOf(bucket) : undefined;
  const end = range ? DateTime.fromISO(range.endDate, { zone: timezone }).endOf("day") : undefined;
  const shift = range && previousRange ? bucketsBetween(
    DateTime.fromISO(previousRange.requestedStart, { zone: timezone }).startOf(bucket),
    DateTime.fromISO(range.requestedStart, { zone: timezone }).startOf(bucket), bucket) : 0;
  const points = (rows: ReturnType<typeof bucketSearchTrend>, previous = false) => rows.flatMap(row => {
    const value = row[metric];
    if (value == null) return [];
    const day = DateTime.fromISO(row.date, { zone: timezone });
    const mapped = previous ? shiftBuckets(day, bucket, shift) : day;
    if ((start && mapped < start) || (end && mapped > end)) return [];
    return [{ x: mapped.toJSDate(), y: metric === "ctr" ? value * 100 : value, date: row.date }];
  });
  const current = points(currentRows), previous = points(previousRows, true);
  if (currentQuery.isPending) return <Skeleton className="h-full w-full rounded" />;
  if (currentQuery.error && !currentQuery.data) return <ErrorState title={t("Google Search unavailable")} message={currentQuery.error.message} refetch={currentQuery.refetch} />;
  if (!current.length) return <StandardSectionEmpty />;
  return <div className="flex h-full min-h-0 flex-col">
    {currentQuery.error && <p className="text-xs text-neutral-500">{t("Google Search unavailable")} <button className="underline" onClick={() => currentQuery.refetch()}>{t("Try Again")}</button></p>}
    {comparing && previousQuery.error && <p className="text-xs text-neutral-500">{t("Search comparison is unavailable.")}</p>}
    <div className="min-h-0 flex-1" role="img" aria-label={t("Search trend: {metric}", { metric: t(LABELS[metric]) })}>
      <TimeSeriesChart current={current} previous={previous} max={Math.max(0, ...current.map(point => point.y), ...previous.map(point => point.y)) * 1.1}
        chartMin={start?.toJSDate()} chartMax={end?.toJSDate()} displayDashed={false} disableDragZoom
        yTickFormat={value => metric === "ctr" ? `${value.toFixed(1)}%` : metric === "position" ? value.toFixed(1) : value.toLocaleString()}
        renderOverlay={({ xScale, yScale }) => <>
          {previous.length === 1 && <circle cx={xScale(previous[0].x)} cy={yScale(previous[0].y)} r={3} fill="hsl(var(--neutral-500))" />}
          {current.length === 1 && <circle cx={xScale(current[0].x)} cy={yScale(current[0].y)} r={3} fill="hsl(var(--dataviz))" />}
        </>}
        renderTooltip={({ point, previousPoint }) => <ChartTooltip><div className="space-y-1 p-2 text-xs">
          <div>{point.date} · {t(LABELS[metric])} {format(metric, metric === "ctr" ? point.y / 100 : point.y)} · PT</div>
          {previousPoint && <div className="text-muted-foreground">{previousPoint.date} · {format(metric, metric === "ctr" ? previousPoint.y / 100 : previousPoint.y)} · PT</div>}
        </div></ChartTooltip>} />
    </div>
  </div>;
}

function ConnectedSearchMainSection() {
  const t = useExtracted(), timezone = useTimezone(), comparing = useComparisonEnabled();
  const { selectedStat, bucket: rawBucket, setBucket, site, time, filters } = useStore();
  const selected = isSearch(selectedStat) ? selectedStat.slice(4) as Metric : undefined;
  const bucket = normalizeBucket(rawBucket);
  const ga4Bucket = useRef<typeof rawBucket>(selected ? "day" : rawBucket);
  const wasSearch = useRef(!!selected);
  const current = useSearchSummary(), previousQuery = useSearchSummary(true);
  const trend = useSearchTrend(), previousTrend = useSearchTrend(true, !!selected && comparing);
  const data = current.data?.data, previous = comparing ? previousQuery.data?.data : null;
  const rows = bucketSearchTrend(trend.data?.data || [], bucket);
  useEffect(() => { if (selected && rawBucket !== bucket) setBucket(bucket); }, [selected, rawBucket, bucket, setBucket]);
  useEffect(() => {
    if (!selected && wasSearch.current) setBucket(ga4Bucket.current);
    else if (!selected) ga4Bucket.current = rawBucket;
    wasSearch.current = !!selected;
  }, [selected, rawBucket, setBucket]);
  const tiles = <section id="google-search-summary" aria-label={t("Google Search Console")} className="border-t border-neutral-100 dark:border-neutral-800">
    <div className="grid grid-cols-2 lg:grid-cols-4">
      {METRICS.map(metric => <Stat key={metric} id={`gsc_${metric}`} title={t(LABELS[metric])}
        value={data?.[metric] ?? null} previous={previous?.[metric] ?? undefined} isLoading={current.isPending}
        valueFormatter={value => format(metric, value)} reverseColor={metric === "position"}
        comparisonDelta={metric === "ctr" ? pointDelta(data?.ctr == null ? null : data.ctr * 100, previous?.ctr == null ? null : previous.ctr * 100)
          : metric === "position" ? null : percentDelta(data?.[metric], previous?.[metric])}
        sparklineData={rows.flatMap(row => row[metric] == null ? [] : [{ time: `${row.date} 00:00:00`, value: metric === "ctr" ? row.ctr! * 100 : row[metric]! }])}
        flash={{ resetKey: JSON.stringify([site, time, filters, bucket, timezone]), ready: data != null, fetching: current.isFetching, empty: !data?.impressions }} />)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-2 text-xs text-neutral-500">
      <span>{t("Search Console · Pacific time · delayed data")}</span>
      {current.error && <span role="status">{t("Google Search unavailable")} <button className="underline" onClick={() => current.refetch()}>{t("Try Again")}</button></span>}
      {current.data?.range?.clipped && <span>{t("Dates are limited to Search Console’s available history.")}</span>}
    </div>
  </section>;
  const controls = <Select value={bucket} onValueChange={value => setBucket(value as Bucket)}>
    <SelectTrigger size="sm" className="w-[90px]" aria-label={t("Search chart interval")}><SelectValue /></SelectTrigger>
    <SelectContent size="sm">{(["day", "week", "month", "year"] as Bucket[]).map(value => <SelectItem key={value} size="sm" value={value}>{t(({ day: "Day", week: "Week", month: "Month", year: "Year" })[value])}</SelectItem>)}</SelectContent>
  </Select>;
  return <MainSection additionalStats={tiles} chartOverride={selected ? { label: `${t(LABELS[selected])} · Google Search`,
    content: <SearchChart metric={selected} currentQuery={trend} previousQuery={previousTrend} bucket={bucket} />, controls,
    fetching: trend.isFetching || (comparing && previousTrend.isFetching) } : undefined} />;
}

export function SearchMainSection() {
  const t = useExtracted();
  const connection = useGetGSCConnection();
  const { selectedStat, setSelectedStat } = useStore();
  const selected = isSearch(selectedStat);
  useEffect(() => {
    if (selected && !connection.isPending && !connection.data?.connected) setSelectedStat("users");
  }, [selected, connection.isPending, connection.data?.connected, setSelectedStat]);
  return connection.data?.connected ? <ConnectedSearchMainSection /> : <MainSection chartOverride={selected
    ? { label: t("Google Search"), content: <Skeleton className="h-full w-full rounded" />, controls: null, fetching: connection.isFetching }
    : undefined} />;
}
