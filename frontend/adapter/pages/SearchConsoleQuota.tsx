import { ChevronDown, ExternalLink, Gauge, RefreshCw } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  QueryState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  fmt,
  useData,
  when,
} from "./shared";
import { useExtracted } from "../extracted";
import { DataFreshness, RelativeTime } from "../overview/ReportFreshness";

// Match the existing GA4 quota card: compact toolbar, shaded table headers,
// 56px data rows and a quiet footer. GA4's layout stays independent.
const tableClass =
  "[&_th]:px-3 [&_td]:px-3 [&_th:first-child]:rounded-l-none [&_th:last-child]:rounded-r-none";

export function SearchConsoleQuota() {
  const t = useExtracted();
  const query = useData("/api/quota/status", 60000);
  const data = query.data?.searchConsole;
  const limits = data?.limits;
  const rows = limits
    ? ([
        [
          "Search Analytics · per site / minute",
          null,
          limits.searchAnalytics.siteMinute,
        ],
        [
          "Search Analytics · per user / minute",
          data.minute?.queries,
          limits.searchAnalytics.userMinute,
        ],
        [
          "Search Analytics · per project / minute",
          data.minute?.queries,
          limits.searchAnalytics.projectMinute,
        ],
        [
          "Search Analytics · per project / day",
          data.today?.queries,
          limits.searchAnalytics.projectDay,
        ],
        [
          "Sites list · per user / minute",
          data.minute?.siteLists,
          limits.other.userMinute,
        ],
      ] as const)
    : [];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Gauge className="size-4" />
          Google Search Console
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          {data && (
            <Badge variant={data.cooldownUntil ? "warning" : "outline"}>
              {t(
                data.reason === "demo"
                  ? "Demo mode"
                  : !data.configured
                  ? "Not configured"
                  : data.cooldownUntil
                  ? "Rate limited"
                  : "Credentials configured"
              )}
            </Badge>
          )}
          <DataFreshness
            status={
              data?.fetchedAt
                ? { fetchedAt: data.fetchedAt, cacheStatus: "unknown" }
                : null
            }
            updating={query.isFetching}
            note={t("Updating local usage does not query Google.")}
          />
          <Button
            variant="outline"
            size="sm"
            loading={query.isFetching}
            onClick={() => query.refetch()}
          >
            <RefreshCw />
            {t("Update local usage")}
          </Button>
        </div>
      </div>
      {(query.isPending || query.isError) && (
        <div className="px-3 pb-3">
          <QueryState query={query} />
        </div>
      )}
      {data && (
        <>
          {data.configured ? (
            <div className="flex flex-wrap gap-x-5 gap-y-1 px-3 pb-3 text-xs text-neutral-500 dark:text-neutral-400">
              {[
                ["Search requests today", data.today.queries],
                ["Report cache hits today", data.today.cacheHits],
                ["API errors today", data.today.errors],
                ["Rate limits today", data.today.rateLimited],
              ].map(([label, value]) => (
                <span key={label}>
                  {t(String(label))}{" "}
                  <span className="ml-1 font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
                    {fmt(value)}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <p className="px-3 pb-3 text-sm text-neutral-500 dark:text-neutral-400">
              {t(
                data.reason === "demo"
                  ? "Live Search Console usage is hidden in demo mode."
                  : "Configure Search Console credentials to observe local API usage."
              )}
            </p>
          )}
          {data.cooldownUntil && (
            <div
              role="status"
              className="mx-3 mb-3 rounded-lg border border-amber-300 p-3 text-sm"
            >
              {t(
                "Requests paused until {time}. Cached reports remain available.",
                { time: when(data.cooldownUntil) }
              )}
            </div>
          )}

          <Table
            aria-label={t("Search Console API limits")}
            className={`min-w-[520px] ${tableClass}`}
          >
            <TableHeader>
              <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
                <TableHead scope="col">{t("Quota scope")}</TableHead>
                <TableHead scope="col" className="whitespace-nowrap text-right">
                  {t("Observed locally")}
                </TableHead>
                <TableHead scope="col" className="whitespace-nowrap text-right">
                  {t("Published limit")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(([label, count, limit]) => (
                <TableRow key={label} className="h-14">
                  <TableHead
                    scope="row"
                    className="h-auto text-left font-normal text-neutral-600 dark:text-neutral-300"
                  >
                    {t(label)}
                  </TableHead>
                  <TableCell className="text-right tabular-nums">
                    {count == null ? (
                      data.sites?.length ? (
                        <a
                          href="#gsc-site-usage"
                          className="text-xs text-neutral-500 underline dark:text-neutral-400"
                        >
                          {t("By site")}
                        </a>
                      ) : (
                        "—"
                      )
                    ) : (
                      fmt(count)
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(limit)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {data.configured && (
            <div id="gsc-site-usage" className="scroll-mt-4">
              <div className="flex items-center justify-between gap-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-850/60">
                <h3 className="font-semibold">
                  {t("Search Analytics by site")}
                </h3>
                <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                  {data.sites?.length || 0}
                </span>
              </div>
              <Table
                aria-label={t("Search Analytics by site")}
                className={`min-w-[600px] ${tableClass}`}
              >
                <TableHeader>
                  <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
                    <TableHead scope="col">
                      {t("Search Console property")}
                    </TableHead>
                    <TableHead
                      scope="col"
                      className="whitespace-nowrap text-right"
                    >
                      {t("Last minute / limit")}
                    </TableHead>
                    <TableHead
                      scope="col"
                      className="whitespace-nowrap text-right"
                    >
                      {t("Search requests today")}
                    </TableHead>
                    <TableHead scope="col" className="whitespace-nowrap">
                      {t("Last API attempt")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.sites?.length ? (
                    data.sites.map((site: any) => (
                      <TableRow key={site.siteUrl} className="h-14">
                        <TableHead
                          scope="row"
                          className="h-auto text-left font-normal text-neutral-600 dark:text-neutral-300"
                        >
                          {site.siteUrl}
                        </TableHead>
                        <TableCell className="text-right tabular-nums">
                          {fmt(site.minute.queries)}{" "}
                          <span className="text-xs text-neutral-500 dark:text-neutral-400">
                            / {fmt(limits.searchAnalytics.siteMinute)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(site.today.queries)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-neutral-500 dark:text-neutral-400">
                          {site.lastRequestAt ? (
                            <RelativeTime value={site.lastRequestAt} />
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-7 text-center text-sm text-neutral-500 dark:text-neutral-400"
                      >
                        {t(
                          "Site usage appears after a Search Console report is loaded."
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="border-t border-neutral-100 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            <p>
              {t(
                "Published defaults. Actual remaining quota is unavailable from this API."
              )}
            </p>
            {data.configured && (
              <p className="mt-1">
                {t(
                  "Observed since {time}. Counts reset on restart or credential changes.",
                  { time: when(data.observedSince) }
                )}
              </p>
            )}
            <details className="group mt-2">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1 font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                {t("How usage is counted")}
                <ChevronDown
                  aria-hidden="true"
                  className="size-3 group-open:rotate-180"
                />
              </summary>
              <div className="space-y-2 py-2">
                <p>
                  {t(
                    "This process only, including its dashboard and MCP requests. Counts reset on restart or credential changes; other processes and apps are excluded."
                  )}
                </p>
                <p>
                  {t(
                    "Search Console does not return remaining quota or query load usage. Local attempts include failures; cache hits make no API request. Minute counts cover the last 60 seconds. Published limits are defaults, not live project settings."
                  )}
                </p>
                {data.configured && (
                  <p>
                    {t(
                      "Active / concurrency limit: {active} / {limit}. Queued: {queued}.",
                      {
                        active: data.activeRequests,
                        limit: data.maxConcurrentRequests,
                        queued: data.queuedRequests,
                      }
                    )}
                  </p>
                )}
                <p>
                  {t(
                    "Query load also has separate 10-minute and daily limits; no numeric balance is available."
                  )}
                </p>
              </div>
            </details>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              <a
                className="inline-flex items-center gap-1 underline"
                href="https://console.cloud.google.com/apis/api/searchconsole.googleapis.com/quotas"
                target="_blank"
                rel="noreferrer"
              >
                {t("View actual usage in Google Cloud")}
                <ExternalLink className="size-3" />
              </a>
              <a
                className="inline-flex items-center gap-1 underline"
                href={data.documentationUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t("Google quota documentation")}
                <ExternalLink className="size-3" />
              </a>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
