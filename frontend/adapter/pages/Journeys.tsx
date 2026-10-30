import { Info } from "lucide-react";
import { useAnalyticsQuery } from "../../rybbit/src/api/analytics/useAnalyticsQuery";
import { Button } from "../../rybbit/src/components/ui/button";
import { Skeleton } from "../../rybbit/src/components/ui/skeleton";
import NativeJourneysPage from "../../rybbit/src/app/[site]/journeys/page";
import { useStore } from "../../rybbit/src/lib/store";
import { useExtracted } from "../extracted";
import { PageTransitions } from "../journeys/PageTransitions";
import { navigate, useLocation } from "../navigation";

type Capabilities = { available: boolean; source: "demo-sessions" | "ordered-sessions" | "bigquery" | null; availableFrom?: string; availableThrough?: string };

export default function JourneysPage() {
  const t = useExtracted();
  const site = useStore(state => state.site);
  const location = useLocation();
  const query = useAnalyticsQuery<Capabilities>({ key: "journey-capabilities", path: "journeys/capabilities", useTime: false, useFilters: false, staleTime: 60_000, placeholder: false });
  const showTransitions = new URL(location).searchParams.get("journeyView") === "transitions";
  const setView = (transitions: boolean) => {
    const url = new URL(location);
    if (transitions) url.searchParams.set("journeyView", "transitions");
    else url.searchParams.delete("journeyView");
    navigate(url.pathname + url.search);
  };
  if (showTransitions || (!query.isLoading && !query.data?.available)) {
    return <PageTransitions key={site} onBack={query.data?.available ? () => setView(false) : undefined} />;
  }
  if (query.isLoading) return <div className="mx-auto max-w-[1300px] space-y-3 p-2 md:p-4"><Skeleton className="h-8" /><Skeleton className="h-80" /></div>;
  const transitionsButton = <Button variant="outline" size="sm" onClick={() => setView(true)}>{t("View page transitions")}</Button>;
  return <NativeJourneysPage key={site} sourceAvailable
    sourceNotice={query.data?.source === "demo-sessions" || query.data?.source === "bigquery" ? <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400"><p className="flex items-start gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{query.data.source === "bigquery" ? t("GA4 exported events. Paths use the selected period; recent exports may still be processing.") : t("Demo session events. Paths, exits and session lists use synthetic data for this property.")}</p>{transitionsButton}</div> : transitionsButton} />;
}
