import { Filter } from "@rybbit/shared";
import { Time } from "../../../components/DateSelector/types";
import { JOURNEY_PAGE_FILTERS } from "../../../lib/filterGroups";
import { useStore } from "../../../lib/store";
import {
  GetSessionsResponse,
  JourneyGrouping,
  JourneysResponse,
  JourneySummary,
  MetricResponse,
} from "../endpoints";
import { useAnalyticsQuery } from "../useAnalyticsQuery";

type PeriodTime = "current" | "previous";

/** The options that decide which sessions become which journey. */
export interface JourneyShape {
  steps?: number;
  stepFilters?: Record<number, string>;
  /** Path pattern the journeys must reach; they are cut at the first visit to it. */
  endsAt?: string;
  groupBy?: JourneyGrouping;
}

export interface JourneyParams extends JourneyShape {
  siteId?: number;
  timeZone?: string;
  /** Left out, the store's period is used. */
  time?: Time;
  /** "previous" asks for the comparison period instead (and runs only while one is set). */
  periodTime?: PeriodTime;
  limit?: number;
  /** Adds each journey's count of sessions that completed this goal. */
  goalId?: number;
  // Merged with the store filters (e.g. scoping journeys to a single user)
  additionalFilters?: Filter[];
  enabled?: boolean;
}

/**
 * The store's filters narrowed to the ones the journeys endpoints honour. An
 * empty subset has to switch filters off: `customFilters` falls back to the
 * store's full list when it is empty.
 */
function useJourneyFilters(additionalFilters?: Filter[]) {
  const filters = useStore(state => state.filters);
  const pageFilters = filters.filter(filter => JOURNEY_PAGE_FILTERS.includes(filter.parameter));
  const customFilters = additionalFilters?.length ? [...pageFilters, ...additionalFilters] : pageFilters;
  return { useFilters: customFilters.length > 0, customFilters };
}

const journeyShapeParams = ({ steps = 3, stepFilters, endsAt, groupBy }: JourneyShape) => ({
  steps,
  stepFilters: stepFilters && Object.keys(stepFilters).length > 0 ? JSON.stringify(stepFilters) : undefined,
  endsAt: endsAt || undefined,
  groupBy: groupBy && groupBy !== "path" ? groupBy : undefined,
});

export const useJourneys = ({
  siteId,
  time,
  periodTime,
  limit = 100,
  goalId,
  additionalFilters,
  enabled = true,
  ...shape
}: JourneyParams) => {
  return useAnalyticsQuery<JourneysResponse>({
    key: "journeys",
    path: "journeys",
    unwrap: false,
    site: siteId,
    overrideTime: time,
    periodTime,
    ...useJourneyFilters(additionalFilters),
    params: { mode: "sessions", ...journeyShapeParams(shape), limit, goalId },
    enabled: enabled && siteId !== undefined,
  });
};

/** Page-level figures for the journeys page: multi-page sessions, path length, top exit, goal reach. */
export const useJourneySummary = ({
  goalId,
  periodTime,
  enabled = true,
}: {
  goalId?: number;
  periodTime?: PeriodTime;
  enabled?: boolean;
}) => {
  return useAnalyticsQuery<JourneySummary>({
    key: "journey-summary",
    path: "journeys/summary",
    periodTime,
    ...useJourneyFilters(),
    params: { mode: "sessions", goalId },
    enabled,
  });
};

/** The sessions counted in one journeys row. `shape` must be the one the row was fetched with. */
export const useJourneySessions = ({
  path,
  replaysOnly = false,
  offset = 0,
  limit = 25,
  enabled = true,
  ...shape
}: JourneyShape & {
  path: string[];
  replaysOnly?: boolean;
  /** Rows to skip. */
  offset?: number;
  limit?: number;
  enabled?: boolean;
}) => {
  return useAnalyticsQuery<GetSessionsResponse>({
    key: "journey-sessions",
    path: "journeys/sessions",
    // Another path's sessions must never stand in while this path's load.
    placeholder: false,
    ...useJourneyFilters(),
    params: {
      mode: "sessions",
      ...journeyShapeParams(shape),
      path: JSON.stringify(path),
      replays_only: replaysOnly ? "true" : undefined,
      offset,
      limit,
    },
    enabled: enabled && path.length > 0,
  });
};

/** Use the same ordered-session population as the paths, never GA4 aggregates. */
export const useJourneyContext = (enabled = true) => {
  const context = useAnalyticsQuery<{ sessions: number; topEntry: MetricResponse | null }>({
    key: "journey-context",
    path: "journeys/context",
    ...useJourneyFilters(),
    params: { mode: "sessions" },
    enabled,
  });

  return {
    sessions: context.data?.sessions,
    topEntry: context.data?.topEntry,
    isLoading: context.isLoading,
  };
};
