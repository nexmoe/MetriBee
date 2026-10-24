import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Code, Copy, PanelsTopLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { useExtracted } from "../extracted";
import {
  defaultWidgetConfig,
  widgetIframeCode,
  WIDGET_PERIODS,
  type SavedWidget,
  type WidgetConfig,
} from "../../../controllers/widgetConfig";
import { Button } from "../../rybbit/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogContentFullScreen,
  DialogHeader,
  DialogTitle,
} from "../../rybbit/src/components/ui/dialog";
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
} from "../../rybbit/src/components/ui/alert-dialog";
import { Switch } from "../../rybbit/src/components/ui/switch";
import { toast } from "../../rybbit/src/components/ui/sonner";
import { CodeSnippet } from "../../rybbit/src/components/CodeSnippet";
import { ErrorState } from "../../rybbit/src/components/ErrorState";
import { Skeleton } from "../../rybbit/src/components/ui/skeleton";
import { Input } from "../../rybbit/src/components/ui/input";
import { NothingFound } from "../../rybbit/src/components/NothingFound";
import { WidgetEditor } from "./WidgetEditor";
import { WidgetIframe } from "./WidgetPreview";
import { widgetApi } from "./api";

export function WidgetManager({
  siteId,
  embedEnabled,
  disabled,
  updatingEnabled,
  onEnabledChange,
}: {
  siteId: number;
  embedEnabled: boolean;
  disabled: boolean;
  updatingEnabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  const t = useExtracted(),
    client = useQueryClient();
  const [editor, setEditor] = useState<{
    config: WidgetConfig;
    id?: string;
  } | null>(null);
  const [code, setCode] = useState<SavedWidget | null>(null);
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["custom-widgets", siteId],
    queryFn: () => widgetApi.list(siteId),
    enabled: !disabled,
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["custom-widgets", siteId] });
  const remove = useMutation({
    mutationFn: (id: string) => widgetApi.remove(siteId, id),
    onSuccess: () => {
      refresh();
      toast.success(t("Widget deleted"));
    },
    onError: (error) => toast.error(error.message),
  });
  const toggle = useMutation({
    mutationFn: (widget: SavedWidget) =>
      widgetApi.save(
        siteId,
        { ...widget.config, enabled: !widget.config.enabled },
        widget.id
      ),
    onSuccess: () => refresh(),
    onError: (error) => toast.error(error.message),
  });
  const widgets = query.data?.data || [];
  const visible = widgets.filter((widget) =>
    `${widget.config.name} ${widget.config.title}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase())
  );
  const create = (
    <Button
      variant="success"
      size="sm"
      disabled={disabled}
      onClick={() => setEditor({ config: defaultWidgetConfig() })}
    >
      <Plus className="h-4 w-4" />
      {t("Create widget")}
    </Button>
  );
  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">
            {t("Widgets")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t(
              "Create custom analytics cards and badges with your own metrics, dates and appearance."
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            {t("Public embeds")}
            <Switch
              aria-label={t("Enable public embeds")}
              checked={embedEnabled}
              disabled={disabled || updatingEnabled}
              onCheckedChange={onEnabledChange}
            />
          </label>
          {create}
        </div>
      </header>
      <div className="space-y-3">
        {!embedEnabled && (
          <p className="rounded-lg border border-neutral-150 px-4 py-3 text-sm text-muted-foreground dark:border-neutral-850">
            {t(
              "Public embeds are disabled. You can create and preview widgets, then enable sharing when they are ready."
            )}
          </p>
        )}
        {widgets.length > 0 && (
          <Input
            isSearch
            className="h-8 w-full sm:w-64"
            aria-label={t("Filter widgets")}
            placeholder={t("Filter widgets")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
        {query.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : query.isError && !query.data ? (
          <ErrorState
            title={t("Widgets unavailable")}
            message={query.error.message}
            refetch={query.refetch}
          />
        ) : !widgets.length ? (
          <NothingFound
            icon={<PanelsTopLeft className="h-10 w-10" />}
            title={t("No widgets yet")}
            description={t(
              "Create your first widget with monthly active users, pageviews, bounce rate or any other supported metrics."
            )}
          />
        ) : !visible.length ? (
          <NothingFound
            icon={<PanelsTopLeft className="h-10 w-10" />}
            title={t("No widgets found")}
            description={t("Try a different name or title.")}
          />
        ) : (
          <div className="divide-y divide-neutral-150 rounded-lg border border-neutral-150 dark:divide-neutral-850 dark:border-neutral-850">
            {visible.map((widget) => (
              <div
                key={widget.id}
                className="flex flex-col justify-between gap-4 p-4 lg:flex-row lg:items-center"
              >
                <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium">
                      {widget.config.name}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {widget.config.metrics.length} {t("metrics")} ·{" "}
                      {t(WIDGET_PERIODS[widget.config.period.preset])} ·{" "}
                      {t(
                        widget.config.layout === "inline"
                          ? "Inline badge"
                          : widget.config.layout === "stats"
                          ? "Metrics only"
                          : "Card with trend"
                      )}
                    </p>
                  </div>
                  <Switch
                    aria-label={t("Enable {name}", {
                      name: widget.config.name,
                    })}
                    checked={widget.config.enabled}
                    disabled={disabled || toggle.isPending}
                    onCheckedChange={() => toggle.mutate(widget)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={disabled}
                    onClick={() =>
                      setEditor({ id: widget.id, config: widget.config })
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {t("Edit")}
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={disabled}
                    onClick={() =>
                      setEditor({
                        config: {
                          ...widget.config,
                          name: `${widget.config.name} (${t("copy")})`,
                        },
                      })
                    }
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t("Duplicate")}
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={!embedEnabled || !widget.config.enabled}
                    onClick={() => setCode(widget)}
                  >
                    <Code className="h-3.5 w-3.5" />
                    {t("Embed Code")}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={disabled || remove.isPending}
                        aria-label={t("Delete {name}", {
                          name: widget.config.name,
                        })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t("Delete widget?")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t(
                            "Existing iframes using this widget will stop working. This does not change your GA4 data."
                          )}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => remove.mutate(widget.id)}
                        >
                          {t("Delete")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        <DialogContentFullScreen aria-describedby={undefined}>
          {editor && (
            <WidgetEditor
              key={editor.id || "new"}
              siteId={siteId}
              widgetId={editor.id}
              initial={editor.config}
              onCancel={() => setEditor(null)}
              onSaved={(widget) => {
                refresh();
                setEditor(null);
                if (embedEnabled && widget.config.enabled) setCode(widget);
              }}
            />
          )}
        </DialogContentFullScreen>
      </Dialog>
      <Dialog
        open={!!code}
        onOpenChange={(open) => {
          if (!open) setCode(null);
        }}
      >
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{t("Embed Code")}</DialogTitle>
          </DialogHeader>
          {code && (
            <>
              <WidgetIframe
                title="Saved widget preview"
                src={`/widget/${siteId}/${code.id}`}
                width={code.config.width}
              />
              <CodeSnippet
                language="HTML"
                code={widgetIframeCode(location.origin, siteId, code)}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
