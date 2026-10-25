import { useState } from "react";
import { DateTime } from "luxon";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  QueryState,
  Button,
  Badge,
  StatBand,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  fmt,
  downloadCsv,
} from "./shared";
import { EventSparkline } from "../../rybbit/src/app/[site]/events/components/EventNames/EventSparkline";
import { Delta } from "../../rybbit/src/components/site/Delta";
import { percentDelta } from "../../rybbit/src/lib/delta";
import { cn } from "../../rybbit/src/lib/utils";
import { RelativeTime } from "../overview/ReportFreshness";
import { useHomeSites } from "../home/useHomeSites";
import { useExtracted } from "../extracted";
import { accountGroups, type AccountMetadata } from "../home/accounts";
const change = (n: number | null) =>
  n == null ? "New" : `${n > 0 ? "+" : ""}${fmt(n)}%`;
const BAD = ["gap", "gone", "drop", "edrop", "error"];
export type ReportView = "status" | "table" | "heatmap";

export default function SiteReports({
  view,
  organizationId,
  siteIds,
  ready,
  grouped,
  metadata,
}: {
  view: ReportView;
  organizationId: string;
  siteIds: number[];
  ready: boolean;
  grouped: boolean;
  metadata: (AccountMetadata & { siteId: number; name: string })[];
}) {
  const t = useExtracted();
  const query = useHomeSites(organizationId, siteIds, ready);
  const data = query.data;
  const [low, setLow] = useState(false);
  const [sort, setSort] = useState("last");
  const [desc, setDesc] = useState(true);
  const byId = new Map(metadata.map((site) => [String(site.siteId), site]));
  const sites = (data?.sites || [])
    .map((row) => {
      const current = byId.get(row.id);
      return current
        ? {
            ...row,
            name: current.name,
            accountId: current.accountId,
            accountName: current.accountName,
          }
        : row;
    })
    .filter(
      (s: any) => !low || s.last == null || s.last >= (data?.lowThreshold ?? 0)
    )
    .sort((a: any, b: any) => {
      const x = a[sort],
        y = b[sort];
      if (x == null) return y == null ? 0 : 1;
      if (y == null) return -1;
      return (
        (typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y))) * (desc ? -1 : 1)
      );
    });
  const total = (key: string) =>
    sites.some((s: any) => s[key] != null)
      ? sites.reduce((n: number, s: any) => n + (s[key] || 0), 0)
      : null;
  const period = (range: any) =>
    range
      ? range.startDateTime
        ? `${new Date(range.startDateTime).toLocaleString(undefined, {
            timeZone: range.timeZone,
          })} – ${new Date(range.endDateTime).toLocaleString(undefined, {
            timeZone: range.timeZone,
          })}`
        : `${range.startDate} – ${range.endDate}`
      : t("None");
  const timeLabel = (time: string) =>
    data?.range.startDateTime && ["minute", "hour"].includes(data.bucket)
      ? DateTime.fromSQL(time, { zone: "UTC" })
          .setZone(data.range.timeZone || "UTC")
          .toFormat("MM-dd HH:mm")
      : ["minute", "hour"].includes(data?.bucket || "")
      ? `${time.slice(5, 10)} ${time.slice(11, 16)}`
      : data?.bucket === "month"
      ? time.slice(0, 7)
      : data?.bucket === "year"
      ? time.slice(0, 4)
      : time.slice(5, 10);
  const money = (v: number | null) =>
    v == null
      ? "—"
      : new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: data?.adsense?.currency || "USD",
          maximumFractionDigits: 2,
        }).format(v);
  const sortBy = (key: string) => {
    setSort(key);
    setDesc(sort === key ? !desc : true);
  };
  const heading = (key: string, label: string, numeric = true) => {
    const active = sort === key;
    const Arrow = desc ? ArrowDown : ArrowUp;
    return (
      <TableHead
        scope="col"
        aria-sort={active ? (desc ? "descending" : "ascending") : undefined}
        className={cn("whitespace-nowrap", numeric && "text-right")}
      >
        <button
          type="button"
          onClick={() => sortBy(key)}
          className={cn(
            "inline-flex items-center gap-1 font-medium focus-visible:underline focus-visible:outline-none",
            active
              ? "text-neutral-900 dark:text-neutral-100"
              : "hover:text-neutral-900 dark:hover:text-neutral-200"
          )}
        >
          {t(label)}
          {active && <Arrow className="h-3 w-3" aria-hidden="true" />}
        </button>
      </TableHead>
    );
  };
  const groups = [
    ["Needs a look", (s: any) => BAD.includes(s.st.k)],
    ["Growing", (s: any) => s.st.k === "up"],
    ["Steady", (s: any) => s.st.k === "steady"],
    ["Low / no traffic", (s: any) => ["low", "dead"].includes(s.st.k)],
  ] as const;
  return (
    <div className="space-y-6 pb-12">
      <QueryState query={query} />
      {data && (
        <>
          <StatBand
            cells={[
              {
                label: t("Sessions"),
                value: fmt(total("last")),
              },
              { label: t("Comparison"), value: fmt(total("prev")) },
              { label: t("Properties"), value: fmt(sites.length) },
              data.adsense && {
                label: t("AdSense"),
                value: money(total("earnLast")),
                sub: t("{count} matched sites", {
                  count: data.adsense.matched,
                }),
              },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              aria-pressed={low}
              onClick={() => setLow(!low)}
            >
              {low ? t("Show low traffic") : t("Hide low traffic")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                downloadCsv(
                  "sites.csv",
                  [
                    "Account",
                    "Account ID",
                    "Property",
                    "Start date",
                    "End date",
                    "Comparison start",
                    "Comparison end",
                    "Selected period",
                    "Comparison period",
                    "Change %",
                    "Status",
                    "Earnings",
                    "Earnings change %",
                    "Page RPM",
                    ...data.days,
                  ],
                  sites.map((s: any) => [
                    s.accountName,
                    s.accountId,
                    s.name,
                    data.range.startDateTime || data.range.startDate,
                    data.range.endDateTime || data.range.endDate,
                    data.comparison?.startDateTime ||
                      data.comparison?.startDate,
                    data.comparison?.endDateTime || data.comparison?.endDate,
                    s.last,
                    s.prev,
                    s.change,
                    s.st.label,
                    s.earnLast,
                    s.earnChange,
                    s.rpm,
                    ...s.vals,
                  ])
                )
              }
            >
              {t("Export CSV")}
            </Button>
          </div>
          <div className="text-xs text-neutral-500">
            {period(data.range)} · {t("Comparison")}: {period(data.comparison)}
            {data.adsense && (
              <span className="ml-2">
                {t("· AdSense")}
                <RelativeTime value={data.adsense.generatedAt} />
                {data.adsense.matched < data.sites.length && (
                  <>
                    {" "}
                    ·{" "}
                    {t("AdSense is shown only for fully covered date ranges.")}
                  </>
                )}
              </span>
            )}
          </div>
          {!sites.length ? (
            <Card className="p-8 text-center text-sm text-neutral-500">
              {t("No matching sites.")}
            </Card>
          ) : (
            accountGroups(sites, grouped).map((account) => (
              <section
                className="space-y-3"
                key={account.accountId ?? "unknown"}
                aria-label={grouped ? account.accountName : undefined}
              >
                {grouped && (
                  <h2 className="text-sm font-medium">
                    {account.accountName}{" "}
                    <span className="ml-2 text-neutral-500">
                      {account.properties.length}
                    </span>
                  </h2>
                )}
                {view === "status" ? (
                  groups.map(([label, test]) => (
                    <section className="space-y-3" key={label}>
                      <h2 className="text-sm font-medium">
                        {t(label)}{" "}
                        <span className="text-neutral-500">
                          {account.properties.filter(test).length}
                        </span>
                      </h2>
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {account.properties.filter(test).map((s: any) => (
                          <Card key={s.id}>
                            <CardHeader>
                              <div className="flex justify-between gap-2">
                                <Link
                                  href={"/analytics?prop=" + s.id}
                                  className="text-sm font-medium"
                                >
                                  {s.name}
                                </Link>
                                <Badge variant="outline">{t(s.st.label)}</Badge>
                              </div>
                            </CardHeader>
                            <CardContent>
                              <div className="flex justify-between">
                                <div>
                                  <span className="text-xl font-semibold tabular-nums">
                                    {fmt(s.last)}
                                  </span>
                                  <span className="ml-2 text-xs text-neutral-500">
                                    {t("sessions ·")}{" "}
                                    {s.prev == null ? "—" : change(s.change)}
                                  </span>
                                </div>
                                {s.error ? (
                                  "—"
                                ) : (
                                  <EventSparkline
                                    values={s.vals}
                                    label={t(
                                      "Sessions over the selected period"
                                    )}
                                    className="w-24"
                                  />
                                )}
                              </div>
                              <p className="mt-2 text-xs text-neutral-500">
                                {s.error ||
                                  s.st.why ||
                                  t(
                                    "Traffic is within its usual range for the selected comparison."
                                  )}
                              </p>
                              {s.earn && (
                                <p className="mt-2 text-xs">
                                  {money(s.earnLast)} ·{" "}
                                  {s.earn.prev == null
                                    ? "—"
                                    : change(s.earnChange)}{" "}
                                  {t("· RPM")}
                                  {money(s.rpm)}
                                </p>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </section>
                  ))
                ) : (
                  <Card>
                    <Table
                      aria-label={
                        grouped
                          ? `Site sessions · ${account.accountName}`
                          : "Site sessions"
                      }
                      className="min-w-[720px] [&_th]:px-3 [&_td]:px-3 [&_th:first-child]:rounded-l-none [&_th:last-child]:rounded-r-none"
                    >
                      <TableHeader>
                        <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
                          {heading("name", "Site", false)}
                          {view === "heatmap" ? (
                            data.days.map((d: string) => (
                              <TableHead
                                key={d}
                                scope="col"
                                className="text-center whitespace-nowrap"
                              >
                                {timeLabel(d)}
                              </TableHead>
                            ))
                          ) : (
                            <>
                              {heading("last", "Sessions")}
                              {heading("prev", "Comparison period")}
                            </>
                          )}
                          {heading("change", "Change")}
                          {view === "table" && (
                            <TableHead
                              scope="col"
                              className="whitespace-nowrap"
                            >
                              {t("Trend")}
                            </TableHead>
                          )}
                          {data.adsense && (
                            <>
                              {heading("earnLast", "Earnings")}
                              {heading("earnChange", "Earnings change")}
                              {heading("rpm", "Page RPM")}
                            </>
                          )}
                          <TableHead scope="col">{t("Status")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {account.properties.map((s: any) => (
                          <TableRow key={s.id} className="h-11">
                            <TableCell>
                              <Link
                                href={"/analytics?prop=" + s.id}
                                className="whitespace-nowrap text-xs font-medium hover:underline"
                              >
                                {s.name}
                              </Link>
                              {s.error && (
                                <p className="text-xs text-red-500">
                                  {s.error}
                                </p>
                              )}
                            </TableCell>
                            {view === "heatmap" ? (
                              s.vals.map((v: number | null, i: number) => {
                                const median =
                                  [...s.vals].sort(
                                    (a: number, b: number) => a - b
                                  )[Math.floor(s.vals.length / 2)] || 1;
                                return (
                                  <TableCell
                                    key={i}
                                    title={`${data.days[i]}: ${fmt(
                                      v
                                    )} sessions`}
                                    className="text-center tabular-nums text-xs"
                                    style={{
                                      background:
                                        v == null
                                          ? "transparent"
                                          : v === 0
                                          ? "hsl(var(--destructive) / .15)"
                                          : `hsl(var(--dataviz) / ${Math.min(
                                              0.55,
                                              0.06 + (v / median) * 0.14
                                            )})`,
                                    }}
                                  >
                                    {fmt(v)}
                                  </TableCell>
                                );
                              })
                            ) : (
                              <>
                                <TableCell className="text-right font-medium tabular-nums">
                                  {fmt(s.last)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-neutral-600 dark:text-neutral-300">
                                  {fmt(s.prev)}
                                </TableCell>
                              </>
                            )}
                            <TableCell className="text-right">
                              {s.change == null ? (
                                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                                  {s.prev == null ? "—" : t("New")}
                                </span>
                              ) : (
                                <Delta
                                  value={percentDelta(s.last, s.prev, {
                                    decimals: 0,
                                  })}
                                />
                              )}
                            </TableCell>
                            {view === "table" && (
                              <TableCell>
                                {s.error ? (
                                  "—"
                                ) : (
                                  <EventSparkline
                                    values={s.vals}
                                    label={t(
                                      "Sessions over the selected period"
                                    )}
                                    className="w-24"
                                  />
                                )}
                              </TableCell>
                            )}
                            {data.adsense && (
                              <>
                                <TableCell className="whitespace-nowrap text-right tabular-nums">
                                  {money(s.earnLast)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {s.earn ? (
                                    s.earnChange == null ? (
                                      <span className="text-xs text-neutral-500 dark:text-neutral-400">
                                        {s.earn.prev == null ||
                                        s.earn.last == null
                                          ? "—"
                                          : t("New")}
                                      </span>
                                    ) : (
                                      <Delta
                                        value={percentDelta(
                                          s.earn.last,
                                          s.earn.prev,
                                          { decimals: 0 }
                                        )}
                                      />
                                    )
                                  ) : (
                                    "—"
                                  )}
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-right tabular-nums">
                                  {money(s.rpm)}
                                </TableCell>
                              </>
                            )}
                            <TableCell>
                              <Badge
                                variant="outline"
                                title={t(s.st.why)}
                                className="whitespace-nowrap"
                              >
                                {t(s.st.label)}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {!account.properties.length && (
                      <p className="p-8 text-center text-sm text-neutral-500">
                        {t("No matching sites.")}
                      </p>
                    )}
                  </Card>
                )}
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}
