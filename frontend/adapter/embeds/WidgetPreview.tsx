import { useEffect, useRef, useState } from "react";
import type { WidgetPreviewState } from "./WidgetFrame";

export function WidgetPreview({ state }: { state: WidgetPreviewState }) {
  return (
    <WidgetIframe
      state={state}
      src="/widget-preview"
      title="Custom widget preview"
      width={state.config.width}
    />
  );
}
export function WidgetIframe({
  state,
  src,
  title,
  width,
}: {
  state?: WidgetPreviewState;
  src: string;
  title: string;
  width: number;
}) {
  const frame = useRef<HTMLIFrameElement>(null),
    latest = useRef(state);
  const [size, setSize] = useState<{ height: number; width?: number }>({
    height: 320,
  });
  latest.current = state;
  const send = () => {
    if (latest.current)
      frame.current?.contentWindow?.postMessage(
        { type: "ga4:widget-preview", state: latest.current },
        location.origin
      );
  };
  useEffect(() => {
    send();
  }, [state]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      if (event.data?.type === "ga4:widget-ready") send();
      if (event.data?.type === "ga4:widget-size")
        setSize((current) => {
          const height = Number.isFinite(event.data.height)
            ? Math.max(1, Math.min(3000, event.data.height))
            : current.height;
          const width = Number.isFinite(event.data.width)
            ? Math.max(1, Math.min(1200, event.data.width))
            : current.width;
          return height === current.height && width === current.width
            ? current
            : { height, width };
        });
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  return (
    <div
      className="mx-auto max-w-full"
      style={{ width: Math.min(width, size.width ?? width) }}
    >
      <iframe
        ref={frame}
        src={src}
        title={title}
        onLoad={send}
        className="block w-full border-0"
        style={{ height: size.height, background: "transparent" }}
      />
    </div>
  );
}
