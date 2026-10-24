import { useEffect, useRef, useState } from 'react';
import { Users, Eye, Clock, ArrowUpRight, MousePointerClick, DollarSign } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/basic-tabs';
import { StatBand } from '@/components/site/StatBand';
import { ChartLegend } from '@/components/site/ChartLegend';
import { Choice, Chart, MetricTable, ReportError, LoadingReport, Notice, Disclosure } from '@/components/Report';
import { useReport, useWorkspace, type CardReport } from '@/lib/api';
import { useExport } from '@/lib/export';
import { exportCsv, number, percent, duration, dateLabel } from '@/lib/utils';
import { percentDelta, pointDelta } from '@/lib/delta';
import { topologyPaths, rowLabel } from '@/lib/audience';

interface Overview { summary: Record<string, number>; previous: Record<string, number> | null; rows: { date: string; values: number[] }[]; previousRows: { date: string; values: number[] }[]; limited: boolean; comparisonUnavailable: boolean; trendUnavailable: boolean; timeZone: string; fetchedAt: number; }
const GROUPS: [string, [string, string][]][] = [
  ['Traffic sources', [['traffic-sources', 'Sources'], ['referrers', 'Referrers'], ['source-split', 'Channels']]],
  ['Pages', [['page-paths', 'Pages'], ['landing-pages', 'Entry pages']]],
  ['Location', [['countries', 'Countries'], ['regions', 'Regions'], ['cities', 'Cities'], ['languages', 'Languages'], ['map', 'Map']]],
  ['Technology', [['devices', 'Devices'], ['browsers', 'Browsers'], ['operating-systems', 'Operating systems'], ['screen-resolutions', 'Screens']]],
  ['Activity', [['events', 'Events'], ['hourly-traffic', 'Hourly traffic']]],
  ['Quality & revenue', [['source-engagement', 'Engagement'], ['bot-traffic', 'Bots'], ['revenue-by-source', 'Revenue']]],
];
function CountryMap({ report }: { report: CardReport }) {
  const geography = useReport<unknown>('/data/world-ind.json');
  const [selected, setSelected] = useState<string | null>(null);
  const paths = geography.data ? topologyPaths(geography.data) : [];
  const counts = new Map(report.rows.map(r => [r.dims[1], { name: r.dims[0], sessions: r.metrics[0] }]));
  const max = Math.max(...report.rows.map(r => r.metrics[0]), 1);
  if (geography.error) return <ReportError error={geography.error} retry={() => geography.refetch()}/>;
  return <div className="px-4 pb-4"><svg viewBox="0 0 720 360" role="img" aria-label="Sessions by country, India point of view boundaries" className="min-h-60 w-full">{paths.filter(p => p.countryCode !== 'AQ').map((p, i) => { const count = counts.get(p.countryCode)?.sessions || 0; return <path key={p.countryCode + i} d={p.path} fill={count ? `hsl(var(--dataviz) / ${.16 + Math.sqrt(count / max) * .84})` : 'hsl(var(--neutral-100))'} stroke={selected === p.countryCode ? 'hsl(var(--foreground))' : 'hsl(var(--background))'} strokeWidth={selected === p.countryCode ? 1 : .4} onMouseEnter={() => setSelected(p.countryCode)}><title>{counts.get(p.countryCode)?.name || p.countryCode}: {number(count)} sessions</title></path>; })}</svg><p className="h-4 text-xs text-neutral-500">{selected && counts.has(selected) ? `${counts.get(selected)?.name} · ${number(counts.get(selected)?.sessions)} sessions` : 'Hover a country to inspect sessions'}</p></div>;
}
function GroupCard({ title, tabs }: { title: string; tabs: [string, string][] }) {
  const { propertyId, range } = useWorkspace();
  const [type, setType] = useState(tabs[0][0]);
  const ref = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(false);
  useEffect(() => { if (!ref.current) return; const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '150px' }); observer.observe(ref.current); return () => observer.disconnect(); }, []);
  const result = useReport<CardReport>(visible ? `/api/analytics-card/${propertyId}/${type === 'map' ? 'countries' : type}?range=${range}` : null);
  const report = result.data;
  const labeled = report ? { ...report, rows: report.rows.map(r => { const label = rowLabel(type, r.dims); return { ...r, dims: type === 'countries' ? r.dims : [label.prefix, label.text, label.detail].filter((v): v is string => !!v) }; }) } : undefined;
  return <Card ref={ref} className="min-w-0 pb-3"><Tabs value={type} onValueChange={setType}><div className="overflow-x-auto px-4 pt-2"><TabsList className="h-auto justify-start gap-3">{tabs.map(([id, name]) => <TabsTrigger key={id} value={id} className="px-0 text-xs">{name}</TabsTrigger>)}</TabsList></div></Tabs><div className="min-h-72 pt-2">{type === 'map' && report ? <CountryMap report={report}/> : <MetricTable title={title} report={labeled} loading={!visible || result.isLoading} error={result.error} retry={() => result.refetch()}/>}</div></Card>;
}
export function OverviewPage() {
  const { property, propertyId, range } = useWorkspace();
  const [stat, setStat] = useState('0');
  const [compare, setCompare] = useState(true);
  const result = useReport<Overview>(`/api/workspace-overview/${propertyId}?range=${range}`);
  const d = result.data, summary = d?.summary, previous = compare ? d?.previous : null;
  const metric = (name: string) => summary?.[name];
  const prev = (name: string) => previous?.[name];
  useExport(() => { if (d) exportCsv('overview', [['Date', 'Users', 'New users', 'Sessions', 'Page views'], ...d.rows.map(r => [r.date, ...r.values])]); });
  return <>
    <StatBand isLoading={result.isLoading} columns={6} cells={[
      { icon: <Users className="h-3 w-3"/>, label: 'Users', value: number(metric('totalUsers')), delta: percentDelta(metric('totalUsers'), prev('totalUsers')), sub: `${number(metric('newUsers'))} new users` },
      { icon: <MousePointerClick className="h-3 w-3"/>, label: 'Sessions', value: number(metric('sessions')), delta: percentDelta(metric('sessions'), prev('sessions')), sub: 'All sessions in this period' },
      { icon: <Eye className="h-3 w-3"/>, label: 'Page views', value: number(metric('screenPageViews')), delta: percentDelta(metric('screenPageViews'), prev('screenPageViews')), sub: 'Recorded page and screen views' },
      { icon: <ArrowUpRight className="h-3 w-3"/>, label: 'Bounce rate', value: percent(metric('bounceRate')), delta: pointDelta(metric('bounceRate') == null ? null : metric('bounceRate')! * 100, prev('bounceRate') == null ? null : prev('bounceRate')! * 100), upIsGood: false, sub: 'GA4 non-engaged sessions' },
      { icon: <Clock className="h-3 w-3"/>, label: 'Session duration', value: duration(metric('averageSessionDuration')), delta: percentDelta(metric('averageSessionDuration'), prev('averageSessionDuration')), sub: 'Average, from GA4' },
      { icon: <DollarSign className="h-3 w-3"/>, label: 'Revenue', value: metric('totalRevenue') == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: property?.currencyCode || 'USD', maximumFractionDigits: 0 }).format(metric('totalRevenue')!), delta: percentDelta(metric('totalRevenue'), prev('totalRevenue')), sub: 'Total reported revenue' },
    ]}/>
    {d?.limited && <Notice>GA4 applied reporting thresholds, sampling or high-cardinality grouping to this report.</Notice>}
    <Card><div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3"><Tabs value={stat} onValueChange={setStat}><TabsList><TabsTrigger value="0">Users</TabsTrigger><TabsTrigger value="2">Sessions</TabsTrigger><TabsTrigger value="3">Page views</TabsTrigger></TabsList></Tabs><Choice label="Compare" value={compare ? 'previous' : 'none'} onChange={v => setCompare(v === 'previous')} options={[["previous", 'Previous period'], ['none', 'No comparison']]}/></div>
      {result.error ? <ReportError error={result.error} retry={() => result.refetch()}/> : result.isLoading ? <LoadingReport rows={8}/> : <div className="p-4"><Chart label="Traffic over time" values={(d?.rows || []).map(r => r.values[+stat])} previous={compare ? d?.previousRows.map(r => r.values[+stat]) : undefined} labels={d?.rows.map(r => dateLabel(r.date))}/><ChartLegend items={[{ label: 'Current period', color: 'hsl(var(--dataviz))' }, ...(compare ? [{ label: 'Previous period', color: 'hsl(var(--neutral-500))', dashed: true }] : [])]}/></div>}
    </Card>
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">{GROUPS.map(([title, tabs]) => <GroupCard key={title} title={title} tabs={tabs}/>)}</div>
    <Disclosure>Reports use GA4 definitions and the property's reporting time zone{d?.timeZone ? ` (${d.timeZone})` : ''}. Location and technology cards use sessions. GA4 does not provide individual visitor time zones. Country boundaries use the existing bundled India point-of-view dataset.</Disclosure>
  </>;
}
