import { useMemo, useState } from 'react';
import { ArrowRight, CornerDownRight, Eye, Files, LogIn, LogOut, SlidersHorizontal, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatBand } from '@/components/site/StatBand';
import { Delta } from '@/components/site/Delta';
import { SankeyDiagram } from '@/components/journeys/SankeyDiagram';
import { pathContainsPage, sectionOfPage } from '@/components/journeys/journeyUtils';
import { Choice, SearchBox, LoadingReport, ReportError, Empty, Notice, Disclosure } from '@/components/Report';
import { useWorkspace, useReport } from '@/lib/api';
import { updateParams } from '@/lib/router';
import { percentDelta } from '@/lib/delta';
import { exportCsv, number, percent } from '@/lib/utils';
import { useExport } from '@/lib/export';

type Pair = { host: string; from: string; to: string; views: number };
interface JourneyPeriod { rows: Pair[]; internalViews: number; sessions: number | null; totalViews: number | null; viewsPerSession: number | null; topReferrer: { path: string; views: number } | null; topDestination: { path: string; views: number } | null; truncated: boolean; quality: { dataLossFromOtherRow: boolean; sampled: boolean; subjectToThresholding: boolean }; }
interface Journeys extends JourneyPeriod { previous: JourneyPeriod | null; comparisonUnavailable: boolean; fetchedAt: number; timeZone: string; }
function PagePicker({ label, value, values, onChange }: { label: string; value: string; values: string[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState('');
  const choose = (value: string) => { onChange(value); setOpen(false); setSearch(''); };
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button size="sm" className="max-w-52 gap-2"><span className="text-neutral-500">{label}</span><span className="truncate">{value || 'Any page'}</span><SlidersHorizontal className="h-3 w-3"/></Button></PopoverTrigger><PopoverContent className="w-80 p-2" align="end"><Input aria-label={`Search ${label.toLowerCase()} pages`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search pages…" className="mb-1 h-8 text-xs"/><div className="max-h-72 overflow-y-auto"><button onClick={() => choose('')} className="w-full rounded px-2 py-2 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800">Any page</button>{values.filter(v => v.toLowerCase().includes(search.toLowerCase())).slice(0, 100).map(v => <button key={v} onClick={() => choose(v)} className="block w-full truncate rounded px-2 py-2 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800" title={v}>{v}</button>)}</div></PopoverContent></Popover>;
}
export function JourneysPage() {
  const { propertyId, property, range: rawRange, params } = useWorkspace();
  const range = ['today', '7d', '28d', '30d'].includes(rawRange) ? rawRange : '30d';
  const compare = params.get('compare') !== 'none', grouping = params.get('group') || 'exact';
  const from = params.get('from') || '', to = params.get('to') || '', query = params.get('q') || '';
  const max = [5, 10, 15, 25].includes(Number(params.get('limit'))) ? Number(params.get('limit')) : 15;
  const [pin, setPin] = useState<string[] | null>(null);
  const result = useReport<Journeys>(`/api/journeys/${propertyId}?range=${range}&compare=${compare ? 'previous' : 'none'}`);
  const data = result.data, before = data?.previous;
  const multiple = new Set(data?.rows.map(r => r.host)).size > 1;
  const transform = (rows: Pair[]) => {
    const map = new Map<string, { path: string[]; count: number; percentage: number }>();
    for (const row of rows) {
      const makePath = (p: string) => (multiple ? row.host : '') + (grouping === 'folder' ? sectionOfPage(p) : p);
      const path = [makePath(row.from), makePath(row.to)], key = JSON.stringify(path);
      const existing = map.get(key) || { path, count: 0, percentage: 0 }; existing.count += row.views; map.set(key, existing);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  };
  const all = useMemo(() => transform(data?.rows || []), [data, grouping]);
  const filtered = all.filter(row => (!from || row.path[0] === from) && (!to || row.path[1] === to) && pathContainsPage(row.path, query)).map(row => ({ ...row, percentage: data?.internalViews ? row.count / data.internalViews * 100 : 0 }));
  const shown = filtered.slice(0, max), shownCount = shown.reduce((sum, row) => sum + row.count, 0);
  const previous = new Map(transform(before?.rows || []).map(row => [JSON.stringify(row.path), row.count]));
  const pinned = pin && shown.some(row => JSON.stringify(row.path) === JSON.stringify(pin)) ? pin : null;
  const exportRows = () => { if (data) exportCsv(`journeys_${propertyId}`, [['Referring page', 'Current page', 'Page views', 'Previous page views', 'Share of internal views'], ...filtered.map(row => [...row.path, row.count, previous.get(JSON.stringify(row.path)) ?? '', row.percentage / 100])]); };
  useExport(exportRows);
  const pick = (field: string, value: string) => { setPin(null); updateParams({ [field]: value || null }); };
  return <>
    <StatBand isLoading={result.isLoading} cells={[
      { icon: <Eye className="h-3 w-3"/>, label: 'Internal page views', value: number(data?.internalViews), delta: percentDelta(data?.internalViews, compare ? before?.internalViews : null), sub: data?.totalViews == null ? 'Views with a same-site referrer' : `${percent(data.totalViews ? data.internalViews / data.totalViews : 0)} of ${number(data.totalViews)} page views` },
      { icon: <Files className="h-3 w-3"/>, label: 'Views per session', value: data?.viewsPerSession == null ? '—' : data.viewsPerSession.toFixed(2), delta: percentDelta(data?.viewsPerSession, compare ? before?.viewsPerSession : null), sub: `Across ${number(data?.sessions)} sessions` },
      { icon: <LogIn className="h-3 w-3"/>, label: 'Top referring page', value: data?.topReferrer?.path || '—', sub: `${number(data?.topReferrer?.views)} internal views` },
      { icon: <LogOut className="h-3 w-3"/>, label: 'Top destination page', value: data?.topDestination?.path || '—', sub: `${number(data?.topDestination?.views)} internal views` },
    ]}/>
    <div className="flex flex-wrap gap-3"><Choice label="Compare" value={compare ? 'previous' : 'none'} onChange={v => updateParams({ compare: v })} options={[["previous", 'Previous period'], ['none', 'No comparison']]}/><Choice label="Group pages" value={grouping} onChange={v => { setPin(null); updateParams({ group: v, from: null, to: null }); }} options={[["exact", 'Exact path'], ['folder', 'First folder']]}/></div>
    {data && (data.truncated || Object.values(data.quality).some(Boolean) || data.comparisonUnavailable) && <Notice>{data.truncated ? 'The report contains only the top 10,000 GA4 rows. Totals and shares describe that retrieved subset. ' : ''}{Object.values(data.quality).some(Boolean) ? 'GA4 applied sampling, thresholds or high-cardinality grouping. ' : ''}{data.comparisonUnavailable ? 'The comparison period is unavailable.' : ''}</Notice>}
    <Card><div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3 dark:border-neutral-850"><div><h2 className="text-base font-semibold">Page-to-page journeys</h2><p className="mt-0.5 text-xs text-neutral-500">{data ? `Top ${shown.length} paths cover ${number(shownCount)} of ${number(data.internalViews)} internal views (${percent(data.internalViews ? shownCount / data.internalViews : 0)})` : 'The most common page transitions within your site'}</p></div><div className="flex flex-wrap gap-2"><PagePicker label="From" value={from} onChange={v => pick('from', v)} values={[...new Set(all.map(row => row.path[0]))]}/><PagePicker label="To" value={to} onChange={v => pick('to', v)} values={[...new Set(all.map(row => row.path[1]))]}/><Button size="sm" variant="outline" disabled title="Two-page referrer pairs are available from GA4 Data API">Steps <span>2</span></Button><Choice label="Show" value={String(max)} onChange={v => updateParams({ limit: v })} options={[5, 10, 15, 25].map(n => [String(n), `Top ${n} paths`])}/></div></div>
      {pinned && <div className="flex items-center justify-between gap-3 bg-dataviz/10 px-4 py-2 text-xs"><span className="truncate">{pinned.join(' → ')}</span><Button variant="ghost" size="xs" onClick={() => setPin(null)} aria-label="Clear selected path"><X className="h-3 w-3"/>Clear</Button></div>}
      {result.isLoading ? <LoadingReport rows={10}/> : result.error ? <ReportError error={result.error} retry={() => result.refetch()}/> : !shown.length ? <Empty title={all.length ? 'No matching paths' : 'No internal page transitions'}><p>Try another page, search or date range.</p>{(query || from || to) && <Button size="sm" className="mt-3" onClick={() => updateParams({ q: null, from: null, to: null })}>Clear filters</Button>}</Empty> : <div className="p-4"><SankeyDiagram journeys={shown} steps={2} maxJourneys={max} domain={property?.domain || 'site.local'} exitsKnown={false} pinnedPath={pinned} onPinPath={path => setPin(JSON.stringify(path) === JSON.stringify(pinned) ? null : path)} pageHref={page => `/analytics/pages?prop=${propertyId}&range=${range}&q=${encodeURIComponent(page.replace(/\/\*\*$/, ''))}`} renderStepHeader={({ index, sessions }) => <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-medium">{index ? 'Current page' : 'Referring page'}</span><span className="text-neutral-500">{number(sessions)} views</span></div>}/></div>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 px-4 py-3 text-xs text-neutral-500 dark:border-neutral-850"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-dataviz"/>Internal page views</span><span>Click a flow to pin it · Page names open in Pages</span></div>
    </Card>
    <Card><div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><h2 className="font-semibold">Top paths</h2><p className="mt-0.5 text-xs text-neutral-500">Observed referring page → current page</p></div><SearchBox placeholder="Contains page, e.g. /docs/**" value={query} onChange={v => updateParams({ q: v })}/></div><Table><TableHeader><TableRow><TableHead className="w-10">#</TableHead><TableHead>Path</TableHead><TableHead className="text-right">Views</TableHead>{compare && <TableHead className="text-right">Change</TableHead>}<TableHead className="text-right">Share</TableHead><TableHead className="w-10"/></TableRow></TableHeader><TableBody>{shown.map((row, i) => <TableRow key={JSON.stringify(row.path)} className={JSON.stringify(row.path) === JSON.stringify(pinned) ? 'bg-dataviz/10' : ''}><TableCell className="text-xs text-neutral-500">{i + 1}</TableCell><TableCell className="max-w-0 text-xs"><button className="flex w-full flex-wrap items-center gap-1.5 text-left hover:underline" onClick={() => setPin(row.path)}><span className="break-all">{row.path[0]}</span><ArrowRight className="h-3 w-3 text-neutral-500"/><span className="break-all">{row.path[1]}</span></button></TableCell><TableCell className="text-right text-xs tabular-nums">{number(row.count)}</TableCell>{compare && <TableCell className="text-right"><Delta value={percentDelta(row.count, before ? previous.get(JSON.stringify(row.path)) ?? (before.truncated ? null : 0) : null)}/></TableCell>}<TableCell className="text-right text-xs tabular-nums">{row.percentage.toFixed(1)}%</TableCell><TableCell><Button variant="ghost" size="xs" onClick={() => setPin(row.path)} aria-label={`Pin path ${i + 1}`}><CornerDownRight className="h-3 w-3"/></Button></TableCell></TableRow>)}</TableBody></Table>{!shown.length && !result.isLoading && <Empty title="No paths to display"/>}<div className="px-4 py-3 text-xs text-neutral-500">Showing {shown.length} of {number(filtered.length)} paths · Shares refer to all retrieved internal views</div></Card>
    <Disclosure><p>Counts are page views with a referring URL on the same hostname, including its www variant. Queries and fragments are removed, and same-page transitions are retained.</p><p>Referrers can be absent, outdated, or affected by SPA tracking. These two-page pairs do not establish session starts, exits or complete multi-step journeys. Ordered session paths require a GA4 BigQuery export.</p></Disclosure>
  </>;
}
