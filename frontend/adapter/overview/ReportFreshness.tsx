import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFormatter, useNow } from "next-intl";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../rybbit/src/components/ui/tooltip";
import {
  reportStatusSnapshot,
  type ReportStatus,
} from "../../rybbit/src/api/analytics/reportStatus";
import { useExtracted } from "../extracted";

type Timestamp = string | number | null | undefined;
type FreshnessStatus = {
  fetchedAt: Timestamp;
  cacheStatus: ReportStatus["cacheStatus"] | "unknown";
};

function useRelativeTime(value: Timestamp) {
  const now = useNow({ updateInterval: 10_000 });
  const format = useFormatter();
  const t = useExtracted();
  const timestamp = value == null ? NaN : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  // Small differences between the server and browser clocks must not show a future update.
  return now.getTime() - timestamp < 60_000
    ? t("Just now")
    : format.relativeTime(new Date(timestamp), { now, style: "narrow" });
}

export function RelativeTime({ value }: { value: Timestamp }) {
  const time = useRelativeTime(value);
  const t = useExtracted();
  return time || t("Update time unavailable");
}

export function DataFreshness({
  status,
  updating = false,
  note,
  className = "justify-end",
}: {
  status: FreshnessStatus | null;
  updating?: boolean;
  note?: string;
  className?: string;
}) {
  const time = useRelativeTime(status?.fetchedAt);
  const t = useExtracted();
  return (
    <div
      role="status"
      className={`flex items-center text-xs text-muted-foreground ${className}`}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="whitespace-nowrap"
            aria-label={
              time
                ? t("Last updated: {time}", { time })
                : t("Update time unavailable")
            }
          >
            {time || (updating ? t("Updating…") : "—")}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {note ||
            t(
              "Oldest data fetch among the reports currently loaded. This is when data was fetched from GA4."
            )}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export function ReportFreshness({
  site,
  className,
}: {
  site: string;
  className?: string;
}) {
  const client = useQueryClient();
  const cache = client.getQueryCache();
  const subscribe = useCallback(
    (notify: () => void) => cache.subscribe(notify),
    [cache]
  );
  const snapshot = useCallback(
    () => reportStatusSnapshot(client, site),
    [client, site]
  );
  const serialized = useSyncExternalStore(subscribe, snapshot, () => "null");
  const status = JSON.parse(serialized) as
    | (ReportStatus & { updating: boolean })
    | null;
  return (
    <DataFreshness
      status={status}
      updating={status?.updating}
      className={className}
    />
  );
}
