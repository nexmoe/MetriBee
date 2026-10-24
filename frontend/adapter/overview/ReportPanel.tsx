import { ReactNode, useMemo, useState } from "react";
import { useExtracted } from "../extracted";
import { ChevronDown, Download } from "lucide-react";
import { useAnalyticsQuery } from "../../rybbit/src/api/analytics/useAnalyticsQuery";
import { ScrollArea } from "../../rybbit/src/components/ui/scroll-area";
import { RowItem } from "../../rybbit/src/app/[site]/components/shared/StandardSection/Row";
import { StandardSectionEmpty } from "../../rybbit/src/app/[site]/components/shared/StandardSection/StandardSection";
import { CardLoader } from "../../rybbit/src/components/ui/card";
import { Favicon } from "../../rybbit/src/components/Favicon";
import { addFilter } from "../../rybbit/src/lib/store";
import { TableSortIndicator } from "../../rybbit/src/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../../rybbit/src/components/ui/dropdown-menu";
import { StandardSkeleton } from "../../rybbit/src/app/[site]/components/shared/StandardSection/Skeleton";
import { Button, ErrorState, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, downloadCsv, fmt } from "../pages/shared";

export type ReportRow = { dims: string[]; metrics: (number | null)[] };
export type Report = {
  rows: ReportRow[];
  dimensionHeaders: string[];
  metricHeaders: string[];
  currencyCode?: string;
  summary?: Record<string, number>;
  groups?: { name: string; sessions: number }[];
  hidden?: boolean;
};

const labels: Record<string, string> = {
  sessionSource: "Source", sessionMedium: "Medium", platform: "Platform", pagePath: "Page",
  pageReferrer: "Referring URL", eventName: "Event", country: "Country", city: "City", reason: "Reason",
  deviceCategory: "Device", sessions: "Sessions", engagementRatePct: "Engagement %",
  avgEngagementSeconds: "Avg engagement / user (s)", keyEvents: "Key Events", sharePct: "Session %",
  totalRevenue: "Revenue", totalAdRevenue: "Ad revenue", purchaseRevenue: "Purchase revenue",
  publisherAdImpressions: "Ad impressions", publisherAdClicks: "Ad clicks", eventValue: "Event value",
  eventCount: "Event count", activeUsers: "Active Users", screenPageViews: "Pageviews",
};
export const reportLabel = (name: string) => labels[name] || name.replace(/([a-z])([A-Z])/g, "$1 $2");

