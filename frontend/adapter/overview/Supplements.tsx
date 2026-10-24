import { useExtracted } from "../extracted";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { DateTime } from "luxon";
import { TabbedSectionCard, TabbedSectionItem } from "../../rybbit/src/app/[site]/components/shared/TabbedSectionCard";
import { ChannelIcon } from "../../rybbit/src/components/Channel";
import { Favicon } from "../../rybbit/src/components/Favicon";
import { TimeSeriesChart } from "../../rybbit/src/components/charts/TimeSeriesChart";
import { ChartTooltip } from "../../rybbit/src/components/charts/ChartTooltip";
import { useGetOverviewBucketed } from "../../rybbit/src/api/analytics/hooks/useGetOverviewBucketed";
import { useStore, useTimezone } from "../../rybbit/src/lib/store";
import { getStartAndEndDate } from "../../rybbit/src/api/utils";
import { ListItem, NativeList, metricFormat, OverviewTable, reportLabel, ReportPanel, ReportRow, ReportState, sourceFaviconDomain, useOverviewReport } from "./ReportPanel";
import { Choice, fmt } from "../pages/shared";

export function reportTab(value: string, label: string, type: string, segment?: string): TabbedSectionItem<string> {
  return { value, label, content: <ReportPanel type={type} segment={segment} />,
    dialogTitle: label, dialogContent: <ReportPanel type={type} segment={segment} expanded /> };
}

function RevenueBreakdown({ expanded = false }: { expanded?: boolean }) {
  const t = useExtracted();
  const query = useOverviewReport("revenue-key-events");
  const summary = query.data?.summary || {};
  return <><ReportState query={query} />{query.data && <NativeList title="Metric" valueLabel="Value" expanded={expanded} showBar={false} showPercentage={false}
    items={[
      ...["totalAdRevenue", "purchaseRevenue", "eventValue", "publisherAdImpressions", "publisherAdClicks", "keyEvents"].filter(name => summary[name]).map(name => ({
        key: name, label: t(reportLabel(name)), value: summary[name], formatCount: metricFormat(name, query.data?.currencyCode),
      })),
      ...(query.data.rows || []).map(row => ({ key: `event:${row.dims[0]}`, label: t("Key event: {name}", { name: row.dims[0] }), value: row.metrics[0] || 0 })),
    ]} />}</>;
}
export function Revenue() {
  const t = useExtracted();
  return <TabbedSectionCard defaultValue="revenue" tabs={[
    { value: "revenue", label: t("Revenue and Key Events"), content: <RevenueBreakdown />, dialogContent: <RevenueBreakdown expanded /> },
    reportTab("sources", t("Revenue by Source"), "revenue-by-source"),
  ]} />;
}

type Visitors = { personas: { label: string; channel: string; activeUsers: number; sessions: number; engagementRate: number; avgEngagementSeconds: number; keyEvents: number; intent: string }[]; pages: ReportRow[]; timeline: ReportRow[] };
function VisitorSegments({ expanded = false }: { expanded?: boolean }) {
  const t = useExtracted();
  const query = useOverviewReport<Visitors>("visitors");
  const [metric, setMetric] = useState<"activeUsers" | "sessions" | "engagementRate" | "avgEngagementSeconds" | "keyEvents">("activeUsers");
  const metrics = ["activeUsers", "sessions", "engagementRate", "avgEngagementSeconds", "keyEvents"].map(value => ({ value, label: value === "engagementRate" ? "Engagement %" : reportLabel(value) }));
  return <><ReportState query={query} />{query.data && (expanded ? <>
    <p className="mb-2 text-xs text-neutral-500">{t("Aggregate segments. Intent labels are estimates.")}</p>
    <OverviewTable name="visitor-segments" expanded metricStart={2}
      headers={["Visitor type", "First user channel", "Active Users", "Sessions", "Engagement %", "Avg engagement / user (s)", "Key Events", "Estimated intent"]}
      rows={query.data.personas.map(p => [p.label, p.channel, p.activeUsers, p.sessions, p.engagementRate, p.avgEngagementSeconds, p.keyEvents, p.intent])} />
  </> : <NativeList title="Visitor type" valueLabel={metrics.find(m => m.value === metric)!.label}
    metric={metric} metrics={metrics} onMetricChange={value => setMetric(value as typeof metric)} showPercentage={false} formatCount={metricFormat(metric)}
    items={[...query.data.personas].sort((a, b) => b[metric] - a[metric]).map((p, i) => ({
      key: p.label + p.channel + i, value: p[metric],
      label: <div className="flex min-w-0 items-center gap-2"><ChannelIcon channel={p.channel === "AI Assistant" ? "AI" : p.channel} /><span className="truncate">{t(p.label)} · {p.channel}</span></div>,
    }))} />)}</>;
}
function VisitorEngagement() {
  const query = useOverviewReport<Visitors>("visitors");
  const timeZone = useTimezone();
  const t = useExtracted();
  const points = query.data?.timeline.map(r => ({
    x: DateTime.fromFormat(r.dims[0], "yyyyLLdd", { zone: timeZone }).toJSDate(),
    y: r.metrics[0] ? (r.metrics[2] || 0) / r.metrics[0] : 0,
  })) || [];
  return <><ReportState query={query} />{query.data && <div className="h-[314px]">
    <TimeSeriesChart current={points} max={Math.max(0, ...points.map(p => p.y))} chartMin={points[0]?.x} chartMax={points.at(-1)?.x} displayDashed={false} disableDragZoom yTickFormat={v => `${fmt(v)}s`}
      renderTooltip={({ point }) => <ChartTooltip><div className="m-2 flex flex-col gap-1 text-xs">
        <div>{DateTime.fromJSDate(point.x, { zone: timeZone }).toFormat("LLL d")}</div>
        <div>{t("Avg engagement / user (s)")}: {fmt(point.y)}s</div>
      </div></ChartTooltip>} />
  </div>}</>;
}
export function Visitors() {
  const t = useExtracted();
  return <TabbedSectionCard defaultValue="visitors" tabs={[
    { value: "visitors", label: t("Visitor segments"), content: <VisitorSegments />, dialogContent: <VisitorSegments expanded /> },
    { value: "engagement", label: t("Engagement"), content: <VisitorEngagement /> },
  ]} />;
}

