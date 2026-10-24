import { useMemo, useState, type CSSProperties } from 'react';
import { Users, Repeat2, TrendingUp, CalendarDays } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatBand } from '@/components/site/StatBand';
import { RetentionGrid, HeatLegend, HatchSwatch, type CellTarget, type HoverTarget } from '@/components/retention/RetentionGrid';
import { RetentionChart, RetentionReadout } from '@/components/retention/RetentionChart';
import { niceScale, statOffsets, type RetentionModel, type RetentionAverage, type PeriodProgress } from '@/components/retention/retentionModel';
import { Choice, LoadingReport, ReportError, Empty, Notice, Disclosure } from '@/components/Report';
import { useReport, useWorkspace } from '@/lib/api';
import { useExport } from '@/lib/export';
import { updateParams } from '@/lib/router';
import { number, percent, dateLabel, exportCsv } from '@/lib/utils';
import { percentDelta, pointDelta } from '@/lib/delta';

interface Summary { totalUsers: number; averageSize: number | null; bestCohort: string | null; cells: { offset: number; users: number; size: number; rate: number | null; cohorts: number }[]; }
interface Cohort { name: string; periodStart: string; periodEnd: string; startDate: string; endDate: string; size: number; partial: boolean; cells: { offset: number; users: number | null; rate: number | null; status: 'future' | 'partial' | 'complete'; startDate: string; endDate: string }[]; }
interface RetentionReport { cohorts: Cohort[]; summary: Summary; previous: { summary: Summary; startDate: string; endDate: string }; range: string; bucket: 'day' | 'week'; startDate: string; endDate: string; today: string; periods: number; days: number; timeZone: string; thresholded: boolean; sampled: boolean; }
function averages(summary: Summary): (RetentionAverage | null)[] { return [null, ...summary.cells.map(cell => cell.rate == null ? null : { users: cell.users, size: cell.size, pct: cell.rate * 100 })]; }
function toModel(data: RetentionReport): RetentionModel {
  const cohorts = data.cohorts.map((c, index) => ({ key: c.periodStart, index, size: c.size,
    open: c.periodEnd >= data.today,
    clipped: c.startDate !== c.periodStart || c.endDate !== c.periodEnd && c.endDate < data.today,
    cells: [{ offset: 0, users: c.size, pct: c.size ? 100 : 0, partial: c.partial }, ...c.cells.filter(cell => cell.status !== 'future' && cell.users != null).map(cell => ({ offset: cell.offset, users: cell.users!, pct: (cell.rate || 0) * 100, partial: cell.status === 'partial' }))],
  }));
  const average = averages(data.summary);
  const values = [...average.flatMap(c => c ? [c.pct] : []), ...cohorts.flatMap(c => c.cells.filter(cell => cell.offset >= 1).map(cell => cell.pct))];
  const scale = niceScale(Math.max(...values, 0));
  return { mode: data.bucket, cohorts, maxOffset: data.periods, average, totalNew: data.summary.totalUsers, averageSize: data.summary.averageSize, best: cohorts.find(c => data.cohorts[c.index].name === data.summary.bestCohort) || null, scaleMax: scale.max, scaleStep: scale.step };
}
export function RetentionPage() {
  const { propertyId, range: rawRange, params } = useWorkspace();
  const range = ['7d', '30d', '90d'].includes(rawRange) ? rawRange : '30d', bucket = params.get('bucket') === 'day' ? 'day' : 'week';
  const compare = params.get('compare') !== 'none', unit = params.get('stat') === 'users' ? 'users' : 'percent';
  const result = useReport<RetentionReport>(`/api/retention/${propertyId}?range=${range}&bucket=${bucket}${params.get('end') ? '&end=' + encodeURIComponent(params.get('end')!) : ''}`);
  const data = result.data;
  const model = useMemo(() => data ? toModel(data) : null, [data]);
  const [pinned, setPinned] = useState<string | null>(null), [hover, setHover] = useState<HoverTarget | null>(null), [selected, setSelected] = useState<CellTarget | null>(null), [offset, setOffset] = useState<number | null>(null);
  const activeKey = selected?.cohort || hover?.cohort || pinned;
  const active = model?.cohorts.find(c => c.key === activeKey) || null;
  const activeOffset = selected?.offset || hover?.offset || offset || 1;
  const previous = compare && data ? averages(data.previous.summary) : null;
  const periodLabel = (n: number) => `${bucket === 'week' ? 'Week' : 'Day'} ${n}`;
  const label = (key: string) => { const cohort = data?.cohorts.find(c => c.periodStart === key); return !cohort || cohort.startDate === cohort.endDate ? dateLabel(key) : `${dateLabel(cohort.startDate)} – ${dateLabel(cohort.endDate)}`; };
  const last = data?.cohorts.at(-1);
  const progress: PeriodProgress | null = last && data && data.endDate === data.today && last.periodEnd >= data.today ? {
    elapsedDays: Math.floor((Date.parse(data.today) - Date.parse(last.periodStart)) / 86400000) + 1,
    totalDays: bucket === 'week' ? 7 : 1,
    nextPeriod: new Date(Date.parse(last.periodEnd) + 86400000).toISOString().slice(0, 10),
  } : null;
  const offsets = statOffsets(bucket, model);
  useExport(() => { if (data) exportCsv(`retention_${propertyId}`, [['Cohort start', 'Cohort end', 'New users', 'Return period', 'Users', 'Retention', 'Status'], ...data.cohorts.flatMap(c => c.cells.map(cell => [c.startDate, c.endDate, c.size, cell.offset, cell.users, cell.rate, cell.status]))]); });
  const reset = () => { setPinned(null); setSelected(null); setHover(null); setOffset(null); };
  const readout = model ? <RetentionReadout model={model} previousAverage={previous} activeCohort={active} activeCohortLabel={active ? label(active.key) : null} activeOffset={activeOffset} periodLabel={periodLabel}/> : null;
  return <>
    <StatBand isLoading={result.isLoading} columns={4} cells={[
      { icon: <Users className="h-3 w-3"/>, label: 'New users', value: number(data?.summary.totalUsers), delta: percentDelta(data?.summary.totalUsers, compare ? data?.previous.summary.totalUsers : null), sub: 'Grouped by first visit' },
      ...offsets.map(n => ({ icon: <Repeat2 className="h-3 w-3"/>, label: `${periodLabel(n)} retention`, value: percent(data?.summary.cells[n - 1]?.rate), delta: pointDelta(data?.summary.cells[n - 1]?.rate == null ? null : data.summary.cells[n - 1].rate! * 100, !compare || data?.previous.summary.cells[n - 1]?.rate == null ? null : data.previous.summary.cells[n - 1].rate! * 100), sub: 'Weighted, complete periods only' })),
    ]}/>
    <div className="flex flex-wrap items-center justify-between gap-3"><Choice label="Compare" value={compare ? 'previous' : 'none'} onChange={v => updateParams({ compare: v })} options={[["previous", 'Previous period'], ['none', 'No comparison']]}/><span className="text-xs text-neutral-500">{data ? `${dateLabel(data.startDate)} – ${dateLabel(data.endDate)} · ${data.timeZone}` : ''}</span></div>
    {(data?.thresholded || data?.sampled) && <Notice>GA4 applied reporting thresholds or sampling to these cohorts.</Notice>}
    <Card><div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-3 pt-4"><div><h2 className="text-base font-semibold">Retention by cohort</h2><p className="mt-1 text-xs text-neutral-500">How many new users return in the {bucket}s after their first visit</p></div><div className="flex flex-wrap items-center gap-2"><Tabs value={bucket} onValueChange={value => { reset(); updateParams({ bucket: value }); }}><TabsList className="h-8"><TabsTrigger value="day" className="text-xs">Daily</TabsTrigger><TabsTrigger value="week" className="text-xs">Weekly</TabsTrigger></TabsList></Tabs><Tabs value={unit} onValueChange={value => updateParams({ stat: value })}><TabsList className="h-8"><TabsTrigger value="percent" className="text-xs">Percent</TabsTrigger><TabsTrigger value="users" className="text-xs">Users</TabsTrigger></TabsList></Tabs></div></div>
      {result.isLoading ? <LoadingReport rows={12}/> : result.error ? <ReportError error={result.error} retry={() => result.refetch()}/> : !model || !data || !model.totalNew ? <Empty title="No first-visit cohorts in this period"/> : <>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-2 text-xs text-neutral-500"><span>Average cohort size <b className="ml-1 font-medium text-neutral-800 dark:text-neutral-200">{number(data.summary.averageSize)}</b>{model.best && <span className="ml-4">Best {periodLabel(1)} <b className="ml-1 font-medium text-neutral-800 dark:text-neutral-200">{label(model.best.key)}</b></span>}</span><HeatLegend scaleMax={model.scaleMax}/></div>
        <div className="px-4 md:hidden">{readout}</div>
        <div className="overflow-x-auto px-4 pb-4"><div style={{ '--retention-cols': `minmax(140px,1.5fr) 90px repeat(${model.maxOffset},minmax(58px,1fr))`, minWidth: Math.max(650, model.maxOffset * 58 + 230) } as CSSProperties}>
          <RetentionChart model={model} previousAverage={previous} activeCohort={active} activeCohortLabel={active ? label(active.key) : null} activeOffset={activeOffset} onHoverOffset={setOffset} readout={readout} columnsClassName="grid-cols-[var(--retention-cols)]"/>
          <RetentionGrid model={model} unit={unit} activeCohortKey={active?.key || null} bandOffset={selected?.offset || hover?.offset || offset} selected={selected} onHover={setHover} onSelect={setSelected} onPinCohort={key => setPinned(pinned === key ? null : key)} cohortLabel={label} periodLabel={periodLabel} formatDay={dateLabel} progress={progress} inProgress={data.endDate === data.today} columnsClassName="grid-cols-[var(--retention-cols)]"/>
        </div></div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 px-4 py-3 text-xs text-neutral-500 dark:border-neutral-850"><span className="flex items-center gap-2"><HatchSwatch/>In-progress periods are excluded from the average</span>{(pinned || selected) && <Button size="xs" variant="ghost" onClick={reset}>Clear selection</Button>}</div>
      </>}
    </Card>
    <Disclosure><p>Cohorts use GA4's native firstSessionDate reports. A person may return in any later period; return activity does not have to be consecutive. The average is weighted by the size of cohorts that have completed that period.</p><p>Weekly cohorts follow Sunday–Saturday in the property time zone. Partial and future periods remain distinct from zero returns. Historical incomplete weeks are omitted when GA4 cannot provide a reliable as-of cutoff.</p></Disclosure>
  </>;
}
