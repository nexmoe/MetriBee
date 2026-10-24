import { useEffect, useMemo, useState } from "react";
import { useIntersectionObserver } from "@uidotdev/usehooks";
import { SquareArrowOutUpRight } from "lucide-react";
import { useExtracted } from "../extracted";
import { useAnalyticsQuery } from "../../rybbit/src/api/analytics/useAnalyticsQuery";
import { useInfiniteMetric } from "../../rybbit/src/api/analytics/hooks/useGetMetric";
import { useGetGSCConnection } from "../../rybbit/src/api/gsc/hooks/useGetGSCConnection";
import { StandardSectionBaseProps } from "../../rybbit/src/app/[site]/components/shared/StandardSection/StandardSection";
import { StandardSectionTab } from "../../rybbit/src/app/[site]/components/shared/StandardSection/StandardSectionTabs";
import { addFilter, removeFilter, useStore } from "../../rybbit/src/lib/store";
import { Button } from "../../rybbit/src/components/ui/button";
import { fmt } from "../pages/shared";
import { NativeList, OverviewTable, ReportState } from "./ReportPanel";
import { joinSearchRows, JoinedSearchRow, SearchDimension, SearchMetrics, SearchRow } from "../../../controllers/searchConsoleRows";

type Metric = keyof SearchMetrics;
type SearchReport = { data: SearchRow[] | null; range?: { clipped: boolean }; truncated: boolean };
const LABELS: Record<Metric, string> = { clicks: "Search clicks", impressions: "Search impressions", ctr: "Search CTR", position: "Search position" };
const METRICS = Object.keys(LABELS) as Metric[];
const GA4_METRICS = ["count", "active_users", "pageviews", "bounce_rate", "time_on_page_seconds"] as const;
const GA4_LABELS: Record<string, string> = { count: "Sessions", active_users: "Active Users", pageviews: "Pageviews", bounce_rate: "Bounce Rate", time_on_page_seconds: "Duration" };
const DIMENSIONS: Record<string, SearchDimension | undefined> = { pathname: "page", country: "country", device_type: "device" };
const formatSearch = (metric: Metric, value: number | null | undefined) => value == null ? "—" : metric === "ctr"
  ? `${(value * 100).toFixed(2)}%` : metric === "position" ? value.toFixed(1) : value.toLocaleString();
const formatGA4 = (metric: string, value: number | null | undefined) => value == null ? "—"
  : metric === "bounce_rate" || metric.endsWith("percentage") ? `${value.toFixed(1)}%`
    : metric === "time_on_page_seconds" ? `${fmt(value)}s` : value.toLocaleString();

function useSearchRows(dimension: SearchDimension | "query", section?: StandardSectionBaseProps) {
  return useAnalyticsQuery<SearchReport>({ key: "gsc-report", path: "gsc/data", unwrap: false,
    params: { dimensions: dimension }, staleTime: 60 * 60 * 1000, placeholder: false,
    overrideTime: section?.customTime, customFilters: section?.customFilters, additionalFilters: section?.additionalFilters });
}

function SearchNote({ query, expanded = false }: { query: ReturnType<typeof useSearchRows>; expanded?: boolean }) {
  const t = useExtracted();
  return <div className="mt-2 text-xs text-neutral-500" role={query.error ? "status" : undefined}>
    {query.error ? <>{t("Google Search unavailable")} · {query.error.message} <button className="underline" onClick={() => query.refetch()}>{t("Try Again")}</button></>
      : <span title={t("Search Console uses final Pacific calendar days. Recent data may be delayed. Search clicks differ from GA4 sessions. Missing matches are shown as —.")}>
        {t("Search Console · Pacific time · delayed data")}
        {expanded && <> · {t("Top results; private queries are omitted. Row totals can differ from the summary.")} {t("Scoped to this hostname; impressions count each result page.")}</>}
      </span>}
    {query.data?.range?.clipped && <> · {t("Dates are limited to Search Console’s available history.")}</>}
    {query.data?.truncated && <> · {t("Showing the top 500 results by clicks.")}</>}
  </div>;
}

