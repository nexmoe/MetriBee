import { ReactNode, useState } from "react";
import { ArrowDownUp, Download } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import SettingsLayout from "../../rybbit/src/app/settings/layout";
import { SettingsPageHeader } from "../../rybbit/src/app/settings/components/Ledger";
import { Button } from "../../rybbit/src/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../rybbit/src/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../../rybbit/src/components/ui/table";
import { ErrorState } from "../../rybbit/src/components/ErrorState";
import { Skeleton } from "../../rybbit/src/components/ui/skeleton";
export {
  Button,
  SettingsPageHeader,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  ErrorState,
  Skeleton,
};
export {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "../../rybbit/src/components/ui/card";
export { Badge } from "../../rybbit/src/components/ui/badge";
export { StatBand } from "../../rybbit/src/components/site/StatBand";
export { LedgerSection } from "../../rybbit/src/app/settings/components/Ledger";
export { Input } from "../../rybbit/src/components/ui/input";
export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../../rybbit/src/components/ui/tabs";
export async function get<T = any>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const data = await res.json();
  if (!res.ok || data.ok === false)
    throw new Error(data.error || data.message || "Data unavailable");
  return data;
}
export function useData<T = any>(
  url: string,
  interval: number | false = false
) {
  return useQuery<T, Error>({
    queryKey: ["ga4", url],
    queryFn: ({ signal }) => get<T>(url, signal),
    refetchInterval: interval,
  });
}
export const fmt = (v: unknown) =>
  v == null
    ? "—"
    : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
export const when = (v: any) =>
  v ? new Date(v).toLocaleString() : "Not available";
export const properties = () =>
  ((window as any).__GA4_CONTEXT__?.properties || []) as {
    id: string;
    site: string;
    domain?: string;
    url?: string;
    accountName?: string;
  }[];
export function Workspace({ children }: { children: ReactNode }) {
  return (
    <SettingsLayout>
      <div className="space-y-6 pb-12">{children}</div>
    </SettingsLayout>
  );
}
export function Choice({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} size="sm" className="w-auto min-w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem value={o.value} key={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function QueryState({ query }: { query: any }) {
  return query.isError && query.data === undefined ? (
    <ErrorState
      title="Data unavailable"
      message={query.error.message}
      refetch={query.refetch}
    />
  ) : query.isPending ? (
    <Skeleton className="h-40 w-full" />
  ) : null;
}
export function downloadCsv(
  name: string,
  headers: string[],
  rows: unknown[][]
) {
  const quote = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const blob = new Blob(
    [
      "\uFEFF" +
        [headers, ...rows].map((r) => r.map(quote).join(",")).join("\r\n"),
    ],
    { type: "text/csv;charset=utf-8" }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function DataTable({
  headers,
  rows,
  name = "report",
}: {
  headers: string[];
  rows: unknown[][];
  name?: string;
}) {
  const [sort, setSort] = useState<{ i: number; desc: boolean } | null>(null);
  const sorted = sort
    ? [...rows].sort((a, b) => {
        const x = a[sort.i],
          y = b[sort.i];
        return (
          (typeof x === "number" && typeof y === "number"
            ? x - y
            : String(x ?? "").localeCompare(String(y ?? ""))) *
          (sort.desc ? -1 : 1)
        );
      })
    : rows;
  return (
    <div>
      <div className="flex justify-end pb-2">
        <Button
          size="xs"
          variant="ghost"
          onClick={() => downloadCsv(name + ".csv", headers, rows)}
        >
          <Download />
          CSV
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((h, i) => (
              <TableHead key={i}>
                <button
                  className="flex items-center gap-1 whitespace-nowrap"
                  onClick={() =>
                    setSort({ i, desc: sort?.i === i ? !sort.desc : true })
                  }
                >
                  {h}
                  <ArrowDownUp className="h-3 w-3" />
                </button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row, i) => (
            <TableRow key={i}>
              {row.map((cell, j) => (
                <TableCell
                  key={j}
                  className={typeof cell === "number" ? "tabular-nums" : ""}
                >
                  {typeof cell === "number" ? fmt(cell) : String(cell ?? "—")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!rows.length && (
        <p className="p-8 text-center text-sm text-neutral-500">
          No data for this period.
        </p>
      )}
    </div>
  );
}
