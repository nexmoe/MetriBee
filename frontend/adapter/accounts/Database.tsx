import { useQuery } from "@tanstack/react-query";
import { useExtracted } from "../extracted";
import { authedFetch } from "../../rybbit/src/api/utils";
import { Panel } from "../../rybbit/src/app/admin/components/shared/Panel";
import { StatStrip } from "../../rybbit/src/app/admin/components/shared/StatStrip";
import { RefreshControls } from "../../rybbit/src/app/admin/components/database/RefreshControls";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "../../rybbit/src/components/ui/table";
import { ErrorState } from "../../rybbit/src/components/ErrorState";

export function Database() {
  const t = useExtracted();
  const query = useQuery({
    queryKey: ["admin-database"],
    queryFn: () =>
      authedFetch<{
        engine: string;
        version: string;
        integrity: string;
        bytes: number;
        tables: { name: string; rows: number }[];
        migrations: { id: string; appliedAt: string }[];
      }>("/admin/database"),
  });
  const data = query.data;
  if (query.error)
    return (
      <ErrorState
        title={t("Database unavailable")}
        message={query.error.message}
        refetch={query.refetch}
      />
    );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">SQLite</h2>
        <RefreshControls
          lastUpdated={
            query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : null
          }
          onRefresh={() => {
            void query.refetch();
          }}
          isRefetching={query.isFetching}
        />
      </div>
      <StatStrip
        isLoading={query.isPending}
        stats={[
          {
            label: t("Total rows"),
            value: data
              ? data.tables
                  .reduce((sum, table) => sum + table.rows, 0)
                  .toLocaleString()
              : "-",
          },
          {
            label: t("Database size"),
            value: data ? `${(data.bytes / 1024 / 1024).toFixed(2)} MB` : "-",
          },
          {
            label: t("Tables"),
            value: data ? String(data.tables.length) : "-",
          },
          {
            label: t("Integrity check"),
            value: data?.integrity || "-",
            hint: data?.version,
          },
        ]}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title={t("Table statistics")} flush>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Table")}</TableHead>
                <TableHead className="text-right">{t("Rows")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.tables.map((table) => (
                <TableRow key={table.name}>
                  <TableCell className="font-medium font-mono text-xs">
                    {table.name}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {table.rows.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
        <Panel title={t("Migrations")} flush>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Migration")}</TableHead>
                <TableHead>{t("Applied at")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.migrations.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs">{m.id}</TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {new Date(m.appliedAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </div>
    </div>
  );
}
