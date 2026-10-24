import { useExtracted } from "../extracted";
import { useAnalyticsQuery } from "../../rybbit/src/api/analytics/useAnalyticsQuery";
import { TabbedSectionCard } from "../../rybbit/src/app/[site]/components/shared/TabbedSectionCard";
import { Button } from "../../rybbit/src/components/ui/button";
import { addFilter } from "../../rybbit/src/lib/store";
import { ListItem, NativeList, ReportState, useOverviewReport } from "./ReportPanel";
import { fmt } from "../pages/shared";

type LiveSpike = { spike: { activeUsers: number; baselineUsers: number; ratio: number; topPage: string } | null };
type Changes = {
  days: number;
  changes: { name: string; kind: string; parameter: Parameters<typeof addFilter>[0]["parameter"]; filterValue: string; current: number; previous: number; difference: number; percent: number | null }[];
  bots: { sessions: number; segments: number };
};
type SpikesReport = {
  sources: { source: string; medium: string; name: string; sessions: number; users: number; share: number; notable: boolean; dominant: boolean; searchUrl: string | null;
    landingPages: { path: string; sessions: number }[]; referrers: { url: string; sessions: number }[] }[];
};
function useLiveSpike() {
  return useAnalyticsQuery<LiveSpike>({ key: "ga4-live-spike", path: "ga4/live-spike", useTime: false, useFilters: false,
    placeholder: false, staleTime: 120_000, refetchInterval: 120_000 });
}
const detailClass = "mx-2 mt-1 mb-1 break-words text-xs text-neutral-600 dark:text-neutral-400";

function ChangesList({ expanded = false }: { expanded?: boolean }) {
  const t = useExtracted();
  const query = useOverviewReport<Changes>("what-changed");
  const live = useLiveSpike();
  const spike = live.data?.spike;
  const items: ListItem[] = [];
  if (spike) items.push({ key: "live", label: t("Live spike"), value: spike.activeUsers,
    formatCount: () => `${spike.ratio.toFixed(1)}×`,
    detail: <p className={detailClass}>{t("Last 30 minutes · all traffic")}{spike.topPage && ` · ${spike.topPage}`}</p> });
  if (query.data?.bots.sessions) items.push({ key: "bots", label: t("Suspected bot traffic"), value: query.data.bots.sessions,
    detail: <p className={detailClass}>{t("{count} segments with bot-like activity", { count: query.data.bots.segments })}</p> });
  query.data?.changes.forEach(change => items.push({ key: `${change.parameter}:${change.name}`, label: change.name, value: Math.abs(change.difference),
    formatCount: () => <span className={change.difference > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
      {change.difference > 0 ? "+" : "−"}{fmt(Math.abs(change.difference))}
    </span>,
    onClick: () => addFilter({ parameter: change.parameter, type: "equals", value: [change.filterValue] }),
    detail: <p className={detailClass}>{t(change.kind)} · {change.percent === null ? t("New in this period") : `${change.percent > 0 ? "+" : ""}${Math.round(change.percent)}%`}
      {" · "}{t("{previous} → {current}", { previous: fmt(change.previous), current: fmt(change.current) })}</p>,
  }));
  return <>
    <ReportState query={query} />
    {query.data && <>
      <p className="mb-3 text-xs text-neutral-600 dark:text-neutral-400">{t("vs previous {days} days", { days: query.data.days })}</p>
      {items.length ? <NativeList title="Change" valueLabel="Difference" items={expanded ? items : items.slice(0, 6)} expanded={expanded} previewClassName="h-[270px]" showBar={false} showPercentage={false} />
        : <p className="py-10 text-center text-sm text-neutral-600 dark:text-neutral-400">{t("No big changes in this period.")}</p>}
    </>}
  </>;
}
export function WhatChanged() {
  const t = useExtracted();
  return <TabbedSectionCard defaultValue="changes" tabs={[
    { value: "changes", label: t("What changed"), content: <ChangesList />, dialogContent: <ChangesList expanded /> },
  ]} />;
}

function SpikesList({ expanded = false }: { expanded?: boolean }) {
  const t = useExtracted();
  const query = useOverviewReport<SpikesReport>("spikes");
  const live = useLiveSpike();
  const spike = live.data?.spike;
  const items: ListItem[] = [];
  if (spike) items.push({ key: "live", label: t("Live spike"), value: spike.activeUsers,
    formatCount: () => t("{count} users · {ratio}× usual", { count: fmt(spike.activeUsers), ratio: spike.ratio.toFixed(1) }),
    detail: <p className={detailClass}>{t("Usual traffic: {count} active users", { count: fmt(spike.baselineUsers) })}{spike.topPage && ` · ${spike.topPage}`}</p> });
  query.data?.sources.forEach(source => items.push({ key: JSON.stringify([source.source, source.medium]), label: source.name, value: source.sessions,
    formatCount: value => t("{count} sessions", { count: fmt(value) }), href: source.searchUrl || undefined,
    detail: <div className={detailClass}>
      <p>{source.notable && t("Notable referral")}{source.notable && source.dominant && " · "}
        {source.dominant && t("{share}% of traffic", { share: Math.round(source.share) })}{" · "}{source.source} / {source.medium}</p>
      {source.landingPages.length > 0 && <p>{t("Landing pages")}: {source.landingPages.slice(0, 3).map(page => page.path).join(", ")}</p>}
      {source.referrers.length > 0 && <p>{t("Referrers")}: {source.referrers.slice(0, 2).map(ref => ref.url).join(", ")}</p>}
    </div>,
  }));
  return <>
    <ReportState query={query} />
    <p className="mb-2 text-xs text-neutral-600 dark:text-neutral-400">{t("Live: last 30 minutes, all traffic. Sources: selected dates and filters.")}</p>
    {live.error && <div role="status" className="mb-2 flex items-center justify-between gap-2 text-xs text-neutral-600 dark:text-neutral-400">
      <span title={live.error.message}>{t("Failed to load live traffic")}</span>
      <Button variant="ghost" size="xs" onClick={() => void live.refetch()}>{t("Try Again")}</Button>
    </div>}
    {live.isPending && query.data && <p className="mb-2 text-xs text-neutral-500">{t("Loading live traffic…")}</p>}
    {query.data && (items.length ? <NativeList title="Source" valueLabel="Activity" items={items} expanded={expanded} previewClassName={live.error ? "h-[238px]" : "h-[270px]"} showBar={false} showPercentage={false} />
      : !live.isPending && !live.error && <p className="py-10 text-center text-sm text-neutral-600 dark:text-neutral-400">{t("No traffic spikes or unusual sources in this period.")}</p>)}
  </>;
}
export function Spikes() {
  const t = useExtracted();
  return <TabbedSectionCard defaultValue="spikes" tabs={[
    { value: "spikes", label: t("Spikes"), content: <SpikesList />, dialogContent: <SpikesList expanded /> },
  ]} />;
}
