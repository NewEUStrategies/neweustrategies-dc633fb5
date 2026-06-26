import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";


// World-class defaults for a content-heavy public site:
//   - 5 min staleTime: settings/menus/posts rarely change; avoid wasted refetches.
//   - 30 min gcTime: keep navigated-away routes warm for quick back-nav.
//   - Single retry with exp backoff: fail loud on real outages, swallow blips.
//   - No focus refetch: never disturb readers tabbing back into an article.
//   - Reconnect refetch: recover gracefully after a network drop.
//   - Mutations retry 0: side-effects must be explicit.
export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        retry: 1,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        refetchOnWindowFocus: false,
        refetchOnReconnect: "always",
      },
      mutations: { retry: 0 },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultPreload: "intent",
  });

  return routerWithQueryClient(router, queryClient);
};

