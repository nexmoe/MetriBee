import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "../../rybbit/src/components/ui/skeleton";

// Preserve old bookmarks while keeping one native site-settings surface.
export default function PropertyAccess() {
  const router = useRouter();
  const query = useSearchParams().toString();
  useEffect(() => {
    const next = new URLSearchParams(query);
    next.set("settings", "general");
    router.replace(`/analytics?${next}`);
  }, [query, router]);
  return <Skeleton className="m-4 h-64" />;
}
