import { Eye, MousePointerClick, Percent, TrendingUp } from "lucide-react";
import { useExtracted } from "../extracted";
import { useGetGSCConnection } from "../../rybbit/src/api/gsc/hooks/useGetGSCConnection";
import { useAnalyticsQuery } from "../../rybbit/src/api/analytics/useAnalyticsQuery";
import { StatBand } from "../../rybbit/src/components/site/StatBand";
import { useComparisonEnabled } from "../../rybbit/src/lib/store";
import { percentDelta, pointDelta } from "../../rybbit/src/lib/delta";
import type { SearchMetrics } from "../../../controllers/searchConsoleRows";

type Summary = { data: SearchMetrics | null; range?: { clipped: boolean } };
export function useSearchSummary(previous = false) {
  return useAnalyticsQuery<Summary>({ key: "gsc-report", path: "gsc/summary", unwrap: false,
    periodTime: previous ? "previous" : "current", staleTime: 60 * 60 * 1000, placeholder: false });
}

function ConnectedSearchSummary({ property }: { property: string | null }) {
  const t = useExtracted();
  const current = useSearchSummary(), previousQuery = useSearchSummary(true);
  const comparing = useComparisonEnabled();
  const data = current.data?.data, previous = comparing ? previousQuery.data?.data : null;
  const format = (metric: keyof SearchMetrics, value: number | null | undefined) => value == null ? "—"
    : metric === "ctr" ? `${(value * 100).toFixed(2)}%` : metric === "position" ? value.toFixed(1) : value.toLocaleString();
  const previousLine = (metric: keyof SearchMetrics) => previous?.[metric] != null
    ? t("{value} previous period", { value: format(metric, previous[metric]) }) : t(metric === "position" ? "Lower is better" : "Google Search");
  return <section id="google-search-summary" aria-label={t("Google Search Console")} className="space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-neutral-500">
      <span className="font-medium text-foreground">{t("Google Search")}</span>
      <span title={property || undefined}>{t("Search Console · Pacific time · delayed data")}</span>
    </div>
    <StatBand columns={4} isLoading={current.isPending} cells={[
      { id: "search-clicks", icon: <MousePointerClick className="size-3" />, label: t("Search clicks"), value: format("clicks", data?.clicks),
        delta: percentDelta(data?.clicks, previous?.clicks), sub: previousLine("clicks") },
      { id: "search-impressions", icon: <Eye className="size-3" />, label: t("Search impressions"), value: format("impressions", data?.impressions),
        delta: percentDelta(data?.impressions, previous?.impressions), sub: previousLine("impressions") },
      { id: "search-ctr", icon: <Percent className="size-3" />, label: t("Search CTR"), value: format("ctr", data?.ctr),
        delta: pointDelta(data?.ctr == null ? null : data.ctr * 100, previous?.ctr == null ? null : previous.ctr * 100), sub: previousLine("ctr") },
      { id: "search-position", icon: <TrendingUp className="size-3" />, label: t("Search position"), value: format("position", data?.position),
        sub: previousLine("position"), title: t("Lower is better") },
    ]} />
    {current.error && <p role="status" className="text-xs text-neutral-500">{t("Google Search unavailable")} · {current.error.message} <button className="underline" onClick={() => current.refetch()}>{t("Try Again")}</button></p>}
    {comparing && previousQuery.error && <p className="text-xs text-neutral-500">{t("Search comparison is unavailable.")}</p>}
    {current.data?.range?.clipped && <p className="text-xs text-neutral-500">{t("Dates are limited to Search Console’s available history.")}</p>}
  </section>;
}

export function SearchSummary() {
  const connection = useGetGSCConnection();
  return connection.data?.connected ? <ConnectedSearchSummary property={connection.data.gscPropertyUrl} /> : null;
}
