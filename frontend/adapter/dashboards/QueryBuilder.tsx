import { useRef, useState, type ReactNode } from "react";
import type { Filter, FilterParameter } from "@rybbit/shared";
import { Button } from "../../rybbit/src/components/ui/button";
import { Label } from "../../rybbit/src/components/ui/label";
import { Input } from "../../rybbit/src/components/ui/input";
import { MultiSelect } from "../../rybbit/src/components/ui/multi-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../rybbit/src/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../rybbit/src/components/ui/popover";
import { FilterPicker } from "../../rybbit/src/app/[site]/components/SubHeader/Filters/FilterPicker";
import { FilterChip } from "../../rybbit/src/app/[site]/components/SubHeader/Filters/FilterChip";
import { useExtracted } from "../extracted";

export const DIMENSIONS = [
  "time",
  "pathname",
  "page_title",
  "country",
  "region",
  "city",
  "device_type",
  "browser",
  "operating_system",
  "referrer",
  "channel",
  "event_name",
  "hostname",
  "language",
  "utm_source",
  "utm_medium",
  "utm_campaign",
];
export const METRICS = [
  "sessions",
  "pageviews",
  "users",
  "new_users",
  "active_users",
  "events",
  "key_events",
  "revenue",
  "bounce_rate",
  "session_duration",
  "pages_per_session",
  "engagement_rate",
];
type Query = {
  dimensions: string[];
  metrics: string[];
  filters?: Filter[];
  limit?: number;
  orderBy?: string;
  direction?: "asc" | "desc";
};
export const DEFAULT_QUERY: Query = {
  dimensions: ["time"],
  metrics: ["sessions", "pageviews"],
  limit: 100,
};
export function QueryBuilder({
  value,
  onChange,
  onRun,
  isRunning,
  headerActions,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  isRunning: boolean;
  headerActions?: ReactNode;
}) {
  const t = useExtracted();
  let query = DEFAULT_QUERY;
  try {
    const parsed = JSON.parse(value);
    if (
      parsed &&
      Array.isArray(parsed.dimensions) &&
      Array.isArray(parsed.metrics) &&
      parsed.dimensions.every((key: string) => DIMENSIONS.includes(key)) &&
      parsed.metrics.every((key: string) => METRICS.includes(key))
    )
      query = parsed;
  } catch {
    /* A blank card starts with the default selection. */
  }
  const [open, setOpen] = useState(false);
  const [parameter, setParameter] = useState<FilterParameter | null>(null);
  const pendingRef = useRef<() => Filter | null>(() => null);
  const update = (fields: Partial<Query>) =>
    onChange(JSON.stringify({ ...query, ...fields }, null, 2));
  const filters = query.filters || [];
  const label = (name: string) =>
    t(name.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase()));
  const columns = [...query.dimensions, ...query.metrics];
  return (
    <div className="shrink-0 space-y-3 rounded-lg border border-neutral-150 p-3 dark:border-neutral-850">
      <div className="flex items-center justify-between">
        <Label>{t("GA4 report")}</Label>
        {headerActions}
      </div>
      <div className="space-y-1.5">
        <Label>{t("Dimensions")}</Label>
        <MultiSelect
          options={DIMENSIONS.map((name) => ({
            value: name,
            label: label(name),
          }))}
          value={query.dimensions}
          onValueChange={(dimensions) =>
            update({ dimensions: dimensions.slice(0, 3), orderBy: undefined })
          }
          placeholder={t("Select up to 3 dimensions")}
        />
      </div>
      <div className="space-y-1.5">
        <Label>{t("Metrics")}</Label>
        <MultiSelect
          options={METRICS.map((name) => ({ value: name, label: label(name) }))}
          value={query.metrics}
          onValueChange={(metrics) =>
            update({ metrics: metrics.slice(0, 8), orderBy: undefined })
          }
          placeholder={t("Select up to 8 metrics")}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {filters.map((filter, index) => (
          <FilterChip
            key={index}
            filter={filter}
            onUpdate={(next) =>
              update({
                filters: filters.map((item, i) => (i === index ? next : item)),
              })
            }
            onRemove={() =>
              update({ filters: filters.filter((_, i) => i !== index) })
            }
          />
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            {t("Add filter")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <FilterPicker
            pendingRef={pendingRef}
            parameter={parameter}
            setParameter={setParameter}
            onCommit={(filter) => {
              update({ filters: [...filters, filter] });
              setOpen(false);
              setParameter(null);
            }}
            onClose={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <Label>{t("Sort")}</Label>
          <Select
            value={query.orderBy || "__auto__"}
            onValueChange={(orderBy) =>
              update({ orderBy: orderBy === "__auto__" ? undefined : orderBy })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__auto__">{t("Automatic")}</SelectItem>
              {columns.map((name) => (
                <SelectItem key={name} value={name}>
                  {label(name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("Direction")}</Label>
          <Select
            value={query.direction || "desc"}
            onValueChange={(direction) =>
              update({ direction: direction as "asc" | "desc" })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">{t("Descending")}</SelectItem>
              <SelectItem value="asc">{t("Ascending")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ga4-row-limit">{t("Row limit")}</Label>
          <Input
            id="ga4-row-limit"
            type="number"
            min={1}
            max={1000}
            value={query.limit ?? 100}
            onChange={(event) =>
              update({
                limit: Math.max(
                  1,
                  Math.min(1000, Number(event.target.value) || 100)
                ),
              })
            }
          />
        </div>
      </div>
      <Button
        size="sm"
        disabled={isRunning || !query.metrics.length}
        onClick={onRun}
      >
        {isRunning ? t("Running…") : t("Run query")}
      </Button>
    </div>
  );
}
