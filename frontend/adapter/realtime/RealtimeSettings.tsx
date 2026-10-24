import { useState } from "react";
import { Gauge, RefreshCw, Settings2, SlidersHorizontal } from "lucide-react";
import { Button } from "../../rybbit/src/components/ui/button";
import { Input } from "../../rybbit/src/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../rybbit/src/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuItem,
} from "../../rybbit/src/components/ui/dropdown-menu";
import { useExtracted } from "../extracted";
import { QuotaPanel } from "../pages/Quota";
import { clampRule, PRESETS, SpikeRule } from "./model";

function RuleDialog({
  rule,
  close,
  change,
}: {
  rule: SpikeRule;
  close: () => void;
  change: (rule: SpikeRule) => void;
}) {
  const t = useExtracted();
  const [draft, setDraft] = useState({
    z: String(rule.z),
    lift: String(rule.lift),
  });
  const z = Number(draft.z),
    lift = Number(draft.lift);
  const valid =
    draft.z !== "" &&
    draft.lift !== "" &&
    Number.isFinite(z) &&
    z >= 1.5 &&
    z <= 6 &&
    Number.isFinite(lift) &&
    lift >= 1 &&
    lift <= 5;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Spike rule")}</DialogTitle>
          <DialogDescription>
            {t(
              "Flag traffic only when both its unusualness and lift exceed these thresholds."
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          {Object.entries(PRESETS).map(([key, value]) => (
            <Button
              key={key}
              variant="outline"
              size="sm"
              onClick={() =>
                setDraft({ z: String(value.z), lift: String(value.lift) })
              }
            >
              {t(
                key === "sensitive"
                  ? "Sensitive"
                  : key === "normal"
                  ? "Normal"
                  : "Strict"
              )}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="space-y-2 text-sm">
            {t("How unusual (z)")}
            <Input
              aria-label={t("Spike z threshold")}
              type="number"
              min={1.5}
              max={6}
              step={0.1}
              value={draft.z}
              onChange={(event) =>
                setDraft({ ...draft, z: event.target.value })
              }
            />
          </label>
          <label className="space-y-2 text-sm">
            {t("Minimum lift (×)")}
            <Input
              aria-label={t("Spike lift threshold")}
              type="number"
              min={1}
              max={5}
              step={0.1}
              value={draft.lift}
              onChange={(event) =>
                setDraft({ ...draft, lift: event.target.value })
              }
            />
          </label>
        </div>
        <p className="text-xs text-neutral-500">
          {t(
            "The baseline uses the same hour over the previous seven days, with a peak-period fallback when unavailable."
          )}
        </p>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setDraft({ z: "3", lift: "1.5" })}
          >
            {t("Reset")}
          </Button>
          <Button variant="outline" onClick={close}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              change(clampRule({ z, lift }));
              close();
            }}
          >
            {t("Apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RealtimeSettings({
  auto,
  setAuto,
  privacy,
  setPrivacy,
  rule,
  changeRule,
  refreshProperties,
  refreshing,
}: {
  auto: boolean;
  setAuto: (value: boolean) => void;
  privacy: boolean;
  setPrivacy: (value: boolean) => void;
  rule: SpikeRule;
  changeRule: (value: SpikeRule) => void;
  refreshProperties: () => void;
  refreshing: boolean;
}) {
  const t = useExtracted();
  const [editing, setEditing] = useState(false);
  const [quota, setQuota] = useState(false);
  const preset =
    Object.keys(PRESETS).find(
      (key) => PRESETS[key].z === rule.z && PRESETS[key].lift === rule.lift
    ) || "custom";
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="smIcon"
            aria-label={t("Realtime settings")}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>{t("Realtime settings")}</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked={auto} onCheckedChange={setAuto}>
            {t("Auto refresh · 2 min")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={privacy}
            onCheckedChange={setPrivacy}
          >
            {t("Privacy mode")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t("Spike sensitivity")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preset}
            onValueChange={(value) => {
              if (PRESETS[value]) changeRule(PRESETS[value]);
            }}
          >
            <DropdownMenuRadioItem value="sensitive">
              {t("Sensitive")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="normal">
              {t("Normal")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="strict">
              {t("Strict")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <SlidersHorizontal />
            {t("Custom rule")}
            <span className="ml-auto text-xs text-neutral-500">
              z {rule.z} · {rule.lift}×
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={refreshing} onSelect={refreshProperties}>
            <RefreshCw />
            {refreshing ? t("Refreshing…") : t("Refresh property list")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setQuota(true)}>
            <Gauge />
            {t("API quota")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editing && (
        <RuleDialog
          rule={rule}
          change={changeRule}
          close={() => setEditing(false)}
        />
      )}
      <Dialog open={quota} onOpenChange={setQuota}>
        <DialogContent className="max-h-[85dvh] max-w-4xl overflow-auto">
          <DialogHeader>
            <DialogTitle>{t("API quota")}</DialogTitle>
            <DialogDescription>
              {t("Quota remaining across connected GA4 properties.")}
            </DialogDescription>
          </DialogHeader>
          {quota && <QuotaPanel compact />}
        </DialogContent>
      </Dialog>
    </>
  );
}
