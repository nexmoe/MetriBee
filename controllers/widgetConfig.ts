// Shared by the GA4 report adapter, saved definitions and the React widget builder.
export const WIDGET_METRICS = {
  activeUsers: { label: "Active users", format: "number", upIsGood: true },
  totalUsers: { label: "Total users", format: "number", upIsGood: true },
  newUsers: { label: "New users", format: "number", upIsGood: true },
  sessions: { label: "Sessions", format: "number", upIsGood: true },
  engagedSessions: {
    label: "Engaged sessions",
    format: "number",
    upIsGood: true,
  },
  screenPageViews: { label: "Pageviews", format: "number", upIsGood: true },
  screenPageViewsPerSession: {
    label: "Views per session",
    format: "decimal",
    upIsGood: true,
  },
  bounceRate: { label: "Bounce rate", format: "percent", upIsGood: false },
  engagementRate: {
    label: "Engagement rate",
    format: "percent",
    upIsGood: true,
  },
  averageSessionDuration: {
    label: "Average session duration",
    format: "duration",
    upIsGood: true,
  },
  eventCount: { label: "Events", format: "number", upIsGood: true },
  keyEvents: { label: "Key events", format: "number", upIsGood: true },
  totalRevenue: { label: "Revenue", format: "currency", upIsGood: true },
} as const;
export type WidgetMetricName = keyof typeof WIDGET_METRICS;
export type WidgetFormat =
  | "auto"
  | "number"
  | "compact"
  | "decimal"
  | "percent"
  | "duration"
  | "currency";
