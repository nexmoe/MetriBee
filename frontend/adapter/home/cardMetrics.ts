import type { SiteCardsResponse } from "../../rybbit/src/api/analytics/endpoints/siteCards";

const cardIds = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);

export function homeCardQueries(
  siteIds: number[],
  key: (id: number) => readonly unknown[],
  read: (id: number, signal: AbortSignal) => Promise<SiteCardsResponse>
) {
  return cardIds(siteIds).map(id => ({
    queryKey: key(id),
    queryFn: ({ signal }: { signal: AbortSignal }) => read(id, signal),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    meta: { persist: true },
    retry: false,
  }));
}

type CardQueryResult = {
  data?: SiteCardsResponse;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
};

// Publish completed sites independently, so one cold/failed report cannot hide cached cards.
export function mergeCardMetrics(siteIds: number[], queries: CardQueryResult[]) {
  const ids = cardIds(siteIds);
  const metrics: SiteCardsResponse = {};
  queries.forEach((query, index) => {
    if (query.data) Object.assign(metrics, query.data);
    else if (query.isError) metrics[ids[index]] = { error: query.error?.message || "Report unavailable" };
  });
  const isError = queries.length > 0 && queries.every(query => query.isError && query.data === undefined);
  const isFetching = queries.some(query => query.isFetching);
  if (isError) return {
    data: undefined,
    isError: true as const,
    error: queries.find(query => query.error)?.error ?? new Error("Reports unavailable"),
    isFetching,
  };
  return {
    data: Object.keys(metrics).length ? metrics : undefined,
    isError: false as const,
    error: null,
    isFetching,
  };
}

export function sortSitesBySessions<T extends { siteId: number }>(
  sites: T[],
  metrics: SiteCardsResponse | undefined
) {
  const sessions = (site: T) => {
    const metric = metrics?.[site.siteId];
    const value = metric?.current?.sessions;
    return !metric?.error && typeof value === "number" && Number.isFinite(value)
      ? value : null;
  };
  return [...sites].sort((a, b) => {
    const x = sessions(a), y = sessions(b);
    return x === y ? 0 : x == null ? 1 : y == null ? -1 : y - x;
  });
}
