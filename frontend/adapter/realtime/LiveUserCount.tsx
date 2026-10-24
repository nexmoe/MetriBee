import { Rewind } from "lucide-react";
import { useAnalyticsQuery } from "../../rybbit/src/api/analytics/useAnalyticsQuery";
import { LiveUserCount as NativeLiveUserCount } from "../../rybbit/src/app/[site]/components/SubHeader/LiveUserCount";
import { TabbedSectionCard } from "../../rybbit/src/app/[site]/components/shared/TabbedSectionCard";
import { StandardSkeleton } from "../../rybbit/src/app/[site]/components/shared/StandardSection/Skeleton";
import { ErrorState } from "../../rybbit/src/components/ErrorState";
import { NothingFound } from "../../rybbit/src/components/NothingFound";
import { StatBand } from "../../rybbit/src/components/site/StatBand";
import { ScrollArea } from "../../rybbit/src/components/ui/scroll-area";
import { useExtracted } from "../extracted";
import { NativeList } from "../overview/ReportPanel";

type LiveGroup = { rows: { name: string; countryCode?: string; users: number }[]; totalCount: number; truncated: boolean };
type LiveUsers = { activeUsers: number; pageviews: number; countries: LiveGroup; devices: LiveGroup; pages: LiveGroup };

export function LiveUserCount() {
  return <NativeLiveUserCount renderDetails={openedAt => <LiveUserDetails key={openedAt} openedAt={openedAt} />} />;
}

function LiveUserDetails({ openedAt }: { openedAt: number }) {
  const t = useExtracted();
  const query = useAnalyticsQuery<LiveUsers>({
    key: "ga4-live-users",
    path: "ga4/live-users",
    useTime: false,
    useFilters: false,
    placeholder: false,
    staleTime: 0,
    refetchInterval: 10_000,
  });
  const refreshed = query.dataUpdatedAt >= openedAt;
  const data = refreshed ? query.data : undefined;
  const groups = [
    { key: "countries", label: t("Countries"), title: t("Country") },
    { key: "devices", label: t("Devices"), title: t("Device") },
    { key: "pages", label: t("Pages"), title: t("Page title") },
  ] as const;

  return <ScrollArea className="h-[75vh]" maskClassName="before:from-white dark:before:from-neutral-950 after:from-white dark:after:from-neutral-950">
    <div className="mx-auto max-w-[1100px] space-y-4 p-2 md:p-4">
      <div className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">{t("Users online in past 5 minutes")}</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("GA4 realtime data is aggregated by country, device and page.")}</p>
      </div>
      {!data ? query.isError && query.fetchStatus === "idle"
        ? <ErrorState title={t("Failed to load data")} message={query.error.message} refetch={() => void query.refetch()} />
        : <div className="flex flex-col gap-2"><StandardSkeleton /></div>
        : <>
          <StatBand columns={2} cells={[
            { label: t("Active Users"), value: data.activeUsers.toLocaleString() },
            { label: t("Pageviews"), value: data.pageviews.toLocaleString() },
          ]} />
          {data.activeUsers === 0 ? <NothingFound icon={<Rewind className="size-10" />} title={t("No users online in the past 5 minutes")} />
            : <TabbedSectionCard defaultValue="countries" tabs={groups.map(group => {
              const section = data[group.key];
              return { value: group.key, label: group.label, content: <NativeList
                title={group.title} valueLabel={t("Active Users")} showPercentage={false}
                items={section.rows.map(row => ({ key: JSON.stringify([row.name, row.countryCode]), label: row.name && row.name !== "(not set)" ? row.name : t("Unknown"), value: row.users }))}
                footer={section.truncated ? <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("Showing the top {count} results.", { count: section.rows.length })}</p> : undefined}
              /> };
            })} />}
        </>}
    </div>
  </ScrollArea>;
}
