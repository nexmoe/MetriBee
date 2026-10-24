import { useState } from "react";
import { ResponsiveLine } from "@nivo/line";
import { useNivoTheme } from "../../rybbit/src/lib/nivo";
import { ChartTooltip } from "../../rybbit/src/components/charts/ChartTooltip";
import { Choice, fmt } from "../pages/shared";
const label = (s: string) =>
  s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
export function Trend({
  rows,
  labels,
}: {
  rows: { dims: string[]; metrics: number[] }[];
  labels: string[];
}) {
  const theme = useNivoTheme();
  const [metric, setMetric] = useState(0);
  return (
    <div>
      {labels.length > 1 && <div className="mb-3">
        <Choice
          label="Chart metric"
          value={String(metric)}
          onChange={(v) => setMetric(+v)}
          options={labels.map((l, i) => ({
            value: String(i),
            label: label(l),
          }))}
        />
      </div>}
      <div className="h-48">
        <ResponsiveLine
          theme={theme}
          data={[
            {
              id: label(labels[metric] || "Users"),
              data: rows.map((r, i) => ({
                x: r.dims[0] || String(i),
                y: r.metrics[metric] || 0,
              })),
            },
          ]}
          margin={{ top: 10, right: 15, bottom: 30, left: 50 }}
          xScale={{ type: "point" }}
          yScale={{ type: "linear", min: 0, max: "auto" }}
          axisBottom={{
            tickValues: rows
              .filter(
                (_, i) => i % Math.max(1, Math.ceil(rows.length / 6)) === 0
              )
              .map((r) => r.dims[0]),
            tickSize: 0,
            tickPadding: 10,
          }}
          axisLeft={{ tickSize: 0, tickPadding: 8 }}
          enablePoints={false}
          enableArea
          areaOpacity={0.1}
          colors={["hsl(var(--dataviz))"]}
          enableGridX={false}
          animate={false}
          useMesh
          tooltip={({ point }) => (
            <ChartTooltip>
              <div className="p-2 text-xs">
                {String(point.data.x)} · {fmt(point.data.y)}
              </div>
            </ChartTooltip>
          )}
        />
      </div>
    </div>
  );
}
