"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { GetSitesFromOrgResponse } from "../../api/admin/endpoints/sites";
import { accountGroups } from "../../../../adapter/home/accounts";
import { useHomeCardMetrics } from "../../../../adapter/home/useHomeCardMetrics";
import { sortSitesBySessions } from "../../../../adapter/home/cardMetrics";
import { useWindowSize } from "@uidotdev/usehooks";
import {
  ChevronLeft,
  ChevronRight,
  FolderTree,
  RefreshCw,
  Search,
} from "lucide-react";
import { useExtracted } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useUserOrganizations } from "../../api/admin/hooks/useOrganizations";
import { useGetSitesFromOrg } from "../../api/admin/hooks/useSites";
import { useTeams } from "../../api/admin/hooks/useTeams";
import { AppSidebar } from "../../components/AppSidebar";
import { DateSelector } from "../../components/DateSelector/DateSelector";
import { OrganizationSelector } from "../../components/OrganizationSelector";
import { StandardPage } from "../../components/StandardPage";
import { ErrorState } from "../../components/ErrorState";
import { TeamSelector } from "../../components/TeamSelector";
import { Button } from "../../components/ui/button";
import { Card, CardDescription, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs";
import { MultiSelect } from "../../components/ui/multi-select";
import { Pagination } from "../../components/pagination";
import { useOrgPermissions } from "../../hooks/usePermissions";
import { useSetPageTitle } from "../../hooks/useSetPageTitle";
import { authClient } from "../../lib/auth";
import { IS_CLOUD } from "../../lib/const";
import {
  canGoBack,
  canGoForward,
  goBack,
  goForward,
  useStore,
} from "../../lib/store";
import { useStripeSubscription } from "../../lib/subscription/useStripeSubscription";
import { useSyncStateWithUrl } from "../../lib/urlParams";
import { ReportFreshness } from "../../../../adapter/overview/ReportFreshness";
import SiteReports from "../../../../adapter/pages/Sites";
import { getHomeView } from "../../../../../lib/homeViews";
const useCheckoutReturn = () => false;
const PlanRequiredNotice = (_props: any) => null;
import { SiteCards } from "./SiteCards";
import { AddSite } from '../components/AddSite';
import { NoOrganization } from '../../components/NoOrganization';

// Rank all sites first; keep card/chart rendering paginated.
const PAGE_SIZE = 20;

export default function Home() {
  const t = useExtracted();
  useSetPageTitle("Home");
  useSyncStateWithUrl();
  const router = useRouter();
  const client = useQueryClient();
  const view = getHomeView(useSearchParams().get("view"));
  const isCards = view === "cards";
  const setView = (nextView: string) => {
    const params = new URLSearchParams(window.location.search);
    if (nextView === "cards") params.delete("view");
    else params.set("view", nextView);
    const query = params.toString();
    router.push(
      `${window.location.pathname}${query ? `?${query}` : ""}${
        window.location.hash
      }`
    );
  };

  const { width } = useWindowSize();
  const isDesktop = width !== null && width >= 768;

  const { time, setTime } = useStore();
  const { data: session } = authClient.useSession();
  const { data: activeOrganization, isPending } =
    authClient.useActiveOrganization();

  // Back from checkout started from the banner below: keep asking until the sites are on.
  const checkoutReturnPending = useCheckoutReturn();
  const {
    data: siteResponse,
    refetch: refetchSites,
    isLoading: isLoadingSites,
  } = useGetSitesFromOrg(activeOrganization?.id, {
    refetchInterval: checkoutReturnPending
      ? (query) =>
          query.state.data?.sites.some((site) => site.requiresPlan)
            ? 3000
            : false
      : 5 * 60_000,
  });

  // The Express bootstrap also carries GA4 account metadata for older API sessions.
  const sites = useMemo(() => {
    if (!siteResponse) return siteResponse;
    const properties = (window as any).__GA4_CONTEXT__?.properties ?? [];
    const byId = new Map<string, any>(
      properties.map((property: any) => [String(property.id), property])
    );
    return {
      ...siteResponse,
      sites: siteResponse.sites.map((site) => {
        const property = byId.get(String(site.siteId));
        return {
          ...site,
          accountId: site.accountId ?? property?.accountId ?? null,
          accountName: site.accountName ?? property?.accountName ?? null,
        };
      }),
    };
  }, [siteResponse]);

  const {
    data: userOrganizationsData,
    isLoading: isLoadingOrganizations,
    refetch: refetchOrganizations,
  } = useUserOrganizations();

  // On cloud an organization without a trial or plan can't track anything, so an empty
  // home page asks for a website and a plan instead of offering "Add Website".
  const { data: subscription, isLoading: isLoadingSubscription } =
    useStripeSubscription();
  const hasNoPlan =
    IS_CLOUD &&
    !!subscription &&
    subscription.status !== "active" &&
    subscription.status !== "trialing";

  // Consolidated loading state
  const isLoading =
    isLoadingOrganizations ||
    isPending ||
    isLoadingSites ||
    (IS_CLOUD && isLoadingSubscription);

  // Check if user has organizations
  const hasOrganizations =
    Array.isArray(userOrganizationsData) && userOrganizationsData.length > 0;
  const hasNoOrganizations = !isLoading && !hasOrganizations;

  // What the user may do in the active organization
  const { can } = useOrgPermissions(activeOrganization?.id);
  const canAddSites = hasOrganizations && can("sites:create");
  const cantAddSitesReason = t(
    "You don't have permission to add sites to this organization"
  );

  // Check if we should show sites content
  const shouldShowSites = hasOrganizations && !isLoading;
  const hasNoSites =
    shouldShowSites && (!sites?.sites || sites.sites.length === 0);
  const sitesRequirePlan =
    shouldShowSites &&
    !checkoutReturnPending &&
    !!sites?.sites?.some((site) => site.requiresPlan);

  const { data: teamsData } = useTeams(activeOrganization?.id);

  const [createOrgDialogOpen, setCreateOrgDialogOpen] = useState(false);
  const [nameFilter, setNameFilter] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedTeamFilter, setSelectedTeamFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [grouped, setGrouped] = useState(() => {
    try {
      return localStorage.getItem("ga4dash.homeGrouped") === "1";
    } catch {
      return false;
    }
  });
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  async function syncProperties() {
    setSyncing(true);
    setSyncMessage("");
    try {
      const response = await fetch("/api/refresh-cache", { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error(result.error || t("Property sync failed"));
      if (result.properties && (window as any).__GA4_CONTEXT__)
        (window as any).__GA4_CONTEXT__.properties = result.properties;
      const refreshed = await refetchSites();
      if (refreshed.error) throw refreshed.error;
      await Promise.all([
        client.invalidateQueries({ queryKey: ["get-site"] }),
        client.invalidateQueries({ queryKey: ["home-sites"] }),
        client.invalidateQueries({ queryKey: ["ga4", "/api/realtime-all"] }),
      ]);
      setSyncMessage(t("Property names synced from GA4"));
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  }
  function toggleGrouping() {
    const next = !grouped;
    setGrouped(next);
    try {
      localStorage.setItem("ga4dash.homeGrouped", next ? "1" : "0");
    } catch {
      /* Keep this choice for the current session. */
    }
  }

  // Filters run over the full org list, so changing them should jump back to
  // the first page of results.
  useEffect(() => {
    setPage(1);
  }, [nameFilter, selectedTags, selectedTeamFilter, grouped]);

  // Compute unique tags from all sites
  const allTags = useMemo(() => {
    const tags = sites?.sites?.flatMap((s) => s.tags || []) || [];
    return Array.from(new Set(tags)).toSorted();
  }, [sites?.sites]);

  // Track hydration to avoid mismatch with date-dependent disabled states
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  const teams = teamsData?.teams || [];
  const cardMetrics = useHomeCardMetrics(
    activeOrganization?.id ?? "",
    sites?.sites.map(site => site.siteId) ?? [],
    isCards && !isLoading
  );

  // Filter sites by name, tags, and team
  const filteredSites = sites?.sites?.filter((site) => {
    const matchesDomain = `${site.name} ${site.domain} ${site.siteId} ${
      site.accountName || ""
    }`
      .toLowerCase()
      .includes(nameFilter.toLowerCase());
    const matchesTags =
      selectedTags.length === 0 ||
      selectedTags.some((tag) => site.tags?.includes(tag));
    let matchesTeam = true;
    if (selectedTeamFilter === "unassigned") {
      matchesTeam = !site.teams || site.teams.length === 0;
    } else if (selectedTeamFilter !== "all") {
      matchesTeam =
        site.teams?.some((t) => t.id === selectedTeamFilter) || false;
    }
    return matchesDomain && matchesTags && matchesTeam;
  });

  // Paginate the filtered list so only PAGE_SIZE cards mount at once. safePage
  // clamps the current page when filtering shrinks the result set below it.
  const totalFiltered = filteredSites?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const orderedSites = accountGroups(sortSitesBySessions(filteredSites ?? [], cardMetrics.data), grouped).flatMap(
    (group) => group.properties
  );
  const paginatedSites = orderedSites.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );
  const hasNoMatches = totalFiltered === 0;

  // Handle successful organization creation
  const handleOrganizationCreated = () => {
    refetchOrganizations();
    refetchSites();
  };

  // Handle tag click to toggle filter
  const handleTagClick = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const hasSites = shouldShowSites && sites?.sites && sites.sites.length > 0;

  const teamSelector =
    teams.length > 0 ? (
      <TeamSelector
        teams={teams}
        value={selectedTeamFilter}
        onValueChange={setSelectedTeamFilter}
        canCreateTeam={hasOrganizations && can("teams:manage")}
      />
    ) : null;

  const dateControls = (
    <div className="flex items-center gap-2">
      <DateSelector time={time} setTime={setTime} />
      <div className="flex items-center">
        <Button
          variant="secondary"
          size="icon"
          onClick={goBack}
          aria-label={t("Previous period")}
          disabled={!canGoBack(time)}
          className="rounded-r-none h-8 w-8"
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          onClick={goForward}
          aria-label={t("Next period")}
          disabled={!isMounted || !canGoForward(time)}
          className="rounded-l-none -ml-px h-8 w-8"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );

  const filterBar =
    hasSites || !isCards ? (
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative min-w-40 flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
          <Input
            aria-label={t("Search sites")}
            placeholder={t("Search sites…")}
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            className="pl-9"
          />
        </div>
        {teamSelector}
        {allTags.length > 0 && (
          <div className="w-[200px]">
            <MultiSelect
              options={allTags.map((tag) => ({ value: tag, label: tag }))}
              value={selectedTags}
              onValueChange={setSelectedTags}
              placeholder={t("Filter by tags...")}
              searchPlaceholder={t("Search tags...")}
              emptyText={t("No tags found.")}
              className="border-neutral-150 dark:border-neutral-800"
            />
          </div>
        )}
        <Button
          variant={grouped ? "secondary" : "outline"}
          aria-pressed={grouped}
          onClick={toggleGrouping}
        >
          <FolderTree className="h-4 w-4" />
          {t("Group by account")}
        </Button>
        {session?.user.role === 'admin' && <Button
          variant="outline"
          loading={syncing}
          onClick={() => void syncProperties()}
        >
          <RefreshCw className="h-4 w-4" />
          {t("Sync properties")}
        </Button>}
      </div>
    ) : null;

  const renderCards = (cardSites: GetSitesFromOrgResponse["sites"]) => (
    <SiteCards
      organizationId={activeOrganization?.id ?? ""}
      metrics={cardMetrics.data ?? {}}
      retry={() => { void cardMetrics.refetch(); }}
      sites={
        cardSites.map((site) => ({
          ...site,
          tags: site.tags ?? [],
          canEditTags: site.permissions?.includes("sites:configure") ?? false,
        })) ?? []
      }
      allTags={allTags}
      onTagsUpdated={refetchSites}
      selectedTags={selectedTags}
      onTagClick={handleTagClick}
    />
  );

  const siteCards = (
    <div className="flex flex-col gap-2">
      {cardMetrics.isError && !cardMetrics.data ? (
        <ErrorState title={t("Data unavailable")} message={cardMetrics.error.message} refetch={() => { void cardMetrics.refetch(); }} />
      ) : grouped
        ? accountGroups(paginatedSites, true).map((group) => (
            <section
              className="space-y-3"
              key={group.accountId ?? "unknown"}
              aria-label={group.accountName}
            >
              <h2 className="text-sm font-medium">
                {group.accountName}{" "}
                <span className="ml-2 text-neutral-500">
                  {group.properties.length}
                </span>
              </h2>
              <div className="flex flex-col gap-2">
                {renderCards(group.properties)}
              </div>
            </section>
          ))
        : renderCards(paginatedSites)}
      {hasSites && hasNoMatches ? (
        <Card className="p-6 flex flex-col items-center text-center">
          <CardTitle className="mb-2 text-xl">
            {t("No matching websites")}
          </CardTitle>
          <CardDescription>{t("Try adjusting your filters")}</CardDescription>
        </Card>
      ) : null}
      {hasNoSites && hasNoPlan && activeOrganization ? <></> : null}
      {hasNoSites && !hasNoPlan ? (
        <Card className="p-6 flex flex-col items-center text-center">
          <CardTitle className="mb-2 text-xl">{t("No websites yet")}</CardTitle>
          <CardDescription className="mb-4">
            {t("Add your first website to start tracking analytics")}
          </CardDescription>
          <></>
        </Card>
      ) : null}
    </div>
  );

  const pagination =
    hasSites && totalPages > 1 ? (
      <div className="mt-4">
        <Pagination
          page={safePage}
          pageCount={totalPages}
          totalItems={totalFiltered}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          itemName={t("websites")}
        />
      </div>
    ) : null;

  const content = (
    <Tabs value={view} onValueChange={setView} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
        <div className="w-56"><OrganizationSelector /></div>
        {canAddSites && <AddSite />}
      </div>
      {hasNoOrganizations && <NoOrganization />}
      <div
        className="flex flex-wrap items-center justify-between gap-3 pt-4"
        data-home-toolbar
      >
        <TabsList aria-label={t("Site views")}>
          <TabsTrigger value="cards">{t("Cards")}</TabsTrigger>
          <TabsTrigger value="status">{t("Status")}</TabsTrigger>
          <TabsTrigger value="table">{t("Table")}</TabsTrigger>
          <TabsTrigger value="heatmap">{t("Heatmap")}</TabsTrigger>
        </TabsList>
        <div className="flex flex-wrap items-center gap-3">
          <ReportFreshness
            site={`organization:${activeOrganization?.id ?? "ga4"}`}
          />
          {dateControls}
        </div>
      </div>
      {filterBar}
      {syncMessage && (
        <p role="status" className="text-xs text-neutral-500">
          {syncMessage}
        </p>
      )}
      <TabsContent value={view} className="space-y-3">
        {isCards ? (
          <>
            {siteCards}
            {pagination}
          </>
        ) : (
          <SiteReports
            view={view}
            organizationId={activeOrganization?.id ?? "ga4"}
            siteIds={filteredSites?.map((site) => site.siteId) ?? []}
            ready={!isLoading}
            grouped={grouped}
            metadata={filteredSites ?? []}
          />
        )}
      </TabsContent>
    </Tabs>
  );

  if (!isDesktop) {
    return (
      <StandardPage>
        {content}
      </StandardPage>
    );
  }

  return (
    <div className="flex h-full">
      <AppSidebar />
      <StandardPage showSidebar={false}>{content}</StandardPage>
    </div>
  );
}
