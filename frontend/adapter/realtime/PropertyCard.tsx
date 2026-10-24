import Link from "next/link";
import {
  Ellipsis,
  ExternalLink,
  Globe,
  ChartNoAxesCombined,
} from "lucide-react";
import { Favicon } from "../../rybbit/src/components/Favicon";
import { Badge } from "../../rybbit/src/components/ui/badge";
import { Button } from "../../rybbit/src/components/ui/button";
import { Card } from "../../rybbit/src/components/ui/card";
import { Progress } from "../../rybbit/src/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../rybbit/src/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "../../rybbit/src/components/ui/tooltip";
import { useExtracted } from "../extracted";
import { fmt } from "../pages/shared";
import { meterPercent, ratioText, ScoredProperty, SpikeRule } from "./model";
import { RealtimeChart } from "./RealtimeChart";

export function BaselineMeter({
  row,
  rule,
}: {
  row: ScoredProperty;
  rule: SpikeRule;
}) {
  const t = useExtracted();
  if (!row.score)
    return <p className="text-xs text-neutral-500">{t("No baseline yet")}</p>;
  const usual =
    row.baselineKind === "same-hour"
      ? t("usual for this hour")
      : t("usual peak");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          className="flex items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-500"
        >
          <div className="relative flex-1 py-1">
            <Progress
              value={meterPercent(row.score.ratio, rule)}
              aria-label={t("Traffic relative to usual")}
              className={`h-1.5 rounded-sm ${
                row.score.isSpike
                  ? "[&>div]:bg-yellow-600 dark:[&>div]:bg-yellow-500"
                  : "[&>div]:bg-neutral-500"
              }`}
            />
            <span
              aria-hidden="true"
              className="absolute bottom-0 left-[75%] top-0 w-px bg-neutral-500 dark:bg-neutral-300"
            />
          </div>
          <span
            className={`shrink-0 text-xs tabular-nums ${
              row.score.isSpike
                ? "font-medium text-yellow-700 dark:text-yellow-400"
                : "text-neutral-500 dark:text-neutral-400"
            }`}
          >
            {ratioText(row.score.ratio)}× {t("usual")}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1">
        <p>
          {fmt(row.activeUsers)} {t("active users")} · {t("Usual")}{" "}
          {fmt(row.baseline)} ({usual})
        </p>
        <p>
          z {row.score.z.toFixed(2)}
          {row.baselineSd != null && ` · ${t("Spread")} ${fmt(row.baselineSd)}`}
        </p>
        <p>
          {t("Spike threshold")}: z ≥ {rule.z} {t("and")} ≥ {rule.lift}×.{" "}
          {t("The marker shows the minimum lift.")}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export function PropertyCard({
  row,
  rule,
  privacy,
  fetchedAt,
}: {
  row: ScoredProperty;
  rule: SpikeRule;
  privacy: boolean;
  fetchedAt?: number;
}) {
  const t = useExtracted();
  const report = `/analytics?prop=${encodeURIComponent(row.propertyId)}`;
  const website =
    row.websiteUrl || row.url || (row.domain ? `https://${row.domain}` : null);
  return (
    <Card
      className={`flex flex-col gap-4 p-4 ${
        row.score?.isSpike
          ? "border-yellow-500/50 dark:border-yellow-500/40"
          : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={report}
          className={`flex min-w-0 items-center gap-2.5 ${
            privacy ? "blur-sm" : ""
          }`}
        >
          {row.domain && (
            <Favicon
              domain={row.domain}
              className="h-5 w-5 shrink-0 rounded-sm"
            />
          )}
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium">
              {row.siteName || row.domain || row.propertyId}
            </h3>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {row.domain || row.propertyId}
            </p>
          </div>
        </Link>
        <div className="flex shrink-0 items-center gap-1">
          {row.score?.isSpike ? (
            <Badge variant="warning">{t("Spike")}</Badge>
          ) : row.score?.above ? (
            <Badge variant="secondary">{t("Above usual")}</Badge>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="smIcon"
                aria-label={t("Property actions")}
              >
                <Ellipsis className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={report}>
                  <ChartNoAxesCombined />
                  {t("Open report")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href={`https://analytics.google.com/analytics/web/#/p${row.propertyId}/reports/intelligenthome`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink />
                  {t("Open GA4")}
                </a>
              </DropdownMenuItem>
              {website && (
                <DropdownMenuItem asChild>
                  <a href={website} target="_blank" rel="noreferrer">
                    <Globe />
                    {t("Visit site")}
                  </a>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-2xl font-semibold tabular-nums">
            {fmt(row.activeUsers)}
          </p>
          <p className="text-xs text-neutral-500">{t("active users")}</p>
        </div>
        <div>
          <p className="text-2xl font-semibold tabular-nums">
            {fmt(row.pageViews)}
          </p>
          <p className="text-xs text-neutral-500">{t("pageviews")}</p>
        </div>
      </div>
      <RealtimeChart values={row.series} fetchedAt={fetchedAt} />
      <BaselineMeter row={row} rule={rule} />
    </Card>
  );
}
