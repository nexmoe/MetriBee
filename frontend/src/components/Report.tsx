import { useState, type ReactNode } from 'react';
import { ArrowDownToLine, ChevronDown, Search, ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ErrorState';
import { number, exportCsv, cn } from '@/lib/utils';
import { Delta } from './site/Delta';
import { percentDelta } from '@/lib/delta';
import type { CardReport } from '@/lib/api';

export function Choice({ label, value, onChange, options, className }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][]; className?: string }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className={cn('h-8 w-auto gap-2 text-xs bg-white dark:bg-neutral-900', className)}><span className="text-neutral-500 dark:text-neutral-400">{label}</span><SelectValue /></SelectTrigger><SelectContent>{options.map(([id, text]) => <SelectItem key={id} value={id}>{text}</SelectItem>)}</SelectContent></Select>;
}
export function SearchBox({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <div className="relative w-full sm:w-64"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-neutral-500"/><Input aria-label={placeholder} className="h-8 pl-8 text-xs" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}/></div>;
}
export function LoadingReport({ rows = 6 }: { rows?: number }) { return <div className="space-y-4 p-4" role="status" aria-label="Loading report">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className={cn('h-4 rounded', i % 3 ? 'w-3/4' : 'w-full')}/>)}</div>; }
export function Empty({ title = 'No data for this period', children }: { title?: string; children?: ReactNode }) { return <div className="flex min-h-48 flex-col items-center justify-center gap-2 p-6 text-center"><div className="text-sm font-medium">{title}</div><div className="max-w-lg text-xs text-neutral-500 dark:text-neutral-400">{children || 'Try another date range or property.'}</div></div>; }
export function ReportError({ error, retry }: { error: Error; retry: () => void }) { return <ErrorState title="Could not load this report" message={error.message} refetch={retry}/>; }
export function Disclosure({ children }: { children: ReactNode }) { return <details className="text-xs text-neutral-500 dark:text-neutral-400"><summary className="cursor-pointer py-2">About this data</summary><div className="max-w-4xl space-y-2 py-2 leading-relaxed">{children}</div></details>; }
export function Notice({ children }: { children: ReactNode }) { return <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">{children}</div>; }
export function ExportButton({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) { return <Button size="sm" variant="ghost" onClick={onClick} disabled={disabled} aria-label="Export CSV" title="Export CSV"><ArrowDownToLine className="h-4 w-4"/></Button>; }
export function Chart({ values, previous, labels = [], height = 220, color = 'hsl(var(--dataviz))', label = 'Trend' }: { values: number[]; previous?: number[]; labels?: string[]; height?: number; color?: string; label?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!values.length) return <Empty/>;
  const w = 1000, h = height, top = 16, bottom = h - 32, left = 46, right = w - 16;
  const max = Math.max(...values, ...(previous || []), 1) * 1.08;
  const x = (i: number) => left + i / Math.max(1, values.length - 1) * (right - left);
  const y = (v: number) => bottom - v / max * (bottom - top);
  const path = (items: number[]) => items.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const active = hover == null ? null : values[hover];
  return <div className="relative w-full" onMouseLeave={() => setHover(null)}>
    {hover != null && <div className="pointer-events-none absolute right-3 top-1 z-10 rounded border border-neutral-100 bg-white px-2 py-1 text-xs shadow-md dark:border-neutral-700 dark:bg-neutral-850">{labels[hover] || `Period ${hover + 1}`} · <b>{number(active)}</b>{previous?.[hover] != null && <span className="ml-2 text-neutral-500">Previous {number(previous[hover])}</span>}</div>}
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={label} onMouseMove={e => { const box = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(values.length - 1, Math.round(((e.clientX - box.left) / box.width * w - left) / (right - left) * (values.length - 1))))); }}>
      {[0, 1, 2, 3].map(t => { const v = t * max / 3; return <g key={t}><line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="hsl(var(--border))" strokeDasharray={t ? '2 4' : undefined}/><text x={left - 10} y={y(v) + 3} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize="10">{number(v)}</text></g>; })}
      <path d={`${path(values)} L${x(values.length - 1)},${bottom} L${left},${bottom}Z`} fill={color} opacity=".10"/>
      {previous?.length ? <path d={path(previous)} fill="none" stroke="hsl(var(--neutral-500))" strokeWidth="1.5" strokeDasharray="4 4"/> : null}
      <path d={path(values)} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"/>
      {hover != null && <line x1={x(hover)} x2={x(hover)} y1={top} y2={bottom} stroke="hsl(var(--neutral-400))" strokeDasharray="3 3"/>}
      {[0, Math.floor((values.length - 1) / 2), values.length - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => <text key={i} x={x(i)} y={h - 8} textAnchor={i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle'} fontSize="10" fill="hsl(var(--muted-foreground))">{labels[i] || ''}</text>)}
    </svg>
  </div>;
}
export function MetricTable({ report, title, loading, error, retry }: { report?: CardReport; title: string; loading?: boolean; error?: Error | null; retry: () => void }) {
  const [query, setQuery] = useState(''), [desc, setDesc] = useState(true);
  const rows = (report?.rows || []).filter(r => r.dims.join(' ').toLowerCase().includes(query.toLowerCase())).sort((a, b) => (desc ? -1 : 1) * (a.metrics[0] - b.metrics[0]));
  const total = report?.totals?.[0] || rows.reduce((s, r) => s + r.metrics[0], 0);
  return <>
    <div className="flex items-center justify-between gap-3 px-4 pb-3"><span className="text-xs text-neutral-500">{title}</span><ExportButton disabled={!rows.length} onClick={() => exportCsv(title, [['Name', ...(report?.metricHeaders || [])], ...rows.map(r => [r.dims.join(' / '), ...r.metrics])])}/></div>
    {loading ? <LoadingReport/> : error ? <ReportError error={error} retry={retry}/> : !rows.length && !query ? <Empty/> : <>
      <div className="px-4 pb-2"><Input className="h-7 text-xs" aria-label={`Search ${title}`} placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)}/></div>
      <div className="max-h-80 overflow-auto px-4"><table className="w-full text-xs"><thead className="sticky top-0 bg-white text-neutral-500 dark:bg-neutral-900"><tr><th className="py-2 text-left font-normal">Name</th><th className="py-2 text-right font-normal"><button className="inline-flex items-center gap-1" onClick={() => setDesc(!desc)}>{report?.metricHeaders?.[0] === 'screenPageViews' ? 'Views' : report?.metricHeaders?.[0] === 'eventCount' ? 'Events' : 'Sessions'}<ArrowUpDown className="h-3 w-3"/></button></th><th className="pl-4 text-right font-normal">Change</th></tr></thead><tbody>{rows.map((row, i) => <tr key={JSON.stringify(row.dims)} className="group border-b border-neutral-50 last:border-0 dark:border-neutral-850"><td className="relative max-w-0 py-2.5 pr-3"><span className="absolute inset-y-1 left-0 rounded-sm bg-dataviz/10" style={{ width: `${total ? row.metrics[0] / total * 100 : 0}%` }}/><span className="relative block truncate" title={row.dims.join(' / ')}>{row.dims.filter((d, j) => !(report?.dimensionHeaders?.[j] === 'countryId')).join(' / ') || '(not set)'}</span></td><td className="relative py-2.5 text-right tabular-nums">{number(row.metrics[0])}</td><td className="pl-4 text-right"><Delta value={percentDelta(row.metrics[0], row.prev?.[0])}/></td></tr>)}</tbody></table></div>
    </>}
  </>;
}
