import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";

import { routeTree } from "./routeTree.gen";
import { addLangPrefix, stripLangPrefix } from "./lib/i18n/localePath";
import { currentLang } from "./lib/i18n/localeRuntime";


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
    // Query owns cache freshness; router never serves stale preloaded data.
    defaultPreloadStaleTime: 0,
    // Aggressive intent preloading on hover/focus - by the time the user
    // clicks, the next route's loader has already resolved.
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    // Only show pending UI for genuinely slow navigations (>500ms). Fast
    // intent-preloaded clicks resolve instantly and never flash a skeleton.
    defaultPendingMs: 500,
    defaultPendingMinMs: 250,
    // Modern crossfade between routes via the View Transitions API. Header
    // and footer hold their position; only the <main> content morphs.
    defaultViewTransition: true,
    // Article anchors are handled by the custom reading rail scroller. This
    // avoids TanStack's immediate hash scroll fighting the eased animation.
    defaultHashScrollIntoView: false,
    // Language lives in the URL path (PL unprefixed, EN under "/en"). The
    // route tree is authored once for the canonical (unprefixed) paths; this
    // rewrite strips the language segment before matching and re-adds it when
    // building every href. The CDN therefore keys on the prefixed URL, so each
    // language is its own shareable cache entry - no cookie-driven, no-store
    // personalization and no language cache-poisoning. See lib/i18n/localePath.
    rewrite: {
      input: ({ url }) => {
        const canonical = stripLangPrefix(url.pathname).pathname;
        if (canonical !== url.pathname) url.pathname = canonical;
        return url;
      },
      output: ({ url }) => {
        const prefixed = addLangPrefix(url.pathname, currentLang());
        if (prefixed !== url.pathname) url.pathname = prefixed;
        return url;
      },
    },
  });

  return routerWithQueryClient(router, queryClient);
};

