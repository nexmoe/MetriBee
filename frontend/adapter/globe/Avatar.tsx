import { useEffect, useState } from "react";
import { Favicon } from "../../rybbit/src/components/Favicon";

type AvatarFactory = (seed: string) => string;
// Use the same city portraits as the original globe. Initials remain available offline.
let portraits: Promise<AvatarFactory> | undefined;
function loadPortraits() {
  return (portraits ??= (async () => {
    const coreUrl = "https://cdn.jsdelivr.net/npm/@dicebear/core@9.2.2/+esm";
    const styleUrl =
      "https://cdn.jsdelivr.net/npm/@dicebear/notionists@9.2.2/+esm";
    const [core, style] = await Promise.all([
      import(/* @vite-ignore */ coreUrl),
      import(/* @vite-ignore */ styleUrl),
    ]);
    const cache = new Map<string, string>();
    return (seed: string) => {
      if (!cache.has(seed))
        cache.set(
          seed,
          core
            .createAvatar(style, {
              seed,
              backgroundColor: ["eef2ff", "e0f2fe", "fef3c7", "ede9fe"],
            })
            .toDataUri()
        );
      return cache.get(seed)!;
    };
  })());
}

export function Avatar({
  city,
  site,
  className = "",
}: {
  city: string;
  site?: { id: string; name?: string; site?: string; domain?: string };
  className?: string;
}) {
  const [factory, setFactory] = useState<AvatarFactory | null>(null);
  useEffect(() => {
    let active = true;
    loadPortraits()
      .then((f) => {
        if (active) setFactory(() => f);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const name = site ? site.name || site.site || city : city;
  const initials =
    name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, site ? 1 : 2) || "?";
  return (
    <span
      className={`globe-avatar ${site ? "globe-site-avatar" : ""} ${className}`}
      aria-hidden="true"
    >
      {site?.domain ? (
        <Favicon domain={site.domain} className="h-full w-full" />
      ) : !site && factory ? (
        <img src={factory(city)} alt="" draggable={false} />
      ) : (
        initials
      )}
    </span>
  );
}
