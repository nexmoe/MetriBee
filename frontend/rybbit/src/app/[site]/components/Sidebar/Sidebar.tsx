"use client";
import {
  AlertTriangle,
  Bot,
  ChartColumnDecreasing,
  Code,
  Database,
  File,
  Funnel,
  Gauge,
  Globe2,
  LayoutDashboard,
  LayoutGrid,
  MousePointerClick,
  Rewind,
  PanelsTopLeft,
  Split,
  Target,
  User,
  Video,
} from "lucide-react";
import { useExtracted } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useGetSite } from "../../../../api/admin/hooks/useSites";
import { CommandPaletteTrigger } from "../../../../components/command-palette/CommandPaletteTrigger";
import { Sidebar as SidebarComponents } from "../../../../components/sidebar/Sidebar";
import { useAppEnv } from "../../../../hooks/useIsProduction";
import { DEPLOYMENT, IS_CLOUD } from "../../../../lib/const";
import { getSiteRouteContext } from "../../../../lib/siteRoute";
import { useStripeSubscription } from "../../../../lib/subscription/useStripeSubscription";
import { useEmbedPageOptions } from "../../utils";
import { SiteSelector } from "./SiteSelector";

function SidebarContent() {
  const t = useExtracted();
  const { data: subscription, isLoading: isSubscriptionLoading } = useStripeSubscription();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { embed, hideSidebar } = useEmbedPageOptions();
  const appEnv = useAppEnv();

  const { data: site } = useGetSite(Number(pathname.split("/")[1]));
  const isMobileSite = site?.type === "mobile";

  if (hideSidebar) return null;

  const { privateKey } = getSiteRouteContext(pathname);

  // Check which tab is active based on the current path
  const getTabPath = (tabName: string) => {
    const { siteId, privateKey } = getSiteRouteContext(pathname);

    // Build path: /siteId/[privateKey]/tabName
    const basePath = privateKey
      ? `/${siteId}/${privateKey}/${tabName.toLowerCase()}`
      : `/${siteId}/${tabName.toLowerCase()}`;
    const queryString = searchParams.toString();

    return queryString ? `${basePath}?${queryString}` : basePath;
  };

  const isActiveTab = (tabName: string) => {
    if (!pathname.includes("/")) return false;

    const route = getSiteRouteContext(pathname).route ?? "main";
    return route === tabName.toLowerCase();
  };

  return (
    <div className="w-56 bg-neutral-50 border-r border-neutral-150 dark:bg-neutral-900 dark:border-neutral-850 flex flex-col h-dvh">
      <div className="flex flex-col p-3 border-b border-neutral-200 dark:border-neutral-800">
        <SiteSelector />
        {/* Keyboard-first, so desktop only (this sidebar also renders in the mobile sheet). */}
        {!embed && <CommandPaletteTrigger className="mt-2 hidden md:flex" />}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 pt-1">
        <div className="mt-2">
          <SidebarComponents.Item
            label={t("Main")}
            active={isActiveTab("main")}
            href={getTabPath("main")}
            icon={<LayoutDashboard className="w-4 h-4" />}
          />
        </div>
        <SidebarComponents.SectionHeader>{t("Traffic")}</SidebarComponents.SectionHeader>
        {(
          <SidebarComponents.Item
            label={t("Pages")}
            active={isActiveTab("pages")}
            href={getTabPath("pages")}
            icon={<File className="w-4 h-4" />}
          />
        )}
        {!privateKey && <SidebarComponents.Item
          label={t("Globe")}
          active={isActiveTab("globe")}
          href={getTabPath("globe")}
          icon={<Globe2 className="w-4 h-4" />}
        />}
        {IS_CLOUD && (
          <></>
        )}
        <SidebarComponents.SectionHeader>{t("Behavior")}</SidebarComponents.SectionHeader>
        <></>
        <div className="hidden md:block">
          {!isMobileSite &&
            !subscription?.planName?.startsWith("appsumo") &&
            !isSubscriptionLoading &&
            appEnv !== "demo" && (
              <></>
            )}
        </div>
        <></>
        <SidebarComponents.Item
          label={t("Events")}
          active={isActiveTab("events")}
          href={getTabPath("events")}
          icon={<MousePointerClick className="w-4 h-4" />}
        />
        <SidebarComponents.SectionHeader>{t("Conversion")}</SidebarComponents.SectionHeader>
        <></>
        <></>
        <SidebarComponents.Item
          label={t("Funnels")}
          active={isActiveTab("funnels")}
          href={getTabPath("funnels")}
          icon={<Funnel className="w-4 h-4" />}
        />
        <SidebarComponents.Item
          label={t("Journeys")}
          active={isActiveTab("journeys")}
          href={getTabPath("journeys")}
          icon={<Split className="w-4 h-4" />}
        />
        <SidebarComponents.Item
          label={t("Retention")}
          active={isActiveTab("retention")}
          href={getTabPath("retention")}
          icon={<ChartColumnDecreasing className="w-4 h-4" />}
        />
        {!privateKey && <>
          <SidebarComponents.SectionHeader>GA4</SidebarComponents.SectionHeader>
          {!embed && <SidebarComponents.Item label={t("Widgets")} active={isActiveTab("widgets")} href={getTabPath("widgets")} icon={<PanelsTopLeft className="w-4 h-4" />} />}
          <SidebarComponents.Item label="API quota" href="/quota" icon={<Gauge className="w-4 h-4"/>}/>
        </>}
        {/* {!privateKey && (
          <SidebarComponents.Item
            label={t("Feature Flags")}
            active={isActiveTab("feature-flags")}
            href={getTabPath("feature-flags")}
            icon={<Flag className="w-4 h-4" />}
          />
        )}
        {!privateKey && (
          <SidebarComponents.Item
            label={t("Experiments")}
            active={isActiveTab("experiments")}
            href={getTabPath("experiments")}
            icon={<FlaskConical className="w-4 h-4" />}
          />
        )} */}
        <></>
        <></>
        {IS_CLOUD && !isMobileSite && (
          <></>
        )}
        {/* API Playground is desktop-only, and it and Dashboards have no private-link route, so the header
            hides with whatever is left: Query, else API Playground on desktop, else nothing */}
        {(IS_CLOUD || DEPLOYMENT || !privateKey) && (
          <div className={IS_CLOUD || DEPLOYMENT ? undefined : "hidden md:block"}>
            <></>
          </div>
        )}
        {!privateKey && (
          <div className="hidden md:block">
            <></>
          </div>
        )}
        {(IS_CLOUD || DEPLOYMENT) && (
          <>
            <></>
            {!privateKey && (
              <></>
            )}
          </>
        )}
        {/* <SidebarComponents.Item
          label="Reports"
          active={isActiveTab("reports")}
          href={getTabPath("reports")}
          icon={<ChartBarDecreasing className="w-4 h-4" />}
          /> */}
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <Suspense fallback={null}>
      <SidebarContent />
    </Suspense>
  );
}
