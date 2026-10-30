// Rybbit billing ledger/plan dialog composition adapted for Waffo. AGPL-3.0-only.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { ArrowRight, ExternalLink } from "lucide-react";
import { authedFetch } from "../../rybbit/src/api/utils";
import { authClient } from "../../rybbit/src/lib/auth";
import { IS_CLOUD } from "../../rybbit/src/lib/const";
import { useCanInOrg } from "../../rybbit/src/hooks/usePermissions";
import { PlanSection } from "../../rybbit/src/components/subscription/components/PlanSection";
import {
  DangerRow,
  DangerZone,
  LedgerRow,
  LedgerRows,
  LedgerSection,
} from "../../rybbit/src/app/settings/components/Ledger";
import { Button } from "../../rybbit/src/components/ui/button";
import { Badge } from "../../rybbit/src/components/ui/badge";
import { PlanDialog } from "../../rybbit/src/components/subscription/components/PlanDialog";
import {
  InvoicesSection,
  type Invoice,
} from "../../rybbit/src/components/subscription/components/InvoicesSection";
import {
  CancellationDialog,
  type CancellationFeedback,
} from "../../rybbit/src/components/subscription/PaidPlain/CancellationDialog";
import { Alert } from "../../rybbit/src/components/ui/alert";
import { Skeleton } from "../../rybbit/src/components/ui/skeleton";
import { ErrorState } from "../../rybbit/src/components/ErrorState";
import { useExtracted } from "../extracted";

type Plan = {
  id: string;
  productId: string;
  name: string;
  interval: string;
  currency: string;
  amount: string;
};
type Subscription = {
  orderId: string;
  productId: string;
  status: string;
  currency: string;
  amount: string;
  interval: string;
  currentPeriodEnd: string | null;
};
type Payment = {
  id: string;
  amount: string;
  currency: string;
  status: string;
  createdAt: string;
};
type BillingData = {
  cloud: boolean;
  mode: "test" | "prod";
  configured: boolean;
  plans: Plan[];
  subscription: Subscription | null;
  payments: Payment[];
  checkout: { status: string; productType: string } | null;
};

