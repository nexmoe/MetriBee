"use client";

import type { ReactNode } from "react";
import { WidgetManagerLink } from "../../../../adapter/embeds/WidgetManagerLink";

// Compatibility for upstream callers. Widget management now has its own page.
interface SiteSettingsProps {
  siteId: number;
  trigger?: ReactNode;
  lazy?: boolean;
  adminOrganization?: {
    id: string;
    subscription: { planName: string; eventLimit?: number };
  };
}

export function SiteSettings({ siteId, trigger }: SiteSettingsProps) {
  return <WidgetManagerLink siteId={siteId} trigger={trigger} />;
}
