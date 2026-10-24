import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Globe, RefreshCw } from "lucide-react";
import {
  Workspace,
  SettingsPageHeader,
  Choice,
  get,
  QueryState,
  ErrorState,
  Button,
  Input,
  Card,
  Badge,
  StatBand,
  fmt,
} from "./shared";
import { AnalysisBar } from "../../rybbit/src/components/site/AnalysisBar";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "../../rybbit/src/components/ui/tooltip";
import { useSetPageTitle } from "../../rybbit/src/hooks/useSetPageTitle";
import { DataFreshness } from "../overview/ReportFreshness";
import { useExtracted } from "../extracted";
import {
  clampRule,
  combinedSeries,
  feedHealth,
  LiveProperty,
  scoreProperty,
  Sort,
  sortProperties,
  SpikeRule,
} from "../realtime/model";
import { PropertyCard } from "../realtime/PropertyCard";
import { RealtimeChart } from "../realtime/RealtimeChart";
import { RealtimeSettings } from "../realtime/RealtimeSettings";
import { SpikeAlerts, SpikeContext } from "../realtime/SpikeAlerts";
import { usePrivacy } from "../privacy/Privacy";

type Feed = {
  data: LiveProperty[];
  fetchedAt: number | null;
  cached?: boolean;
  status?: string;
  error?: string;
};
const LIVE_URL = "/api/realtime-all";
async function getRealtime(): Promise<Feed> {
  const response = await fetch(LIVE_URL);
  const body = await response.json();
  // A structured outage keeps property diagnostics available without treating HTTP 503 as live data.
  if (
    response.status === 503 &&
    body.code === "ga4_unavailable" &&
    Array.isArray(body.data)
  )
    return body;
  if (!response.ok || body.ok === false)
    throw new Error(body.error || "Realtime data unavailable");
  return body;
}
function saved(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Session-only in private mode. */
  }
}
function savedRule() {
  try {
    return clampRule(JSON.parse(saved("ga4dash.spikeRule") || "null"));
  } catch {
    return clampRule(null);
  }
}

