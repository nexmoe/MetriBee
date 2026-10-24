export type RetentionMode = "day" | "week";

export interface RetentionCell {
  /** Periods since the cohort's first visit. 0 is the cohort's own period. */
  offset: number;
  users: number;
  /** Share of the cohort, 0 to 100. */
  pct: number;
  /** The period this cell covers is not over inside the window, so the figure is not final. */
  partial: boolean;
}

export interface RetentionCohortRow {
  /** The cohort period's first day, YYYY-MM-DD. */
  key: string;
  index: number;
  size: number;
  /** Indexed by offset. Later cohorts have fewer: nothing past the window's end is observable. */
  cells: RetentionCell[];
  /** The cohort's own period is not over, so its new users are still arriving. */
  open: boolean;
  /** The window starts after this period began, so the cohort misses the period's first days. */
  clipped: boolean;
}

export interface RetentionAverage {
  users: number;
  size: number;
  pct: number;
}

export interface RetentionModel {
  mode: RetentionMode;
  cohorts: RetentionCohortRow[];
  /** The highest offset a cohort can show: one less than the number of periods. */
  maxOffset: number;
  /** Indexed by offset, weighted by cohort size over finished cells. Null when no cohort has finished that period. */
  average: (RetentionAverage | null)[];
  totalNew: number;
  /** Mean size of the cohorts whose period lies wholly inside the window. */
  averageSize: number | null;
  /** Highest period-1 retention among cohorts of a meaningful size. */
  best: RetentionCohortRow | null;
  /** Ceiling shared by the heat scale and the curve's y axis, in percent. */
  scaleMax: number;
  /** Step between y-axis ticks, in percent. */
  scaleStep: number;
}

const SCALE_STEPS = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25];

/** The smallest "nice" ceiling with at most five ticks above zero. */
export function niceScale(dataMax: number): { max: number; step: number } {
  if (!(dataMax > 0)) return { max: 1, step: 0.25 };
  for (const step of SCALE_STEPS) {
    const ticks = Math.ceil(dataMax / step - 1e-9);
    if (ticks <= 5) return { max: Math.min(100, ticks * step), step };
  }
  return { max: 100, step: 25 };
}

export const HEAT_STEPS = [0.06, 0.12, 0.2, 0.3, 0.44, 0.64, 0.8, 0.96] as const;
export const HEAT_DARK_TEXT_FROM = 5;

export function heatStep(pct: number, scaleMax: number): number {
  const position = Math.max(0, Math.min(0.9999, scaleMax > 0 ? pct / scaleMax : 0));
  return Math.floor(position * HEAT_STEPS.length);
}

export const heatColor = (step: number) => `hsl(var(--dataviz) / ${HEAT_STEPS[step]})`;

export const formatPercent = (pct: number) => `${pct.toFixed(1)}%`;

export interface PeriodProgress {
  /** Days of the last period the window has reached, counting the current one. */
  elapsedDays: number;
  totalDays: number;
  /** The first day after the last period, YYYY-MM-DD: when the next return period begins. */
  nextPeriod: string;
}


const STAT_OFFSETS: Record<RetentionMode, readonly (readonly [number, number, number])[]> = {
  day: [
    [1, 7, 30],
    [1, 7, 14],
    [1, 3, 7],
    [1, 2, 3],
  ],
  week: [
    [1, 4, 8],
    [1, 2, 4],
    [1, 2, 3],
  ],
};

/** The periods the stat band reports on: the longest set whose last period some cohort has finished. */
export function statOffsets(mode: RetentionMode, model: RetentionModel | null): readonly [number, number, number] {
  const sets = STAT_OFFSETS[mode];
  return (model && sets.find(set => model.average[set[2]])) || sets[model ? sets.length - 1 : 0];
}

