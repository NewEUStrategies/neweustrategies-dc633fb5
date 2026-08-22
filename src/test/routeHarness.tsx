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

/** Walidator search params trasy w kształcie testowym. */
export type RouteSearchValidator = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * `validateSearch` trasy jako FUNKCJA - jedno miejsce, które zawęża ten odczyt.
 *
 * PO CO. `RouteOptions.validateSearch` jest unią: framework przyjmuje tam
 * funkcję ALBO obiekt ze standardowym schematem (`{ parse }`), więc wywołanie
 * `Route.options.validateSearch?.(raw)` nie kompiluje się - „this expression is
 * not callable" na członie obiektowym. Kontrakt adresu chcemy sprawdzać BEZ
 * montowania trasy (walidator jest czystą funkcją i to jego zachowanie jest
 * przedmiotem dowodu), więc zawężenie musi mieszkać w jednym miejscu.
 *
 * STRAŻNIK, nie rzutowanie: warunek sprawdza w RUNTIME, że to funkcja, i to on
 * zawęża typ. Wyjątek zamiast `undefined` w wyniku, bo test, który „przechodzi"
 * na braku walidatora, nie dowodzi niczego o kontrakcie adresu.
 */
export function routeSearchValidator(route: AnyRoute): RouteSearchValidator {
  const validate = route.options.validateSearch;
  if (typeof validate !== "function") {
    throw new Error("test: trasa nie ma `validateSearch` w postaci funkcji");
  }
  return (raw) => {
    const result: unknown = validate(raw);
    if (result === null || typeof result !== "object") {
      throw new Error("test: `validateSearch` nie zwrócił obiektu search params");
    }
    return { ...result };
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

/**
 * Handler serwerowy trasy (`server.handlers.GET/POST`) w kształcie testowym.
 *
 * `params` jest OPCJONALNE i celowo obecne w typie: trasy z parametrem
 * (`sitemaps.$section.ts`) czytają wyłącznie `params`, a nie `request`, więc bez
 * tego pola test takiej trasy nie skompilowałby się bez rzutowania - a rzutowań
 * w tym repo nie ma. Poszerzenie jest zgodne wstecz: wołający, którzy podają
 * samo `{ request }`, kompilują się dalej.
 */
export type RouteServerHandler = (args: {
  request?: Request;
  params?: Record<string, string>;
}) => Promise<Response>;

/** Opcje trasy w części, której framework nie wystawia w typie publicznym. */
interface RouteOptionsWithServer {
  server?: { handlers?: Record<string, RouteServerHandler> };
}

/**
 * Czy opcje trasy niosą blok serwerowy. STRAŻNIK, nie rzutowanie: `as unknown
 * as` przepuściłby też kształt, którego tam nie ma, a ten warunek sprawdza to
 * w runtime i dopiero wtedy zawęża typ.
 */
function hasServerBlock(options: object): options is RouteOptionsWithServer {
  return "server" in options;
}

/**
 * Handlery serwerowe trasy pliku - JEDNO miejsce, które czyta `Route.options`
 * głębiej, niż framework opisuje w typach.
 *
 * PO CO. Trasy API (`createFileRoute(...)({ server: { handlers } })` ) nie
 * wystawiają handlerów w typie publicznym: `RouteOptions` jest sparametryzowane
 * kontekstem routera i ścieżką, więc odczyt „daj mi POST" trzeba zawęzić
 * samemu. Zamiast powtarzać to w każdym pliku testowym trasy, mieszka tu raz -
 * z wyjaśnieniem, i z jednym miejscem do poprawienia, gdyby framework zaczął
 * ten kształt eksportować.
 *
 * Handler wołamy WPROST, bez runtime'u routera: to on niesie całą logikę
 * odpowiedzi (kody, nagłówki, zapisy), a przejście przez router niczego by tu
 * nie dowiodło.
 */
export function routeServerHandlers(route: AnyRoute): Record<string, RouteServerHandler> {
  const handlers = hasServerBlock(route.options) ? route.options.server?.handlers : undefined;
  if (!handlers) throw new Error("test: trasa nie ma handlerów serwerowych");
  return handlers;
}

/** Wynik `head()` trasy w kształcie, którego dotykają testy nagłówka. */
export interface RouteHeadResult {
  meta?: RouteMetaEntry[];
  links?: Record<string, unknown>[];
  scripts?: { type?: string; children?: string }[];
}

/**
 * Kontekst, z którego `head()` faktycznie korzysta: dane loadera i parametry
 * ścieżki. Framework wstrzykuje tam znacznie więcej (match, kontekst routera),
 * ale test opisuje WEJŚCIE, którego dotyczy dowód.
 */
export interface RouteHeadContext {
  loaderData?: unknown;
  params?: Record<string, string>;
}

type RouteHeadFn = (ctx: RouteHeadContext) => RouteHeadResult;

/** STRAŻNIK, nie rzutowanie - warunek sprawdza w runtime, że to funkcja. */
function isHeadFn(value: unknown): value is RouteHeadFn {
  return typeof value === "function";
}

/**
 * `head()` trasy wołany WPROST, z podanym kontekstem - do dowodów o meta,
 * `robots`, adresie kanonicznym i danych strukturalnych.
 *
 * PO CO OSOBNO OD `routeMeta`. `routeMeta` woła `head()` na pustym kontekście
 * i oddaje same `meta` - to wystarcza trasom, których nagłówek nie zależy od
 * danych. Nagłówek profilu publicznego zależy od WSZYSTKIEGO: od ładunku
 * loadera (tożsamość, dorobek, strona eksploratora) i od parametru ścieżki,
 * a dowód dotyczy też `links` (kanoniczny) i `scripts` (JSON-LD). Zawężenie
 * typu mieszka tu raz, zamiast w każdym pliku testowym trasy publicznej.
 */
export function routeHead(route: AnyRoute, ctx: RouteHeadContext = {}): RouteHeadResult {
  const head: unknown = route.options.head;
  if (!isHeadFn(head)) throw new Error("test: trasa nie ma `head()` w postaci funkcji");
  return head(ctx);
}
