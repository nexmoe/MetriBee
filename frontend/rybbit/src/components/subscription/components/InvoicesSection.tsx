import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useExtracted, useLocale } from "next-intl";
import { authedFetch } from "@/api/utils";
import { LedgerSection, LedgerTable } from "@/app/settings/components/Ledger";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth";
import { IS_CLOUD } from "@/lib/const";
import { cn } from "@/lib/utils";

export interface Invoice {
  id: string;
  number: string | null;
  status: string | null;
  amountDue?: number;
  amountPaid?: number;
  displayAmount?: string;
  currency: string;
  created: number;
  periodStart: number;
  periodEnd: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

function useInvoices(enabled: boolean) {
  const { data: activeOrg } = authClient.useActiveOrganization();

  return useQuery<Invoice[]>({
    queryKey: ["waffo-invoices", activeOrg?.id],
    queryFn: async () => {
      const result = await authedFetch<{
        payments: Array<{
          id: string;
          amount: string;
          currency: string;
          status: string;
          createdAt: string;
        }>;
      }>(`/organizations/${encodeURIComponent(activeOrg!.id)}/billing`);
      return result.payments.map((p) => ({
        id: p.id,
        number: null,
        status: p.status === "succeeded" ? "paid" : "refunded",
        displayAmount: p.amount,
        currency: p.currency,
        created: Date.parse(p.createdAt) / 1000,
        periodStart: 0,
        periodEnd: 0,
        hostedInvoiceUrl: null,
        invoicePdf: null,
      }));
    },
    enabled: enabled && !!activeOrg && IS_CLOUD,
    staleTime: 5 * 60 * 1000,
  });
}

const STATUS_DOT: Record<string, string> = {
  paid: "bg-accent-500",
  open: "bg-yellow-500",
  uncollectible: "bg-red-500",
};

const TH =
  "py-2 pr-4 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400";
const TD = "py-3 pr-4";

/** Original Rybbit invoice table, with display amounts and a Waffo portal action. */
export function InvoicesSection({
  invoices: provided,
  onView,
  processing,
}: { invoices?: Invoice[]; onView?: () => void; processing?: boolean } = {}) {
  const t = useExtracted();
  const locale = useLocale();
  const query = useInvoices(provided === undefined);
  const invoices = provided ?? query.data;
  const isLoading = provided === undefined && query.isLoading;

  function getStatusLabel(status: string | null): string {
    switch (status) {
      case "refunded":
        return t("Refunded");
      case "paid":
        return t("Paid");
      case "open":
        return t("Open");
      case "void":
        return t("Void");
      case "uncollectible":
        return t("Uncollectible");
      case "draft":
        return t("Draft");
      default:
        return status ?? "";
    }
  }

  if (isLoading || !invoices || invoices.length === 0) {
    return null;
  }

  const date = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <LedgerSection title={t("Invoices")} count={invoices.length}>
      <LedgerTable className="relative">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-neutral-100 dark:border-neutral-850">
              <th className={TH}>{t("Date")}</th>
              <th className={TH}>{t("Invoice")}</th>
              <th className={cn(TH, "text-right")}>{t("Amount")}</th>
              <th className={TH}>{t("Status")}</th>
              <th className={TH}>
                <span className="sr-only">{t("View")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-850">
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className={cn(TD, "whitespace-nowrap tabular-nums")}>
                  {date.format(invoice.created * 1000)}
                </td>
                <td
                  className={cn(
                    TD,
                    "tabular-nums text-neutral-500 dark:text-neutral-400"
                  )}
                >
                  {invoice.number ?? "—"}
                </td>
                <td
                  className={cn(
                    TD,
                    "whitespace-nowrap text-right font-medium tabular-nums"
                  )}
                >
                  {new Intl.NumberFormat(locale, {
                    style: "currency",
                    currency: invoice.currency.toUpperCase(),
                  }).format(
                    invoice.displayAmount !== undefined
                      ? Number(invoice.displayAmount)
                      : (invoice.amountPaid || invoice.amountDue || 0) / 100
                  )}
                </td>
                <td className={TD}>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-neutral-700 dark:text-neutral-300">
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        STATUS_DOT[invoice.status ?? ""] ??
                          "bg-neutral-400 dark:bg-neutral-600"
                      )}
                    />
                    {getStatusLabel(invoice.status)}
                  </span>
                </td>
                <td className="py-2 text-right">
                  {onView ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="-mr-1.5 [&_svg]:size-3"
                      onClick={onView}
                      disabled={processing}
                      title={t("View in billing portal")}
                    >
                      {t("View")}
                      <ExternalLink aria-hidden />
                    </Button>
                  ) : (
                    invoice.hostedInvoiceUrl && (
                      <Button
                        asChild
                        variant="ghost"
                        size="xs"
                        className="-mr-1.5 [&_svg]:size-3"
                      >
                        <a
                          href={invoice.hostedInvoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t("View")}
                          <ExternalLink aria-hidden />
                        </a>
                      </Button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </LedgerTable>
    </LedgerSection>
  );
}