export default function Billing() {
  const t = useExtracted();
  const locale = useLocale();
  const cache = useQueryClient();
  const { data: org } = authClient.useActiveOrganization();
  const canManage = useCanInOrg("billing:manage", org?.id);
  const root = `/organizations/${encodeURIComponent(org?.id || "")}/billing`;
  const returned = new URLSearchParams(location.search).get("checkout");
  const key = ["waffo-billing", org?.id, returned];
  const [planOpen, setPlanOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      authedFetch<BillingData>(
        root,
        returned ? { checkout: returned } : undefined
      ),
    enabled: !!org && canManage && IS_CLOUD,
    refetchInterval: (q) =>
      returned &&
      q.state.data?.checkout?.status !== "completed" &&
      q.state.dataUpdateCount < 60
        ? 5000
        : false,
  });
  useEffect(() => {
    setError("");
    setPlanOpen(false);
    setCancelOpen(false);
  }, [org?.id]);
  useEffect(() => {
    const refresh = () => {
      void cache.invalidateQueries({ queryKey: key });
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [org?.id]);
  const data = query.data;
  const sub = data?.subscription;
  const money = (amount: string, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      Number(amount)
    );
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      new Date(value)
    );
  const active =
    sub && ["active", "canceling", "past_due"].includes(sub.status);
  const cancellationDescription = t(
    sub?.status === "past_due"
      ? "Overdue subscriptions are canceled as soon as the payment provider confirms."
      : "Your subscription remains available until the current billing period ends."
  );
  const currentPlan = data?.plans.find((p) => p.productId === sub?.productId);
  const post = <T,>(action: string, body: object = {}) =>
    authedFetch<T>(`${root}/${action}`, undefined, {
      method: "POST",
      data: body,
    });
  // Opening the blank window in the click handler preserves the browser's user gesture.
  const openHosted = (action: "checkout" | "portal", body: object = {}) => {
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setError(t("Allow popups to open the secure payment page."));
      return;
    }
    popup.opener = null;
    setBusy(true);
    setError("");
    void post<{ checkoutUrl?: string; portalUrl?: string }>(action, body)
      .then((result) => {
        const url = new URL(result.checkoutUrl || result.portalUrl || "");
        if (url.protocol !== "https:" || url.hostname !== "pancake.waffo.ai")
          throw Error(t("Unable to open the payment page."));
        popup.location.replace(url.href);
        setPlanOpen(false);
      })
      .catch((cause: Error) => {
        popup.close();
        setError(cause.message);
      })
      .finally(() => setBusy(false));
  };
  if (!IS_CLOUD) return null;
  if (!org)
    return (
      <p className="text-sm text-neutral-500">
        {t("You need to select an organization to manage your subscription.")}
      </p>
    );
  if (!canManage) return null;
  if (query.isPending)
    return (
      <>
        <LedgerSection title={t("Plan")}>
          <LedgerRows>
            <LedgerRow label={t("Current plan")}>
              <div className="space-y-2 md:pt-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-64" />
              </div>
            </LedgerRow>
          </LedgerRows>
        </LedgerSection>
        <LedgerSection title={t("Payment")}>
          <LedgerRows>
            <LedgerRow label={t("Payment method")}>
              <Skeleton className="h-9 w-full" />
            </LedgerRow>
          </LedgerRows>
        </LedgerSection>
      </>
    );
  if (query.isError)
    return (
      <ErrorState
        title={t("Couldn't load your subscription")}
        message=""
        refetch={query.refetch}
      />
    );
  if (!data) return null;
  const status =
    sub?.status === "active"
      ? t("Active")
      : sub?.status === "canceling"
      ? t("Cancels at period end")
      : sub?.status === "past_due"
      ? t("Payment overdue")
      : t("No active subscription");
  const isCanceling = sub?.status === "canceling";
  const periodEnd = sub?.currentPeriodEnd ? date(sub.currentPeriodEnd) : null;
  const price = active
    ? t(sub.interval === "yearly" ? "{price}/year" : "{price}/month", {
        price: money(sub.amount, sub.currency),
      })
    : undefined;
  const invoices: Invoice[] = data.payments.map((payment) => ({
    id: payment.id,
    number: null,
    status: payment.status === "succeeded" ? "paid" : "refunded",
    displayAmount: payment.amount,
    currency: payment.currency,
    created: Date.parse(payment.createdAt) / 1000,
    periodStart: 0,
    periodEnd: 0,
    hostedInvoiceUrl: null,
    invoicePdf: null,
  }));
  const cancelSubscription = async (feedback: CancellationFeedback) => {
    await post("cancel", feedback);
    void cache.invalidateQueries({ queryKey: ["waffo-billing", org.id] });
    void cache.invalidateQueries({
      queryKey: ["organization-subscription", org.id],
    });
  };
  return (
    <>
      {returned && data.checkout?.status !== "completed" && (
        <p role="status" className="text-sm text-neutral-500">
          {t(
            "Waiting for payment confirmation. This page updates automatically."
          )}
        </p>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      <PlanDialog
        open={planOpen}
        onOpenChange={setPlanOpen}
        plans={data.plans}
        currentProductId={sub?.productId}
        currentPlanName={currentPlan?.name}
        hasActiveSubscription={!!active}
        processing={busy}
        onCheckout={(planId) => openHosted("checkout", { planId })}
      />
      {sub && (
        <CancellationDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          organizationId={org.id}
          subscription={{
            planName: currentPlan?.name || "MetriBee Cloud",
            interval: sub.interval,
            currentPeriodEnd: sub.currentPeriodEnd || "",
          }}
          consequence={cancellationDescription}
          price={price}
          onChangePlan={() => setPlanOpen(true)}
          onCancel={cancelSubscription}
        />
      )}
      <PlanSection
        name={
          <>
            {active
              ? currentPlan?.name || t("MetriBee Cloud")
              : t("No active subscription")}
            {data.mode === "test" && (
              <Badge
                variant="outline"
                className="ml-2 align-middle font-normal"
              >
                {t("Test mode")}
              </Badge>
            )}
          </>
        }
        price={price}
        description={
          active
            ? sub.interval === "yearly"
              ? t("Billed annually.")
              : t("Billed monthly.")
            : undefined
        }
        status={
          periodEnd
            ? isCanceling
              ? t("Your plan is set to cancel on {date}.", { date: periodEnd })
              : t("{status} · Current period ends {date}", {
                  status,
                  date: periodEnd,
                })
            : active
            ? status
            : undefined
        }
        details={t("Fixed fee per organization.")}
        action={
          <Button
            variant="success"
            disabled={!data.configured || busy}
            onClick={() => {
              setError("");
              if (sub && ["canceling", "past_due"].includes(sub.status))
                openHosted("portal");
              else setPlanOpen(true);
            }}
          >
            {sub && ["canceling", "past_due"].includes(sub.status)
              ? t("Manage billing")
              : active
              ? t("Change plan")
              : t("Upgrade to Pro")}
            {!active && <ArrowRight className="h-4 w-4" />}
          </Button>
        }
      />
      {!data.configured && (
        <p role="status" className="text-sm text-neutral-500">
          {t("Payments are not configured yet. Contact your administrator.")}
        </p>
      )}
      <LedgerSection title={t("Payment")}>
        <LedgerRows>
          <LedgerRow
            label={t("Payment method")}
            description={active ? t("Charged on each renewal.") : undefined}
          >
            <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                {t("Your card and billing email are managed in Waffo.")}
              </p>
              <Button
                variant="outline"
                className="sm:ml-auto"
                disabled={!data.configured || busy}
                onClick={() => openHosted("portal")}
              >
                {t("Manage in Waffo")}
                <ExternalLink aria-hidden className="size-3.5" />
              </Button>
            </div>
          </LedgerRow>
        </LedgerRows>
      </LedgerSection>
      <InvoicesSection
        invoices={invoices}
        processing={busy}
        onView={() => openHosted("portal")}
      />
      {active && (
        <DangerZone>
          <DangerRow
            label={t("Cancel subscription")}
            description={t("Takes effect when the period ends.")}
            consequence={
              isCanceling && periodEnd
                ? t("Your plan is set to cancel on {date}.", {
                    date: periodEnd,
                  })
                : cancellationDescription
            }
            action={
              <Button
                variant="ghost"
                disabled={busy || isCanceling}
                className="text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                onClick={() => setCancelOpen(true)}
              >
                {t("Cancel subscription")}
              </Button>
            }
          />
        </DangerZone>
      )}
    </>
  );
}
