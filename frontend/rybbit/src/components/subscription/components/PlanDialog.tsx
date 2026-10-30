import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useExtracted, useLocale } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PlanRow } from "./PlanRow";

export interface BillingPlan {
  id: string;
  productId: string;
  name: string;
  interval: string;
  currency: string;
  amount: string;
}

interface PlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlanName?: string;
  hasActiveSubscription?: boolean;
  plans?: BillingPlan[];
  currentProductId?: string;
  processing?: boolean;
  onCheckout?: (planId: string) => void;
}

// Rybbit's original dialog and PlanRow; fixed organization fees need no event slider.
export function PlanDialog({
  open,
  onOpenChange,
  currentPlanName,
  hasActiveSubscription,
  plans = [],
  currentProductId,
  processing,
  onCheckout,
}: PlanDialogProps) {
  const t = useExtracted();
  const locale = useLocale();
  const [isAnnual, setIsAnnual] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"standard" | "pro">(
    "standard"
  );
  useEffect(() => {
    if (!open) return;
    const current = plans.find((p) => p.productId === currentProductId);
    setIsAnnual(current?.interval === "yearly");
    setSelectedPlan(
      (current?.name || currentPlanName || "").toLowerCase().includes("pro")
        ? "pro"
        : "standard"
    );
  }, [open, currentProductId, currentPlanName]);
  const interval = isAnnual ? "yearly" : "monthly";
  const options = plans.filter((p) => p.interval === interval);
  const selected = options.find((p) => p.name.toLowerCase() === selectedPlan);
  const isCurrentSelection =
    !!hasActiveSubscription && selected?.productId === currentProductId;
  const money = (amount: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      amount
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100dvw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-5 pr-6">
            <DialogTitle>{t("Choose Your Plan")}</DialogTitle>
            <div className="relative flex rounded-lg border border-neutral-250 bg-neutral-150 p-0.5 text-sm dark:border-neutral-750 dark:bg-neutral-850">
              {[false, true].map((annual) => (
                <button
                  key={String(annual)}
                  type="button"
                  aria-pressed={isAnnual === annual}
                  onClick={() => setIsAnnual(annual)}
                  className={cn(
                    "cursor-pointer rounded-md px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-500",
                    isAnnual === annual
                      ? "bg-white font-medium text-neutral-700 dark:bg-white/20 dark:text-neutral-100"
                      : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
                  )}
                >
                  {annual ? t("Annual") : t("Monthly")}
                </button>
              ))}
              {isAnnual && (
                <span className="absolute -top-3 right-0 whitespace-nowrap rounded-md bg-emerald-500 px-1.5 py-0.5 text-[10px] text-white">
                  {t("Annual savings")}
                </span>
              )}
            </div>
          </div>
          <DialogDescription>
            {t("Fixed fee per organization.")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <div className="space-y-2">
            {options.map((plan) => (
              <PlanRow
                key={plan.id}
                plan={plan.name.toLowerCase() === "pro" ? "pro" : "standard"}
                label={plan.name}
                description={t("Per organization")}
                isAnnual={isAnnual}
                selectedPlan={selectedPlan}
                onSelect={() =>
                  setSelectedPlan(
                    plan.name.toLowerCase() === "pro" ? "pro" : "standard"
                  )
                }
                isCurrent={
                  hasActiveSubscription && plan.productId === currentProductId
                }
                priceLabel={money(
                  Number(plan.amount) / (isAnnual ? 12 : 1),
                  plan.currency
                )}
                priceSuffix={t("/mo")}
                billingLabel={
                  isAnnual
                    ? t("Billed {price}/year", {
                        price: money(Number(plan.amount), plan.currency),
                      })
                    : undefined
                }
              />
            ))}
          </div>
          {onCheckout ? (
            <Button
              className="w-full h-11"
              variant="success"
              loading={processing}
              disabled={!selected || isCurrentSelection}
              onClick={() => selected && onCheckout(selected.id)}
            >
              {isCurrentSelection
                ? t("Current Plan")
                : hasActiveSubscription
                ? t("Change Plan")
                : t("Subscribe")}
              {!isCurrentSelection && <ArrowRight className="ml-2 h-4 w-4" />}
            </Button>
          ) : (
            <Button asChild className="w-full h-11" variant="success">
              <Link href="/settings/billing">
                {t("Manage billing")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          )}
          <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
            {t(
              "Review the final amount, tax and any plan change adjustment on the secure payment page."
            )}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