/** Reuses each native tab's labels, links and filters, adding GSC to the same rows. */
function SearchDimensionSection({ section, dimension, expanded }: { section: StandardSectionBaseProps; dimension: SearchDimension; expanded: boolean }) {
  const t = useExtracted();
  const analytics = useInfiniteMetric({ parameter: section.filterParameter, limit: 100, customFilters: section.customFilters,
    additionalFilters: section.additionalFilters, customTime: section.customTime, lite: section.lite });
  const search = useSearchRows(dimension, section);
  const filters = useStore(state => state.filters);
  const [metric, setMetric] = useState("count");
  const isSearch = METRICS.includes(metric as Metric);
  const [loadRef, entry] = useIntersectionObserver({ threshold: 0, root: null, rootMargin: "0px 0px 200px 0px" });
  useEffect(() => {
    if (entry?.isIntersecting && analytics.hasNextPage && !analytics.isFetchingNextPage && !analytics.isPending) analytics.fetchNextPage();
  }, [entry?.isIntersecting, analytics.hasNextPage, analytics.isFetchingNextPage, analytics.isPending, analytics.fetchNextPage]);
  const rows = useMemo(() => joinSearchRows(analytics.data?.pages.flatMap(page => page.data) || [], search.data?.data || [], dimension), [analytics.data, search.data, dimension]);
  const nativeItem = (row: JoinedSearchRow) => row.analytics || { value: row.key, count: 0, percentage: 0 };
  const filter = (row: JoinedSearchRow) => {
    if (row.key.startsWith("gsc:")) return;
    const value = section.getValue(nativeItem(row));
    const existing = filters.find(filter => filter.parameter === section.filterParameter && filter.value.includes(value));
    if (existing) removeFilter(existing);
    else addFilter({ parameter: section.filterParameter, type: "equals", value: [value] });
  };
  const label = (row: JoinedSearchRow) => row.key.startsWith("gsc:") ? row.key.slice(4) : section.getLabel(nativeItem(row));
  const link = (row: JoinedSearchRow) => row.url || section.getLink?.(nativeItem(row));
  const value = (row: JoinedSearchRow) => isSearch ? row.search?.[metric as Metric] : row.analytics?.[metric as keyof NonNullable<JoinedSearchRow["analytics"]>];
  const sorted = rows.filter(row => isSearch ? row.search : row.analytics).sort((a, b) => {
    const x = value(a), y = value(b);
    if (x == null || y == null) return x == null ? y == null ? 0 : 1 : -1;
    return metric === "position" ? Number(x) - Number(y) : Number(y) - Number(x);
  });
  const footer = analytics.hasNextPage ? <div ref={loadRef} className="py-2 text-center">
    <Button variant="ghost" size="sm" disabled={analytics.isFetchingNextPage} onClick={() => analytics.fetchNextPage()}>{t(analytics.isFetchingNextPage ? "Loading more..." : "Load more")}</Button>
  </div> : null;
  const byKey = new Map(rows.map(row => [row.key, row]));
  const expandedMetrics = ["count", "percentage", "active_users", "pageviews", "pageviews_percentage", "time_on_page_seconds", "bounce_rate"];
  return <>
    {analytics.isPending && !isSearch && <ReportState query={analytics} />}
    {analytics.error && <p className="mb-2 text-xs text-neutral-500">GA4 · {analytics.error.message} <button className="underline" onClick={() => analytics.refetch()}>{t("Try Again")}</button></p>}
    {isSearch && search.isPending && <ReportState query={search} />}
    {expanded ? <>
      <SearchNote query={search} expanded />
      <OverviewTable name={`analytics-${dimension}`} headers={[section.title, section.countLabel || t("Sessions"), "Session %", "Active Users", "Pageviews", "Pageviews %", "Duration", "Bounce Rate", ...METRICS.map(metric => LABELS[metric])]}
        rows={rows.map(row => [row.key, ...expandedMetrics.map(metric => row.analytics?.[metric as keyof NonNullable<JoinedSearchRow["analytics"]>] ?? null), ...METRICS.map(metric => row.search?.[metric] ?? null)])}
        searchText={row => { const item = byKey.get(String(row[0])); return item ? (section.getFilterLabel || section.getValue)(nativeItem(item)) : ""; }}
        onRowClick={row => { const item = byKey.get(String(row[0])); if (item) filter(item); }}
        formatCell={(value, column) => {
          if (column === 0) {
            const row = byKey.get(String(value))!;
            const href = link(row);
            return <div className="flex items-center gap-1">{label(row)}{href && href !== "#" && <a href={href} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} aria-label={t("Open page")}><SquareArrowOutUpRight className="size-3.5" /></a>}</div>;
          }
          return column > expandedMetrics.length ? formatSearch(METRICS[column - expandedMetrics.length - 1], value as number | null)
            : formatGA4(expandedMetrics[column - 1], value as number | null);
        }} footer={footer} />
    </> : <>
      {(isSearch ? !search.isPending : !analytics.isPending) && <NativeList title={section.title} valueLabel={isSearch ? LABELS[metric as Metric] : metric === "count" ? section.countLabel || "Sessions" : GA4_LABELS[metric]}
        metric={metric} metrics={[...GA4_METRICS.map(value => ({ value, label: value === "count" ? section.countLabel || "Sessions" : GA4_LABELS[value] })), ...METRICS.map(value => ({ value, label: LABELS[value] }))]}
        onMetricChange={setMetric} previewClassName="h-[284px]" showPercentage={metric === "count"} showBar={!["position", "ctr", "bounce_rate", "time_on_page_seconds"].includes(metric)}
        items={sorted.map(row => ({ key: row.key, label: label(row), value: Number(value(row) ?? 0), href: link(row),
          ...(row.key.startsWith("gsc:") ? {} : { onClick: () => filter(row) }),
          ...(metric === "count" ? { percentage: row.analytics?.percentage } : {}),
          formatCount: () => isSearch ? formatSearch(metric as Metric, value(row) as number | undefined) : formatGA4(metric, value(row) as number | undefined) }))} footer={footer} />}
      <SearchNote query={search} />
    </>}
  </>;
}

