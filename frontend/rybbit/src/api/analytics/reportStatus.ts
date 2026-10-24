import type { QueryClient, QueryKey } from "@tanstack/react-query";

export type ReportStatus = {
  fetchedAt: string | null;
  cacheStatus: "fresh" | "cached" | "mixed";
  revalidating?: boolean;
  revalidateUntil?: number;
};

type ReportObservations = Record<string, ReportStatus>;
const statusKey = (queryKey: QueryKey) => ["ga4-report-status", queryKey] as const;
const initialized = new WeakSet<QueryClient>();
const revalidating = (status: ReportStatus) => status.revalidating && (status.revalidateUntil || 0) > Date.now();

// Recheck a stale server response without issuing more GA4 calls. The server
// deduplicates refreshes; its deadline bounds polling even if Google stalls.
export function reportRevalidationInterval(client: QueryClient, queryKey: QueryKey, interval?: number) {
  return (query: { state: { status: string } }) => {
    const observations = client.getQueryData<ReportObservations>(statusKey(queryKey));
    return query.state.status !== "error" && observations && Object.values(observations).some(revalidating)
      ? 2000 : interval ?? false;
  };
}

// Keep response metadata beside the query, preserving the native data shapes used by every panel.
export function recordReportStatus(client: QueryClient, queryKey: QueryKey, status: ReportStatus, page = "single") {
  if (!initialized.has(client)) {
    initialized.add(client);
    // Metadata lives exactly as long as its report, including reports left open beyond five minutes.
    client.setQueryDefaults(["ga4-report-status"], { gcTime: Infinity });
    client.getQueryCache().subscribe(event => {
      if (event.type === "removed" && event.query.queryKey[0] !== "ga4-report-status") {
        client.removeQueries({ queryKey: statusKey(event.query.queryKey), exact: true });
      }
    });
  }
  client.setQueryData<ReportObservations>(statusKey(queryKey), previous => ({ ...previous, [page]: status }));
}

export function reportStatusSnapshot(client: QueryClient, site: string) {
  const statuses: ReportStatus[] = [];
  let updating = false;
  for (const query of client.getQueryCache().findAll({ type: "active" })) {
    if (String(query.queryKey[1]) !== String(site) || query.state.data === undefined) continue;
    const observations = client.getQueryData<ReportObservations>(statusKey(query.queryKey));
    if (!observations) continue;
    statuses.push(...Object.values(observations));
    updating ||= query.state.fetchStatus === "fetching" || Object.values(observations).some(revalidating);
  }
  if (!statuses.length) return "null";
  const times = statuses.map(status => status.fetchedAt ? Date.parse(status.fetchedAt) : NaN);
  const cacheStates = new Set(statuses.map(status => status.cacheStatus));
  // A stable primitive snapshot lets React subscribe without polling or making any extra requests.
  return JSON.stringify({
    fetchedAt: times.every(Number.isFinite) ? new Date(Math.min(...times)).toISOString() : null,
    cacheStatus: cacheStates.size === 1 ? statuses[0].cacheStatus : "mixed",
    updating,
  });
}
