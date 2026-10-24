import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  defaultWidgetConfig,
  normalizeWidgetConfig,
  type WidgetConfig,
  type WidgetReport,
} from "../../../controllers/widgetConfig";
import { MetricWidget } from "./MetricWidget";
import { ErrorState } from "../../rybbit/src/components/ErrorState";

export type WidgetPreviewState = {
  config: WidgetConfig;
  data?: WidgetReport;
  loading?: boolean;
  error?: string;
};
export default function WidgetFrame() {
  const context = (window as any).__GA4_CONTEXT__.metricWidget as {
    preview?: boolean;
    siteId: string;
    widgetId: string;
    config?: WidgetConfig;
  };
  const [preview, setPreview] = useState<WidgetPreviewState>({
    config: context.config || defaultWidgetConfig(),
    loading: true,
  });
  const ref = useRef<HTMLDivElement>(null);
  const { setTheme } = useTheme();
  const query = useQuery<{ config: WidgetConfig; data: WidgetReport }>({
    queryKey: ["public-widget", context.siteId, context.widgetId],
    enabled: !context.preview,
    queryFn: async () => {
      const response = await fetch(
        `/api/rybbit/sites/${context.siteId}/widgets/${context.widgetId}/data`,
        { credentials: "omit" }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Widget unavailable.");
      return result;
    },
    refetchInterval: 300000,
    refetchIntervalInBackground: false,
  });
  const config = context.preview
    ? preview.config
    : query.data?.config || preview.config;
  const error = context.preview ? preview.error : query.error?.message;
  const inline = config.layout === "inline" && !error;
  useEffect(() => {
    if (!context.preview) return;
    const receive = (event: MessageEvent) => {
      if (
        event.source !== parent ||
        event.origin !== location.origin ||
        event.data?.type !== "ga4:widget-preview"
      )
        return;
      try {
        setPreview({
          ...event.data.state,
          config: normalizeWidgetConfig(event.data.state.config),
        });
      } catch {
        /* Incomplete drafts stay in the editor until they are valid. */
      }
    };
    window.addEventListener("message", receive);
    parent.postMessage({ type: "ga4:widget-ready" }, location.origin);
    return () => window.removeEventListener("message", receive);
  }, [context.preview]);
  useEffect(() => {
    setTheme(config.theme);
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    document.title = config.title || config.name;
  }, [config.theme, config.name, config.title, setTheme]);
  useEffect(() => {
    if (!ref.current || parent === window) return;
    const element = ref.current;
    let disposed = false;
    const publish = () => {
      if (disposed) return;
      let width = config.width;
      if (inline) {
        // Measure the natural width independently of a narrow host so the iframe
        // can grow again when its host gets wider. Restore constraints before paint.
        const maxWidth = element.style.maxWidth;
        element.style.maxWidth = "none";
        width = Math.min(
          width,
          Math.ceil(element.getBoundingClientRect().width)
        );
        element.style.maxWidth = maxWidth;
      }
      parent.postMessage(
        {
          type: "ga4:widget-size",
          width,
          height: Math.ceil(element.getBoundingClientRect().height),
        },
        "*"
      );
    };
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    document.fonts.ready.then(publish);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [inline, config.width]);
  return (
    <div
      ref={ref}
      id="widget-content"
      className={inline ? "w-max max-w-full" : "w-full"}
      style={inline ? { maxWidth: `min(100%, ${config.width}px)` } : undefined}
    >
      {error ? (
        <ErrorState
          title="Widget unavailable"
          message={error}
          refetch={context.preview ? undefined : query.refetch}
        />
      ) : (
        <MetricWidget
          config={config}
          data={context.preview ? preview.data : query.data?.data}
          loading={context.preview ? preview.loading : query.isPending}
        />
      )}
    </div>
  );
}
