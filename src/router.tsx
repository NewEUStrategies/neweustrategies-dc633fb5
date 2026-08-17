import { QueryClient } from "@tanstack/react-query";
import { createRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { isServer } from "@tanstack/router-core/isServer";

import { routeTree } from "./routeTree.gen";
import { addLangPrefix, stripLangPrefix } from "./lib/i18n/localePath";
import { currentLang } from "./lib/i18n/localeRuntime";
import { FriendlyErrorPage } from "./components/error/FriendlyErrorPage";
import { errorCopy } from "./lib/errorCopy";
import { installSsrQueryTimeout } from "./lib/ssr/queryTimeout";
import { guardQueryStream } from "./lib/ssr/queryStreamGuard";
import { sweepQueryCacheForSerialization } from "./lib/ssr/postRenderSweep";

// World-class defaults for a content-heavy public site:
//   - 5 min staleTime: settings/menus/posts rarely change; avoid wasted refetches.
//   - 30 min gcTime: keep navigated-away routes warm for quick back-nav.
//   - Single retry with exp backoff: fail loud on real outages, swallow blips.
//   - No focus refetch: never disturb readers tabbing back into an article.
//   - Reconnect refetch: recover gracefully after a network drop.
//   - Mutations retry 0: side-effects must be explicit.
function DefaultErrorComponent({ error, reset }: ErrorComponentProps) {
  return <FriendlyErrorPage error={error} reset={reset} />;
}

function DefaultNotFoundComponent() {
  const copy = errorCopy();
  return (
    <FriendlyErrorPage
      error={{ status: 404, message: "not found" }}
      title={copy.notFoundTitle}
      footer={copy.notFoundBody}
    />
  );
}

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
      // SSR: never serialize a query that cannot settle on the server. A
      // pending query with no in-flight fetch (typically one whose fetch was
      // cancelled with `revert: true`) owns a promise nobody will ever
      // resolve; seroval would wait on it until its hard limit and truncate
      // the document. Such queries simply refetch after hydration.
      dehydrate: {
        // Only settled data crosses the wire. A dehydrated *pending* query
        // serializes its in-flight promise, and seroval then blocks the whole
        // document until that promise settles - which never happens once the
        // fetch is cancelled (SSR timeout, request teardown, `revert: true`).
        // Anything unsettled at render time simply refetches after hydration.
        shouldDehydrateQuery: (query) => query.state.status === "success",
      },
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
    // Friendly, instruction-rich error screens for every route without its
    // own errorComponent / notFoundComponent.
    defaultErrorComponent: DefaultErrorComponent,
    defaultNotFoundComponent: DefaultNotFoundComponent,
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

  // Official router <-> query SSR integration (replaces the deprecated
  // @tanstack/react-router-with-query, whose last release trailed the router by
  // ~40 versions): dehydrates the query cache with the router payload, streams
  // render-phase queries, and provides QueryClientProvider.
  setupRouterSsrQueryIntegration({ router, queryClient });

  // NOTE: `router.isServer` is not reliable at construction time - use the
  // same `isServer` flag the integration itself reads.
  if (isServer) {
    // Bound every render-phase query so one hanging fetch cannot hold the
    // dehydrate stream open and truncate the HTML response. Also logs the
    // offending query keys. See lib/ssr/queryTimeout.
    //
    // Disposer wpięty w cykl życia serverSsr (ten sam hak, którego używa
    // integracja router<->query): `serverSsr.cleanup()` na końcu strumienia
    // odpowiedzi czyści subskrypcję cache i wszystkie timery watchdog-a -
    // żaden timer nie przeżywa żądania (na Workers wiszący timer po
    // domknięciu odpowiedzi to ostrzeżenia runtime i zbędne wybudzenia).
    const disposeSsrQueryTimeout = installSsrQueryTimeout(queryClient);
    router.serverSsrLifecycle = {
      ...router.serverSsrLifecycle,
      onServerSsrAttach: [
        ...(router.serverSsrLifecycle?.onServerSsrAttach ?? []),
        (serverSsr) => serverSsr.onCleanup(disposeSsrQueryTimeout),
      ],
    };

    // The integration closes its `queryStream` only from an
    // `onRenderFinished` listener, which router-core silently drops in some
    // states - the stream then never closes and the SSR document never
    // finishes. Wrap it in a stream we close deterministically.
    // See lib/ssr/queryStreamGuard.
    const integrationDehydrate = router.options.dehydrate;
    router.options.dehydrate = async () => {
      // Render się zakończył: anulujemy wiszące fetch-e i usuwamy zapytania,
      // które nigdy się nie rozstrzygną, ZANIM integracja zrobi snapshot
      // cache'u. Inaczej seroval czeka na ich promisy do twardego limitu.
      sweepQueryCacheForSerialization(queryClient, {
        label: router.state.location.pathname,
        reason: "dehydrate",
      });

      const dehydrated = (await integrationDehydrate?.()) as
        (Record<string, unknown> & { queryStream?: ReadableStream<unknown> }) | undefined;
      if (dehydrated?.queryStream) {
        dehydrated.queryStream = guardQueryStream(dehydrated.queryStream, queryClient, {
          label: router.state.location.pathname,
        });
      }

      return dehydrated;
    };
  }

  if (!isServer) {
    // The integration hydrates the INITIAL dehydrated batch synchronously, but
    // pumps the render-phase query STREAM through an async reader chain. React
    // hydration otherwise starts before those buffered chunks land in the
    // cache; widgets then render their pending/skeleton state against server
    // HTML that has real data, and React 19 treats that as a hydration
    // mismatch and rebuilds the whole tree client-side - the page visibly
    // blanks and every query refetches. Yielding one macrotask after the
    // integration's hydrate lets every already-delivered stream chunk settle
    // into the cache first; router-core awaits options.hydrate before React
    // hydration begins, so this delays first paint by at most one tick.
    const integrationHydrate = router.options.hydrate;
    router.options.hydrate = async (dehydrated) => {
      // Twardy budżet: jeśli strumień zapytań z SSR nigdy nie domknie się w
      // przeglądarce, `integrationHydrate` nigdy się nie rozstrzyga, React nie
      // hydratuje i cała strona zostaje statycznym HTML-em (przyciski i linki
      // nie reagują). Brakujące dane po prostu dociągną się przez refetch.
      const HYDRATE_BUDGET_MS = 1500;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          integrationHydrate?.(dehydrated),
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              console.warn("[ssr-hydrate] hydration stream exceeded budget - continuing");
              resolve();
            }, HYDRATE_BUDGET_MS);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    };
  }

  return router;
};
