import { DateTime } from "luxon";
import { useMemo } from "react";
import { SiteSessionChart } from "../../rybbit/src/components/SiteSessionChart";
import { useTimezone } from "../../rybbit/src/lib/store";
import { useExtracted } from "../extracted";

export function RealtimeChart({
  values,
  fetchedAt,
  className = "h-16",
}: {
  values?: number[] | null;
  fetchedAt?: number;
  className?: string;
}) {
  const t = useExtracted();
  const zone = useTimezone();
  const data = useMemo(() => {
    if (!values?.length || !fetchedAt) return [];
    const minute = Math.floor(fetchedAt / 60_000) * 60_000;
    return values.map((users, i) => ({
      time: DateTime.fromMillis(minute - (values.length - 1 - i) * 60_000, {
        zone,
      }).toSQL()!,
      sessions: users,
    }));
  }, [values, fetchedAt, zone]);
  return (
    <div
      className={className}
      role="img"
      aria-label={t("Active users per minute, last 30 minutes")}
    >
      {data.length ? (
        <SiteSessionChart
          data={data}
          metricLabel={t("Active users")}
          bucket="minute"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-neutral-500">
          {t("Minute-by-minute data unavailable")}
        </div>
      )}
    </div>
  );
}