export type WidgetMetric = {
  metric: WidgetMetricName;
  label: string;
  format: WidgetFormat;
  decimals: number;
};
export const WIDGET_PERIODS = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
  last30: "Last 30 days",
  last90: "Last 90 days",
  thisMonth: "This month",
  lastMonth: "Last month",
  thisYear: "This year",
  last12Months: "Last 12 months",
  custom: "Custom date range",
} as const;
export type WidgetPeriod = {
  preset: keyof typeof WIDGET_PERIODS;
  startDate?: string;
  endDate?: string;
};
export type WidgetConfig = {
  name: string;
  title: string;
  enabled: boolean;
  metrics: WidgetMetric[];
  period: WidgetPeriod;
  comparison: boolean;
  bucket: "day" | "month";
  layout: "card" | "stats" | "inline";
  theme: "dark" | "light" | "system";
  chartMetric: WidgetMetricName;
  showChart: boolean;
  showTitle: boolean;
  showPeriod: boolean;
  showUpdated: boolean;
  transparent: boolean;
  accent: string;
  width: number;
  columns: 1 | 2 | 3;
  filters: {
    pagePath: string;
    country: string;
    device: "" | "desktop" | "mobile" | "tablet";
  };
};
export type SavedWidget = {
  id: string;
  config: WidgetConfig;
  createdAt: string;
  updatedAt: string;
};
export type WidgetReport = {
  range: { startDate: string; endDate: string };
  previousRange: { startDate: string; endDate: string } | null;
  values: Record<string, number | null>;
  previous: Record<string, number | null> | null;
  series: { date: string; values: Record<string, number | null> }[];
  timeZone: string;
  currencyCode: string;
  fetchedAt: string;
  comparisonUnavailable: boolean;
  limited: boolean;
};
const fail = (message: string) =>
  Object.assign(new Error(message), { status: 400 });
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, field: string, max: number, empty = true) => {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim())
  )
    throw fail(`Choose a valid ${field}.`);
  return value.trim();
};
const choice = <T extends string>(
  value: unknown,
  options: readonly T[],
  field: string
): T => {
  if (typeof value !== "string" || !options.includes(value as T))
    throw fail(`Choose a valid ${field}.`);
  return value as T;
};
const bool = (value: unknown, field: string) => {
  if (typeof value !== "boolean") throw fail(`${field} must be a boolean.`);
  return value;
};
export function defaultWidgetConfig(): WidgetConfig {
  return {
    name: "Monthly overview",
    title: "Monthly overview",
    enabled: true,
    metrics: (
      ["activeUsers", "screenPageViews", "bounceRate"] as WidgetMetricName[]
    ).map((metric) => ({
      metric,
      label: "",
      format: "auto",
      decimals: metric === "bounceRate" ? 1 : 0,
    })),
    period: { preset: "thisMonth" },
    comparison: true,
    bucket: "day",
    layout: "card",
    theme: "dark",
    chartMetric: "activeUsers",
    showChart: true,
    showTitle: true,
    showPeriod: true,
    showUpdated: true,
    transparent: false,
    accent: "#b3bfff",
    width: 560,
    columns: 3,
    filters: { pagePath: "", country: "", device: "" },
  };
}
export function normalizeWidgetConfig(raw: unknown): WidgetConfig {
  if (!isObject(raw)) throw fail("Widget configuration must be an object.");
  const allowed = Object.keys(defaultWidgetConfig());
  if (Object.keys(raw).some((key) => !allowed.includes(key)))
    throw fail("Unknown widget configuration field.");
  const input = { ...defaultWidgetConfig(), ...raw };
  if (
    !Array.isArray(input.metrics) ||
    input.metrics.length < 1 ||
    input.metrics.length > 6
  )
    throw fail("Choose one to six metrics.");
  const metrics: WidgetMetric[] = input.metrics.map((item: unknown) => {
    if (!isObject(item)) throw fail("Choose a valid metric.");
    const metric = choice(
      item.metric,
      Object.keys(WIDGET_METRICS) as WidgetMetricName[],
      "metric"
    );
    const format = choice(
      item.format ?? "auto",
      [
        "auto",
        "number",
        "compact",
        "decimal",
        "percent",
        "duration",
        "currency",
      ] as const,
      "number format"
    );
    const decimals =
      item.decimals ?? (WIDGET_METRICS[metric].format === "number" ? 0 : 1);
    if (
      !Number.isInteger(decimals) ||
      Number(decimals) < 0 ||
      Number(decimals) > 4
    )
      throw fail("Choose zero to four decimal places.");
    // Rates are percentage values throughout the renderer, regardless of the chosen display format.
    if (format === "percent" && WIDGET_METRICS[metric].format !== "percent")
      throw fail("Percent formatting is only available for rate metrics.");
    return {
      metric,
      label: text(item.label ?? "", "metric label", 80),
      format,
      decimals: Number(decimals),
    };
  });
  if (new Set(metrics.map((item) => item.metric)).size !== metrics.length)
    throw fail("Choose each metric once.");
  if (!isObject(input.period)) throw fail("Choose a valid time period.");
  const preset = choice(
    input.period.preset,
    Object.keys(WIDGET_PERIODS) as (keyof typeof WIDGET_PERIODS)[],
    "time period"
  );
  const period: WidgetPeriod = { preset };
  if (preset === "custom") {
    period.startDate = text(input.period.startDate, "start date", 10, false);
    period.endDate = text(input.period.endDate, "end date", 10, false);
    if (
      !validDate(period.startDate) ||
      !validDate(period.endDate) ||
      period.startDate > period.endDate
    )
      throw fail("Choose a valid date range.");
  }
  const width = input.width,
    columns = input.columns;
  if (!Number.isInteger(width) || Number(width) < 240 || Number(width) > 1200)
    throw fail("Choose a width between 240 and 1200 pixels.");
  if (![1, 2, 3].includes(Number(columns)) || typeof columns !== "number")
    throw fail("Choose one to three columns.");
  if (typeof input.accent !== "string" || !/^#[a-f0-9]{6}$/i.test(input.accent))
    throw fail("Choose a valid chart color.");
  if (!isObject(input.filters)) throw fail("Choose valid report filters.");
  const pagePath = text(input.filters.pagePath ?? "", "page path", 500);
  if (pagePath && (!pagePath.startsWith("/") || /[\r\n?#]/.test(pagePath)))
    throw fail("Use a page path such as /pricing, without a query string.");
  const country = text(
    input.filters.country ?? "",
    "country code",
    2
  ).toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country))
    throw fail("Use a two-letter country code.");
  const chartMetric = metrics.some((item) => item.metric === input.chartMetric)
    ? (input.chartMetric as WidgetMetricName)
    : metrics[0].metric;
  return {
    name: text(input.name, "widget name", 120, false),
    title: text(input.title, "widget title", 160),
    enabled: bool(input.enabled, "enabled"),
    metrics,
    period,
    comparison: bool(input.comparison, "comparison"),
    bucket: choice(input.bucket, ["day", "month"], "chart interval"),
    layout: choice(input.layout, ["card", "stats", "inline"], "layout"),
    theme: choice(input.theme, ["dark", "light", "system"], "theme"),
    chartMetric,
    showChart: bool(input.showChart, "showChart"),
    showTitle: bool(input.showTitle, "showTitle"),
    showPeriod: bool(input.showPeriod, "showPeriod"),
    showUpdated: bool(input.showUpdated, "showUpdated"),
    transparent: bool(input.transparent, "transparent"),
    accent: input.accent.toLowerCase(),
    width: Number(width),
    columns: columns as 1 | 2 | 3,
    filters: {
      pagePath,
      country,
      device: choice(
        input.filters.device ?? "",
        ["", "desktop", "mobile", "tablet"],
        "device"
      ),
    },
  };
}
const DAY = 86400000;
const iso = (date: Date | number) => new Date(date).toISOString().slice(0, 10);
const shift = (date: string, days: number) =>
  iso(Date.parse(date) + days * DAY);
function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    iso(Date.parse(value)) === value
  );
}
export function resolveWidgetPeriod(
  period: WidgetPeriod,
  timeZone: string,
  now = new Date()
) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );
  const today = `${parts.year}-${parts.month}-${parts.day}`,
    year = +parts.year,
    month = +parts.month;
  let startDate = today,
    endDate = today;
  if (period.preset === "yesterday") startDate = endDate = shift(today, -1);
  else if (period.preset === "last7") startDate = shift(today, -6);
  else if (period.preset === "last30") startDate = shift(today, -29);
  else if (period.preset === "last90") startDate = shift(today, -89);
  else if (period.preset === "thisMonth") startDate = `${today.slice(0, 7)}-01`;
  else if (period.preset === "lastMonth") {
    startDate = iso(Date.UTC(year, month - 2, 1));
    endDate = iso(Date.UTC(year, month - 1, 0));
  } else if (period.preset === "thisYear") startDate = `${year}-01-01`;
  else if (period.preset === "last12Months")
    startDate = iso(Date.UTC(year, month - 12, 1));
  else if (period.preset === "custom") {
    startDate = period.startDate!;
    endDate = period.endDate! > today ? today : period.endDate!;
  }
  if (
    !validDate(startDate) ||
    !validDate(endDate) ||
    startDate < "2015-01-01" ||
    startDate > endDate ||
    (Date.parse(endDate) - Date.parse(startDate)) / DAY > 365
  )
    throw fail(
      "Choose a date range of up to 366 days that has already started."
    );
  const days =
    Math.round((Date.parse(endDate) - Date.parse(startDate)) / DAY) + 1;
  let previous = {
    startDate: shift(startDate, -days),
    endDate: shift(startDate, -1),
  };
  if (period.preset === "lastMonth")
    previous = {
      startDate: iso(Date.UTC(year, month - 3, 1)),
      endDate: iso(Date.UTC(year, month - 2, 0)),
    };
  if (period.preset === "thisMonth") {
    const previousStart = iso(Date.UTC(year, month - 2, 1)),
      previousEnd = iso(Date.UTC(year, month - 1, 0));
    previous = {
      startDate: previousStart,
      endDate:
        shift(previousStart, days - 1) < previousEnd
          ? shift(previousStart, days - 1)
          : previousEnd,
    };
  }
  return { range: { startDate, endDate }, previous };
}
export function widgetIframeCode(
  origin: string,
  siteId: string | number,
  widget: SavedWidget
) {
  const url = new URL(`/widget/${siteId}/${widget.id}`, origin);
  const safeUrl = url.toString().replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const title = (widget.config.title || widget.config.name).replace(
    /[&<>"']/g,
    (value) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        value
      ]!)
  );
  return `<iframe
  src="${safeUrl}"
  title="${title}"
  style="border: 0; width: ${widget.config.width}px; max-width: 100%; height: ${
    widget.config.layout === "inline" ? 48 : 480
  }px; vertical-align: middle;"
  loading="lazy"
></iframe>
<script>
(function () {
  var frame = document.currentScript.previousElementSibling;
  window.addEventListener("message", function (event) {
    if (event.source !== frame.contentWindow || event.origin !== ${JSON.stringify(
      url.origin
    )}) return;
    var data = event.data;
    if (data && data.type === "ga4:widget-size") {
      if (Number.isFinite(data.width)) frame.style.width = Math.max(1, Math.min(1200, data.width)) + "px";
      if (Number.isFinite(data.height)) frame.style.height = Math.max(1, Math.min(3000, data.height)) + "px";
    }
  });
})();
</script>`;
}
