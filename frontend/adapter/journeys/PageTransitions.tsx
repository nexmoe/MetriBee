import { ArrowLeft, FolderTree, Funnel, Info, LogIn, LogOut, Pin, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useGetSite } from "../../rybbit/src/api/admin/hooks/useSites";
import { GetOverviewResponse, JourneyGrouping, JourneysResponse, JourneySummary } from "../../rybbit/src/api/analytics/endpoints";
import { useAnalyticsQuery } from "../../rybbit/src/api/analytics/useAnalyticsQuery";
import { SubHeader } from "../../rybbit/src/app/[site]/components/SubHeader/SubHeader";
import { OptionControl, PagePicker } from "../../rybbit/src/app/[site]/journeys/components/JourneyControls";
import { PathChips } from "../../rybbit/src/app/[site]/journeys/components/PathChips";
import { SankeyDiagram } from "../../rybbit/src/app/[site]/journeys/components/SankeyDiagram";
import { SaveAsFunnelDialog } from "../../rybbit/src/app/[site]/journeys/components/SaveAsFunnelDialog";
import { pathContainsPage, pathKey, sectionOfPage } from "../../rybbit/src/app/[site]/journeys/components/journeyUtils";
import { usePagesHref } from "../../rybbit/src/app/[site]/journeys/components/useJourneyLinks";
import { AnalysisBar } from "../../rybbit/src/components/site/AnalysisBar";
import { Delta } from "../../rybbit/src/components/site/Delta";
import { StatBand } from "../../rybbit/src/components/site/StatBand";
import { Button } from "../../rybbit/src/components/ui/button";
import { Card, CardLoader } from "../../rybbit/src/components/ui/card";
import { Input } from "../../rybbit/src/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../rybbit/src/components/ui/table";
import { ErrorState } from "../../rybbit/src/components/ErrorState";
import { Skeleton } from "../../rybbit/src/components/ui/skeleton";
import { useCanOnSite } from "../../rybbit/src/hooks/usePermissions";
import { useSetPageTitle } from "../../rybbit/src/hooks/useSetPageTitle";
import { percentDelta } from "../../rybbit/src/lib/delta";
import { useStore } from "../../rybbit/src/lib/store";
import { useExtracted } from "../extracted";

const FILTERS = ["hostname", "country", "region", "city", "language", "browser", "browser_version", "operating_system", "operating_system_version", "device_type", "referrer", "channel", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "entry_page"] as const;
const LIMITS = [10, 15, 25, 50, 100, 200, 500];

