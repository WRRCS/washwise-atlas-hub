import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Keep data around so it can be served from the offline cache.
        gcTime: 1000 * 60 * 60 * 24 * 7,
        staleTime: 30_000,
        networkMode: "offlineFirst",
        retry: 1,
      },
      mutations: { networkMode: "online" },
    },
  });

  if (typeof window !== "undefined") {
    // Restore/persist the read cache so field crews can open the app offline.
    void (async () => {
      try {
        const [{ persistQueryClient }, { createSyncStoragePersister }] = await Promise.all([
          import("@tanstack/react-query-persist-client"),
          import("@tanstack/query-sync-storage-persister"),
        ]);
        persistQueryClient({
          queryClient: queryClient as never,
          persister: createSyncStoragePersister({ storage: window.localStorage, key: "atlas-offline-cache" }),
          maxAge: 1000 * 60 * 60 * 24 * 7,
        });
      } catch {
        /* offline cache is best-effort */
      }
    })();
  }

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
