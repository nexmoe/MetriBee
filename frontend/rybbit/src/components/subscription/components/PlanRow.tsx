import { useExtracted } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { findPriceForTier } from "@/lib/subscription/planUtils";

interface PlanRowProps {
  plan: "standard" | "pro";
  label: string;
  description: string;
  eventLimit?: number | string;
  priceLabel?: ReactNode;
  priceSuffix?: ReactNode;
  billingLabel?: ReactNode;
  isAnnual: boolean;
  selectedPlan: string;
  onSelect: () => void;
  isCurrent?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export function PlanRow({
  plan,
  label,
  description,
  eventLimit = "Custom",
  priceLabel,
  priceSuffix,
  billingLabel,
  isAnnual,
  selectedPlan,
  onSelect,
  isCurrent,
  disabled,
  disabledReason,
}: PlanRowProps) {
  const t = useExtracted();
  const price =
    priceLabel === undefined && eventLimit !== "Custom"
      ? findPriceForTier(eventLimit, isAnnual ? "year" : "month", plan)
      : null;
  const displayPrice = price
    ? isAnnual
      ? Math.round(price.price / 12)
      : price.price
    : 0;

  return (
    <button
      type="button"
      aria-pressed={selectedPlan === plan}
      disabled={disabled}
      onClick={disabled ? undefined : onSelect}
      className={cn(
        "w-full rounded-lg p-1.5 transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950 dark:focus-visible:ring-neutral-300",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        !disabled && selectedPlan === plan
          ? "bg-emerald-500/10 border border-emerald-500/30"
          : "bg-neutral-200/20 dark:bg-neutral-900/40 border border-neutral-200 dark:border-neutral-800"
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-3 p-3 rounded-lg border",
          !disabled && selectedPlan === plan
            ? "border-emerald-500 bg-neutral-50 dark:bg-neutral-800/60"
            : "border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900",
          !disabled &&
            selectedPlan !== plan &&
            "hover:border-neutral-300 dark:hover:border-neutral-700"
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              "w-4 h-4 shrink-0 rounded-full border-2 flex items-center justify-center",
              !disabled && selectedPlan === plan
                ? "border-emerald-500"
                : "border-neutral-300 dark:border-neutral-600"
            )}
          >
            {!disabled && selectedPlan === plan && (
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{label}</span>
              {isCurrent && (
                <span className="text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                  {t("Current")}
                </span>
              )}
              {disabled && disabledReason && (
                <span className="text-[10px] text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded">
                  {disabledReason}
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {description}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span className="font-semibold tabular-nums">
            {priceLabel ?? `$${displayPrice}`}
          </span>
          <span className="text-sm text-neutral-500 dark:text-neutral-400">
            {priceSuffix ?? t("/mo")}
          </span>
          {billingLabel && (
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {billingLabel}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
