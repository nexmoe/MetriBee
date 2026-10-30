import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import SettingsLayout from "../rybbit/src/app/settings/layout";
import {
  SettingsPage,
  SettingsPageHeader,
  LedgerSection,
  LedgerRows,
  LedgerRow,
} from "../rybbit/src/app/settings/components/Ledger";
import { CodeSnippet } from "../rybbit/src/components/CodeSnippet";
import { Button } from "../rybbit/src/components/ui/button";
import { Badge } from "../rybbit/src/components/ui/badge";
import { ErrorState } from "../rybbit/src/components/ErrorState";
import { Skeleton } from "../rybbit/src/components/ui/skeleton";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../rybbit/src/components/ui/tabs";
import { useSetPageTitle } from "../rybbit/src/hooks/useSetPageTitle";
import { DataFreshness } from "./overview/ReportFreshness";
import { useExtracted } from "./extracted";

type ConnectionStatus = {
  envFound: boolean;
  keyAccepted: boolean;
  clientEmail?: string;
  propertyCount?: number;
  hint?: string;
  error?: string;
  link?: string;
};
type Instructions = {
  prompt: string;
  manual: { html: string }[];
  gsc?: string[];
  oauth?: string[];
};

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Connection information unavailable.");
  return response.json();
}
function InstructionList({ items }: { items: string[] }) {
  return (
    <ol className="list-decimal space-y-3 pl-5 text-sm leading-6 break-words [&_a]:underline [&_a]:underline-offset-4 [&_code]:text-xs">
      {items.map((html, index) => (
        <li key={index} dangerouslySetInnerHTML={{ __html: html }} />
      ))}
    </ol>
  );
}
function InstructionDetails({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <details className="group border-y border-neutral-100 py-4 dark:border-neutral-850">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground group-open:rotate-180"
        />
      </summary>
      <div className="pt-4">
        <InstructionList items={items} />
      </div>
    </details>
  );
}
export default function Setup() {
  const t = useExtracted();
  useSetPageTitle(t("GA4 connection"));
  const status = useQuery({
    queryKey: ["setup-status"],
    queryFn: () => get<ConnectionStatus>("/api/setup/status"),
  });
  const instructions = useQuery({
    queryKey: ["setup-instructions"],
    queryFn: () => get<Instructions>("/api/setup/instructions"),
  });
  const connected =
    status.data?.keyAccepted && (status.data.propertyCount ?? 0) > 0;
  const data = instructions.data;
  return (
    <SettingsLayout>
      <SettingsPage>
        <SettingsPageHeader
          title={t("GA4 connection")}
          description={t(
            "Connect Google Analytics and optional data sources."
          )}
          actions={
            <>
              {connected && (
                <Button variant="success" size="sm" asChild>
                  <Link href="/">{t("Open dashboard")}</Link>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => status.refetch()}
                loading={status.isFetching}
                loadingLabel={t("Checking…")}
              >
                {t("Check connection")}
              </Button>
            </>
          }
        />
        <DataFreshness
          status={
            status.data
              ? { fetchedAt: status.dataUpdatedAt, cacheStatus: "unknown" }
              : null
          }
          updating={status.isFetching}
          note={t(
            "Time since the latest connection check. This page does not load analytics reports."
          )}
        />
        <LedgerSection
          title={t("Google Analytics")}
          description={status.data?.hint}
        >
          {status.isPending ? (
            <Skeleton className="h-24" />
          ) : status.isError ? (
            <ErrorState
              title={t("Connection unavailable")}
              message={status.error.message}
              refetch={status.refetch}
            />
          ) : (
            <>
              <LedgerRows>
                <LedgerRow label={t("Credentials")}>
                  <Badge
                    variant={status.data?.envFound ? "success" : "outline"}
                  >
                    {status.data?.envFound
                      ? t("Configured")
                      : t("Not configured")}
                  </Badge>
                </LedgerRow>
                <LedgerRow label={t("Service account")}>
                  <span className="break-all text-sm">
                    {status.data?.clientEmail || "—"}
                  </span>
                </LedgerRow>
                <LedgerRow label={t("Google authorization")}>
                  <Badge
                    variant={status.data?.keyAccepted ? "success" : "outline"}
                  >
                    {status.data?.keyAccepted
                      ? t("Connected")
                      : t("Not connected")}
                  </Badge>
                </LedgerRow>
                <LedgerRow label={t("Accessible properties")}>
                  <span className="text-sm tabular-nums">
                    {status.data?.propertyCount ?? "—"}
                  </span>
                </LedgerRow>
              </LedgerRows>
              {status.data?.error && (
                <p
                  role="alert"
                  className="mt-3 break-words text-sm text-destructive"
                >
                  {status.data.error}
                </p>
              )}
              {status.data?.link && (
                <Button variant="outline" size="sm" className="mt-3" asChild>
                  <a
                    href={status.data.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("Open Google settings")}
                  </a>
                </Button>
              )}
            </>
          )}
        </LedgerSection>
        {instructions.isPending ? (
          <Skeleton className="h-64" />
        ) : instructions.isError ? (
          <ErrorState
            title={t("Setup instructions unavailable")}
            message={instructions.error.message}
            refetch={instructions.refetch}
          />
        ) : (
          data && (
            <>
              <div id="ai">
                <LedgerSection
                  title={t("Set up Google Analytics")}
                  description={t(
                    "Create a service account and grant it Viewer access to your GA4 properties."
                  )}
                >
                  <Tabs defaultValue="agent">
                    <TabsList aria-label={t("Google Analytics setup")}>
                      <TabsTrigger value="agent">{t("AI prompt")}</TabsTrigger>
                      <TabsTrigger value="manual">
                        {t("Manual setup")}
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="agent">
                      <CodeSnippet code={data.prompt} />
                    </TabsContent>
                    <TabsContent value="manual">
                      <InstructionList
                        items={data.manual.map((step) => step.html)}
                      />
                    </TabsContent>
                  </Tabs>
                </LedgerSection>
              </div>
              {data.gsc?.length || data.oauth?.length ? (
                <LedgerSection
                  title={t("Optional connections")}
                  description={t(
                    "Add Google Search data or access properties that require your Google user account."
                  )}
                >
                  <div className="space-y-4">
                    <InstructionDetails
                      title="Google Search Console"
                      items={data.gsc ?? []}
                    />
                    <InstructionDetails
                      title={t("Supplemental user OAuth")}
                      items={data.oauth ?? []}
                    />
                  </div>
                </LedgerSection>
              ) : null}
            </>
          )
        )}
        <LedgerSection
          title={t("Interface source")}
          description={t(
            "Rybbit components and local adaptations are distributed under the preserved AGPL license."
          )}
        >
          <Button variant="outline" size="sm" asChild>
            <a href="https://github.com/nexmoe/MetriBee" target="_blank" rel="noopener noreferrer">
              {t("View source on GitHub")}
            </a>
          </Button>
        </LedgerSection>
      </SettingsPage>
    </SettingsLayout>
  );
}
