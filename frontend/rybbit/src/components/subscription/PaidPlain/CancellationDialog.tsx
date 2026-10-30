"use client";

import { useEffect, useState } from "react";
import { useExtracted } from "next-intl";
import { AlertTriangle, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import type { SubscriptionData } from "@/lib/subscription/useStripeSubscription";

export type CancellationReason =
  | "too_expensive"
  | "missing_features"
  | "not_using"
  | "too_complex"
  | "switching_competitor"
  | "other";
export interface CancellationFeedback {
  reason: CancellationReason;
  details: string;
}
const REASONS: { value: CancellationReason; label: string }[] = [
  { value: "too_expensive", label: "It's too expensive" },
  { value: "missing_features", label: "Missing features I need" },
  { value: "not_using", label: "I'm not using it enough" },
  { value: "too_complex", label: "It's too hard to set up or use" },
  { value: "switching_competitor", label: "Switching to another tool" },
  { value: "other", label: "Other reason" },
];
interface CancellationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: Pick<
    SubscriptionData,
    "planName" | "interval" | "currentPeriodEnd"
  > & { isTrial?: boolean };
  organizationId: string;
  onChangePlan: () => void;
  onCancel?: (feedback: CancellationFeedback) => Promise<void>;
  /** Compatibility for retained upstream callers; the MetriBee billing page uses onCancel. */
  onProceedToStripe?: () => void;
  consequence?: string;
  price?: string;
}

// Retains Rybbit's reason → alternative → final confirmation flow and native layout.
export function CancellationDialog({
  open,
  onOpenChange,
  subscription,
  organizationId,
  onChangePlan,
  onCancel,
  onProceedToStripe,
  consequence,
  price,
}: CancellationDialogProps) {
  const t = useExtracted();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [reason, setReason] = useState<CancellationReason | "">("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) {
      setStep(1);
      setReason("");
      setDetails("");
      setError("");
    }
  }, [open, organizationId]);
  const close = () => {
    if (busy) return;
    setStep(1);
    setReason("");
    setDetails("");
    setError("");
    onOpenChange(false);
  };
  const changePlan = () => {
    close();
    onChangePlan();
  };
  const cancel = async () => {
    if (!reason) return;
    setBusy(true);
    setError("");
    try {
      if (onCancel) await onCancel({ reason, details: details.trim() });
      else onProceedToStripe?.();
      setStep(1);
      setReason("");
      setDetails("");
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("Unable to cancel subscription.")
      );
    } finally {
      setBusy(false);
    }
  };
  const monthly =
    subscription.interval === "month" || subscription.interval === "monthly";
  const title =
    step === 1
      ? t("Why are you leaving?")
      : step === 2
      ? t("Before you go...")
      : t("Are you sure?");
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (busy) return;
        if (!value) close();
        else onOpenChange(value);
      }}
    >
      <DialogContent className="w-[calc(100dvw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("Cancel subscription")}
          </DialogDescription>
        </DialogHeader>
        {error && <Alert variant="destructive">{error}</Alert>}
        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {t(
                "We'd love to understand why you're leaving so we can improve."
              )}
            </p>
            <RadioGroup
              value={reason}
              onValueChange={(value) => setReason(value as CancellationReason)}
            >
              {REASONS.map((r) => (
                <div key={r.value} className="flex items-center space-x-3">
                  <RadioGroupItem value={r.value} id={`cancel-${r.value}`} />
                  <Label
                    htmlFor={`cancel-${r.value}`}
                    className="cursor-pointer text-sm font-normal"
                  >
                    {t(r.label)}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {["missing_features", "switching_competitor", "other"].includes(
              reason
            ) && (
              <Textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={2000}
                rows={3}
                aria-label={t("Tell us more...")}
                placeholder={
                  reason === "missing_features"
                    ? t("What features are you looking for?")
                    : reason === "switching_competitor"
                    ? t("Which tool are you switching to?")
                    : t("Tell us more...")
                }
                className="mt-2"
              />
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={close}>
                {t("Never mind")}
              </Button>
              <Button disabled={!reason} onClick={() => setStep(2)}>
                {t("Continue")}
              </Button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {t("Before you go, we'd like to offer an alternative:")}
            </p>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/50">
              <h4 className="mb-1 font-medium text-neutral-800 dark:text-neutral-200">
                {reason === "too_expensive"
                  ? monthly
                    ? t("Switch to annual and save")
                    : t("Review your plan")
                  : t("Is there anything we can do?")}
              </h4>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                {reason === "too_expensive"
                  ? monthly
                    ? t(
                        "Save compared with paying monthly when you choose annual billing."
                      )
                    : t(
                        "Review the available organization plans before canceling."
                      )
                  : t(
                      "We're sorry to see you go. If there's anything we can do to improve your experience, we'd love to hear about it."
                    )}
              </p>
              <Button
                variant={reason === "too_expensive" ? "success" : "default"}
                className="mt-3"
                onClick={reason === "too_expensive" ? changePlan : close}
              >
                {reason === "too_expensive"
                  ? monthly
                    ? t("Switch to Annual Billing")
                    : t("View Plans")
                  : t("Keep My Plan")}
              </Button>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                className="text-sm text-neutral-500 underline underline-offset-2 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
                onClick={() => setStep(3)}
              >
                {t("No thanks, continue cancelling")}
              </button>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800/50 dark:bg-red-900/10">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500 dark:text-red-400" />
                <div className="space-y-2">
                  <h4 className="font-medium text-red-800 dark:text-red-300">
                    {t("Cancel subscription")}
                  </h4>
                  <p className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
                    <ArrowRight className="size-3.5 shrink-0" />
                    {subscription.planName}
                    {price && (
                      <span className="text-neutral-500">({price})</span>
                    )}
                  </p>
                  <p className="pt-1 text-sm text-red-700 dark:text-red-400">
                    {consequence ||
                      t(
                        "Your subscription remains available until the current billing period ends."
                      )}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-3 pt-2">
              <Button variant="success" disabled={busy} onClick={close}>
                {t("Keep My Plan")}
              </Button>
              <Button variant="destructive" loading={busy} onClick={cancel}>
                {t("Cancel My Subscription")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
