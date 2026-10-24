import { ChevronDown, ChevronRight, Gauge, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Workspace,
  SettingsPageHeader,
  Button,
  useData,
  QueryState,
  Card,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  fmt,
  when,
  properties,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "./shared";
import Link from "next/link";
import { DataFreshness, RelativeTime } from "../overview/ReportFreshness";
import { useExtracted } from "../extracted";
import { Progress } from "../../rybbit/src/components/ui/progress";
import { SearchConsoleQuota } from "./SearchConsoleQuota";

const quotaMetrics = [
  {
    remaining: "projectHourLeft",
    limit: "projectHour",
    label: "Project / hour left",
  },
  { remaining: "hourLeft", limit: "hour", label: "Property / hour left" },
  { remaining: "dayLeft", limit: "day", label: "Property / day left" },
] as const;

const poolOrder = new Map([
  ["core", 0],
  ["realtime", 1],
  ["funnel", 2],
]);
const poolLabels: Record<string, string> = {
  core: "Core",
  realtime: "Realtime",
  funnel: "Funnel",
};

function QuotaRemaining({
  remaining,
  limit,
  reserve,
  label,
}: {
  remaining: number | null;
  limit: number;
  reserve: number;
  label: string;
}) {
  const ratio =
    remaining != null &&
    Number.isFinite(remaining) &&
    Number.isFinite(limit) &&
    limit > 0
      ? Math.max(0, Math.min(1, remaining / limit))
      : null;
  const percent = ratio == null ? null : ratio * 100;
  const fillClass =
    ratio != null && ratio < 0.1
      ? "[&>div]:bg-red-500"
      : ratio != null && ratio < reserve
      ? "[&>div]:bg-yellow-500"
      : "[&>div]:bg-dataviz";

  return (
    <div className="min-w-44 space-y-1.5 tabular-nums">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">
          {ratio == null ? "—" : fmt(remaining)}
          <span className="ml-1 text-xs font-normal text-neutral-500 dark:text-neutral-400">
            / {fmt(limit)}
          </span>
        </span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {percent == null
            ? "Unknown"
            : `${fmt(Math.round(percent * 10) / 10)}% left`}
        </span>
      </div>
      {percent == null ? (
        <div
          aria-hidden="true"
          className="h-1.5 rounded-sm bg-neutral-200 dark:bg-neutral-800"
        />
      ) : (
        <Progress
          value={percent}
          aria-label={label}
          getValueLabel={() =>
            `${fmt(remaining)} of ${fmt(limit)} tokens remaining`
          }
          className={`h-1.5 rounded-sm motion-reduce:[&>div]:transition-none ${fillClass}`}
        />
      )}
    </div>
  );
}

export function QuotaPanel({ compact = false }: { compact?: boolean }) {
  const t = useExtracted();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [refreshErrors, setRefreshErrors] = useState<
    { propertyId?: string; code: string }[]
  >([]);
  const query = useData("/api/quota/status", refreshing ? false : 60000);
  const data = query.data;
  const errorMessages: Record<string, string> = {
    permission: t("No permission to read this property's quota."),
    quota: t("GA4 quota lookup is unavailable. Try again later."),
    paused: t("GA4 requests are temporarily paused."),
    incomplete: t("GA4 returned incomplete quota data."),
    unavailable: t("Could not fetch the latest quota from GA4."),
  };
  async function fetchLatestQuota() {
    setRefreshing(true);
    setRefreshErrors([]);
    try {
      await queryClient.cancelQueries({
        queryKey: ["ga4", "/api/quota/status"],
        exact: true,
      });
      const response = await fetch("/api/quota/refresh", { method: "POST" });
      const payload = await response.json();
      if (Array.isArray(payload.entries))
        queryClient.setQueryData(["ga4", "/api/quota/status"], payload);
      if (
        Array.isArray(payload.refresh?.errors) &&
        payload.refresh.errors.length
      )
        setRefreshErrors(payload.refresh.errors);
      else if (!response.ok) throw new Error("Quota refresh failed");
    } catch {
      setRefreshErrors([{ code: "unavailable" }]);
    } finally {
      setRefreshing(false);
    }
  }
  const siteNames = new Map(properties().map((p) => [String(p.id), p.site]));
  const entries: any[] = (data?.entries || []).filter((entry: any) =>
    siteNames.has(String(entry.propertyId))
  );
  const groups = new Map<
    string,
    { propertyId: string; name: string; entries: any[] }
  >();
  for (const entry of entries) {
    if (!groups.has(entry.propertyId)) {
      groups.set(entry.propertyId, {
        propertyId: entry.propertyId,
        name: siteNames.get(entry.propertyId) || entry.propertyId,
        entries: [],
      });
    }
    groups.get(entry.propertyId)!.entries.push(entry);
  }
  const siteGroups = [...groups.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.propertyId.localeCompare(b.propertyId)
  );
  for (const group of siteGroups) {
    group.entries.sort(
      (a, b) =>
        (poolOrder.get(a.pool) ?? poolOrder.size) -
          (poolOrder.get(b.pool) ?? poolOrder.size) ||
        a.pool.localeCompare(b.pool)
    );
  }
  const visibleGroups = compact ? siteGroups.slice(0, 2) : siteGroups;
  const columnCount = compact ? 5 : 7;
  const toggleGroup = (propertyId: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(propertyId)) next.delete(propertyId);
      else next.add(propertyId);
      return next;
    });
  };
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Gauge className="h-4 w-4" />
          API quota
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          {!compact && (
            <DataFreshness
              status={
                data
                  ? { fetchedAt: data.fetchedAt, cacheStatus: "cached" }
                  : null
              }
              updating={query.isFetching || refreshing}
              note={t(
                "Quota values come from previous GA4 responses. The update time is when this quota snapshot was read."
              )}
            />
          )}
          {compact ? (
            <Link href="/quota" className="text-xs text-neutral-500 underline">
              All quota details
            </Link>
          ) : (
            <Button
              variant="outline"
              size="sm"
              loading={refreshing}
              onClick={fetchLatestQuota}
            >
              <RefreshCw />
              {t("Fetch latest quota from GA4")}
            </Button>
          )}
        </div>
      </div>
      {refreshErrors.length > 0 && (
        <ul
          role="alert"
          className="mx-3 mb-3 space-y-1 text-sm text-red-600 dark:text-red-400"
        >
          {refreshErrors.map((error, index) => (
            <li key={error.propertyId || index}>
              {error.propertyId &&
                `${
                  properties().find(
                    (property) => String(property.id) === error.propertyId
                  )?.site || error.propertyId
                }: `}
              {errorMessages[error.code] || errorMessages.unavailable}
            </li>
          ))}
        </ul>
      )}
      {(query.isError || query.isPending) && (
        <div className="px-3 pb-3">
          <QueryState query={query} />
        </div>
      )}
      {data && (
        <>
          {data.cooldowns.map((c: any) => (
            <div
              key={c.scope}
              role="status"
              className="mx-3 mb-3 rounded-lg border border-amber-300 p-3 text-sm"
            >
              GA4 requests paused · {c.scope} · until {when(c.until)}
              <p className="text-xs text-neutral-500">{c.reason}</p>
            </div>
          ))}
          <Table
            aria-label="API quota by property and pool"
            className="min-w-[720px] [&_th]:px-3 [&_td]:px-3 [&_th:first-child]:rounded-l-none [&_th:last-child]:rounded-r-none"
          >
            <TableHeader>
              <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
                <TableHead scope="col" className="whitespace-nowrap">
                  Pool
                </TableHead>
                {quotaMetrics.map(({ limit, label }) => (
                  <TableHead
                    key={limit}
                    scope="col"
                    className="whitespace-nowrap"
                  >
                    {label}
                  </TableHead>
                ))}
                {!compact && (
                  <>
                    <TableHead
                      scope="col"
                      className="whitespace-nowrap text-right"
                    >
                      Last request cost
                    </TableHead>
                    <TableHead scope="col">Observed</TableHead>
                  </>
                )}
                <TableHead scope="col">Status</TableHead>
              </TableRow>
            </TableHeader>
            {visibleGroups.map((group) => (
              <TableBody key={group.propertyId} aria-label={group.name}>
                <TableRow className="bg-neutral-50 hover:bg-neutral-50 dark:bg-neutral-850/60 dark:hover:bg-neutral-850/60">
                  <TableHead
                    scope="rowgroup"
                    colSpan={columnCount}
                    className="h-auto py-2 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="h-6 w-6 shrink-0 px-0 text-neutral-500 dark:text-neutral-400"
                        aria-expanded={!collapsed.has(group.propertyId)}
                        aria-label={
                          collapsed.has(group.propertyId)
                            ? t("Expand {section}", { section: group.name })
                            : t("Collapse {section}", { section: group.name })
                        }
                        onClick={() => toggleGroup(group.propertyId)}
                      >
                        {collapsed.has(group.propertyId) ? (
                          <ChevronRight />
                        ) : (
                          <ChevronDown />
                        )}
                      </Button>
                      <Link
                        href={"/analytics?prop=" + group.propertyId}
                        className="font-semibold text-neutral-900 hover:underline dark:text-neutral-100"
                      >
                        {group.name}
                      </Link>
                      {group.name !== group.propertyId && (
                        <span className="font-normal tabular-nums text-neutral-500 dark:text-neutral-400">
                          {group.propertyId}
                        </span>
                      )}
                      <span className="ml-auto font-normal tabular-nums text-neutral-500 dark:text-neutral-400">
                        {t("{count, plural, one {# pool} other {# pools}}", {
                          count: group.entries.length,
                        })}
                      </span>
                    </div>
                  </TableHead>
                </TableRow>
                {!collapsed.has(group.propertyId) &&
                  group.entries.map((e: any) => (
                    <TableRow key={e.propertyId + e.pool} className="h-14">
                      <TableHead
                        scope="row"
                        className="h-auto whitespace-nowrap text-left font-normal text-neutral-600 dark:text-neutral-300"
                      >
                        {poolLabels[e.pool] || e.pool}
                      </TableHead>
                      {quotaMetrics.map(({ remaining, limit, label }) => (
                        <TableCell key={remaining}>
                          <QuotaRemaining
                            remaining={e[remaining]}
                            limit={data.limits[limit] * e.scale}
                            reserve={data.reserve[limit]}
                            label={`${e.propertyId} ${e.pool} · ${label}`}
                          />
                        </TableCell>
                      ))}
                      {!compact && (
                        <>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">
                            {e.cost == null ? "—" : `${fmt(e.cost)} tokens`}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-neutral-500 dark:text-neutral-400">
                            <RelativeTime value={e.at} />
                          </TableCell>
                        </>
                      )}
                      <TableCell>
                        <Badge
                          className="whitespace-nowrap"
                          variant={
                            e.status === "critical"
                              ? "destructive"
                              : e.status === "low"
                              ? "warning"
                              : "outline"
                          }
                        >
                          {e.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            ))}
          </Table>
          {!entries.length && (
            <p className="px-3 py-7 text-center text-sm text-neutral-500 dark:text-neutral-400">
              {t("No quota observations yet. Fetch the latest quota from GA4.")}
            </p>
          )}
          <p className="border-t border-neutral-100 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            Bars show remaining quota; yellow marks low reserves and red marks
            less than 10% remaining. Tokens are from the latest Google response.
            Expired observations show —. Last request cost is for one request.
            Daily reset: {when(data.dailyReset)}.
          </p>
        </>
      )}
    </Card>
  );
}
export default function Quota() {
  const t = useExtracted();
  return (
    <Workspace>
      <SettingsPageHeader
        title="API quota"
        description={t(
          "GA4 token budgets and Google Search Console request usage."
        )}
      />
      <Tabs defaultValue="ga4">
        <TabsList>
          <TabsTrigger value="ga4" aria-label="Google Analytics">
            <span className="sm:hidden">GA4</span>
            <span className="hidden sm:inline">Google Analytics</span>
          </TabsTrigger>
          <TabsTrigger value="gsc" aria-label="Google Search Console">
            <span className="sm:hidden">GSC</span>
            <span className="hidden sm:inline">Google Search Console</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="ga4">
          <QuotaPanel />
        </TabsContent>
        <TabsContent value="gsc">
          <SearchConsoleQuota />
        </TabsContent>
      </Tabs>
    </Workspace>
  );
}
