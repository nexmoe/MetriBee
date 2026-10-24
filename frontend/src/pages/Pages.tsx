import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ArrowUpDown, Files, Eye, Clock, MousePointerClick, Folder, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/basic-tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { StatBand } from '@/components/site/StatBand';
import { Delta } from '@/components/site/Delta';
import { Choice, SearchBox, Chart, LoadingReport, ReportError, Empty, Notice, Disclosure } from '@/components/Report';
import { useWorkspace, useReport, type Property } from '@/lib/api';
import { updateParams } from '@/lib/router';
import { useExport } from '@/lib/export';
import { exportCsv, number, duration, percent, dateLabel } from '@/lib/utils';
import { percentDelta, pointDelta } from '@/lib/delta';

interface Summary { views: number; sessions: number; users: number; pages: number | null; bounce: number; avgEngagement: number; viewsPerSession: number; }
interface PageRow { path: string; title: string; views: number; sessions: number | null; users: number | null; engagement: number; avgEngagement: number; bounce: number | null; entries: number | null; previousViews: number | null; previousSessions: number | null; series: number[] | null; children?: PageRow[]; }
interface PagesReport { summary: Summary; previousSummary: Summary | null; rows: PageRow[]; previousRows: { path: string; views: number; sessions: number }[] | null; warnings: string[]; truncated: boolean; previousTruncated: boolean; trendLimit: number; current: { startDate: string; endDate: string }; previous: { startDate: string; endDate: string }; timeZone: string; days: number; fetchedAt: number; }
interface SectionReport { summary: Summary; previousSummary: Summary | null; series: number[]; }
const sectionOf = (path: string) => { const parts = path.split('?')[0].split('/').filter(Boolean); return path.startsWith('/') && !path.startsWith('//') && (parts.length > 1 || path.endsWith('/') && parts.length) ? `/${parts[0]}/` : null; };
function groupPages(rows: PageRow[], previous: PagesReport['previousRows'], entry: boolean): PageRow[] {
  const groups = new Map<string, PageRow[]>(), result: PageRow[] = [];
  rows.forEach(row => { const section = sectionOf(row.path); if (section) groups.set(section, [...(groups.get(section) || []), row]); else result.push(row); });
  for (const [path, children] of groups) {
    if (children.length === 1) { result.push(children[0]); continue; }
    const views = children.reduce((sum, row) => sum + row.views, 0), engagement = children.reduce((sum, row) => sum + row.engagement, 0);
    const old = previous?.filter(row => sectionOf(row.path) === path);
    result.push({ path, title: '', children, views, engagement, avgEngagement: views ? engagement / views : 0,
      sessions: entry ? children.reduce((sum, row) => sum + (row.sessions || 0), 0) : null, users: null, bounce: null,
      entries: children.every(r => r.entries != null) ? children.reduce((sum, r) => sum + r.entries!, 0) : null,
      previousViews: old ? old.reduce((sum, r) => sum + r.views, 0) : null, previousSessions: entry && old ? old.reduce((sum, r) => sum + r.sessions, 0) : null,
      series: children.every(r => r.series) ? children[0].series!.map((_, i) => children.reduce((sum, r) => sum + r.series![i], 0)) : null,
    });
  }
  return result;
}
function Spark({ values }: { values: number[] | null }) {
  if (!values || values.length < 2) return <span className="text-neutral-400">—</span>;
  const max = Math.max(...values, 1);
  return <svg viewBox="0 0 90 24" className="h-6 w-20" role="img" aria-label="Page views trend"><path d={values.map((v, i) => `${i ? 'L' : 'M'}${i / (values.length - 1) * 88 + 1},${23 - v / max * 22}`).join(' ')} stroke="hsl(var(--dataviz))" strokeWidth="1.5" fill="none"/></svg>;
}
function PageRows({ row, propertyId, period, entry, compare, denominator, depth = 0, inspect }: { row: PageRow; propertyId: string; period: string; entry: boolean; compare: boolean; denominator: number; depth?: number; inspect: (row: PageRow) => void }) {
  const [open, setOpen] = useState(false);
  const section = useReport<SectionReport>(row.children && open ? `/api/pages-section/${propertyId}?${period}&view=${entry ? 'entry' : 'all'}&section=${encodeURIComponent(row.path)}` : null);
  const summary = section.data?.summary;
  const views = entry ? row.entries : row.views, previous = entry ? row.previousSessions : row.previousViews;
  return <>
    <TableRow>
      <TableCell className="max-w-0 text-xs"><div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 20 }}>{row.children ? <button className="flex min-w-0 items-center gap-1.5" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${row.path}`}>{open ? <ChevronDown className="h-3.5 w-3.5 text-neutral-500"/> : <ChevronRight className="h-3.5 w-3.5 text-neutral-500"/>}<Folder className="h-3.5 w-3.5 text-neutral-500"/><span className="truncate">{row.path}</span><span className="ml-1 text-[10px] text-neutral-400">{row.children.length}</span></button> : <button className="truncate text-left hover:underline" title={row.title ? `${row.path}\n${row.title}` : row.path} onClick={() => inspect(row)}>{row.path}</button>}</div></TableCell>
      <TableCell className="text-right text-xs tabular-nums">{number(views)}</TableCell>
      {compare && <TableCell className="text-right"><Delta value={percentDelta(views, previous)}/></TableCell>}
      <TableCell className="text-right text-xs tabular-nums">{number(summary?.sessions ?? row.sessions)}</TableCell>
      <TableCell className="text-right text-xs tabular-nums">{number(summary?.users ?? row.users)}</TableCell>
      <TableCell className="text-right text-xs tabular-nums">{duration(row.avgEngagement)}</TableCell>
      <TableCell className="text-right text-xs tabular-nums">{percent(summary?.bounce ?? row.bounce)}</TableCell>
      <TableCell><button onClick={() => inspect({ ...row, series: section.data?.series || row.series })} aria-label={`View trend for ${row.path}`}><Spark values={section.data?.series || row.series}/></button></TableCell>
      <TableCell className="text-right text-xs tabular-nums">{percent(denominator && views != null ? views / denominator : 0)}</TableCell>
    </TableRow>
    {open && row.children?.map(child => <PageRows key={child.path} row={child} propertyId={propertyId} period={period} entry={entry} compare={compare} denominator={denominator} depth={depth + 1} inspect={inspect}/>)}
    {open && section.error && <TableRow><TableCell colSpan={9} className="text-xs text-amber-700 dark:text-amber-400">Directory totals could not load. Page-level figures are still available.</TableCell></TableRow>}
  </>;
}
export function PagesPage() {
  const { propertyId, property, range, params } = useWorkspace();
  const entry = params.get('view') === 'entry', grouped = params.get('breakdown') !== 'page', compare = params.get('compare') !== 'none', query = params.get('q') || '';
  const period = params.has('start') && params.has('end') ? new URLSearchParams({ start: params.get('start')!, end: params.get('end')! }).toString() : `range=${range}`;
  const result = useReport<PagesReport>(`/api/pages-report/${propertyId}?${period}&view=${entry ? 'entry' : 'all'}`);
  const d = result.data, s = d?.summary, before = compare ? d?.previousSummary : null;
  const [sort, setSort] = useState('views'), [direction, setDirection] = useState(-1), [page, setPage] = useState(0), [selected, setSelected] = useState<PageRow | null>(null);
  const filtered = useMemo(() => (d?.rows || []).filter(row => (row.path + ' ' + row.title).toLowerCase().includes(query.toLowerCase())), [d, query]);
  const rows = (grouped ? groupPages(filtered, d?.previousRows || null, entry) : filtered).sort((a, b) => sort === 'path' ? direction * a.path.localeCompare(b.path) : direction * ((a[sort as keyof PageRow] as number || 0) - (b[sort as keyof PageRow] as number || 0)));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 25) - 1));
  const visible = rows.slice(currentPage * 25, (currentPage + 1) * 25);
  const sortBy = (key: string) => { if (key === sort) setDirection(-direction); else { setSort(key); setDirection(-1); } setPage(0); };
  useExport(() => exportCsv(`pages_${propertyId}`, [['Page', 'Page views', 'Sessions', 'Users', 'Entries', 'Average engagement per view (seconds)', 'Bounce rate'], ...filtered.map(r => [r.path, r.views, r.sessions, r.users, r.entries, r.avgEngagement, r.bounce])]));
  const headings: [string, string][] = [['path', 'Page'], [entry ? 'entries' : 'views', entry ? 'Entries' : 'Views'], ...(compare ? [['previousViews', 'Change']] as [string, string][] : []), ['sessions', 'Sessions'], ['users', 'Users'], ['avgEngagement', 'Avg. engagement'], ['bounce', 'Bounce rate'], ['series', 'Trend'], ['share', 'Share']];
  return <>
    <StatBand isLoading={result.isLoading} cells={[
      { icon: <Eye className="h-3 w-3"/>, label: entry ? 'Entry sessions' : 'Page views', value: number(entry ? s?.sessions : s?.views), delta: percentDelta(entry ? s?.sessions : s?.views, entry ? before?.sessions : before?.views), sub: 'Across all reported pages' },
      { icon: <Files className="h-3 w-3"/>, label: 'Unique pages', value: number(s?.pages), sub: d?.truncated ? 'Page list is limited' : 'Distinct page paths' },
      { icon: <MousePointerClick className="h-3 w-3"/>, label: 'Views per session', value: s?.viewsPerSession.toFixed(2) || '—', delta: percentDelta(s?.viewsPerSession, before?.viewsPerSession), sub: `${number(s?.sessions)} sessions` },
      { icon: <Clock className="h-3 w-3"/>, label: 'Avg. engagement / view', value: duration(s?.avgEngagement), delta: percentDelta(s?.avgEngagement, before?.avgEngagement), sub: 'GA4 engaged time ÷ views' },
    ]}/>
    <div className="flex flex-wrap gap-3"><Choice label="Compare" value={compare ? 'previous' : 'none'} onChange={v => updateParams({ compare: v })} options={[["previous", 'Previous period'], ['none', 'No comparison']]}/><Choice label="Group pages" value={grouped ? 'section' : 'page'} onChange={v => updateParams({ breakdown: v })} options={[["section", 'Directory'], ['page', 'Exact path']]}/>{d && <span className="ml-auto self-center text-xs text-neutral-500">{dateLabel(d.current.startDate)} – {dateLabel(d.current.endDate)} · {d.timeZone}</span>}</div>
    {d?.warnings.length ? <Notice>{d.warnings.join(' ')}</Notice> : null}
    <Card><div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-2"><Tabs value={entry ? 'entry' : 'all'} onValueChange={v => { setPage(0); updateParams({ view: v }); }}><TabsList><TabsTrigger value="all">All pages</TabsTrigger><TabsTrigger value="entry">Entry pages</TabsTrigger></TabsList></Tabs><SearchBox placeholder="Search pages…" value={query} onChange={v => { setPage(0); updateParams({ q: v }); }}/></div>
      {result.isLoading ? <LoadingReport rows={12}/> : result.error ? <ReportError error={result.error} retry={() => result.refetch()}/> : !rows.length ? <Empty title="No matching pages"/> : <>
        <Table><TableHeader><TableRow>{headings.map(([key, label], i) => <TableHead key={key} className={i ? 'whitespace-nowrap text-right text-xs' : 'w-full min-w-52 text-xs'}><button onClick={() => !['series', 'share', 'previousViews'].includes(key) && sortBy(key)} className="inline-flex items-center gap-1">{label}{!['series', 'share', 'previousViews'].includes(key) && <ArrowUpDown className="h-3 w-3"/>}</button></TableHead>)}</TableRow></TableHeader><TableBody>{visible.map(row => <PageRows key={propertyId + row.path + period + entry} row={row} propertyId={propertyId} period={period} entry={entry} compare={compare} denominator={(entry ? s?.sessions : s?.views) || 0} inspect={setSelected}/>)}</TableBody></Table>
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-neutral-500"><span>{number(currentPage * 25 + 1)}–{number(Math.min((currentPage + 1) * 25, rows.length))} of {number(rows.length)} {grouped ? 'pages & directories' : 'pages'}</span><div className="flex gap-2"><Button size="xs" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</Button><Button size="xs" disabled={(currentPage + 1) * 25 >= rows.length} onClick={() => setPage(currentPage + 1)}>Next</Button></div></div>
      </>}
    </Card>
    <Disclosure><p>Page views, sessions and users use GA4's definitions. Average engagement is recorded engagement time divided by views; bounce rate is the GA4 share of sessions that were not engaged. Exit pages and exit rates require raw event data.</p><p>Sessions and users are not added across a directory's children. Expanding a directory loads distinct totals from GA4. Queries are excluded from page paths. Trends cover the report's top {d?.trendLimit || 100} pages.</p></Disclosure>
    <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle className="break-all">{selected?.path}</DialogTitle><DialogDescription>{selected?.title || 'Page traffic for the selected period'}</DialogDescription></DialogHeader>{selected && <><div className="grid grid-cols-3 gap-4 rounded border border-neutral-100 p-3 text-xs dark:border-neutral-800"><div><span className="text-neutral-500">Views</span><p className="mt-1 text-base font-semibold">{number(selected.views)}</p></div><div><span className="text-neutral-500">Sessions</span><p className="mt-1 text-base font-semibold">{number(selected.sessions)}</p></div><div><span className="text-neutral-500">Avg. engagement</span><p className="mt-1 text-base font-semibold">{duration(selected.avgEngagement)}</p></div></div>{selected.series ? <Chart label={`Traffic for ${selected.path}`} values={selected.series}/> : <Empty title="Trend unavailable">Daily trends are provided for the top pages in this report.</Empty>}{!selected.children && selected.path.startsWith('/') && !selected.path.startsWith('//') && property?.domain && <Button size="sm" variant="outline" asChild><a href={new URL(selected.path, `https://${property.domain}`).href} target="_blank" rel="noopener noreferrer">Open page<ExternalLink className="h-3 w-3"/></a></Button>}</>}</DialogContent></Dialog>
  </>;
}
