"use client";
import {
  ChartColumnDecreasing,
  File,
  Funnel,
  Globe2,
  LayoutDashboard,
  LayoutGrid,
  MousePointerClick,
  PanelsTopLeft,
  Split,
  Target,
  Settings,
} from "lucide-react";
import { useExtracted } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useGetSite } from "../../../../api/admin/hooks/useSites";
import { CommandPaletteTrigger } from "../../../../components/command-palette/CommandPaletteTrigger";
import { Sidebar as SidebarComponents } from "../../../../components/sidebar/Sidebar";
import { getSiteRouteContext } from "../../../../lib/siteRoute";
import { useEmbedPageOptions } from "../../utils";
import { SiteSelector } from "./SiteSelector";
import { SiteSettings } from "../../../../components/SiteSettings/SiteSettings";
import { isPublicDashboard } from "../../../../../../adapter/navigation";

function SidebarContent() {
  const t = useExtracted();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { embed, hideSidebar } = useEmbedPageOptions();

  const { data: site } = useGetSite(Number(pathname.split("/")[1]));

  if (hideSidebar) return null;

  const { privateKey } = getSiteRouteContext(pathname);
  const readOnly = !!privateKey || isPublicDashboard();

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
        {!embed && !readOnly && <CommandPaletteTrigger className="mt-2 hidden md:flex" />}
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
        <SidebarComponents.SectionHeader>
          {t("Traffic")}
        </SidebarComponents.SectionHeader>
        <SidebarComponents.Item
          label={t("Pages")}
          active={isActiveTab("pages")}
          href={getTabPath("pages")}
          icon={<File className="w-4 h-4" />}
        />
        {!readOnly && (
          <SidebarComponents.Item
            label={t("Globe")}
            active={isActiveTab("globe")}
            href={getTabPath("globe")}
            icon={<Globe2 className="w-4 h-4" />}
          />
        )}
        <SidebarComponents.SectionHeader>
          {t("Behavior")}
        </SidebarComponents.SectionHeader>
        <SidebarComponents.Item
          label={t("Events")}
          active={isActiveTab("events")}
          href={getTabPath("events")}
          icon={<MousePointerClick className="w-4 h-4" />}
        />
        <SidebarComponents.SectionHeader>
          {t("Conversion")}
        </SidebarComponents.SectionHeader>
        <SidebarComponents.Item
          label={t("Goals")}
          active={isActiveTab("goals")}
          href={getTabPath("goals")}
          icon={<Target className="w-4 h-4" />}
        />
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
        {!readOnly && (
          <>
            <SidebarComponents.SectionHeader>
              {t("Explore")}
            </SidebarComponents.SectionHeader>
            <SidebarComponents.Item
              label={t("Dashboards")}
              active={isActiveTab("dashboards")}
              href={getTabPath("dashboards")}
              icon={<LayoutGrid className="w-4 h-4" />}
            />
            {!embed && (
              <SidebarComponents.Item
                label={t("Widgets")}
                active={isActiveTab("widgets")}
                href={getTabPath("widgets")}
                icon={<PanelsTopLeft className="w-4 h-4" />}
              />
            )}
          </>
        )}
        {!embed && !readOnly && site?.permissions.includes("sites:configure") && (
          <>
            <SidebarComponents.SectionHeader>
              {t("Settings")}
            </SidebarComponents.SectionHeader>
            <SiteSettings
              siteId={site.siteId}
              lazy
              trigger={
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg transition-colors w-full text-neutral-700 hover:text-neutral-900 hover:bg-neutral-150 dark:text-neutral-200 dark:hover:text-white dark:hover:bg-neutral-800/50 cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    <span className="text-sm">{t("Site Settings")}</span>
                  </span>
                </button>
              }
            />
          </>
        )}
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
