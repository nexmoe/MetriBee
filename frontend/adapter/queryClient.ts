import { QueryClient, type Query } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { removeOldestQuery } from "@tanstack/react-query-persist-client";
import type { PersistedClient } from "@tanstack/react-query-persist-client";

export const QUERY_CACHE_TIME = 30 * 60_000;

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60_000,
        gcTime: QUERY_CACHE_TIME,
        refetchOnMount: true,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchIntervalInBackground: false,
        retry: false,
      },
    },
  });
}

export function queryCacheScope(
  context: { demo?: boolean; publicSiteId?: string; authScope?: string | null; properties?: { id: string | number }[] },
  restricted = false
) {
  const ids = [
    ...new Set(context.properties?.map((property) => String(property.id))),
  ].sort();
  // Sharing/permission checks and public embeds must always start from the server.
  return restricted || context.publicSiteId || !ids.length
    ? null
    : JSON.stringify([context.demo ? "demo" : "live", context.authScope || null, ids]);
}

export function createQueryPersistence(
  client: QueryClient,
  storage: Storage | undefined,
  scope: string | null
) {
  if (!storage || !scope) return undefined;
  return {
    buster: `metribee-query-v1:${scope}`,
    maxAge: QUERY_CACHE_TIME,
    persister: createSyncStoragePersister({
      storage,
      key: "metribee.query-cache",
      retry: removeOldestQuery,
      // Save the last successful result even when its background refresh failed.
      // Error objects and in-flight fetch states do not survive a page reload.
      serialize: (persisted: PersistedClient) =>
        JSON.stringify({
          ...persisted,
          clientState: {
            ...persisted.clientState,
            queries: persisted.clientState.queries.map((query) => ({
              ...query,
              state: {
                ...query.state,
                status: "success",
                fetchStatus: "idle",
                error: null,
                fetchFailureCount: 0,
                fetchFailureReason: null,
              },
            })),
          },
        }),
      deserialize: (value: string): PersistedClient => {
        const persisted = JSON.parse(value) as PersistedClient;
        // A recent write must not renew the lifetime of older reports in the same snapshot.
        persisted.clientState.queries = persisted.clientState.queries.filter(
          (query) => query.state.dataUpdatedAt > Date.now() - QUERY_CACHE_TIME
        );
        return persisted;
      },
    }),
    dehydrateOptions: {
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery: (query: Query) => {
        const report =
          query.queryKey[0] === "ga4-report-status"
            ? client
                .getQueryCache()
                .find({
                  queryKey: query.queryKey[1] as readonly unknown[],
                  exact: true,
                })
            : query;
        return (
          report?.meta?.persist === true &&
          query.state.data !== undefined &&
          report.state.dataUpdatedAt > Date.now() - QUERY_CACHE_TIME
        );
      },
    },
  };
}
