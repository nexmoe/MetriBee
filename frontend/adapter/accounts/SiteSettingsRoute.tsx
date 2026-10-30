import { useRouter, useSearchParams } from "next/navigation";
import { SiteSettings } from "../../rybbit/src/components/SiteSettings/SiteSettings";

export function SiteSettingsRoute({ siteId }: { siteId: number }) {
  const params = useSearchParams();
  const router = useRouter();
  if (params.get("settings") !== "general" || !siteId) return null;
  return (
    <SiteSettings
      key={siteId}
      siteId={siteId}
      initialOpen
      trigger={<button className="hidden" aria-hidden tabIndex={-1} />}
      onClose={() => {
        const next = new URLSearchParams(params);
        next.delete("settings");
        router.replace(
          `${location.pathname}${next.size ? `?${next}` : ""}${location.hash}`
        );
      }}
    />
  );
}
