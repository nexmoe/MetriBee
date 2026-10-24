"use client";
import { Home, Activity, AppWindow, Globe, Gauge, Plug } from "lucide-react";
import { usePathname } from "next/navigation";
import { useExtracted } from "next-intl";
import { OrganizationSelector } from "../OrganizationSelector";
import { Sidebar } from "./Sidebar";
export function NavigationSidebar() {
  const pathname = usePathname();
  const t = useExtracted();
  return (
    <Sidebar.Root>
      <div className="p-3 pt-4 border-b border-neutral-300 dark:border-neutral-800">
        <OrganizationSelector />
      </div>
      <Sidebar.Items>
        <Sidebar.SectionHeader>Workspace</Sidebar.SectionHeader>
        <Sidebar.Item
          label={t("Properties")}
          href="/"
          active={pathname === "/"}
          icon={<AppWindow className="w-4 h-4" />}
        />
        <Sidebar.Item
          label="Realtime overview"
          href="/realtime"
          active={pathname === "/realtime"}
          icon={<Activity className="w-4 h-4" />}
        />
        <Sidebar.Item
          label="Sites"
          href="/sites"
          active={pathname === "/sites"}
          icon={<AppWindow className="w-4 h-4" />}
        />
        <Sidebar.Item
          label="Globe"
          href="/globe"
          active={pathname.endsWith("/globe")}
          icon={<Globe className="w-4 h-4" />}
        />
        <Sidebar.SectionHeader>GA4</Sidebar.SectionHeader>
        <Sidebar.Item
          label="API quota"
          href="/quota"
          active={pathname === "/quota"}
          icon={<Gauge className="w-4 h-4" />}
        />
        <Sidebar.Item
          label="Connection"
          href="/setup"
          active={pathname === "/setup"}
          icon={<Plug className="w-4 h-4" />}
        />
      </Sidebar.Items>
    </Sidebar.Root>
  );
}
