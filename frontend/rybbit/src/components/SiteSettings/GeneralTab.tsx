"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useExtracted } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { moveSite, updateSiteConfig, type SiteResponse } from "../../api/admin/endpoints";
import { publicDashboardUrl } from "../../../../adapter/navigation";
import { CopyButton } from "../interior/copy-button";
import { Switch } from "../ui/switch";
import { adminMoveSite } from "../../api/admin/endpoints/adminSites";
import { useUserOrganizations } from "../../api/admin/hooks/useOrganizations";
import { RemoteOrganizationCombobox } from "../../app/admin/components/shared/RemoteOrganizationCombobox";
import { useConfigs } from "../../lib/configs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { toast } from "../ui/sonner";
import { SettingRow, SettingsSection, SettingsSections } from "./SettingsSection";
import { TransferSiteSection } from "./TransferSiteSection";

// Preserve the original General tab's fields, sections, move and confirmation.
// GA4 metadata is read-only; collector settings and deletion do not apply.
export function GeneralTab({
  siteMetadata,
  canTransfer = false,
  onClose,
  adminMode = false,
}: {
  siteMetadata: SiteResponse;
  canTransfer?: boolean;
  onClose?: () => void;
  adminMode?: boolean;
}) {
  const t = useExtracted();
  const { data: userOrganizations } = useUserOrganizations();
  const { configs } = useConfigs();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [targetOrgId, setTargetOrgId] = useState("");
  const [targetOrgName, setTargetOrgName] = useState("");
  const [isMoving, setIsMoving] = useState(false);
  const [isUpdatingPublic, setIsUpdatingPublic] = useState(false);
  const canConfigure = siteMetadata.permissions.includes("sites:configure");
  const handlePublicChange = async (enabled: boolean) => {
    if (!canConfigure || isUpdatingPublic) return;
    setIsUpdatingPublic(true);
    try {
      await updateSiteConfig(siteMetadata.siteId, { public: enabled });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["get-site"] }),
        queryClient.invalidateQueries({ queryKey: ["site-is-public"] }),
        queryClient.invalidateQueries({ queryKey: ["get-sites-from-org"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-organizations"] }),
      ]);
      toast.success(enabled ? t("Site analytics made public") : t("Site analytics made private"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Failed to update site configuration"));
    } finally {
      setIsUpdatingPublic(false);
    }
  };
  const moveTargets = (userOrganizations ?? []).filter(
    (org) =>
      org.permissions?.includes("sites:create") &&
      org.id !== siteMetadata.organizationId
  );

  const handleMove = async () => {
    if (!targetOrgId || isMoving) return;
    setIsMoving(true);
    try {
      await (adminMode
        ? adminMoveSite(siteMetadata.siteId, targetOrgId)
        : moveSite(siteMetadata.siteId, targetOrgId));
      toast.success(t("Site moved successfully"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["get-sites-from-org"] }),
        queryClient.invalidateQueries({ queryKey: ["get-site"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-organizations"] }),
      ]);
      onClose?.();
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("Failed to move site")
      );
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <SettingsSections>
      <SettingsSection>
        <div className="space-y-2">
          <div>
            <Label
              htmlFor={`site-name-${siteMetadata.siteId}`}
              className="text-sm font-medium text-foreground"
            >
              {t("Site Name")}
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("The display name for this site")}
            </p>
          </div>
          <Input
            id={`site-name-${siteMetadata.siteId}`}
            value={siteMetadata.name}
            readOnly
          />
        </div>
        <div className="space-y-2">
          <div>
            <Label
              htmlFor={`site-domain-${siteMetadata.siteId}`}
              className="text-sm font-medium text-foreground"
            >
              {t("Domain")}
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("Property names and domains are managed in Google Analytics.")}
            </p>
          </div>
          <Input
            id={`site-domain-${siteMetadata.siteId}`}
            value={siteMetadata.domain}
            readOnly
          />
        </div>
      </SettingsSection>
      <SettingsSection title={t("Privacy & Security")}>
        <SettingRow
          label={t("Public Analytics")}
          htmlFor={`site-public-${siteMetadata.siteId}`}
          description={t("Anyone can view your site analytics without logging in")}
        >
          <Switch
            id={`site-public-${siteMetadata.siteId}`}
            checked={siteMetadata.public}
            disabled={!canConfigure || isUpdatingPublic}
            onCheckedChange={handlePublicChange}
          />
        </SettingRow>
        {siteMetadata.public && (
          <div className="space-y-2">
            <Label htmlFor={`site-public-link-${siteMetadata.siteId}`}>{t("Public dashboard link")}</Label>
            <div className="flex items-center">
              <Input id={`site-public-link-${siteMetadata.siteId}`} value={publicDashboardUrl(siteMetadata.siteId)} readOnly className="rounded-r-none" />
              <CopyButton iconOnly variant="default" value={publicDashboardUrl(siteMetadata.siteId)} label={t("Copy link")} className="w-10 rounded-l-none" />
            </div>
          </div>
        )}
      </SettingsSection>
      {canTransfer && (adminMode || moveTargets.length > 0) && (
        <SettingsSection
          title={t("Move to Organization")}
          description={t(
            "Transfer this site to another organization you administer. Team and restricted member access for this site will be reset."
          )}
        >
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              {adminMode ? (
                <RemoteOrganizationCombobox
                  value={targetOrgId}
                  selectedName={targetOrgName}
                  excludeId={siteMetadata.organizationId ?? undefined}
                  onSelect={(organization) => {
                    setTargetOrgId(organization.id);
                    setTargetOrgName(organization.name);
                  }}
                />
              ) : (
                <Select value={targetOrgId} onValueChange={setTargetOrgId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("Select an organization")} />
                  </SelectTrigger>
                  <SelectContent>
                    {moveTargets.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  loading={isMoving}
                  loadingLabel={t("Moving...")}
                  disabled={!targetOrgId || isMoving}
                >
                  {t("Move")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("Move this site?")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t(
                      'This will move "{siteName}" to {orgName}. Team and restricted member access for this site will be reset, and members of the current organization may lose access.',
                      {
                        siteName: siteMetadata.name,
                        orgName:
                          targetOrgName ||
                          moveTargets.find((org) => org.id === targetOrgId)
                            ?.name ||
                          targetOrgId,
                      }
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleMove} disabled={isMoving}>
                    {t("Yes, move site")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </SettingsSection>
      )}
      {canTransfer &&
        !adminMode &&
        (configs?.mailConfigured ? (
          <TransferSiteSection siteId={siteMetadata.siteId} />
        ) : (
          <SettingsSection
            title={t("Transfer to someone else")}
            description={t(
              "Configure email delivery to transfer this property to someone else."
            )}
          />
        ))}
    </SettingsSections>
  );
}
