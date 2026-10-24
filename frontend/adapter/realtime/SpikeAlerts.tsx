import Link from "next/link";
import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { Alert } from "../../rybbit/src/components/ui/alert";
import { Badge } from "../../rybbit/src/components/ui/badge";
import { Button } from "../../rybbit/src/components/ui/button";
import { useExtracted } from "../extracted";
import { fmt } from "../pages/shared";
import { ratioText, ScoredProperty } from "./model";

export type SpikeContext = {
  propertyId: string;
  topPage?: string;
  reasonSummary?: string;
  topReferrals?: { classifiedName: string; users: number; category: string }[];
};
export function SpikeAlerts({
  spikes,
  context,
  contextUnavailable,
  collapsed,
  onToggle,
  privacy,
}: {
  spikes: ScoredProperty[];
  context?: SpikeContext[];
  contextUnavailable?: boolean;
  collapsed: boolean;
  onToggle: () => void;
  privacy: boolean;
}) {
  const t = useExtracted();
  if (!spikes.length) return null;
  return (
    <Alert variant="warning" role="status">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400" />
        <div className="min-w-0 flex-1 space-y-3" id="realtime-spike-alerts">
          {collapsed ? (
            <p className="text-sm font-medium">
              {t("{count} properties spiking", {
                count: String(spikes.length),
              })}
              :{" "}
              <span className={privacy ? "blur-sm" : ""}>
                {spikes
                  .map((row) => row.siteName || row.domain || row.propertyId)
                  .join(", ")}
              </span>
            </p>
          ) : (
            spikes.slice(0, 2).map((row) => {
              const detail = context?.find(
                (item) => String(item.propertyId) === String(row.propertyId)
              );
              const source = detail?.topReferrals?.[0];
              return (
                <div key={row.propertyId} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                    <Link
                      className={privacy ? "blur-sm" : ""}
                      href={`/analytics?prop=${row.propertyId}`}
                    >
                      {row.siteName || row.domain || row.propertyId}
                    </Link>
                    <span>
                      · {fmt(row.activeUsers)} {t("active")} ·{" "}
                      {ratioText(row.score!.ratio)}×{" "}
                      {row.baselineKind === "same-hour"
                        ? t("usual for this hour")
                        : t("usual peak")}
                    </span>
                    <Badge variant="warning">{t("Spike")}</Badge>
                  </div>
                  <div
                    className={`text-xs text-neutral-600 dark:text-neutral-300 ${
                      privacy ? "blur-sm" : ""
                    }`}
                  >
                    {t("High concurrent active visitor count ({count} active users)", { count: fmt(row.activeUsers) })}
                    {detail?.topPage && detail.topPage !== "/" && (
                      <span>
                        {" "}
                        · {t("Active page")}: {detail.topPage}
                      </span>
                    )}
                    {source && source.category !== "direct" && (
                      <span>
                        {" "}
                        · {t("Today’s leading source")}: {source.classifiedName}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
          {!collapsed && contextUnavailable && (
            <p className="text-xs text-neutral-500">
              {t(
                "Additional spike context is unavailable. Alerts still use the realtime feed."
              )}
            </p>
          )}
          {!collapsed && spikes.length > 2 && (
            <p className="text-xs">
              {t("{count} more spiking", { count: String(spikes.length - 2) })}:{" "}
              <span className={privacy ? "blur-sm" : ""}>
                {spikes
                  .slice(2)
                  .map((row) => row.siteName || row.domain || row.propertyId)
                  .join(", ")}
              </span>
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="smIcon"
          className="-my-1 shrink-0"
          aria-controls="realtime-spike-alerts"
          aria-expanded={!collapsed}
          aria-label={
            collapsed ? t("Expand spike alerts") : t("Collapse spike alerts")
          }
          onClick={onToggle}
        >
          {collapsed ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </Button>
      </div>
    </Alert>
  );
}