export default function Home() {
  const t = useExtracted();
  useSetPageTitle("Realtime overview");
  const [auto, setAuto] = useState(() => saved("ga4dash.realtimeAuto") !== "0");
  const [privacy, setPrivacy] = usePrivacy();
  const [collapsed, setCollapsed] = useState(
    () => saved("ga4dash.spikesCollapsed") === "1"
  );
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("unusual");
  const [rule, setRule] = useState(savedRule);
  const [cacheMessage, setCacheMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const query = useQuery<Feed, Error>({
    queryKey: ["ga4", LIVE_URL],
    queryFn: getRealtime,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: auto,
    retry: false,
    refetchInterval: (query) =>
      auto
        ? query.state.error ||
          ["unavailable", "partial"].includes(query.state.data?.status || "")
          ? 30_000
          : 120_000
        : false,
  });
  const rows = useMemo(
    () =>
      (query.isError ? [] : query.data?.data || []).map((row) =>
        scoreProperty(row, rule)
      ),
    [query.data, query.isError, rule]
  );
  const health = feedHealth(rows, query.isError);
  const unavailable = health.status === "unavailable";
  const partial = health.status === "partial";
  const available = rows.filter((row) => !row.error);
  const spikes = sortProperties(
    available.filter((row) => row.score?.isSpike),
    "unusual"
  );
  const contextIds = spikes
    .slice(0, 2)
    .map((row) => row.propertyId)
    .sort()
    .join(",");
  const context = useQuery<{ spikes: SpikeContext[] }, Error>({
    queryKey: ["ga4", "spike-context", contextIds, rule.z, rule.lift],
    queryFn: () =>
      get(
        `/api/spikes?z=${rule.z}&lift=${
          rule.lift
        }&propertyIds=${encodeURIComponent(contextIds)}`
      ),
    enabled: spikes.length > 0,
    refetchOnWindowFocus: auto,
    staleTime: 120_000,
    refetchInterval: auto && spikes.length > 0 ? 120_000 : false,
  });
  const filtered = sortProperties(
    rows.filter((row) =>
      `${row.siteName || ""} ${row.domain || ""} ${row.accountName || ""}`
        .toLowerCase()
        .includes(search.toLowerCase())
    ),
    sort
  );
  const groups = unavailable
    ? []
    : [{ key: "all", name: t("All properties"), rows: filtered }];
  const combined = useMemo(() => combinedSeries(rows), [rows]);
  const missingMinutes = available.some((row) => !Array.isArray(row.series));
  function changeRule(next: SpikeRule) {
    const value = clampRule(next);
    setRule(value);
    persist("ga4dash.spikeRule", JSON.stringify(value));
  }
  async function refreshProperties() {
    setRefreshing(true);
    setCacheMessage("");
    try {
      const response = await fetch("/api/refresh-cache", { method: "POST" });
      const body = await response.json();
      if (!response.ok || body.ok === false)
        throw new Error(body.error || t("Property refresh failed"));
      setCacheMessage(t("Properties refreshed"));
      await query.refetch();
    } catch (error) {
      setCacheMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <Workspace>
      <div className="space-y-4">
        <SettingsPageHeader
          title={t("Realtime")}
          description={t(
            "Live traffic across your GA4 properties · last 30 minutes"
          )}
          actions={
            <>
              <Badge
                variant={
                  unavailable || partial
                    ? "warning"
                    : !query.isPending && auto
                    ? "success"
                    : "secondary"
                }
              >
                {unavailable
                  ? t("Unavailable")
                  : query.isPending
                  ? t("Updating…")
                  : partial
                  ? t("Partial data")
                  : auto
                  ? t("Live")
                  : t("Paused")}
              </Badge>
              <Button variant="outline" size="sm" asChild>
                <Link href="/globe">
                  <Globe className="h-4 w-4" />
                  {t("Live globe")}
                </Link>
              </Button>
            </>
          }
        />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <StatBand
            className="h-full bg-white dark:bg-neutral-900 [&>div]:h-full"
            isLoading={query.isPending}
            cells={[
              {
                label: t("Active users"),
                value: fmt(health.activeUsers),
                sub: partial
                  ? t("Available properties only")
                  : t("Across properties"),
              },
              {
                label: t("Pageviews"),
                value: fmt(health.pageViews),
                sub: t("Last 30 minutes"),
              },
              {
                label: t("Properties with traffic"),
                value: fmt(health.withTraffic),
                sub: t("{count} available · {failed} failed", {
                  count: String(health.available),
                  failed: String(health.failed),
                }),
              },
              {
                label: t("Traffic spikes"),
                value:
                  query.data && !unavailable && health.available
                    ? fmt(spikes.length)
                    : "—",
                sub: `z ≥ ${rule.z} · ${t("lift")} ≥ ${rule.lift}×`,
              },
            ]}
          />
          <Card className="space-y-1 p-3">
            <RealtimeChart
              values={combined}
              fetchedAt={query.data?.fetchedAt ?? undefined}
              className="h-10"
            />
            <div className="flex justify-between text-[10px] text-neutral-500">
              <span>−29m</span>
              <span>
                {missingMinutes
                  ? t("Partial minute data")
                  : t("Active users per minute")}
              </span>
              <span>{t("Now")}</span>
            </div>
          </Card>
        </div>
        <AnalysisBar
          compare={null}
          end={
            <>
              <DataFreshness
                status={
                  query.data && !unavailable
                    ? {
                        fetchedAt: query.data.fetchedAt,
                        cacheStatus: query.data.cached ? "cached" : "fresh",
                      }
                    : null
                }
                updating={query.isFetching}
                note={t(
                  "When this realtime feed was fetched from GA4. The feed refreshes every two minutes."
                )}
              />
              <Button
                variant="outline"
                size="smIcon"
                loading={query.isFetching}
                aria-label={t("Refresh realtime data")}
                onClick={() => {
                  void query.refetch();
                  if (spikes.length) void context.refetch();
                }}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <RealtimeSettings
                auto={auto}
                setAuto={(value) => {
                  setAuto(value);
                  persist("ga4dash.realtimeAuto", value ? "1" : "0");
                }}
                privacy={privacy}
                setPrivacy={setPrivacy}
                rule={rule}
                changeRule={changeRule}
                refreshing={refreshing}
                refreshProperties={refreshProperties}
              />
            </>
          }
        >
          <Input
            isSearch
            aria-label={t("Search properties")}
            placeholder={t("Search properties…")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 w-full sm:w-60"
          />
          <Choice
            label={t("Sort properties")}
            value={sort}
            onChange={(value) => setSort(value as Sort)}
            options={[
              { value: "unusual", label: t("Most unusual") },
              { value: "active", label: t("Most active") },
              { value: "name", label: t("Name") },
            ]}
          />
        </AnalysisBar>
        {cacheMessage && (
          <p role="status" className="text-xs text-neutral-500">
            {cacheMessage}
          </p>
        )}
        {unavailable ? (
          <ErrorState
            title={t("Realtime unavailable")}
            message={
              query.error?.message ||
              query.data?.error ||
              t(
                "GA4 realtime data is temporarily unavailable. Please try again."
              )
            }
            refetch={() => {
              void query.refetch();
            }}
          />
        ) : (
          <QueryState query={query} />
        )}
        <SpikeAlerts
          spikes={spikes}
          context={context.data?.spikes}
          contextUnavailable={context.isError}
          collapsed={collapsed}
          onToggle={() => {
            setCollapsed(!collapsed);
            persist("ga4dash.spikesCollapsed", !collapsed ? "1" : "0");
          }}
          privacy={privacy}
        />
        {groups.map((group) => {
          const active = group.rows.filter(
            (row) => !row.error && (row.activeUsers || 0) > 0
          );
          const quiet = group.rows.filter(
            (row) => !row.error && !row.activeUsers
          );
          const errors = group.rows.filter((row) => row.error);
          return (
            <section
              key={group.key}
              className="space-y-3"
              aria-label={group.name}
            >
              <div className="flex items-center justify-between gap-3">
                <h2
                  className={`text-sm font-medium ${privacy ? "blur-sm" : ""}`}
                >
                  {group.name}
                </h2>
                <span className="text-xs text-neutral-500">
                  {t("{count} properties", {
                    count: String(group.rows.length),
                  })}
                </span>
              </div>
              {active.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {active.map((row) => (
                    <PropertyCard
                      key={row.propertyId}
                      row={row}
                      rule={rule}
                      privacy={privacy}
                      fetchedAt={query.data?.fetchedAt ?? undefined}
                    />
                  ))}
                </div>
              )}
              {(quiet.length > 0 || errors.length > 0) && (
                <div className="space-y-2">
                  <p className="text-xs text-neutral-500">
                    {quiet.length > 0 &&
                      t("{count} with no active users in the last 30 minutes", {
                        count: String(quiet.length),
                      })}
                    {quiet.length > 0 && errors.length > 0 && " · "}
                    {errors.length > 0 &&
                      t("{count} unavailable", {
                        count: String(errors.length),
                      })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {errors.map((row) => (
                      <Tooltip key={row.propertyId}>
                        <TooltipTrigger asChild>
                          <Link href={`/analytics?prop=${row.propertyId}`}>
                            <Badge variant="destructive">
                              <span className={privacy ? "blur-sm" : ""}>
                                {row.siteName || row.domain || row.propertyId}
                              </span>{" "}
                              · {t("Error")}
                            </Badge>
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent
                          className={`max-w-sm break-words ${
                            privacy ? "blur-sm" : ""
                          }`}
                        >
                          {row.error}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                    {quiet.map((row) => (
                      <Link
                        key={row.propertyId}
                        href={`/analytics?prop=${row.propertyId}`}
                      >
                        <Badge
                          variant="secondary"
                          className={privacy ? "blur-sm" : ""}
                          title={`${fmt(row.activeUsers)} ${t(
                            "active users"
                          )} · ${fmt(row.pageViews)} ${t("pageviews")}`}
                        >
                          {row.siteName || row.domain || row.propertyId}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })}
        {!query.isPending && !unavailable && !filtered.length && (
          <p className="py-10 text-center text-sm text-neutral-500">
            {t("No properties match this search.")}
          </p>
        )}
      </div>
    </Workspace>
  );
}