// GA4 sessionSource is often a bare campaign label ("gemini", "google"), not the
// referrer host Rybbit stores. Only labels that map to exactly one host in the
// original display-name table resolve; real hostnames pass through unchanged.
const SOURCE_LABEL_TO_DOMAIN: Record<string, string> = {
  google: "www.google.com", bing: "www.bing.com", baidu: "www.baidu.com", naver: "www.naver.com",
  facebook: "www.facebook.com", instagram: "www.instagram.com", youtube: "www.youtube.com",
  reddit: "www.reddit.com", twitter: "twitter.com", x: "x.com", linkedin: "www.linkedin.com",
  github: "github.com", duckduckgo: "duckduckgo.com", yandex: "yandex.ru", yahoo: "search.yahoo.com",
  tiktok: "www.tiktok.com", pinterest: "www.pinterest.com", chatgpt: "chatgpt.com", openai: "chat.openai.com",
  claude: "claude.ai", gemini: "gemini.google.com", copilot: "copilot.microsoft.com",
  "google ai studio": "aistudio.google.com", notebooklm: "notebooklm.google.com", duck: "duck.ai",
  kimi: "kimi.com", doubao: "doubao.com", manus: "manus.im", threads: "www.threads.com",
  bluesky: "bsky.app", outlook: "outlook.live.com", deepseek: "chat.deepseek.com", mistral: "chat.mistral.ai",
  "meta ai": "meta.ai", poe: "poe.com", grok: "grok.com", pi: "pi.ai", character: "character.ai",
  perplexity: "www.perplexity.ai", phind: "phind.com", andi: "andi.com", you: "you.com",
  cursor: "cursor.com", jasper: "jasper.ai", "hacker news": "news.ycombinator.com", stripe: "stripe.com",
  substack: "substack.com", discord: "discord.com", wikipedia: "en.wikipedia.org",
};
export function sourceFaviconDomain(value: string) {
  const raw = (value || "").trim();
  if (!raw || /^\(.*\)$/.test(raw)) return "";
  if (SOURCE_LABEL_TO_DOMAIN[raw.toLowerCase()]) return SOURCE_LABEL_TO_DOMAIN[raw.toLowerCase()];
  const host = /^https?:\/\//i.test(raw) ? (() => { try { return new URL(raw).hostname; } catch { return ""; } })() : raw;
  if (!host || host.includes("/") || /\s/.test(host)) return "";
  if (host.includes(".")) return host;
  return SOURCE_LABEL_TO_DOMAIN[host.toLowerCase()] || "";
}
export function useOverviewReport<T = Report>(type: string, params?: Record<string, unknown>) {
  return useAnalyticsQuery<T>({ key: "ga4-overview", path: `ga4/${type}`, params, placeholder: false });
}
export function ReportState({ query }: { query: ReturnType<typeof useOverviewReport<any>> }) {
  const t = useExtracted();
  return <>
    {query.isFetching && <div className="absolute top-[-8px] left-0 h-full w-full"><CardLoader /></div>}
    {query.error && !query.data
      ? <ErrorState title={t("Failed to load data")} message={query.error.message} refetch={query.refetch} />
      : query.isPending ? <div className="flex flex-col gap-2"><StandardSkeleton /></div> : null}
  </>;
}

