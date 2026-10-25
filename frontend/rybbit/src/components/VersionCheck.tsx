"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useExtracted } from "next-intl";
import { toast } from "@/components/ui/sonner";
import { fetchLatestRelease, isNewer, shouldCheckVersion } from "../../../adapter/updates";

import { IS_CLOUD } from "../lib/const";
import { X } from "lucide-react";
import { Button } from "./ui/button";

const CURRENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

export function VersionCheck() {
  const t = useExtracted();

  const [enabled] = useState(() => !IS_CLOUD && shouldCheckVersion());

  const { data: release } = useQuery({
    queryKey: ["metribee-version-check"],
    queryFn: fetchLatestRelease,
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (!enabled || !release) return;
    if (isNewer(release.version, CURRENT_VERSION)) {
      toast.custom(
        toastInstance => (
          <div
            role="status"
            style={{
              opacity: toastInstance.visible ? 1 : 0,
              transform: toastInstance.visible ? "translateY(0)" : "translateY(-8px)",
            }}
            className="flex max-w-md items-center gap-3 bg-white dark:bg-neutral-850 border border-neutral-150 dark:border-neutral-850 rounded-lg shadow-lg py-2 px-3 text-sm text-neutral-900 dark:text-neutral-100 transition-[opacity,transform] duration-200 motion-reduce:transition-none"
          >
            <span>{t("MetriBee v{latest} is available (you're on v{current})", { latest: release.version, current: CURRENT_VERSION })}</span>
            <Button asChild variant="success" size="sm" className="shrink-0">
              <a href={release.url} target="_blank" rel="noopener noreferrer">
                {t("Upgrade")}
              </a>
            </Button>
            <Button
              variant="ghost"
              size="smIcon"
              aria-label={t("Close")}
              onClick={() => toast.dismiss(toastInstance.id)}
              className="shrink-0 text-neutral-500 dark:text-neutral-400"
            >
              <X size={16} />
            </Button>
          </div>
        ),
        { id: "metribee-version-update", duration: 10000 }
      );
    }
  }, [release, enabled, t]);

  return null;
}
