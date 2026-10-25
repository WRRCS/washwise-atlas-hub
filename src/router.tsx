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
        const { supabase } = await import("@/integrations/supabase/client");
        const { data: { session } } = await supabase.auth.getSession();
        const initialUser = session?.user.id ?? "signed-out";
        window.localStorage.removeItem("atlas-offline-cache");
        const [{ persistQueryClient }, { createSyncStoragePersister }] = await Promise.all([
          import("@tanstack/react-query-persist-client"),
          import("@tanstack/query-sync-storage-persister"),
        ]);
        const key = `atlas-offline-cache:${initialUser}`;
        let active = true;
        supabase.auth.onAuthStateChange((_event, nextSession) => {
          if ((nextSession?.user.id ?? "signed-out") !== initialUser) {
            active = false;
            window.localStorage.removeItem(key);
          }
        });
        const scopedStorage = {
          getItem: (name: string) => active ? window.localStorage.getItem(name) : null,
          setItem: (name: string, value: string) => { if (active) window.localStorage.setItem(name, value); },
          removeItem: (name: string) => window.localStorage.removeItem(name),
        };
        persistQueryClient({
          queryClient: queryClient as never,
          persister: createSyncStoragePersister({ storage: scopedStorage, key }),
          maxAge: 1000 * 60 * 60 * 24 * 7,
          dehydrateOptions: { shouldDehydrateQuery: query => active && query.state.status === "success" && !["job-photos", "invoice-photos"].includes(String(query.queryKey[0])) },
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