type Diagnostic = { sources: { source: string; medium: string; sessions: number; users: number; share: number; name: string; landingPages: { path: string; sessions: number }[]; referrers: { url: string; sessions: number }[] }[] };
function SourceDiagnostics({ expanded = false }: { expanded?: boolean }) {
  const t = useExtracted();
  const query = useOverviewReport<Diagnostic>("diagnostics");
  const [open, setOpen] = useState<string | null>(null);
  const items: ListItem[] = query.data?.sources.map(s => {
    const key = JSON.stringify([s.source, s.medium]), isOpen = key === open, domain = sourceFaviconDomain(s.source);
    return { key, value: s.sessions, percentage: s.share,
      label: <div className="flex min-w-0 items-center">{domain && <Favicon domain={domain} className="mr-2 w-4" />}<span className="truncate">{s.name}</span></div>,
      onClick: () => setOpen(isOpen ? null : key),
      leftContent: isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />,
      detail: isOpen && <div className="ml-4 mt-2 mb-4 border-l-2 border-neutral-100 pl-4 text-xs dark:border-neutral-800">
        <div className="space-y-2 break-all text-neutral-500">
          <p>{s.source} / {s.medium} · {fmt(s.users)} {t("Active Users")}</p>
          {s.landingPages.map(p => <p key={p.path}>{p.path} · {fmt(p.sessions)}</p>)}
          {s.referrers.map(r => <p key={r.url}>{r.url} · {fmt(r.sessions)}</p>)}
        </div>
      </div>,
    };
  }) || [];
  return <><ReportState query={query} />{query.data && <>
    {expanded && <p className="mb-2 text-xs text-neutral-500">{t("Notable referrals and dominant sources in this period.")}</p>}
    <NativeList title="Source" valueLabel="Sessions" items={items} expanded={expanded} />
  </>}</>;
}
export function sourceInsightsTab(label: string): TabbedSectionItem<string> {
  return { value: "insights", label, content: <SourceDiagnostics />, dialogTitle: label, dialogContent: <SourceDiagnostics expanded /> };
}
export function TrafficQuality() {
  const t = useExtracted();
  const [segment, setSegment] = useState("source");
  return <TabbedSectionCard defaultValue="quality" renderTabsListEnd={({ value }) => value === "split" ? <Choice label={t("Breakdown")} value={segment} onChange={setSegment} options={[
    { value: "source", label: t("Source") }, { value: "medium", label: t("Medium") }, { value: "platform", label: t("Platform") },
  ]} /> : null} tabs={[
    reportTab("quality", t("Traffic Quality"), "source-engagement"),
    reportTab("split", t("Breakdown"), "source-split", segment),
    reportTab("bots", t("Suspected bots"), "bot-traffic"),
  ]} />;
}

export function WeekdaySummary() {
  const site = useStore(s => s.site), time = useStore(s => s.time), timeZone = useTimezone();
  const query = useGetOverviewBucketed({ site, bucket: "day" });
  const [metric, setMetric] = useState<"sessions" | "users" | "average">("sessions");
  const days = Array.from({ length: 7 }, (_, i) => ({ name: DateTime.now().startOf("week").plus({ days: i }).toFormat("ccc"), sessions: 0, users: 0, count: 0 }));
  query.data?.forEach(row => {
    const date = DateTime.fromSQL(row.time, { zone: timeZone });
    if (!date.isValid) return;
    const day = days[date.weekday - 1]; day.sessions += row.sessions; day.users += row.active_users || 0;
  });
  const window = getStartAndEndDate(time, timeZone);
  const start = DateTime.fromISO(window.startDate || query.data?.[0]?.time.slice(0, 10) || "", { zone: timeZone });
  const end = DateTime.min(DateTime.fromISO(window.endDate || DateTime.now().setZone(timeZone).toISODate()!, { zone: timeZone }), DateTime.now().setZone(timeZone).startOf("day"));
  // Include quiet dates in the denominator, even when GA4 omits their empty buckets.
  for (let date = start; date.isValid && date <= end; date = date.plus({ days: 1 })) days[date.weekday - 1].count++;
  const metrics = [{ value: "sessions", label: "Sessions" }, { value: "users", label: "Daily user sum" }, { value: "average", label: "Avg sessions / day" }];
  return <><ReportState query={query} />{query.data && <NativeList title="Day" valueLabel={metrics.find(m => m.value === metric)!.label}
    metric={metric} metrics={metrics} onMetricChange={v => setMetric(v as typeof metric)} showPercentage={metric === "sessions"}
    items={days.map(d => ({ key: d.name, label: d.name, value: metric === "average" ? d.count ? d.sessions / d.count : 0 : d[metric] }))} />}</>;
}
