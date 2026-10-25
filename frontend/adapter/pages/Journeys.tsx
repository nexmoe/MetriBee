import { Info, Route } from "lucide-react";
import { useAnalyticsQuery } from "../../rybbit/src/api/analytics/useAnalyticsQuery";
import { Button } from "../../rybbit/src/components/ui/button";
import { ErrorState } from "../../rybbit/src/components/ErrorState";
import { Skeleton } from "../../rybbit/src/components/ui/skeleton";
import NativeJourneysPage from "../../rybbit/src/app/[site]/journeys/page";
import { useStore } from "../../rybbit/src/lib/store";
import { useExtracted } from "../extracted";
import { PageTransitions } from "../journeys/PageTransitions";
import { navigate, useLocation } from "../navigation";

type Capabilities = { available: boolean; source: "demo-sessions" | "ordered-sessions" | null };

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
  if (showTransitions) return <PageTransitions key={site} onBack={() => setView(false)} />;
  const transitionsButton = <Button variant="outline" size="sm" onClick={() => setView(true)}>{t("View page transitions")}</Button>;
  return <NativeJourneysPage key={site} sourceAvailable={query.data?.available ?? false}
    sourceNotice={query.data?.source === "demo-sessions" && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400"><p className="flex items-start gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t("Demo session events. Paths, exits and session lists use synthetic data for this property.")}</p>{transitionsButton}</div>}
    unavailableState={query.isLoading ? <Skeleton className="h-80" /> : query.error ? <ErrorState title={t("Failed to load journeys")} message={query.error.message} refetch={query.refetch} /> : <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 py-6 text-center">
      <Route className="h-5 w-5 text-neutral-400" />
      <p className="text-sm font-medium">{t("Session event data required")}</p>
      <p className="max-w-md text-xs text-neutral-500 dark:text-neutral-400">{t("Multi-step journeys, session lists and exits need ordered session events. This GA4 connection currently provides referrer-to-page views.")}</p>
      {transitionsButton}
    </div>} />;
}
