import { lazy, Suspense, useEffect } from "react";
import { getAppPath, navigate } from "../navigation";
import { IS_CLOUD } from "../../rybbit/src/lib/const";
import SettingsLayout from "../../rybbit/src/app/settings/layout";
import OrganizationLayout from "../../rybbit/src/app/settings/organization/layout";
import TeamsLayout from "../../rybbit/src/app/settings/teams/layout";
import BillingLayout from "../../rybbit/src/app/settings/billing/layout";
import { Skeleton } from "../../rybbit/src/components/ui/skeleton";
const Account = lazy(
  () => import("../../rybbit/src/app/settings/account/page")
);
const Organization = lazy(
  () => import("../../rybbit/src/app/settings/organization/page")
);
const Teams = lazy(() => import("../../rybbit/src/app/settings/teams/page"));
const Billing = lazy(() => import("../../rybbit/src/app/settings/billing/page"));
export default function Settings() {
  const path = getAppPath();
  const unavailable = path === "/settings/billing" && !IS_CLOUD;
  useEffect(() => {
    if (unavailable) navigate("/settings/account", true);
  }, [unavailable]);
  if (unavailable) return null;
  return (
    <SettingsLayout>
      <Suspense fallback={<Skeleton className="h-80" />}>
        {path === "/settings/billing" ? (
          <BillingLayout><Billing /></BillingLayout>
        ) : path === "/settings/organization" ? (
          <OrganizationLayout>
            <Organization />
          </OrganizationLayout>
        ) : path === "/settings/teams" ? (
          <TeamsLayout>
            <Teams />
          </TeamsLayout>
        ) : (
          <Account />
        )}
      </Suspense>
    </SettingsLayout>
  );
}