export type ListItem = { key: string; label: ReactNode; value: number; href?: string; onClick?: () => void; leftContent?: ReactNode; detail?: ReactNode; percentage?: number; formatCount?: (value: number, hovered: boolean) => ReactNode };
export function NativeList({ title, valueLabel, items, metric, metrics, onMetricChange, formatCount, showPercentage = true, showBar = true, expanded = false, previewClassName = "h-[314px]", footer }: {
  title: string; valueLabel: string; items: ListItem[]; metric?: string;
  metrics?: { value: string; label: string }[]; onMetricChange?: (metric: string) => void;
  formatCount?: (value: number, hovered: boolean) => ReactNode;
  showPercentage?: boolean; showBar?: boolean; expanded?: boolean; previewClassName?: string;
  footer?: ReactNode;
}) {
  const t = useExtracted();
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const percentage = (item: ListItem) => item.percentage ?? (total ? Math.max(0, item.value) / total * 100 : 0);
  const maxPercentage = Math.max(0, ...items.map(percentage));
  return <div className={expanded ? "flex min-h-0 flex-1 flex-col" : ""}>
    <div className="mb-2 flex flex-row justify-between gap-2 pr-1 text-xs text-neutral-600 dark:text-neutral-400">
      <div>{t(title)}</div>
      {metrics && metrics.length > 1 && onMetricChange ? <DropdownMenu>
        <DropdownMenuTrigger asChild unstyled><button className="flex items-center gap-1" aria-label={t("Choose metric")}>
          {t(valueLabel)}<ChevronDown className="size-3" />
        </button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuRadioGroup value={metric} onValueChange={onMetricChange}>
          {metrics.map(option => <DropdownMenuRadioItem key={option.value} value={option.value}>{t(option.label)}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup></DropdownMenuContent>
      </DropdownMenu> : <div>{t(valueLabel)}</div>}
    </div>
    <ScrollArea className={expanded ? "min-h-0 flex-1" : previewClassName} viewportClassName="[&>div]:!block">
      <div className="flex flex-col gap-2 overflow-x-hidden">
        {items.length ? items.map(item => <div className="flex flex-col" key={item.key}>
          <RowItem item={{ value: item.key, count: item.value, percentage: percentage(item) }}
            ratio={maxPercentage ? 100 / maxPercentage : 0} getKey={e => e.value} getValue={e => e.value} getLabel={() => item.label}
            getLink={item.href ? () => item.href! : undefined} onClick={item.onClick} leftContent={item.leftContent}
            formatCount={item.formatCount || formatCount} showPercentage={showPercentage} showBar={showBar} />
          {item.detail}
        </div>) : <StandardSectionEmpty />}
        {footer}
      </div>
    </ScrollArea>
  </div>;
}

export function metricFormat(metric: string, currency?: string) {
  if (/Pct$|Rate$/.test(metric)) return (value: number) => `${fmt(value)}%`;
  if (/Seconds$/.test(metric)) return (value: number) => `${fmt(value)}s`;
  if ((/revenue/i.test(metric) || metric === "eventValue") && currency) return (value: number, hovered: boolean) => new Intl.NumberFormat(undefined, {
    style: "currency", currency, notation: hovered ? "standard" : "compact", maximumFractionDigits: 2,
  }).format(value);
  return undefined;
}

export function OverviewTable({ headers, rows, name, expanded = true, metricStart = 1, formatCell, footer, onRowClick, searchText }: {
  headers: string[]; rows: (string | number | null)[][]; name: string; expanded?: boolean; metricStart?: number;
  formatCell?: (value: string | number | null, column: number) => ReactNode;
  footer?: ReactNode;
  onRowClick?: (row: (string | number | null)[]) => void;
  searchText?: (row: (string | number | null)[]) => string;
}) {
  const t = useExtracted();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ index: number; desc: boolean }>();
  const filtered = useMemo(() => {
    const list = rows.filter(row => row.some(cell => String(cell ?? "").toLowerCase().includes(search.toLowerCase())) || searchText?.(row).toLowerCase().includes(search.toLowerCase()));
    return sort ? list.sort((a, b) => {
      const x = a[sort.index], y = b[sort.index];
      if (x == null || y == null) return x == null ? y == null ? 0 : 1 : -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""))) * (sort.desc ? -1 : 1);
    }) : list;
  }, [rows, search, sort, searchText]);
  const columns = headers.map((_, i) => i);
  if (!headers.length) return <StandardSectionEmpty />;
  return <div className={expanded ? "flex min-h-0 flex-1 flex-col gap-3" : "space-y-2"}>
    {expanded && <div className="flex items-center gap-2">
      <Input inputSize="sm" className="bg-white text-xs dark:bg-neutral-900" aria-label={t("Search")} placeholder={t("Filter {count} items...", { count: String(rows.length) })} value={search} onChange={e => setSearch(e.target.value)} />
      <Button variant="outline" size="sm" onClick={() => downloadCsv(`${name}.csv`, headers, rows)}><Download />CSV</Button>
    </div>}
    <ScrollArea className={expanded ? "min-h-0 flex-1" : "h-[314px]"} viewportClassName="[&>div]:!block">
      <Table className="min-w-max text-xs">
        <TableHeader className="sticky top-0 z-10 bg-neutral-100"><TableRow>{columns.map((index, i) => <TableHead key={index} className={`whitespace-nowrap first:rounded-l-lg last:rounded-r-lg ${i === 0 ? "" : "text-right"}`}>
          <button className={`flex w-full items-center gap-1 ${i === 0 ? "text-left" : "justify-end text-right"}`} onClick={() => setSort({ index, desc: sort?.index === index ? !sort.desc : true })}>
            {t(headers[index])}<TableSortIndicator sortDirection={sort?.index === index ? sort.desc ? "desc" : "asc" : false} />
          </button>
        </TableHead>)}</TableRow></TableHeader>
        <TableBody>{filtered.map((row, i) => <TableRow key={i} onClick={onRowClick ? () => onRowClick(row) : undefined} className={onRowClick ? "cursor-pointer" : undefined}>{columns.map((index, j) => {
          const text = j === 0 && !expanded ? row.slice(0, metricStart).join(" · ") : row[index];
          return <TableCell key={index} className={j === 0 ? "truncate" : "text-right tabular-nums"} title={String(text ?? "")}>
            {formatCell ? formatCell(text, index) : typeof text === "number" ? fmt(text) : text ?? "—"}
          </TableCell>;
        })}</TableRow>)}</TableBody>
      </Table>
      {!filtered.length && <StandardSectionEmpty />}
      {footer}
    </ScrollArea>
  </div>;
}

