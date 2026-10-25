import React, { Suspense, lazy, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import { NuqsAdapter } from "nuqs/adapters/react";
import axios from "axios";
import { setPrivateKeyResolver } from "../rybbit/src/api/requestContext";
import SiteLayout from "../rybbit/src/app/[site]/layout";
import { TooltipProvider } from "../rybbit/src/components/ui/tooltip";
import { CommandPalette } from "../rybbit/src/components/command-palette/CommandPalette";
import { ErrorState } from "../rybbit/src/components/ErrorState";
import { Skeleton } from "../rybbit/src/components/ui/skeleton";
import { Toaster } from "../rybbit/src/components/ui/sonner";
import messages from "../rybbit/messages/en.json";
import { getAppPath, getLocale, getSharedRoute, useLocation } from "./navigation";
import { PrivacyProvider } from "./privacy/Privacy";
import { useExtracted } from "./extracted";
import { QueryProvider } from "./QueryProvider";
import "./urlState";
import "../rybbit/src/app/globals.css";
import "./integration.css";

const pages: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  "/analytics": lazy(() => import("./pages/Overview")),
  "/analytics/pages": lazy(() => import("./pages/Pages")),
  "/events": lazy(() => import("../rybbit/src/app/[site]/events/page")),
  "/journeys": lazy(() => import("./pages/Journeys")),
  "/retention": lazy(() => import("../rybbit/src/app/[site]/retention/page")),
  "/funnels": lazy(() => import("./pages/Funnels")),
  "/widgets": lazy(() => import("./pages/Widgets")),
  "/globe": lazy(() => import("./pages/Globe")),
  "/": lazy(() => import("../rybbit/src/app/(home)/page")),
  "/realtime": lazy(() => import("./pages/Home")),
  "/quota": lazy(() => import("./pages/Quota")),
  "/analytics/reports": lazy(() => import("./pages/Reports")),
  "/setup": lazy(() => import("./Setup")),
};
const WidgetFrame = lazy(() => import("./embeds/WidgetFrame"));
function ReportError({ error }: { error: Error }) {
  const t = useExtracted();
  return <ErrorState title={t("Report unavailable")} message={error.message} refetch={() => location.reload()} />;
}
class Boundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <ReportError error={this.state.error} />
    ) : (
      this.props.children
    );
  }
}
function App() {
  useLocation();
  const t = useExtracted();
  const pathname = getAppPath();
  useEffect(() => {
    const titles: Record<string, string> = {
      "/": "Home",
      "/realtime": "Realtime overview",
      "/globe": "Globe",
      "/quota": "API quota",
      "/setup": "GA4 connection",
    };
    if (titles[pathname]) document.title = `${t(titles[pathname])} · MetriBee`;
  }, [pathname, t]);
  const widget = (window as any).__GA4_CONTEXT__?.metricWidget;
  const Page = widget ? WidgetFrame : pages[pathname] || pages["/analytics"];
  const content = (
    <Boundary key={location.pathname}>
      <Suspense
        fallback={
          <div className="mx-auto max-w-[1300px] space-y-3 p-2 md:p-4">
            <Skeleton className="h-8" />
            <Skeleton className="h-96" />
          </div>
        }
      >
        <Page />
      </Suspense>
    </Boundary>
  );
  return widget || ["/", "/realtime", "/setup", "/quota", "/globe"].includes(
    pathname
  ) ? (
    content
  ) : (
    <SiteLayout>{content}</SiteLayout>
  );
}
async function boot() {
  const shared = getSharedRoute();
  setPrivateKeyResolver(() => getSharedRoute()?.privateKey ?? null);
  if (shared) {
    axios.defaults.headers.common["x-private-key"] = shared.privateKey;
    axios.defaults.headers.common["x-private-site"] = shared.siteId;
  }
  const params = new URLSearchParams(location.search);
  const widget = (window as any).__GA4_CONTEXT__?.metricWidget;
  const embedded = params.get("embed") === "true";
  const theme = embedded ? params.get("theme") : null;
  const locale = getLocale();
  const catalogs = import.meta.glob<{ default: typeof messages }>(
    "../rybbit/messages/*.json"
  );
  const catalog =
    locale === "en"
      ? messages
      : (await catalogs[`../rybbit/messages/${locale}.json`]()).default;
  document.documentElement.lang = locale;
  createRoot(document.getElementById("root")!).render(
    <NextIntlClientProvider locale={locale} messages={{ ...messages, ...catalog }} timeZone="UTC">
      <MotionConfig reducedMotion="user">
        <ThemeProvider
          attribute="class"
          storageKey={widget ? `ga4_widget_theme_${widget.siteId || "preview"}_${widget.widgetId || "preview"}` : embedded ? "ga4_embed_theme" : "pb_theme"}
          defaultTheme={widget?.config?.theme || (embedded ? "system" : "dark")}
          forcedTheme={!widget && (theme === "dark" || theme === "light") ? theme : undefined}
          enableSystem
          disableTransitionOnChange
        >
          <NuqsAdapter>
            <QueryProvider>
              <TooltipProvider>
                <PrivacyProvider>
                  <Boundary>
                    <App />
                    {!shared && !embedded && !widget && <CommandPalette />}
                    <Toaster />
                  </Boundary>
                </PrivacyProvider>
              </TooltipProvider>
            </QueryProvider>
          </NuqsAdapter>
        </ThemeProvider>
      </MotionConfig>
    </NextIntlClientProvider>
  );
}
boot();
