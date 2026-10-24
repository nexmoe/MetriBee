import type { ReactNode } from "react";
import { PanelsTopLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useExtracted } from "../extracted";
import { Button } from "../../rybbit/src/components/ui/button";

export function WidgetManagerLink({
  siteId,
  trigger,
}: {
  siteId: number;
  trigger?: ReactNode;
}) {
  const router = useRouter();
  const t = useExtracted();
  return (
    <span
      className="contents"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        router.push(`/${siteId}/widgets`);
      }}
    >
      {trigger ?? (
        <Button variant="ghost" size="icon" aria-label={t("Widgets")}>
          <PanelsTopLeft className="h-4 w-4" />
        </Button>
      )}
    </span>
  );
}
