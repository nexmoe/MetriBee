import { useNivoTheme } from "@/lib/nivo";
import { ResponsiveLine } from "@nivo/line";
import { DateTime } from "luxon";
import { useExtracted } from "next-intl";
import { useMemo } from "react";
import { GetOverviewBucketedResponse } from "../api/analytics/endpoints";
import { formatChartDateTime } from "../lib/dateTimeUtils";
import { useStore } from "../lib/store";
import type { TimeBucket } from "@rybbit/shared";
import { ChartTooltip } from "./charts/ChartTooltip";

interface SiteSessionChartProps {
  data: Pick<GetOverviewBucketedResponse[number], "time" | "sessions">[];
  metricLabel?: string;
  bucket?: TimeBucket;
  valueFormatter?: (value: number) => string;
  color?: string;
}

export function SiteSessionChart({ data, metricLabel, bucket: bucketOverride, valueFormatter, color = "hsl(var(--dataviz))" }: SiteSessionChartProps) {
  const t = useExtracted();
  const storedBucket = useStore(state => state.bucket);
  const bucket = bucketOverride ?? storedBucket;
  const chartData = useMemo(() => {
    if (!data || data.length === 0) {
      return [{ id: "sessions", data: [] }];
    }

    return [
      {
        id: "sessions",
        data: data.map(point => {
          return {
            x: DateTime.fromSQL(point.time).toUTC().toFormat("yyyy-MM-dd HH:mm:ss"),
            y: point.sessions,
            currentTime: DateTime.fromSQL(point.time),
          };
        }),
      },
    ];
  }, [data]);
  const nivoTheme = useNivoTheme();

  return (
    <ResponsiveLine
      data={chartData}
      margin={{ top: 5, right: 0, bottom: 0, left: 0 }}
      xScale={{
        type: "time",
        format: "%Y-%m-%d %H:%M:%S",
        precision: "second",
        useUTC: true,
      }}
      yScale={{
        type: "linear",
        min: 0,
        max: "auto",
      }}
      curve="linear"
      enableSlices={"x"}
      axisBottom={null}
      axisLeft={null}
      enableGridX={false}
      enableGridY={false}
      enablePoints={false}
      enableArea={true}
      areaOpacity={0.3}
      colors={[color]}
      theme={nivoTheme}
      defs={[
        {
          id: "gradientA",
          type: "linearGradient",
          colors: [
            { offset: 0, color, opacity: 1 },
            { offset: 50, color, opacity: 0.3 },
            { offset: 100, color, opacity: 0 },
          ],
        },
      ]}
      animate={false}
      fill={[{ match: "*", id: "gradientA" }]}
      sliceTooltip={({ slice }: any) => {
        const currentY = Number(slice.points[0].data.yFormatted);
        const currentTime = slice.points[0].data.currentTime as DateTime;

        return (
          <ChartTooltip>
            <div className="p-2">
              <div className="text-xs mb-1">{metricLabel || t("Sessions")}</div>
              <div className="flex justify-between text-xs gap-3">
                <div className="text-muted-foreground">{formatChartDateTime(currentTime, bucket)}</div>
                <div className="font-medium">{valueFormatter ? valueFormatter(currentY) : currentY.toLocaleString()}</div>
              </div>
            </div>
          </ChartTooltip>
        );
      }}
    />
  );
}