export function ReportPanel({ type, expanded = false, segment }: { type: string; expanded?: boolean; segment?: string }) {
  const query = useOverviewReport(type, segment ? { segment } : undefined);
  const [selectedMetric, setMetric] = useState("");
  const d = query.data;
  const metrics = d?.metricHeaders || [];
  const metric = metrics.includes(selectedMetric) ? selectedMetric
    : type.includes("engagement") && metrics.includes("engagementRatePct") ? "engagementRatePct" : metrics[0];
  const index = metrics.indexOf(metric);
  const shareKnown = (type === 'bot-traffic' && metric === 'sessions') || (type === 'revenue-key-events' && metric === 'keyEvents' && !!d?.summary?.keyEvents);
  const rows = [...(d?.rows || [])].sort((a, b) => (b.metrics[index] || 0) - (a.metrics[index] || 0));
  const items = rows.map((row, i): ListItem => {
    const dimension = d?.dimensionHeaders?.[0], value = row.dims[0] || "";
    const parameter = dimension === "sessionSource" ? "referrer" : dimension === "pagePath" ? "pathname" : dimension === "eventName" ? "event_name" : null;
    const isSource = dimension === "sessionSource" || dimension === "pageReferrer";
    const domain = sourceFaviconDomain(value);
    return { key: JSON.stringify(row.dims) + i, value: row.metrics[index] || 0,
      ...(type === 'bot-traffic' ? { percentage: row.metrics[metrics.indexOf('sharePct')] || 0 } : type === 'revenue-key-events' && d?.summary?.keyEvents ? { percentage: (row.metrics[index] || 0) / d.summary.keyEvents * 100 } : {}),
      label: <div className="flex min-w-0 items-center">{isSource && domain && <Favicon domain={domain} className="mr-2 w-4" />}<span className="truncate">{row.dims.filter(Boolean).join(" · ")}</span></div>,
      ...(parameter ? { onClick: () => addFilter({ parameter, type: "equals", value: [value] }) } : {}),
      ...(dimension === "pageReferrer" && /^https?:\/\//.test(value) ? { href: value } : {}),
    };
  });
  return <>
    <ReportState query={query} />
    {d && (expanded ? <>
      {d.groups?.length ? <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
        {d.groups.map(group => <span key={group.name}>{group.name} <span className="tabular-nums text-foreground">{fmt(group.sessions)}</span></span>)}
      </div> : null}
      <OverviewTable name={type} expanded metricStart={d.dimensionHeaders?.length || 1}
        headers={[...(d.dimensionHeaders || []).map(reportLabel), ...metrics.map(m => reportLabel(m) + (/revenue/i.test(m) && d.currencyCode ? ` (${d.currencyCode})` : ""))]}
        rows={(d.rows || []).map(row => [...row.dims, ...row.metrics])} />
    </> : <NativeList title={reportLabel(d.dimensionHeaders?.[0] || "eventName")} valueLabel={reportLabel(metric || "Count")} items={items}
      metric={metric} metrics={metrics.map(m => ({ value: m, label: reportLabel(m) }))} onMetricChange={setMetric}
      formatCount={metricFormat(metric || "", d.currencyCode)} showPercentage={shareKnown} />)}
  </>;
}