function SearchKeywords({ expanded = false }: { expanded?: boolean }) {
  const query = useSearchRows("query");
  const [metric, setMetric] = useState<Metric>("clicks");
  const rows = [...(query.data?.data || [])].sort((a, b) => metric === "position" ? (a.position ?? Infinity) - (b.position ?? Infinity) : (b[metric] ?? -1) - (a[metric] ?? -1));
  return <>
    <ReportState query={query} />
    {expanded ? <><SearchNote query={query} expanded /><OverviewTable name="search-keywords" headers={["Keyword", ...METRICS.map(metric => LABELS[metric])]}
      rows={rows.map(row => [row.query || "", ...METRICS.map(metric => row[metric])])}
      formatCell={(value, column) => column === 0 ? value : formatSearch(METRICS[column - 1], value as number | null)} /></>
      : <><NativeList title="Keyword" valueLabel={LABELS[metric]} metric={metric} metrics={METRICS.map(value => ({ value, label: LABELS[value] }))}
        onMetricChange={value => setMetric(value as Metric)} previewClassName="h-[284px]" showPercentage={false} showBar={metric === "clicks" || metric === "impressions"}
        items={rows.map(row => ({ key: row.query || "", label: row.query, value: row[metric] ?? 0, formatCount: () => formatSearch(metric, row[metric]) }))} /><SearchNote query={query} /></>}
  </>;
}

function renderSearchSection(section: StandardSectionBaseProps, expanded: boolean) {
  const dimension = DIMENSIONS[section.filterParameter];
  return dimension ? <SearchDimensionSection section={section} dimension={dimension} expanded={expanded} /> : undefined;
}

export function useSearchIntegration() {
  const t = useExtracted();
  const connection = useGetGSCConnection();
  const connected = connection.data?.connected === true;
  const keywordsTab: StandardSectionTab<string> = { value: "search-keywords", label: t("Keywords"), content: <SearchKeywords />,
    dialogTitle: t("Google Search") + " · " + t("Keywords"), dialogContent: <SearchKeywords expanded /> };
  return { sectionRenderer: connected ? renderSearchSection : null, keywordsTabs: connected ? [keywordsTab] : [] };
}