/** The existing GA4 aggregate capability, kept separate from ordered-session Journeys. */
export function PageTransitions({ onBack }: { onBack?: () => void }) {
  const t = useExtracted();
  useSetPageTitle("Page transitions");
  const { data: site } = useGetSite();
  const storeFilters = useStore(state => state.filters);
  const privateKey = useStore(state => state.privateKey);
  const canSave = useCanOnSite("funnels:write") && !privateKey;
  const pageHref = usePagesHref();
  const [groupBy, setGroupBy] = useState<JourneyGrouping>("path");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(15);
  const [search, setSearch] = useState("");
  const [pinned, setPinned] = useState<string | null>(null);
  const [funnel, setFunnel] = useState<string[] | null>(null);
  // Retain existing chips: unsupported session filters must fail explicitly,
  // rather than silently broadening an audience when switching reports.
  const filters = { useFilters: storeFilters.length > 0, customFilters: storeFilters };
  const params = { steps: 2, limit: 500, groupBy, stepFilters: JSON.stringify({ 0: from, 1: to }) };
  const query = useAnalyticsQuery<JourneysResponse>({ key: "ga4-transitions", path: "journeys", unwrap: false, ...filters, params });
  const previous = useAnalyticsQuery<JourneysResponse>({ key: "ga4-transitions", path: "journeys", unwrap: false, ...filters, params, periodTime: "previous" });
  const summary = useAnalyticsQuery<JourneySummary>({ key: "ga4-transition-summary", path: "journeys/summary", ...filters });
  const overview = useAnalyticsQuery<GetOverviewResponse>({ key: "overview", path: "overview", ...filters });
  const all = query.data?.journeys ?? [];
  const shown = all.slice(0, limit);
  const selected = shown.find(row => pathKey(row.path) === pinned);
  const matching = shown.filter(row => pathContainsPage(row.path, search));
  const previousCounts = useMemo(() => new Map(previous.data?.journeys.map(row => [pathKey(row.path), row.count])), [previous.data]);
  const suggestions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of all) for (const page of row.path) counts.set(page, (counts.get(page) ?? 0) + row.count);
    return [...counts].map(([value, count]) => ({ value: groupBy === "section" ? sectionOfPage(value) : value, count }));
  }, [all, groupBy]);
  const togglePin = (path: string[]) => setPinned(current => current === pathKey(path) ? null : pathKey(path));
  const total = query.data?.totalSessions ?? 0;
  const covered = shown.reduce((sum, row) => sum + row.count, 0);

  return <div className="mx-auto max-w-[1300px] space-y-3 p-2 md:p-4">
    <SubHeader availableFilters={[...FILTERS]} />
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
      <p className="flex items-start gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t("Two-page transitions reported by GA4 referrers")}</p>
      {onBack && <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft />{t("Journeys")}</Button>}
    </div>
    <StatBand isLoading={summary.isLoading} cells={[
      { id: "views", label: t("Internal page views"), value: summary.data?.sessions.toLocaleString() ?? "–" },
      { id: "depth", label: t("Views per session"), value: overview.data?.pages_per_session.toFixed(2) ?? "–", sub: t("Across all sessions in the selected period") },
      { id: "source", label: t("Top referring page"), value: summary.data?.topReferrer?.page ?? "–" },
      { id: "destination", label: t("Top destination"), value: summary.data?.topDestination?.page ?? "–" },
    ]} />
    <AnalysisBar>
      <OptionControl<JourneyGrouping> icon={<FolderTree />} label={t("Group pages")} value={groupBy} onChange={setGroupBy}
        options={[{ value: "path", label: t("Exact path") }, { value: "section", label: t("By section") }]} />
    </AnalysisBar>
    <Card>
      {query.isFetching && !query.isLoading && <CardLoader />}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3 dark:border-neutral-850">
        <div className="min-w-0">
          <h2 className="font-semibold leading-none tracking-tight">{t("Page transitions")}</h2>
          <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">{t("{count} page views", { count: covered.toLocaleString() })}{total > 0 && ` · ${(covered * 100 / total).toFixed(1)}%`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PagePicker icon={<LogIn />} label={t("Referring page")} value={from} onChange={setFrom} suggestions={suggestions} />
          <PagePicker icon={<LogOut />} label={t("Current page")} value={to} onChange={setTo} suggestions={suggestions} />
          <OptionControl label={t("Show")} value={String(limit)} onChange={value => setLimit(Number(value))}
            options={LIMITS.map(value => ({ value: String(value), label: t("Top {count} paths", { count: String(value) }) }))} />
        </div>
      </div>
      <div className="p-4">
        {query.isLoading ? <Skeleton className="h-80" /> : query.error && !query.data ? <ErrorState title={t("Failed to load journeys")} message={query.error.message} refetch={query.refetch} />
          : shown.length > 0 && site?.domain ? <SankeyDiagram journeys={shown} steps={2} maxJourneys={limit} domain={site.domain}
            exitsKnown={false} measurement="pageviews" pinnedPath={selected?.path} onPinPath={togglePin} pageHref={pageHref}
            renderStepHeader={({ index, sessions }) => <><span className="text-xs font-medium">{t(index === 0 ? "Referring page" : "Current page")}</span><span className="text-xs tabular-nums text-neutral-500">{t("{count} page views", { count: sessions.toLocaleString() })}</span></>}
            overlay={selected && <div className="space-y-3 rounded-md border border-neutral-150 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-800">
              <div className="flex items-start justify-between gap-2"><PathChips path={selected.path} pageHref={pageHref} /><Button variant="ghost" size="smIcon" aria-label={t("Unpin path")} onClick={() => setPinned(null)}><X /></Button></div>
              <p className="text-xs tabular-nums">{t("{count} page views · {percent} of internal page views", { count: selected.count.toLocaleString(), percent: `${selected.percentage.toFixed(1)}%` })}</p>
              {canSave && <Button variant="accent" size="xs" onClick={() => setFunnel(selected.path)}><Funnel />{t("Save as funnel")}</Button>}
            </div>} />
          : <p className="py-16 text-center text-sm text-neutral-500">{t("No internal page transitions")}</p>}
        <p className="mt-3 border-t border-neutral-100 pt-3 text-xs text-neutral-500 dark:border-neutral-850 dark:text-neutral-400">{t("Each link counts page views from a referring page to the current page. These aggregates cannot identify a visitor's complete session path.")}</p>
      </div>
    </Card>
    {all.length > 0 && <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><h2 className="font-semibold">{t("Top paths")}</h2><Input className="h-8 w-full text-xs sm:w-56" isSearch value={search} onChange={event => setSearch(event.target.value)} placeholder={t("Contains page, e.g. /docs/**")} aria-label={t("Filter paths by page")} /></div>
      <Table>
        <TableHeader><TableRow><TableHead>{t("Path")}</TableHead><TableHead className="text-right">{t("Page views")}</TableHead><TableHead className="text-right">{t("View share")}</TableHead>{previous.data && <TableHead className="text-right">{t("vs prev.")}</TableHead>}<TableHead>{t("Open")}</TableHead></TableRow></TableHeader>
        <TableBody>{matching.map(row => <TableRow key={pathKey(row.path)} aria-selected={pathKey(row.path) === pinned}>
          <TableCell><PathChips path={row.path} pageHref={pageHref} /></TableCell><TableCell className="text-right tabular-nums">{row.count.toLocaleString()}</TableCell><TableCell className="text-right tabular-nums">{row.percentage.toFixed(1)}%</TableCell>
          {previous.data && <TableCell className="text-right"><Delta value={percentDelta(row.count, previousCounts.get(pathKey(row.path)))} /></TableCell>}
          <TableCell><div className="flex gap-1"><Button variant="ghost" size="xs" onClick={() => togglePin(row.path)}><Pin />{t(pathKey(row.path) === pinned ? "Unpin path" : "Pin path")}</Button>{canSave && <Button variant="ghost" size="xs" onClick={() => setFunnel(row.path)}><Funnel />{t("Save as funnel")}</Button>}</div></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </Card>}
    <SaveAsFunnelDialog path={funnel} onClose={() => setFunnel(null)} />
  </div>;
}
