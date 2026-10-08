import { RouteLoadingSkeleton } from "./lib/ssr/RouteLoadingSkeleton";
import { QueryClient, type Query } from "@tanstack/react-query";
import { createRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { isServer } from "@tanstack/router-core/isServer";

import { routeTree } from "./routeTree.gen";
import { addLangPrefix, stripLangPrefix } from "./lib/i18n/localePath";
import { currentLang } from "./lib/i18n/localeRuntime";
// Ekrany błędu NIE należą do udanego pierwszego renderu - `React.lazy`
// (wewnątrz wrappera) trzyma je poza chunkiem wejściowym; SSR strony błędu
// nadal działa, bo lazy renderuje się w strumieniu (test: router.test.tsx).
import { LazyFriendlyErrorPage } from "./components/error/LazyFriendlyErrorPage";
import { errorCopy } from "./lib/errorCopy";
import { installSsrQueryTimeout } from "./lib/ssr/queryTimeout";
import { guardQueryStream } from "./lib/ssr/queryStreamGuard";
import { sweepQueryCacheForSerialization } from "./lib/ssr/postRenderSweep";
import { withHydrateBudget } from "./lib/ssr/hydrateBudget";
import { injectBootSet, type BootRouterLike } from "./lib/boot/bootSet.server";
import {
  isInteractionOrQuietOpen,
  onInteractionOrQuiet,
} from "./lib/performance/interactionOrQuiet";

// USTĄPIENIE PO DRZEWIE TRAS (P1.7, runda 9; recenzja I-2). Moduły, które ten
// plik importuje - przede wszystkim `./routeTree.gen` z top-levelem kilkuset
// tras, schematami `validateSearch` (zod) i `createRoute` - ewaluują się PRZED
// jego ciałem. Bez tego tyknięcia w tym samym zadaniu szła dalej reszta entry:
// ciało tego modułu, entry TanStack Start i `hydrateRoot` (część B zadania K9
// księgi Lantern, >= 50 ms sym. w 10/10 przebiegach dowodu). Top-level await
// na kliencie dzieli to na ewaluację drzewa tras i start Reacta w następnym
// makrozadaniu (`setTimeout(0)`, nie `scheduler.postTask` - Safari go nie ma).
// Na serwerze `isServer` jest prawdą (w buildzie produkcyjnym stałą), więc
// tyknięcie nie biegnie. Koszt na kliencie: jedno tyknięcie przed
// `hydrateRoot` (zagnieżdżenie timerów < 5, bez zacisku 4 ms). Sama ewaluacja
// drzewa tras zostaje jednym zadaniem - jej podział należy do P5.2.
if (!isServer) await new Promise<void>((resolve) => setTimeout(resolve, 0));

// ZESTAW BOOTU (P2.1). Serwer wstrzykuje `#nes-boot-set` (lista modułów serii bootu i tryb)
// poza drzewem Reacta - skład i uzasadnienie w `lib/boot/bootSet.server.ts`. Owijka
// `createIsomorphicFn`, bo moduł `.server` nie może wejść do grafu przeglądarki (ochrona
// importów TanStack Start): kompilator wycina gałąź serwerową z bundla klienta razem
// z importem, a klient dostaje no-op.
const injectBootSetOnServer = createIsomorphicFn()
  .server((router: BootRouterLike): void => injectBootSet(router))
  .client((): void => {});

// World-class defaults for a content-heavy public site:
//   - 5 min staleTime: settings/menus/posts rarely change; avoid wasted refetches.
//   - 30 min gcTime: keep navigated-away routes warm for quick back-nav.
//   - Single retry with exp backoff: fail loud on real outages, swallow blips.
//   - No focus refetch: never disturb readers tabbing back into an article.
//   - Reconnect refetch: recover gracefully after a network drop.
//   - Mutations retry 0: side-effects must be explicit.
function DefaultErrorComponent({ error, reset }: ErrorComponentProps) {
  return <LazyFriendlyErrorPage error={error} reset={reset} />;
}

function DefaultNotFoundComponent() {
  const copy = errorCopy();
  return (
    <LazyFriendlyErrorPage
      error={{ status: 404, message: "not found" }}
      title={copy.notFoundTitle}
      footer={copy.notFoundBody}
    />
  );
}

/**
 * ODŚWIEŻANIE PRZY MONTAŻU W OKNIE BOOTU (P3.8, poprawka #5). Wpis z SSR jest
 * stemplowany chwilą renderu serwera, a dokument z brzegu bywa starszy niż
 * `staleTime` (świeży do 180 s, potem STALE do 24 h). Domyślny `refetchOnMount`
 * pobierał więc przy hydratacji każdy zamontowany wpis młodszy niż dokument -
 * reklamy i autorów (60 s) już po minucie, listy wpisów po kilku - w oknie
 * LCP/SI i z preflightem na każde żądanie.
 *
 * Polityka klienta: dopóki wspólny zatrzask „pierwsza interakcja ALBO punkt
 * ciszy" (`interactionOrQuiet.ts`) jest zamknięty, wpis Z DANYMI nie odświeża
 * się przy montażu tylko z powodu wieku. Odświeżają się od razu: zasiewy
 * z `updatedAt: 0` (doktryna leczenia po degradacji SSR - `ssr-degradation`)
 * i wpisy unieważnione (`invalidateQueries`: zapisy panelu, zmiana sesji).
 * Zapytanie bez danych (np. prywatne dane zalogowanego) ładuje się przy
 * montażu zawsze - tej ścieżki opcja nie dotyczy. Pierwsze wstrzymanie zapisuje
 * jedno `refetchQueries({ type: "active", stale: true })` przy otwarciu
 * zatrzasku, więc nic nie zostaje nieświeże na dłużej niż do pierwszej
 * interakcji albo ciszy; `cancelRefetch: false` łączy je z pobraniami już
 * w locie (bez podwójnych żądań). Po otwarciu zatrzasku - zachowanie domyślne.
 * Serwer: bez zmian (`true`).
 */
function bootRefetchOnMount(queryClient: QueryClient) {
  let catchUpArmed = false;
  return (query: Query): boolean => {
    if (isInteractionOrQuietOpen() || query.state.dataUpdatedAt === 0 || query.state.isInvalidated)
      return true;
    if (!catchUpArmed) {
      catchUpArmed = true;
      onInteractionOrQuiet(() => {
        void queryClient.refetchQueries({ type: "active", stale: true }, { cancelRefetch: false });
      });
    }
    return false;
  };
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        // A retry delay consumes the SSR deadline without rendering anything.
        // The hydrated client retries transient failures with its own budget.
        retry: isServer ? 0 : 1,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        refetchOnWindowFocus: false,
        refetchOnReconnect: "always",
        // Okno bootu (P3.8 #5, `bootRefetchOnMount` wyżej) - wyłącznie klient.
        refetchOnMount: isServer ? true : (query) => refetchOnMount(query),
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
  const refetchOnMount = bootRefetchOnMount(queryClient);

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // 30 s okna „ta trasa jest już przygotowana". To NIE jest świeżość danych
    // - tą włada react-query (staleTime 5 min, własne klucze). Router liczy tu
    // wyłącznie swoją pracę: dopasowanie trasy, `beforeLoad` i import chunku.
    // Przy 0 każde ponowne najechanie na ten sam odnośnik powtarzało to
    // wszystko od zera, mimo że wynik nie mógł się zmienić.
    defaultPreloadStaleTime: 30_000,
    // Aggressive intent preloading on hover/focus - by the time the user
    // clicks, the next route's loader has already resolved.
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    // Only show pending UI for genuinely slow navigations (>500ms). Fast
    // intent-preloaded clicks resolve instantly and never flash a skeleton.
    defaultPendingComponent: RouteLoadingSkeleton,
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
      // ZESTAW BOOTU (P2.1) - pierwszy, bo zależy wyłącznie od dopasowań i hintów loaderów
      // (oba gotowe po `router.load()`), a ten hak biegnie raz na dokument, przed renderem
      // Reacta, tak samo na ścieżce strumieniowej i `allReady` botów. Wstrzyknięty HTML czeka
      // w buforze routera na pierwszą granicę strumienia (`lib/boot/bootSet.server.ts`).
      injectBootSetOnServer(router);
      // KOLEJNOŚĆ, SPROSTOWANA 2026-09-01. Stało tu „Render się zakończył",
      // a to jest odwrotnie: `createStartHandler` woła
      // `routerInstance.load()` (wszystkie loadery), potem
      // `serverSsr.dehydrate()` - czyli TĘ funkcję - i DOPIERO POTEM render
      // Reacta. Zamiatanie biegnie więc PRZED renderem, nigdy po nim (mimo
      // nazwy modułu `postRenderSweep`, która też o tym kłamie).
      //
      // Unsettled loader work is cancelled before React renders. The chrome
      // Suspense gate can restart its bounded warmup after this sweep, while
      // the sibling route body is already free to stream.
      //
      // Anulujemy wiszące fetch-e i usuwamy zapytania, które nigdy się nie
      // rozstrzygną, ZANIM integracja zrobi snapshot cache'u. Inaczej seroval
      // czeka na ich promisy do twardego limitu.
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
    // hydration begins, so this delays the hydration of the tree by a few
    // ticks (see PODZIAŁ NA MAKROZADANIA below).
    //
    // PODZIAŁ NA MAKROZADANIA (P1.7, F6 z diagnozy P0.5). Hak biegnie
    // w renderze `StartClient` (zadanie K10: `createRouter` + skrypty `$_TSR`),
    // a po nim router-core w JEDNYM zadaniu dopasowuje trasy, importuje ich
    // chunki (pomocnik `__vitePreload` dokleja przy tym `modulepreload`
    // zależności) i woła `head()` tras - to zadanie K11 timera. Każdy kawałek
    // dostaje teraz własne makrozadanie (`setTimeout(0)`, nie
    // `scheduler.postTask` - Safari go nie ma, a to ścieżka krytyczna):
    //   1. hydratacja cache'u zapytań (integracja) - poza zadaniem
    //      `createRouter`;
    //   2. (doktryna wyżej, literał zostaje) ustąpienie po hydratacji
    //      integracji, potem import chunków dopasowanych tras;
    //   3. ostatnie ustąpienie - router-core dokańcza (dopasowanie, magazyny
    //      dopasowań, `head()`) już z gotowymi obietnicami chunków
    //      (`loadRouteChunk` jest idempotentny) i oddaje router Reactowi
    //      (`Await` w `StartClient` -> hydratacja drzewa).
    // Koszt: dwa dodatkowe tyknięcia przed hydratacją drzewa (poniżej progu
    // zaciskania zagnieżdżonych timerów, czyli ~0 ms każde).
    const prewarmRouteChunks = () => {
      try {
        const { matchedRoutes } = router.getMatchedRoutes(router.latestLocation.pathname);
        for (const route of matchedRoutes) {
          void Promise.resolve(router.loadRouteChunk(route)).catch(() => undefined);
        }
      } catch {
        // Rozgrzewka tylko PRZESUWA pracę: router-core zaraz po haku woła
        // `loadRouteChunk` sam i to on zgłasza błąd chunku na swojej ścieżce.
      }
    };
    const integrationHydrate = router.options.hydrate;
    router.options.hydrate = async (dehydrated) => {
      // Makrozadanie 1: hydratacja zapytań nie dokleja się do `createRouter`.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      // This bounds the hydration HOOK, including any upstream ogHydrate.
      // The pinned integration reads queryStream in the background and does
      // not await its completion. Actual application readiness is measured
      // by the boot probe and the production-artifact browser tests.
      //
      // Mechanika mieszka w `lib/ssr/hydrateBudget.ts`: stała jest tam
      // EKSPORTOWANA, a raport WSTRZYKIWALNY, więc budżet jest kontraktem,
      // a nie literałem i szpiegowaniem globalnej konsoli. Zachowanie
      // produkcyjne bez zmian. Tam też jest zapisane, czego ten bezpiecznik
      // w obecnej wersji integracji NIE ŚCINA (zmierzone).
      await withHydrateBudget(integrationHydrate?.(dehydrated), { label: "router-hydrate" });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      // Makrozadanie 2: chunki tras; makrozadanie 3: reszta hydratacji routera.
      prewarmRouteChunks();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    };
  }

  return router;
};
