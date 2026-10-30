"use client";

import { Settings, X } from "lucide-react";
import { useExtracted } from "next-intl";
import { useState } from "react";
import { useGetSite } from "../../api/admin/hooks/useSites";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { ErrorState } from "../ErrorState";
import { Skeleton } from "../ui/skeleton";
import { GeneralTab } from "./GeneralTab";

// Native Rybbit dialog. GA4 supplies metadata; Widgets has its own manager.
interface SiteSettingsProps {
  siteId: number;
  trigger?: React.ReactNode;
  lazy?: boolean;
  initialOpen?: boolean;
  onClose?: () => void;
  adminOrganization?: {
    id: string;
    subscription: { planName: string; eventLimit?: number };
  };
}

export function SiteSettings({
  siteId,
  trigger,
  lazy = false,
  initialOpen = false,
  onClose,
  adminOrganization,
}: SiteSettingsProps) {
  const t = useExtracted();
  const [dialogOpen, setDialogOpen] = useState(initialOpen);
  const {
    data: siteMetadata,
    isPending,
    error,
    refetch,
  } = useGetSite(siteId, { enabled: !lazy || dialogOpen });
  const close = () => {
    setDialogOpen(false);
    onClose?.();
  };
  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => (open ? setDialogOpen(true) : close())}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" aria-label={t("Site Settings")}>
            <Settings className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-[1000px] p-0 gap-0 overflow-hidden"
        hideClose
        aria-describedby={undefined}
      >
        <div className="flex h-[80vh] flex-col sm:flex-row">
          <aside className="w-full sm:w-[220px] shrink-0 border-b sm:border-b-0 sm:border-r border-neutral-200 dark:border-neutral-850 bg-neutral-50 dark:bg-neutral-900/50 p-3 flex sm:flex-col gap-1">
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="self-start sm:mb-2 h-8 w-8"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">{t("Close")}</span>
              </Button>
            </DialogClose>
            <button
              type="button"
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-left transition-colors bg-neutral-200/70 text-foreground dark:bg-neutral-800 dark:text-neutral-50"
            >
              <Settings className="h-4 w-4 shrink-0" />
              <span className="truncate">{t("General")}</span>
            </button>
          </aside>
          <main className="flex-1 flex flex-col min-w-0 min-h-0">
            <header className="px-6 pt-5 pb-3 border-b border-neutral-200 dark:border-neutral-850 flex items-center justify-between gap-4">
              <DialogTitle className="text-lg font-semibold mb-0">
                {t("General")}
              </DialogTitle>
            </header>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {isPending ? (
                <Skeleton className="h-64" />
              ) : !siteMetadata || error ? (
                <ErrorState
                  title={t("Property unavailable")}
                  message={
                    error?.message || t("This property could not be loaded.")
                  }
                  refetch={refetch}
                />
              ) : (
                <GeneralTab
                  key={siteMetadata.siteId}
                  siteMetadata={siteMetadata}
                  canTransfer={siteMetadata.permissions.includes(
                    "sites:transfer"
                  )}
                  onClose={close}
                  adminMode={!!adminOrganization}
                />
              )}
            </div>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
