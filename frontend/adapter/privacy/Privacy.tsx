import { ReactNode, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../rybbit/src/components/ui/tooltip";
import { useExtracted } from "../extracted";
import { privacySnapshot, setPrivacy, subscribePrivacy } from "./store";
import { privacyAllowed, privacyShortcut, privacyTerms } from "./model";
import { maskDocument } from "./dom";
import { getAppPath, useLocation } from "../navigation";

const isMetadataQuery = (key: readonly unknown[]) =>
  ["get-site", "get-sites-from-org", "setup-status"].includes(String(key[0])) ||
  (key[0] === "ga4" && String(key[1]).includes("quota"));

export function usePrivacy() {
  return [useSyncExternalStore(subscribePrivacy, privacySnapshot, () => false), setPrivacy] as const;
}

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [enabled] = usePrivacy();
  useLocation();
  const allowed = privacyAllowed(getAppPath());
  const client = useQueryClient();
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("privacy-blur", enabled && allowed);
    if (!enabled || !allowed) return;
    const sources = () => privacyTerms([
      { value: (window as any).__GA4_CONTEXT__?.properties, metadata: true },
      ...client.getQueryCache().getAll().filter(query => isMetadataQuery(query.queryKey))
        .map(query => ({ value: query.state.data, metadata: query.queryKey[0] !== "ga4" })),
    ]);
    let terms = sources(), fingerprint = terms.join("\0");
    const mask = maskDocument(document, terms);
    const stop = client.getQueryCache().subscribe(event => {
      if (event.type !== "updated" || event.action.type !== "success" || !isMetadataQuery(event.query.queryKey)) return;
      const next = sources(), key = next.join("\0");
      if (key !== fingerprint) { terms = next; fingerprint = key; mask.update(terms); }
    });
    return () => { stop(); mask.stop(); document.documentElement.classList.remove("privacy-blur"); };
  }, [enabled, allowed, client]);
  useEffect(() => {
    if (!allowed) return;
    const key = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!privacyShortcut(event, !!target?.closest("input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=combobox],[role=dialog]"))) return;
      event.preventDefault(); setPrivacy(value => !value);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [allowed]);
  return children;
}

export function PrivacyToggle() {
  const [enabled, setEnabled] = usePrivacy();
  const t = useExtracted();
  const Icon = enabled ? EyeOff : Eye;
  return <Tooltip><TooltipTrigger asChild>
    <button type="button" data-privacy-ignore aria-label={t("Privacy mode")} aria-pressed={enabled}
      onClick={() => setEnabled(!enabled)}
      className={`p-1 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950 dark:focus-visible:ring-neutral-300 ${enabled ? "bg-neutral-150 text-neutral-900 dark:bg-neutral-800 dark:text-white" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-150 dark:hover:bg-neutral-800/80"}`}>
      <Icon className="w-5 h-5" />
    </button>
  </TooltipTrigger><TooltipContent side="right" data-privacy-ignore>{t("Privacy mode")} <kbd className="ml-2 text-neutral-500">P</kbd></TooltipContent></Tooltip>;
}
