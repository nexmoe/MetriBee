import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { authedFetch } from "../../rybbit/src/api/utils";
import {
  LedgerRow,
  LedgerRows,
  LedgerSection,
} from "../../rybbit/src/app/settings/components/Ledger";
import { CodeSnippet } from "../../rybbit/src/components/CodeSnippet";
import { CopyButton } from "../../rybbit/src/components/interior/copy-button";
import { Button } from "../../rybbit/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../rybbit/src/components/ui/dialog";
import { Skeleton } from "../../rybbit/src/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../rybbit/src/components/ui/tabs";
import { useExtracted } from "../extracted";

type Connection = { url: string; oauthAvailable: boolean };

export default function McpConnection() {
  const t = useExtracted();
  const [open, setOpen] = useState(false);
  const connection = useQuery({
    queryKey: ["mcp-connection"],
    queryFn: () => authedFetch<Connection>("/user/mcp-connection"),
    staleTime: 5 * 60 * 1000,
  });
  const data = connection.data;
  // Shell commands use single-quote escaping; JSON quoting is not shell quoting.
  const quotedUrl = data ? `'${data.url.replace(/'/g, "'\\''")}'` : "";
  const config = data
    ? JSON.stringify(
        { mcpServers: { metribee: { type: "http", url: data.url } } },
        null,
        2
      )
    : "";
  return (
    <LedgerSection
      title={t("Connect AI tools")}
      description={t(
        "Connect with your own account. Access follows your organization and team permissions."
      )}
    >
      {connection.isPending ? (
        <Skeleton className="h-16" />
      ) : connection.isError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-neutral-100 py-4 dark:border-neutral-850">
          <p role="alert" className="text-sm text-destructive">
            {t("Unable to load MCP connection details.")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => connection.refetch()}
          >
            {t("Retry")}
          </Button>
        </div>
      ) : data ? (
        <LedgerRows>
          <LedgerRow label={t("MCP server")} description="Streamable HTTP">
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-xs">
                {data.url}
              </code>
              <CopyButton
                value={data.url}
                label={t("Copy URL")}
                variant="outline"
                size="sm"
              />
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">{t("Connection instructions")}</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{t("Connect AI tools")}</DialogTitle>
                    <DialogDescription>
                      {t(
                        "Connect with your own account. Access follows your organization and team permissions."
                      )}
                    </DialogDescription>
                  </DialogHeader>
                  {data.oauthAvailable ? (
                    <Tabs defaultValue="claude" className="min-w-0">
                      <TabsList
                        aria-label={t("MCP client setup")}
                        className="max-w-full"
                      >
                        <TabsTrigger value="claude">Claude Code</TabsTrigger>
                        <TabsTrigger value="codex">Codex</TabsTrigger>
                        <TabsTrigger value="json">JSON</TabsTrigger>
                      </TabsList>
                      <TabsContent value="claude" className="space-y-3">
                        <CodeSnippet
                          language="bash"
                          code={`claude mcp add --transport http metribee ${quotedUrl}`}
                        />
                        <p className="text-sm text-muted-foreground">
                          {t(
                            "Run this command, then open /mcp in Claude Code, select metribee and choose Authenticate. Sign in and approve access in your browser."
                          )}
                        </p>
                      </TabsContent>
                      <TabsContent value="codex" className="space-y-3">
                        <CodeSnippet
                          language="bash"
                          code={`codex mcp add metribee --url ${quotedUrl}\ncodex mcp login metribee`}
                        />
                        <p className="text-sm text-muted-foreground">
                          {t(
                            "Run these commands, then sign in and approve access in the browser window."
                          )}
                        </p>
                      </TabsContent>
                      <TabsContent value="json" className="space-y-3">
                        <CodeSnippet language="json" code={config} />
                        <p className="text-sm text-muted-foreground">
                          {t(
                            "Merge this entry into your client's existing MCP configuration. Each person signs in with their own account."
                          )}
                        </p>
                      </TabsContent>
                      <p className="mt-4 text-xs text-muted-foreground">
                        {t(
                          "Other clients: add the server URL as a Streamable HTTP connection and follow the sign-in prompt. For narrower access, use a personal API key."
                        )}
                      </p>
                    </Tabs>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        {t(
                          "OAuth requires HTTPS or a loopback address. Create a personal API key and configure your client's Authorization header."
                        )}
                      </p>
                      <CodeSnippet code="Authorization: Bearer <PERSONAL_API_KEY>" />
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            </div>
          </LedgerRow>
        </LedgerRows>
      ) : null}
    </LedgerSection>
  );
}
