"use client";

import { Footprints, LogIn, LogOut, Split, Target } from "lucide-react";
import { useExtracted } from "next-intl";
import { JourneySummary } from "@/api/analytics/endpoints";
import { useJourneyContext } from "@/api/analytics/hooks/useGetJourneys";
import { StatBand } from "@/components/site/StatBand";
import { percentDelta, pointDelta } from "@/lib/delta";

const share = (part: number, whole: number) => `${((part / whole) * 100).toFixed(1)}%`;

export interface JourneyStatsProps {
  summary: JourneySummary | undefined;
  /** The comparison period's figures; undefined while it is off or loading. */
  previous: JourneySummary | undefined;
  isLoading: boolean;
  /** The selected goal's name; null leaves the reach cell out. */
  goalName: string | null;
}

/** The figures that open the journeys page: how many sessions have a path at all, and where paths start, end and convert. */
export function JourneyStats({ summary, previous, isLoading, goalName }: JourneyStatsProps) {
  const t = useExtracted();
  const context = useJourneyContext();

  const sessions = summary?.sessions ?? 0;
  const reach = summary && summary.conversions !== null && sessions > 0 ? (summary.conversions / sessions) * 100 : null;
  const previousReach =
    previous && previous.conversions !== null && previous.sessions > 0
      ? (previous.conversions / previous.sessions) * 100
      : null;

  return (
    <StatBand
      isLoading={isLoading}
      cells={[
        {
          id: "multi-page",
          icon: <Split className="h-3 w-3" />,
          label: t("Internal page views"),
          value: sessions.toLocaleString(),
          delta: percentDelta(summary?.sessions, previous?.sessions),
          sub:
            context.sessions && sessions <= context.sessions
              ? t("{percent} of {total} page views", {
                  percent: share(sessions, context.sessions),
                  total: context.sessions.toLocaleString(),
                })
              : "",
        },
        {
          id: "path-length",
          icon: <Footprints className="h-3 w-3" />,
          label: t("Transition length"),
          value: sessions > 0 ? t("{count} pages", { count: (summary?.avgPathLength ?? 0).toFixed(1) }) : "–",
          sub:
            previous && previous.sessions > 0
              ? t("{count} in the comparison period", { count: previous.avgPathLength.toFixed(2) })
              : "",
        },
        {
          id: "top-entry",
          icon: <LogIn className="h-3 w-3" />,
          label: t("Top entry page"),
          value: context.topEntry?.value ?? "–",
          title: context.topEntry?.value,
          isLoading: context.isLoading,
          sub: context.topEntry
            ? t("{count} entries · {percent} of sessions", {
                count: context.topEntry.count.toLocaleString(),
                percent: `${context.topEntry.percentage.toFixed(1)}%`,
              })
            : "",
        },
        {
          id: "top-exit",
          icon: <LogOut className="h-3 w-3" />,
          label: t("Top destination"),
          value: summary?.topExit?.page ?? "–",
          title: summary?.topExit?.page,
          sub: summary?.topExit
            ? t("{percent} of internal page views arrive here", { percent: share(summary.topExit.sessions, sessions) })
            : "",
        },
        goalName !== null && {
          id: "goal-reach",
          icon: <Target className="h-3 w-3" />,
          label: t("Reach {goal}", { goal: goalName }),
          value: reach === null ? "–" : `${reach.toFixed(1)}%`,
          delta: pointDelta(reach, previousReach),
          sub:
            summary && summary.conversions !== null
              ? t("{count} of {total} sessions", {
                  count: summary.conversions.toLocaleString(),
                  total: sessions.toLocaleString(),
                })
              : "",
        },
      ]}
    />
  );
}
