// Harness montujący PRAWDZIWĄ trasę pliku (`createFileRoute`) w routerze
// pamięciowym - czyli testujący SKLEJENIE trasy, a nie sam komponent.
//
// PO CO. `createFileRoute("/checkout/$planId")({...})` samo w sobie nie zna
// swojej ścieżki: generator drzewa (`routeTree.gen.ts`) dopiero doklepuje jej
// `id`/`path`/`getParentRoute`. Bez tego kroku `Route.useParams()`,
// `Route.useSearch()`, `validateSearch`, `loader` i `head()` NIE ISTNIEJĄ w
// teście - test renderujący sam komponent mija dokładnie tę warstwę, w której
// mieszkają błędy sklejenia (zły wzorzec parametru, brak walidacji query,
// loader poza budżetem, brak `noindex` na stronie płatności).
//
// Ten harness odtwarza ten jeden krok generatora dla POJEDYNCZEJ trasy
// (korzeń zastępczy = `<Outlet/>`, historia pamięciowa, kontekst z
// `queryClient`), więc test dostaje prawdziwy `RouterProvider`, prawdziwą
// walidację search params, prawdziwy loader i prawdziwe `head()` - bez
// ciągnięcia całego drzewa tras aplikacji do jednego pliku testowego.
import type { ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  type AnyRoute,
} from "@tanstack/react-router";

/** Kontekst routera wymagany przez loadery tras publicznych (patrz `__root.tsx`). */
export interface RouteHarnessContext {
  queryClient: QueryClient;
}

/** Wpis nagłówka z `head()` trasy - `{ title }` albo `{ name, content }`. */
export type RouteMetaEntry = Record<string, unknown>;

/** Podpięcie trasy pod korzeń - dokładnie te trzy pola ustawia generator drzewa. */
interface RouteWiring {
  id: string;
  path: string;
  getParentRoute: () => AnyRoute;
}

/**
 * Doklepuje trasie ścieżkę i rodzica. W runtime `update()` scala CAŁE opcje
 * trasy (tak używa go `routeTree.gen.ts`), ale w typach przyjmuje wyłącznie
 * podzbiór "aktualizowalny" - generator tłumi to przez `as any`, czego w
 * ręcznie pisanym kodzie nie robimy, więc zawężamy sygnaturę strukturalnie.
 */
function wireToParent<TRoute extends AnyRoute>(route: TRoute, wiring: RouteWiring): TRoute {
  const update = route.update as unknown as (options: RouteWiring) => TRoute;
  return update.call(route, wiring);
}

export interface RenderRouteOptions {
  /** Eksport `Route` z pliku trasy (`src/routes/...`). */
  route: AnyRoute;
  /** Wzorzec ścieżki dokładnie taki, jak w `routeTree.gen.ts` (np. `/checkout/$planId`). */
  path: string;
  /** Adres startowy historii pamięciowej (ze stringiem zapytania, jeśli trzeba). */
  initialEntry: string;
  /** Współdzielony klient zapytań, gdy test chce podejrzeć cache/inwalidacje. */
  queryClient?: QueryClient;
  /** Opakowanie wokół `RouterProvider` (np. własny provider motywu). */
  wrapper?: (children: ReactNode) => ReactNode;
}

export interface RenderedRoute extends RenderResult {
  queryClient: QueryClient;
  /** Ścieżka bieżącej lokalizacji - do asercji nawigacji między trasami. */
  currentPath: () => string;
  /** Search params PO przejściu przez `validateSearch` trasy. */
  search: () => Record<string, unknown>;
  /** `meta` z `head()` dopasowanej trasy - to, co trafiłoby do `<HeadContent/>`. */
  meta: () => RouteMetaEntry[];
  /** `links` z `head()` - m.in. kanoniczny adres i preload obrazu LCP. */
  links: () => RouteMetaEntry[];
  /** Nawigacja w obrębie zamontowanego drzewa (np. na trasę rodzeństwa). */
  navigate: (href: string) => Promise<void>;
}

/**
 * Montuje trasę pod adresem `initialEntry` i czeka na wykonanie jej loadera.
 * Zwraca standardowe utilsy Testing Library rozszerzone o dostęp do lokalizacji,
 * nagłówków i nawigacji.
 */
export async function renderRoute(options: RenderRouteOptions): Promise<RenderedRoute> {
  const queryClient =
    options.queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const rootRoute = createRootRouteWithContext<RouteHarnessContext>()({
    component: () => <Outlet />,
  });
  const child = wireToParent(options.route, {
    id: options.path,
    path: options.path,
    getParentRoute: () => rootRoute,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([child]),
    history: createMemoryHistory({ initialEntries: [options.initialEntry] }),
    context: { queryClient },
    // Testy asertują stan końcowy, nie migotanie stanów oczekiwania.
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });

  // Loader biegnie PRZED renderem - tak samo jak w nawigacji produkcyjnej,
  // dzięki czemu asercje nie ścigają się z `ensureQueryData`.
  await router.load();

  const tree = <RouterProvider router={router} />;
  const utils = render(
    <QueryClientProvider client={queryClient}>
      {options.wrapper ? options.wrapper(tree) : tree}
    </QueryClientProvider>,
  );

  return {
    ...utils,
    queryClient,
    currentPath: () => router.state.location.pathname,
    search: () => (router.state.matches.at(-1)?.search ?? {}) as Record<string, unknown>,
    meta: () => (router.state.matches.at(-1)?.meta ?? []) as RouteMetaEntry[],
    links: () => (router.state.matches.at(-1)?.links ?? []) as RouteMetaEntry[],
    navigate: async (href: string) => {
      await router.navigate({ href });
      await router.invalidate();
    },
  };
}

/**
 * Odczytuje `head()` trasy BEZ montowania jej komponentu - do bramek nagłówka
 * (tytuł, `robots`) na trasach, których render wymagałby całej sesji zakupowej.
 */
export async function routeMeta(route: AnyRoute): Promise<RouteMetaEntry[]> {
  const head = route.options.head;
  if (typeof head !== "function") return [];
  const result = await head({} as Parameters<typeof head>[0]);
  return (result?.meta ?? []) as RouteMetaEntry[];
}
