import { useMemo, useState } from 'react';
import { Activity, Users, Code2, MousePointerClick, ChevronRight, Target } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/basic-tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { StatBand } from '@/components/site/StatBand';
import { Delta } from '@/components/site/Delta';
import { ChartLegend } from '@/components/site/ChartLegend';
import { Chart, Choice, SearchBox, LoadingReport, ReportError, Empty, Notice, Disclosure } from '@/components/Report';
import { useReport, useWorkspace } from '@/lib/api';
import { useExport } from '@/lib/export';
import { updateParams } from '@/lib/router';
import { exportCsv, number, dateLabel, percent } from '@/lib/utils';
import { percentDelta } from '@/lib/delta';

interface EventRow { name: string; type: string; events: number; users: number; previous: number; series: number[]; latestDay: string | null; }
interface EventsReport { totals: { events: number; users: number; sessions: number; keyEvents: number; perSession: number }; previous: EventsReport['totals']; events: EventRow[]; dates: string[]; eventNames: number; previousEventNames: number; timeZone: string; limited: boolean; thresholded: boolean; sampled: boolean; fetchedAt: number; }
interface ActivityReport { rows: { hour: string; name: string; page: string; device: string; events: number; users: number }[]; rowCount: number; timeZone: string; }
const CATEGORIES = [['custom', 'Custom events'], ['outbound', 'Outbound'], ['buttons', 'Buttons'], ['forms', 'Forms'], ['copies', 'Copies'], ['all', 'All events']] as const;
function matches(event: EventRow, category: string) {
  if (category === 'all') return true;
  if (category === 'custom') return event.type === 'other';
  if (category === 'buttons') return /(?:button|cta).*click|click.*(?:button|cta)/i.test(event.name);
  if (category === 'copies') return /copy|clipboard/i.test(event.name);
  return event.type === category;
}
function EventDetails({ selected, propertyId, range, close }: { selected: EventRow | null; propertyId: string; range: string; close: () => void }) {
  const result = useReport<ActivityReport>(selected ? `/api/events/${propertyId}/activity?range=${range}&event=${encodeURIComponent(selected.name)}` : null);
  return <Dialog open={!!selected} onOpenChange={open => !open && close()}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle className="break-all font-mono">{selected?.name}</DialogTitle><DialogDescription>Event activity aggregated by hour, page and device. Counts are not individual event logs.</DialogDescription></DialogHeader>{selected && <><StatBand cells={[{ label: 'Events', value: number(selected.events) }, { label: 'Users', value: number(selected.users) }, { label: 'Latest day', value: selected.latestDay ? dateLabel(selected.latestDay) : '—' }]}/><Chart label={`${selected.name} trend`} values={selected.series} height={160}/>{result.isLoading ? <LoadingReport/> : result.error ? <ReportError error={result.error} retry={() => result.refetch()}/> : !result.data?.rows.length ? <Empty title="No activity breakdown"/> : <Table><TableHeader><TableRow><TableHead>Hour</TableHead><TableHead>Page</TableHead><TableHead>Device</TableHead><TableHead className="text-right">Events</TableHead></TableRow></TableHeader><TableBody>{result.data.rows.map((row, i) => <TableRow key={i}><TableCell className="whitespace-nowrap text-xs">{`${row.hour.slice(4, 6)}/${row.hour.slice(6, 8)} ${row.hour.slice(8, 10)}:00`}</TableCell><TableCell className="max-w-60 truncate text-xs" title={row.page}>{row.page}</TableCell><TableCell className="text-xs">{row.device}</TableCell><TableCell className="text-right text-xs tabular-nums">{number(row.events)}</TableCell></TableRow>)}</TableBody></Table>}{result.data && <p className="text-xs text-neutral-500">Showing {result.data.rows.length} of {number(result.data.rowCount)} hourly groups · {result.data.timeZone}</p>}<p className="text-xs text-neutral-500">Custom parameters need registered GA4 custom dimensions. This report only shows the event fields returned by the current Data API.</p></>}</DialogContent></Dialog>;
}
export function EventsPage() {
  const { propertyId, range, params } = useWorkspace();
  const category = CATEGORIES.some(([key]) => key === params.get('category')) ? params.get('category')! : 'custom';
  const query = params.get('q') || '', compare = params.get('compare') !== 'none';
  const [selected, setSelected] = useState<EventRow | null>(null), [page, setPage] = useState(0), [sort, setSort] = useState('events');
  const result = useReport<EventsReport>(`/api/events/${propertyId}?range=${range}`);
  const d = result.data;
  const rows = (d?.events || []).filter(e => matches(e, category) && e.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : b[sort as 'events' | 'users'] - a[sort as 'events' | 'users']);
  const series = useMemo(() => d?.dates.map((_, i) => rows.reduce((sum, row) => sum + row.series[i], 0)) || [], [d, category, query]);
  const total = rows.reduce((sum, row) => sum + row.events, 0);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 25) - 1));
  useExport(() => exportCsv(`events_${propertyId}`, [['Event', 'Events', 'Users', 'Previous events', 'Latest day'], ...rows.map(e => [e.name, e.events, e.users, e.previous, e.latestDay])]));
  return <>
    <StatBand isLoading={result.isLoading} cells={[
      { label: 'Total events', icon: <Activity className="h-3 w-3"/>, value: number(d?.totals.events), delta: percentDelta(d?.totals.events, compare ? d?.previous.events : null), sub: 'All recorded events' },
      { label: 'Users', icon: <Users className="h-3 w-3"/>, value: number(d?.totals.users), delta: percentDelta(d?.totals.users, compare ? d?.previous.users : null), sub: 'Distinct GA4 users' },
      { label: 'Event names', icon: <Code2 className="h-3 w-3"/>, value: number(d?.eventNames), delta: percentDelta(d?.eventNames, compare ? d?.previousEventNames : null), sub: 'Across all event types' },
      { label: 'Events per session', icon: <MousePointerClick className="h-3 w-3"/>, value: d?.totals.perSession.toFixed(2) || '—', delta: percentDelta(d?.totals.perSession, compare ? d?.previous.perSession : null), sub: `${number(d?.totals.keyEvents)} key events` },
    ]}/>
    <div className="flex items-center justify-between"><Choice label="Compare" value={compare ? 'previous' : 'none'} onChange={v => updateParams({ compare: v })} options={[["previous", 'Previous period'], ['none', 'No comparison']]}/>{d && <span className="text-xs text-neutral-500">{d.timeZone}</span>}</div>
    {(d?.limited || d?.thresholded || d?.sampled) && <Notice>GA4 applied row limits, thresholds or sampling. Figures may be partial.</Notice>}
    <Card><div className="overflow-x-auto px-4 pt-2"><Tabs value={category} onValueChange={value => { setPage(0); updateParams({ category: value }); }}><TabsList className="justify-start gap-4">{CATEGORIES.map(([key, label]) => <TabsTrigger key={key} value={key} className="px-0 text-xs">{label}<span className="ml-1 text-[10px] text-neutral-500">{number(d?.events.filter(e => matches(e, key)).length)}</span></TabsTrigger>)}</TabsList></Tabs></div>
      {result.isLoading ? <LoadingReport rows={10}/> : result.error ? <ReportError error={result.error} retry={() => result.refetch()}/> : !rows.length ? <Empty title={query ? 'No matching events' : `No ${CATEGORIES.find(([key]) => key === category)?.[1].toLowerCase()} recorded`}><p>This property has no matching events in this period. Choose All events to inspect automatic events.</p><Button size="sm" className="mt-3" onClick={() => updateParams({ category: 'all', q: null })}>Show all events</Button></Empty> : <div className="px-4 pb-4 pt-3"><div className="mb-2 flex items-center justify-between"><span className="text-xs text-neutral-500">{CATEGORIES.find(([key]) => key === category)?.[1]}</span><span className="text-sm font-semibold tabular-nums">{number(total)} events</span></div><Chart label="Events over time" values={series} labels={d?.dates.map(dateLabel)}/><ChartLegend items={[{ label: 'Events in selected category', color: 'hsl(var(--dataviz))' }]}/></div>}
    </Card>
    <Card><div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><h2 className="font-semibold">Events</h2><SearchBox placeholder="Search event names…" value={query} onChange={value => { setPage(0); updateParams({ q: value }); }}/></div><Table><TableHeader><TableRow><TableHead className="w-full"><button onClick={() => setSort('name')}>Event name</button></TableHead><TableHead className="whitespace-nowrap text-right"><button onClick={() => setSort('events')}>Events ↓</button></TableHead>{compare && <TableHead className="text-right">Change</TableHead>}<TableHead className="text-right"><button onClick={() => setSort('users')}>Users</button></TableHead><TableHead className="text-right">Share</TableHead><TableHead/></TableRow></TableHeader><TableBody>{rows.slice(currentPage * 25, (currentPage + 1) * 25).map(e => <TableRow key={e.name}><TableCell className="max-w-0"><button className="flex max-w-full items-center gap-2 text-left" onClick={() => setSelected(e)}><Code2 className="h-3.5 w-3.5 text-neutral-400"/><span className="truncate font-mono text-xs" title={e.name}>{e.name}</span></button></TableCell><TableCell className="text-right text-xs tabular-nums">{number(e.events)}</TableCell>{compare && <TableCell className="text-right"><Delta value={percentDelta(e.events, e.previous)}/></TableCell>}<TableCell className="text-right text-xs tabular-nums">{number(e.users)}</TableCell><TableCell className="text-right text-xs tabular-nums">{percent(total ? e.events / total : 0)}</TableCell><TableCell><Button variant="ghost" size="xs" aria-label={`Inspect ${e.name}`} onClick={() => setSelected(e)}><ChevronRight className="h-3 w-3"/></Button></TableCell></TableRow>)}</TableBody></Table>{!rows.length && !result.isLoading && <Empty title="No events to display"/>}<div className="flex items-center justify-between px-4 py-3 text-xs text-neutral-500"><span>{number(rows.length)} event names</span><div className="flex gap-2"><Button size="xs" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</Button><Button size="xs" disabled={(currentPage + 1) * 25 >= rows.length} onClick={() => setPage(currentPage + 1)}>Next</Button></div></div></Card>
    <Disclosure><p>Custom events are event names outside GA4's known automatic and enhanced-measurement groups. Buttons and copies are classified by event names (for example download_cta_clicked); they require matching instrumentation. Forms use form_start and form_submit; outbound uses GA4's click event.</p><p>Event counts can be added; users can overlap across event names and are never added to estimate a total. Drill-down shows hourly aggregates. Individual raw event logs and unregistered parameters require additional GA4 instrumentation or BigQuery.</p></Disclosure>
    <EventDetails selected={selected} propertyId={propertyId} range={range} close={() => setSelected(null)}/>
  </>;
}
