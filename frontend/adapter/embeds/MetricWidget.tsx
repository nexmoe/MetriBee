import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { useExtracted } from "../extracted";
import {
  WIDGET_METRICS,
  type WidgetConfig,
  type WidgetMetric,
  type WidgetReport,
} from "../../../controllers/widgetConfig";
import { StatBand } from "../../rybbit/src/components/site/StatBand";
import { Delta } from "../../rybbit/src/components/site/Delta";
import { SiteSessionChart } from "../../rybbit/src/components/SiteSessionChart";
import { Skeleton } from "../../rybbit/src/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../rybbit/src/components/ui/select";
import { percentDelta, pointDelta } from "../../rybbit/src/lib/delta";
import { cn } from "../../rybbit/src/lib/utils";

export function formatWidgetValue(
  value: number | null | undefined,
  metric: WidgetMetric,
  locale: string,
  currency: string
) {
  if (value == null || !Number.isFinite(value)) return "—";
  const format =
    metric.format === "auto"
      ? WIDGET_METRICS[metric.metric].format
      : metric.format;
  const options = {
    minimumFractionDigits: metric.decimals,
    maximumFractionDigits: metric.decimals,
  };
  if (format === "duration") {
    const seconds = Math.round(value);
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }
  if (format === "percent") return `${value.toLocaleString(locale, options)}%`;
  if (format === "currency") {
    if (/^[A-Z]{3}$/.test(currency))
      return value.toLocaleString(locale, {
        ...options,
        style: "currency",
        currency,
      });
    return value.toLocaleString(locale, options);
  }
  return value.toLocaleString(locale, {
    ...options,
    ...(format === "compact" ? { notation: "compact" as const } : {}),
  });
}
export function MetricWidget({
  config,
  data,
  loading = false,
}: {
  config: WidgetConfig;
  data?: WidgetReport;
  loading?: boolean;
}) {
  const t = useExtracted(),
    locale = useLocale();
  const [selected, setSelected] = useState(config.chartMetric);
  useEffect(() => setSelected(config.chartMetric), [config.chartMetric]);
  const chartMetric =
    config.metrics.find((item) => item.metric === selected) ||
    config.metrics.find((item) => item.metric === config.chartMetric) ||
    config.metrics[0];
  const label = (metric: WidgetMetric) =>
    metric.label || t(WIDGET_METRICS[metric.metric].label);
  const format = (metric: WidgetMetric, value: number | null | undefined) =>
    formatWidgetValue(value, metric, locale, data?.currencyCode || "");
  const delta = (metric: WidgetMetric) =>
    config.comparison && data?.previous
      ? WIDGET_METRICS[metric.metric].format === "percent"
        ? pointDelta(data.values[metric.metric], data.previous[metric.metric])
        : percentDelta(data.values[metric.metric], data.previous[metric.metric])
      : null;
  const footer =
    data && config.showUpdated ? (
      <p className="text-[11px] text-muted-foreground">
        {t("Updated")}{" "}
        {new Date(data.fetchedAt).toLocaleString(locale, {
          timeZone: data.timeZone,
        })}{" "}
        · {data.timeZone}
        {data.comparisonUnavailable ? ` · ${t("Comparison unavailable")}` : ""}
        {data.limited ? ` · ${t("GA4 reporting limits apply")}` : ""}
      </p>
    ) : null;
  if (config.layout === "inline")
    return (
      <div
        className={cn(
          "flex w-max max-w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-neutral-150 px-3 py-2 text-sm dark:border-neutral-800",
          !config.transparent && "bg-white dark:bg-neutral-900"
        )}
      >
        {config.showTitle && config.title && (
          <span className="font-medium">{config.title}</span>
        )}
        {config.metrics.map((metric) => (
          <span
            key={metric.metric}
            className="inline-flex min-w-0 max-w-full items-baseline gap-1.5"
          >
            <span className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {label(metric)}
            </span>
            <strong className="font-semibold tabular-nums">
              {loading ? "…" : format(metric, data?.values[metric.metric])}
            </strong>
            <Delta
              value={delta(metric)}
              upIsGood={WIDGET_METRICS[metric.metric].upIsGood}
            />
          </span>
        ))}
        {config.showPeriod && data && (
          <span className="text-[11px] text-muted-foreground">
            {data.range.startDate} – {data.range.endDate}
          </span>
        )}
        {footer}
      </div>
    );
  return (
    <article
      className={cn(
        "space-y-4 rounded-lg border border-neutral-150 p-4 dark:border-neutral-850",
        !config.transparent && "bg-white dark:bg-neutral-900"
      )}
    >
      {(config.showTitle || config.showPeriod) && (
        <header className="space-y-1">
          {config.showTitle && config.title && (
            <h1 className="truncate text-base font-semibold tracking-tight">
              {config.title}
            </h1>
          )}
          {config.showPeriod && (
            <p className="text-xs text-muted-foreground">
              {data ? `${data.range.startDate} – ${data.range.endDate}` : "…"}
              {data?.previousRange &&
                ` · ${t("vs.")} ${data.previousRange.startDate} – ${
                  data.previousRange.endDate
                }`}
            </p>
          )}
        </header>
      )}
      <StatBand
        columns={config.columns}
        transparent={config.transparent}
        isLoading={loading}
        cells={config.metrics.map((metric) => ({
          id: metric.metric,
          label: label(metric),
          value: format(metric, data?.values[metric.metric]),
          delta: delta(metric),
          upIsGood: WIDGET_METRICS[metric.metric].upIsGood,
          title: data?.values[metric.metric]?.toLocaleString(locale),
        }))}
      />
      {config.layout === "card" && config.showChart && (
        <section className="space-y-2">
          <Select
            value={chartMetric.metric}
            onValueChange={(value) => setSelected(value as typeof selected)}
          >
            <SelectTrigger
              size="sm"
              className="h-7 w-auto min-w-32 text-xs"
              aria-label={t("Chart metric")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {config.metrics.map((metric) => (
                <SelectItem key={metric.metric} value={metric.metric}>
                  {label(metric)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div
            className="h-28"
            aria-label={`${label(chartMetric)} ${t("trend")}`}
          >
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : data?.series.some(
                (point) => point.values[chartMetric.metric] != null
              ) ? (
              <SiteSessionChart
                data={data.series
                  .filter((point) => point.values[chartMetric.metric] != null)
                  .map((point) => ({
                    time: `${point.date} 00:00:00`,
                    sessions: point.values[chartMetric.metric]!,
                  }))}
                metricLabel={label(chartMetric)}
                bucket={config.bucket}
                color={config.accent}
                valueFormatter={(value) => format(chartMetric, value)}
              />
            ) : (
              <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {t("No data for this period.")}
              </p>
            )}
          </div>
        </section>
      )}
      {footer}
    </article>
  );
}
