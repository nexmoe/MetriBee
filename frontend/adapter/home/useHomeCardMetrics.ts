import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useStore } from "../../rybbit/src/lib/store";
import { LITE_DASHBOARD } from "../../rybbit/src/lib/const";
import { buildAnalyticsRequest, fetchAnalytics } from "../../rybbit/src/api/analytics/analyticsRequest";
import { useAnalyticsContext } from "../../rybbit/src/api/analytics/useAnalyticsQuery";
import { recordReportStatus, reportRevalidationInterval } from "../../rybbit/src/api/analytics/reportStatus";
import type { SiteCardsResponse } from "../../rybbit/src/api/analytics/endpoints/siteCards";
import { homeCardQueries, mergeCardMetrics } from "./cardMetrics";

export function useHomeCardMetrics(organizationId: string, siteIds: number[], enabled: boolean) {
  const client = useQueryClient();
  const bucket = useStore(state => state.bucket);
  const { site, context, hasPeriod } = useAnalyticsContext({ useFilters: false });
  const previous = useAnalyticsContext({ periodTime: "previous", useFilters: false });
  const comparison = previous.hasPeriod
    ? buildAnalyticsRequest({ path: "" }, previous.context).params : null;
  const ids = [...new Set(siteIds)].sort((a, b) => a - b);
  const request = buildAnalyticsRequest({
    path: LITE_DASHBOARD ? "site-cards-lite" : "site-cards",
    organizationId,
    params: { bucket },
    body: () => ({ siteIds: ids, comparison }),
  }, context);
  const queryKey = (id: number) => ["site-cards", `organization:${organizationId}`, request.path, request.params, { siteIds: [id], comparison }];
  const queries = useQueries({
    queries: homeCardQueries(ids, queryKey, async (id, signal) => {
      const data = await fetchAnalytics<SiteCardsResponse>(site, {
        ...request,
        body: { siteIds: [id], comparison },
      }, signal, status => recordReportStatus(client, queryKey(id), status));
      if (!data[id] || data[id].error) throw new Error(data[id]?.error || "Report unavailable");
      return data;
    }).map(query => ({ ...query,
      refetchInterval: reportRevalidationInterval(client, query.queryKey),
      meta: { persist: request.params.past_minutes_start === undefined },
      enabled: enabled && !!organizationId && hasPeriod,
    })),
  });
  return {
    ...mergeCardMetrics(ids, queries),
    refetch: () => Promise.all(queries.map(query => query.refetch())),
  };
}
