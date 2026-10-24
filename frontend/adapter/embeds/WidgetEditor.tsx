import { useMemo, useState, type ReactNode } from "react";
import { useDebounce } from "@uidotdev/usehooks";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { useExtracted } from "../extracted";
import {
  normalizeWidgetConfig,
  WIDGET_METRICS,
  WIDGET_PERIODS,
  type SavedWidget,
  type WidgetConfig,
  type WidgetMetric,
  type WidgetMetricName,
} from "../../../controllers/widgetConfig";
import { ConfigurationEditorLayout } from "../../rybbit/src/components/ConfigurationEditorLayout";
import { Button } from "../../rybbit/src/components/ui/button";
import { Input } from "../../rybbit/src/components/ui/input";
import { Label } from "../../rybbit/src/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../rybbit/src/components/ui/select";
import { Switch } from "../../rybbit/src/components/ui/switch";
import { toast } from "../../rybbit/src/components/ui/sonner";
import { SettingsSection } from "../../rybbit/src/components/SiteSettings/SettingsSection";
import { WidgetPreview } from "./WidgetPreview";
import { widgetApi } from "./api";

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}
export function WidgetEditor({
  siteId,
  initial,
  widgetId,
  onCancel,
  onSaved,
}: {
  siteId: number;
  initial: WidgetConfig;
  widgetId?: string;
  onCancel: () => void;
  onSaved: (widget: SavedWidget) => void;
}) {
  const t = useExtracted();
  const [draft, setDraft] = useState(initial);
  const set = <K extends keyof WidgetConfig>(key: K, value: WidgetConfig[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const debounced = useDebounce(draft, 500);
  const parse = (value: WidgetConfig) => {
    try {
      return { config: normalizeWidgetConfig(value), error: "" };
    } catch (error) {
      return { config: undefined, error: (error as Error).message };
    }
  };
  const validation = useMemo(() => parse(draft), [draft]);
  const ready = useMemo(() => parse(debounced), [debounced]);
  const query = useQuery({
    queryKey: [
      "widget-preview",
      siteId,
      ready.config && {
        metrics: ready.config.metrics.map((item) => item.metric).sort(),
        period: ready.config.period,
        comparison: ready.config.comparison,
        bucket: ready.config.bucket,
        showChart: ready.config.showChart,
        layout: ready.config.layout,
        filters: ready.config.filters,
      },
    ],
    enabled: !!ready.config,
    queryFn: () => widgetApi.preview(siteId, ready.config!),
  });
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: query.data?.data.timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const save = useMutation({
    mutationFn: (config: WidgetConfig) =>
      widgetApi.save(siteId, config, widgetId),
    onSuccess: (result) => {
      toast.success(t("Widget saved"));
      onSaved(result.data);
    },
    onError: (error) => toast.error(error.message),
  });
  const setMetric = (index: number, patch: Partial<WidgetMetric>) =>
    set(
      "metrics",
      draft.metrics.map((metric, i) =>
        i === index ? { ...metric, ...patch } : metric
      )
    );
  const moveMetric = (index: number, offset: number) => {
    const metrics = [...draft.metrics];
    [metrics[index], metrics[index + offset]] = [
      metrics[index + offset],
      metrics[index],
    ];
    set("metrics", metrics);
  };
  const formats = [
    "auto",
    "number",
    "compact",
    "decimal",
    "percent",
    "duration",
    "currency",
  ] as const;
  return (
    <ConfigurationEditorLayout
      title={widgetId ? t("Edit widget") : t("Create widget")}
      actions={
        <>
          <Button variant="outline" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button
            variant="success"
            disabled={!validation.config || save.isPending}
            onClick={() => validation.config && save.mutate(validation.config)}
          >
            <Save className="h-4 w-4" />
            {save.isPending ? t("Saving...") : t("Save widget")}
          </Button>
        </>
      }
      builder={
        <>
          <SettingsSection title={t("Widget")}>
            <Field label={t("Name")} htmlFor="widget-name">
              <Input
                id="widget-name"
                autoFocus
                value={draft.name}
                maxLength={120}
                onChange={(event) => set("name", event.target.value)}
              />
            </Field>
            <Field label={t("Title")} htmlFor="widget-title">
              <Input
                id="widget-title"
                value={draft.title}
                maxLength={160}
                onChange={(event) => set("title", event.target.value)}
              />
            </Field>
          </SettingsSection>
          <SettingsSection
            title={t("Metrics")}
            description={t(
              "Choose up to six metrics. Each value is aggregated over the entire selected period."
            )}
          >
            {draft.metrics.map((item, index) => (
              <div
                key={item.metric}
                className="space-y-3 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="flex items-center gap-1.5">
                  <div className="min-w-0 flex-1">
                    <Choice
                      label={t("Metric {number}", { number: index + 1 })}
                      value={item.metric}
                      onChange={(value) => {
                        const metric = value as WidgetMetricName;
                        setMetric(index, {
                          metric,
                          format: "auto",
                          decimals:
                            WIDGET_METRICS[metric].format === "number" ? 0 : 1,
                        });
                      }}
                      options={Object.entries(WIDGET_METRICS)
                        .filter(
                          ([metric]) =>
                            metric === item.metric ||
                            !draft.metrics.some(
                              (entry) => entry.metric === metric
                            )
                        )
                        .map(([value, entry]) => ({
                          value,
                          label: t(entry.label),
                        }))}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="smIcon"
                    aria-label={t("Move metric up")}
                    disabled={index === 0}
                    onClick={() => moveMetric(index, -1)}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="smIcon"
                    aria-label={t("Move metric down")}
                    disabled={index === draft.metrics.length - 1}
                    onClick={() => moveMetric(index, 1)}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="smIcon"
                    aria-label={t("Remove metric")}
                    disabled={draft.metrics.length === 1}
                    onClick={() =>
                      set(
                        "metrics",
                        draft.metrics.filter((_, i) => index !== i)
                      )
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Input
                  aria-label={t("Metric label {number}", { number: index + 1 })}
                  placeholder={t("Label (optional)")}
                  value={item.label}
                  maxLength={80}
                  onChange={(event) =>
                    setMetric(index, { label: event.target.value })
                  }
                />
                <div className="grid grid-cols-[1fr_88px] gap-2">
                  <Field label={t("Format")}>
                    <Choice
                      label={t("Metric format {number}", { number: index + 1 })}
                      value={item.format}
                      options={formats
                        .filter(
                          (value) =>
                            value !== "percent" ||
                            WIDGET_METRICS[item.metric].format === "percent"
                        )
                        .map((value) => ({
                          value,
                          label: t(
                            value === "auto"
                              ? "Automatic"
                              : value[0].toUpperCase() + value.slice(1)
                          ),
                        }))}
                      onChange={(value) =>
                        setMetric(index, {
                          format: value as WidgetMetric["format"],
                        })
                      }
                    />
                  </Field>
                  <Field label={t("Decimals")}>
                    <Input
                      type="number"
                      min={0}
                      max={4}
                      aria-label={t("Decimal places {number}", {
                        number: index + 1,
                      })}
                      value={item.decimals}
                      onChange={(event) =>
                        setMetric(index, {
                          decimals: Math.max(
                            0,
                            Math.min(4, Number(event.target.value) || 0)
                          ),
                        })
                      }
                    />
                  </Field>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              className="w-full"
              disabled={draft.metrics.length >= 6}
              onClick={() => {
                const metric = (
                  Object.keys(WIDGET_METRICS) as WidgetMetricName[]
                ).find(
                  (name) => !draft.metrics.some((item) => item.metric === name)
                )!;
                set("metrics", [
                  ...draft.metrics,
                  { metric, label: "", format: "auto", decimals: 0 },
                ]);
              }}
            >
              <Plus className="h-4 w-4" />
              {t("Add metric")}
            </Button>
          </SettingsSection>
          <SettingsSection title={t("Time period")}>
            <Choice
              label={t("Time period")}
              value={draft.period.preset}
              options={Object.entries(WIDGET_PERIODS).map(([value, label]) => ({
                value,
                label: t(label),
              }))}
              onChange={(value) =>
                set(
                  "period",
                  value === "custom"
                    ? {
                        preset: "custom",
                        startDate: today,
                        endDate: today,
                      }
                    : { preset: value as WidgetConfig["period"]["preset"] }
                )
              }
            />
            {draft.period.preset === "custom" && (
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("Start date")}>
                  <Input
                    type="date"
                    aria-label={t("Start date")}
                    value={draft.period.startDate}
                    onChange={(event) =>
                      set("period", {
                        ...draft.period,
                        startDate: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label={t("End date")}>
                  <Input
                    type="date"
                    aria-label={t("End date")}
                    value={draft.period.endDate}
                    onChange={(event) =>
                      set("period", {
                        ...draft.period,
                        endDate: event.target.value,
                      })
                    }
                  />
                </Field>
              </div>
            )}
            <Toggle
              label={t("Compare with previous period")}
              checked={draft.comparison}
              onChange={(value) => set("comparison", value)}
            />
            <p className="text-xs text-muted-foreground">
              {t(
                "Natural months follow the property timezone. This month compares the same elapsed days in the previous month."
              )}
            </p>
          </SettingsSection>
          <SettingsSection title={t("Appearance")}>
            <Field label={t("Layout")}>
              <Choice
                label={t("Layout")}
                value={draft.layout}
                options={[
                  { value: "card", label: t("Card with trend") },
                  { value: "stats", label: t("Metrics only") },
                  { value: "inline", label: t("Inline badge") },
                ]}
                onChange={(value) =>
                  set("layout", value as WidgetConfig["layout"])
                }
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("Theme")}>
                <Choice
                  label={t("Theme")}
                  value={draft.theme}
                  options={["dark", "light", "system"].map((value) => ({
                    value,
                    label: t(value[0].toUpperCase() + value.slice(1)),
                  }))}
                  onChange={(value) =>
                    set("theme", value as WidgetConfig["theme"])
                  }
                />
              </Field>
              <Field label={t("Columns")}>
                <Choice
                  label={t("Columns")}
                  value={String(draft.columns)}
                  options={[1, 2, 3].map((value) => ({
                    value: String(value),
                    label: String(value),
                  }))}
                  onChange={(value) =>
                    set("columns", Number(value) as WidgetConfig["columns"])
                  }
                />
              </Field>
            </div>
            <Field
              label={t(
                draft.layout === "inline" ? "Maximum width (px)" : "Width (px)"
              )}
              htmlFor="custom-widget-width"
            >
              <Input
                id="custom-widget-width"
                type="number"
                min={240}
                max={1200}
                value={draft.width}
                onChange={(event) =>
                  set("width", Number(event.target.value) || 560)
                }
              />
            </Field>
            <Toggle
              label={t("Transparent background")}
              checked={draft.transparent}
              onChange={(value) => set("transparent", value)}
            />
            <Toggle
              label={t("Show title")}
              checked={draft.showTitle}
              onChange={(value) => set("showTitle", value)}
            />
            <Toggle
              label={t("Show date range")}
              checked={draft.showPeriod}
              onChange={(value) => set("showPeriod", value)}
            />
            <Toggle
              label={t("Show update time")}
              checked={draft.showUpdated}
              onChange={(value) => set("showUpdated", value)}
            />
            {draft.layout === "card" && (
              <>
                <Toggle
                  label={t("Show trend chart")}
                  checked={draft.showChart}
                  onChange={(value) => set("showChart", value)}
                />
                {draft.showChart && (
                  <>
                    <Field label={t("Default chart metric")}>
                      <Choice
                        label={t("Default chart metric")}
                        value={
                          draft.metrics.some(
                            (item) => item.metric === draft.chartMetric
                          )
                            ? draft.chartMetric
                            : draft.metrics[0].metric
                        }
                        options={draft.metrics.map((item) => ({
                          value: item.metric,
                          label:
                            item.label || t(WIDGET_METRICS[item.metric].label),
                        }))}
                        onChange={(value) =>
                          set("chartMetric", value as WidgetMetricName)
                        }
                      />
                    </Field>
                    <Field label={t("Chart interval")}>
                      <Choice
                        label={t("Chart interval")}
                        value={draft.bucket}
                        options={[
                          { value: "day", label: t("Daily") },
                          { value: "month", label: t("Monthly") },
                        ]}
                        onChange={(value) =>
                          set("bucket", value as WidgetConfig["bucket"])
                        }
                      />
                    </Field>
                    <Field
                      label={t("Chart color")}
                      htmlFor="widget-chart-color"
                    >
                      <input
                        id="widget-chart-color"
                        type="color"
                        value={draft.accent}
                        onChange={(event) => set("accent", event.target.value)}
                        className="h-9 w-full cursor-pointer rounded-md border border-neutral-200 bg-transparent dark:border-neutral-800"
                      />
                    </Field>
                  </>
                )}
              </>
            )}
          </SettingsSection>
          <SettingsSection title={t("Filters")}>
            <Field label={t("Page path (optional)")} htmlFor="widget-page-path">
              <Input
                id="widget-page-path"
                placeholder="/pricing"
                value={draft.filters.pagePath}
                onChange={(event) =>
                  set("filters", {
                    ...draft.filters,
                    pagePath: event.target.value,
                  })
                }
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field
                label={t("Country code (optional)")}
                htmlFor="widget-country"
              >
                <Input
                  id="widget-country"
                  placeholder="US"
                  maxLength={2}
                  value={draft.filters.country}
                  onChange={(event) =>
                    set("filters", {
                      ...draft.filters,
                      country: event.target.value.toUpperCase(),
                    })
                  }
                />
              </Field>
              <Field label={t("Device")}>
                <Choice
                  label={t("Device")}
                  value={draft.filters.device || "all"}
                  options={[
                    { value: "all", label: t("All devices") },
                    ...["desktop", "mobile", "tablet"].map((value) => ({
                      value,
                      label: t(value[0].toUpperCase() + value.slice(1)),
                    })),
                  ]}
                  onChange={(value) =>
                    set("filters", {
                      ...draft.filters,
                      device:
                        value === "all"
                          ? ""
                          : (value as WidgetConfig["filters"]["device"]),
                    })
                  }
                />
              </Field>
            </div>
          </SettingsSection>
          {validation.error && (
            <p role="alert" className="text-sm text-red-500">
              {validation.error}
            </p>
          )}
        </>
      }
      previewTitle={t("Widget preview")}
      previewActions={
        query.isFetching && (
          <span className="text-xs text-muted-foreground">
            {t("Updating...")}
          </span>
        )
      }
      preview={
        <div className="py-6">
          <WidgetPreview
            state={{
              config: validation.config || initial,
              data: query.data?.data,
              loading: query.isPending,
              error: validation.error || query.error?.message,
            }}
          />
        </div>
      }
    />
  );
}
