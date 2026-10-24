import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useExtracted } from "../extracted";
import { WidgetManager } from "../embeds/WidgetManager";
import { updateSiteConfig } from "../../rybbit/src/api/admin/endpoints";
import { useGetSite } from "../../rybbit/src/api/admin/hooks/useSites";
import { ErrorState } from "../../rybbit/src/components/ErrorState";
import { Skeleton } from "../../rybbit/src/components/ui/skeleton";
import { toast } from "../../rybbit/src/components/ui/sonner";
import { useSetPageTitle } from "../../rybbit/src/hooks/useSetPageTitle";
import { useStore } from "../../rybbit/src/lib/store";
import { SiteSelector } from "../../rybbit/src/app/[site]/components/Sidebar/SiteSelector";

function SiteWidgets({ siteId }: { siteId: number }) {
  const t = useExtracted();
  const client = useQueryClient();
  const metadata = useGetSite(siteId);
  const enable = useMutation({
    mutationFn: (enabled: boolean) =>
      updateSiteConfig(siteId, { embedEnabled: enabled }),
    onSuccess: (_, enabled) => {
      client.setQueryData(["get-site", siteId], (site: typeof metadata.data) =>
        site ? { ...site, embedEnabled: enabled } : site
      );
      client.invalidateQueries({ queryKey: ["get-site"] });
      client.invalidateQueries({ queryKey: ["get-sites-from-org"] });
      toast.success(
        enabled ? t("Public embeds enabled") : t("Public embeds disabled")
      );
    },
    onError: (error) => toast.error(error.message),
  });
  if (metadata.isPending)
    return (
      <div className="space-y-3">
        <Skeleton className="h-14" />
        <Skeleton className="h-24" />
      </div>
    );
  if (metadata.isError || !metadata.data)
    return (
      <ErrorState
        title={t("Widgets unavailable")}
        message={metadata.error?.message || t("Property not found.")}
        refetch={metadata.refetch}
      />
    );
  if (!metadata.data.permissions?.includes("sites:configure"))
    return (
      <ErrorState
        title={t("Widgets unavailable")}
        message={t(
          "You do not have permission to manage widgets for this property."
        )}
      />
    );
  return (
    <WidgetManager
      siteId={siteId}
      embedEnabled={!!metadata.data.embedEnabled}
      disabled={false}
      updatingEnabled={enable.isPending}
      onEnabledChange={(enabled) => enable.mutate(enabled)}
    />
  );
}

export default function WidgetsPage() {
  useSetPageTitle("Widgets");
  const site = useStore((state) => state.site);
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 p-4">
      <div className="max-w-72 md:hidden">
        <SiteSelector />
      </div>
      <SiteWidgets key={site} siteId={Number(site)} />
    </div>
  );
}
