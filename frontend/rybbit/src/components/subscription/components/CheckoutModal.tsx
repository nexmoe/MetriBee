"use client";
// Retained compatibility for upstream callers. MetriBee checkout lives in organization billing.
import Link from "next/link";
import { useExtracted } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
interface CheckoutModalProps {
  clientSecret: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
export function CheckoutModal({ open, onOpenChange }: CheckoutModalProps) {
  const t = useExtracted();
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{t("Billing")}</DialogTitle></DialogHeader><Button asChild variant="success"><Link href="/settings/billing">{t("Manage billing")}</Link></Button></DialogContent></Dialog>;
}
