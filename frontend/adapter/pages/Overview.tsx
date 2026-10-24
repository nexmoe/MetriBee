import { ReactNode } from "react";
import { useExtracted } from "../extracted";
import { useGetLiveUserCount } from "../../rybbit/src/api/analytics/hooks/useGetLiveUserCount";
import { useInView } from "../../rybbit/src/hooks/useInView";
import { useSetPageTitle } from "../../rybbit/src/hooks/useSetPageTitle";
import { useStore } from "../../rybbit/src/lib/store";
import { SubHeader } from "../../rybbit/src/app/[site]/components/SubHeader/SubHeader";
import { SearchMainSection } from "../overview/SearchMainSection";
import { Referrers } from "../../rybbit/src/app/[site]/main/components/sections/Referrers";
import { Pages } from "../../rybbit/src/app/[site]/main/components/sections/Pages";
import { Devices } from "../../rybbit/src/app/[site]/main/components/sections/Devices";
import { Countries } from "../../rybbit/src/app/[site]/main/components/sections/Countries";
import { Events } from "../../rybbit/src/app/[site]/main/components/sections/Events";
import { Weekdays } from "../../rybbit/src/app/[site]/main/components/sections/Weekdays";
import { Revenue, Visitors, TrafficQuality, reportTab, sourceInsightsTab, WeekdaySummary } from "../overview/Supplements";
import { WhatChanged, Spikes } from "../overview/Insights";
import { useSearchIntegration } from "../overview/SearchConsole";
import { StandardSectionRenderer } from "../../rybbit/src/app/[site]/components/shared/StandardSection/StandardSectionTabs";

function LazySection({ children, id }: { children: ReactNode; id: string }) {
  const { ref, isInView } = useInView({ persistVisibility: true, rootMargin: "100px 0px" });
  return <section id={id} ref={ref} className="min-w-0 scroll-mt-4" style={{ minHeight: isInView ? undefined : 405 }}>{isInView ? children : null}</section>;
}
export default function Overview() {
  const site = useStore(s => s.site);
  const { data } = useGetLiveUserCount(5);
  const t = useExtracted();
  const search = useSearchIntegration();
  useSetPageTitle(`${data?.count ?? "…"} users online`);
  if (!site) return null;
  return <StandardSectionRenderer.Provider value={search.sectionRenderer}><div className="mx-auto max-w-[1100px] space-y-3 p-2 md:p-4">
    <SubHeader />
    <SearchMainSection />
    <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
      <LazySection id="sources"><Referrers sourceTab={reportTab("source-medium", t("Sources"), "traffic-sources")} additionalTabs={[
        reportTab("referring-urls", t("Referrers"), "referrers"),
        ...search.keywordsTabs,
        sourceInsightsTab(t("Insights")),
      ]} /></LazySection>
      <LazySection id="content"><Pages additionalTabs={[reportTab("engagement", t("Engagement"), "content-engagement")]} /></LazySection>
      <LazySection id="technology"><Devices /></LazySection>
      <LazySection id="geography"><Countries /></LazySection>
      <LazySection id="events"><Events additionalTabs={[
        reportTab("all-events", t("All Events"), "events"),
        reportTab("key-events", t("Key Events"), "revenue-key-events"),
      ]} /></LazySection>
      <LazySection id="weekly"><Weekdays summary={<WeekdaySummary />} /></LazySection>
      <LazySection id="quality"><TrafficQuality /></LazySection>
      <LazySection id="visitors"><Visitors /></LazySection>
      <LazySection id="what-changed"><WhatChanged /></LazySection>
      <LazySection id="spikes"><Spikes /></LazySection>
      <LazySection id="revenue"><Revenue /></LazySection>
    </div>
  </div></StandardSectionRenderer.Provider>;
}
