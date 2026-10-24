import { useStore } from "../../rybbit/src/lib/store";
import { buildAnalyticsRequest } from "../../rybbit/src/api/analytics/analyticsRequest";
import {
  useAnalyticsContext,
  useAnalyticsQuery,
} from "../../rybbit/src/api/analytics/useAnalyticsQuery";

type Period = { startDate: string; endDate: string; startDateTime?: string; endDateTime?: string; timeZone?: string };
type SiteReport = {
  id: string;
  name: string;
  domain: string;
  accountId?: string | null;
  accountName?: string | null;
  error: string;
  last: number | null;
  prev: number | null;
  change: number | null;
  vals: (number | null)[];
  st: { k: string; label: string; why: string };
  comparisonUnavailable?: boolean;
  earn?: {
    last: number | null;
    prev: number | null;
    change: number | null;
    rpm: number | null;
  } | null;
  earnLast?: number | null;
  earnChange?: number | null;
  rpm?: number | null;
};
type HomeSitesReport = {
  days: string[];
  range: Period;
  comparison: Period | null;
  bucket: string;
  lowThreshold: number;
  sites: SiteReport[];
  adsense: { generatedAt: string; currency: string; matched: number } | null;
};

export function useHomeSites(
  organizationId: string,
  siteIds: number[],
  enabled: boolean
) {
  const bucket = useStore((state) => state.bucket);
  const previous = useAnalyticsContext({
    periodTime: "previous",
    useFilters: false,
  });
  const comparison = previous.hasPeriod
    ? buildAnalyticsRequest({ path: "" }, previous.context).params
    : null;
  return useAnalyticsQuery<HomeSitesReport>({
    key: "home-sites",
    path: "site-status",
    organizationId,
    useFilters: false,
    params: { bucket },
    body: () => ({
      siteIds: [...new Set(siteIds)].sort((a, b) => a - b),
      comparison,
    }),
    enabled,
    placeholder: false,
  });
}
