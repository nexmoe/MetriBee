import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import {
  createQueryClient,
  createQueryPersistence,
  queryCacheScope,
} from "./queryClient";
import { getAppPath, getSharedRoute, isPublicDashboard, useLocation } from "./navigation";

function ScopedQueryProvider({
  children,
  scope,
}: {
  children: ReactNode;
  scope: string | null;
}) {
  const [client] = useState(createQueryClient);
  const [persistOptions] = useState(() => {
    try {
      return createQueryPersistence(
        client,
        scope ? window.sessionStorage : undefined,
        scope
      );
    } catch {
      // Browsers that block storage still get the same in-memory cache policy.
      return undefined;
    }
  });
  return persistOptions ? (
    <PersistQueryClientProvider client={client} persistOptions={persistOptions}>
      {children}
    </PersistQueryClientProvider>
  ) : (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

export function QueryProvider({ children }: { children: ReactNode }) {
  useLocation();
  const context = (window as any).__GA4_CONTEXT__ || {};
  const shared = getSharedRoute();
  const embedded = new URLSearchParams(location.search).get("embed") === "true";
  const restricted =
    !!shared || isPublicDashboard() || embedded || !!context.metricWidget || getAppPath() === "/setup";
  const scope = queryCacheScope(context, restricted);
  // A navigation across access contexts must not reuse the owner's query cache.
  const key =
    scope ||
    JSON.stringify([
      shared ? [shared.siteId, shared.privateKey] : null,
      context.publicSiteId,
      embedded,
      context.metricWidget,
      getAppPath() === "/setup",
    ]);
  return (
    <ScopedQueryProvider key={key} scope={scope}>
      {children}
    </ScopedQueryProvider>
  );
}
