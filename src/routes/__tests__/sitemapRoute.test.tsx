// LOADER MAPY STRONY (`src/routes/sitemap.tsx`) - dwa kontrakty naraz:
// nagłówek `Cache-Control` bramkowany czystością renderu ORAZ zdolność oddania
// dokumentu, kiedy backend nie odpowiada W OGÓLE.
//
// CO TU BYŁO DO 2026-09-12 i dlaczego to była druga z dwóch tras wskazanych
// imiennie w punkcie A4.5 zlecenia `docs/PROMPT_SSR_PIERWSZE_WCZYTANIE.md`:
// `setCacheControlHeader(contentCacheControl())` było PIERWSZĄ instrukcją tego
// loadera, a trzy zapytania budujące CAŁĄ treść mapy leciały po nim
// w `Promise.allSettled` - bez budżetu i BEZ SPRAWDZENIA WYNIKU. Odrzucenie
// któregokolwiek dawało mapę bez stron, bez kategorii albo bez wpisów, przy
// statusie 200 i z nagłówkiem pozwalającym brzegowi trzymać ten kadłubek przez
// 15 minut świeżości plus dobę okna stale.
//
// CO TU BYŁO DO 2026-09-21 (regresja pilnowana od teraz przez `ZWIS ...`):
// `settleWithinBudget(Promise.allSettled([...]), 2 000)` kończyło LOADER po
// terminie, ale nie anulowało zapytań i nie zasiewało żadnych danych - a
// komponent czyta te same trzy klucze przez `useSuspenseQuery`. Render czekał
// więc dalej na te same, wciąż biegnące fetchy: budżet skracał czas do
// NAGŁÓWKA, nie do pierwszego bajtu (zmierzone: `curl /sitemap` powyżej 90 s
// i dokument bez `<h1>`). Dlatego sam nagłówek przestał tu wystarczać za dowód
// i asercje sięgają do CACHE'U ZAPYTAŃ: zasiany fallback ze stemplem
// `updatedAt: 0` jest jedyną rzeczą, która pozwala komponentowi wyrenderować
// się natychmiast.
//
// Mapa strony jest powierzchnią, z której crawler czerpie strukturę serwisu
// (każdy URL w zasięgu dwóch kliknięć), więc jej okrojona wersja utrwalona
// w cache'u kosztuje indeks, a nie kosmetykę.
//
// Zero sieci: trzy fabryki zapytań są podmienione na atrapy o sterowanym
// wyniku, a nagłówki odpowiedzi są rejestrem, nie efektem ubocznym h3.
import { QueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stan atrap MUSI mieszkać w `vi.hoisted`: fabryki `vi.mock` są wynoszone nad
// cały plik, więc zwykła stała modułowa byłaby w chwili ich wywołania jeszcze
// w martwej strefie (`Cannot access ... before initialization`).
const h = vi.hoisted(() => ({
  /** Wartości `setCacheControlHeader(...)` w kolejności wywołań. */
  cacheControl: [] as string[],
  /** Które z trzech zapytań mają ODRZUCIĆ (nazwa -> odrzuca). */
  failing: new Set<string>(),
  /** Które z trzech zapytań mają ZAWISNĄĆ bez rozstrzygnięcia. */
  hanging: new Set<string>(),
  // Ładunki atrap - rozpoznawalne, żeby odróżnić PRAWDZIWY odczyt od fallbacku.
  pageRows: [
    {
      id: "p1",
      slug: "o-nas",
      title_pl: "O nas",
      title_en: "About",
      parent_id: null,
      menu_order: 1,
    },
  ],
  categoryRows: [{ slug: "analizy", name_pl: "Analizy", name_en: "Analyses" }],
  blogResult: {
    posts: [
      { id: "b1", slug: "wpis", title_pl: "Wpis", title_en: "Post", published_at: "2026-09-01" },
    ],
  },
}));

vi.mock("@/lib/http/responseHeaders", async (o) => ({
  ...(await o<typeof import("@/lib/http/responseHeaders")>()),
  setCacheControlHeader: (value: string) => {
    h.cacheControl.push(value);
  },
}));

/** Klucz, pod którym atrapa `name` żyje w cache'u zapytań. */
function keyOf(name: string) {
  return ["stub", name] as const;
}

/**
 * Trzy fabryki zapytań podmienione na atrapy o STEROWANYM wyniku. Podmiana
 * dotyczy wyłącznie tych trzech - reszta modułu (typy, pozostałe fabryki)
 * zostaje prawdziwa, bo przedmiotem dowodu jest loader, nie warstwa zapytań.
 *
 * `hanging` to osobny tryb od `failing`: odrzucenie broni się `catch`-em,
 * a ZWIS nie - i to zwis, nie błąd, trzymał tę trasę ponad 90 s.
 */
function stubOptions(name: string, payload: unknown) {
  return () =>
    queryOptions({
      queryKey: keyOf(name),
      queryFn: (): Promise<unknown> => {
        if (h.hanging.has(name)) return new Promise<unknown>(() => {});
        if (h.failing.has(name)) return Promise.reject(new Error(`${name} unreachable`));
        return Promise.resolve(payload);
      },
      retry: false,
    });
}

vi.mock("@/lib/queries/public", async (o) => ({
  ...(await o<typeof import("@/lib/queries/public")>()),
  publicPagesTreeQueryOptions: stubOptions("pages-tree", h.pageRows),
  publicCategoriesQueryOptions: stubOptions("categories", h.categoryRows),
  blogListQueryOptions: stubOptions("blog-list", h.blogResult),
}));

import { Route } from "@/routes/sitemap";

type Loader = (args: {
  context: { queryClient: QueryClient };
}) => Promise<{ degraded: boolean } | null>;

interface LoaderRun {
  readonly queryClient: QueryClient;
  readonly degraded: boolean;
}

async function runLoader(): Promise<LoaderRun> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const loader = Route.options.loader as unknown as Loader;
  const data = await loader({ context: { queryClient } });
  return { queryClient, degraded: data?.degraded === true };
}

/** Stan zapytania atrapy - to na nim renderuje się komponent. */
function stateOf(run: LoaderRun, name: string) {
  const state = run.queryClient.getQueryState(keyOf(name));
  return { data: state?.data, updatedAt: state?.dataUpdatedAt, status: state?.status };
}

/**
 * Przestaw JEDEN test na RENDER SERWEROWY.
 *
 * Budżety czasowe loaderów obowiązują wyłącznie na serwerze (patrz nagłówek
 * `lib/ssr/resilientLoad.ts`): przy nawigacji SPA wynik loadera jest
 * niezmienny, więc degradacja z powodu CZASU zamarzałaby jako fałszywy
 * komunikat awarii. Suita biegnie w happy-dom, gdzie `document` istnieje
 * zawsze, więc bez tego stubu „zwis backendu" czekałby tu w nieskończoność -
 * dokładnie tak, jak MA czekać w przeglądarce.
 */
function renderOnServer(): void {
  vi.stubGlobal("document", undefined);
}

beforeEach(() => {
  h.cacheControl = [];
  h.failing = new Set<string>();
  h.hanging = new Set<string>();
  // `loadResilient` loguje każdą degradację - w teście to szum, nie sygnał.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  // Stub środowiska z `renderOnServer()` nie może przeciekać na kolejny test.
  vi.unstubAllGlobals();
});

describe("loader `/sitemap` - `Cache-Control` bramkowany czystością renderu", () => {
  it("KOMPLETNA mapa wchodzi do cache'u wspólnego (kontrola pozytywna)", async () => {
    const run = await runLoader();

    expect(run.degraded).toBe(false);
    expect(h.cacheControl).toHaveLength(1);
    expect(h.cacheControl[0]).toContain("s-maxage=900");
    expect(h.cacheControl[0]).not.toContain("no-store");
    // Czysty odczyt zostaje przy polityce treści RAZEM z prawdziwymi danymi:
    // żaden z trzech kluczy nie jest zasianym fallbackiem (`updatedAt: 0`).
    for (const [name, payload] of [
      ["pages-tree", h.pageRows],
      ["categories", h.categoryRows],
      ["blog-list", h.blogResult],
    ] as const) {
      const state = stateOf(run, name);
      expect(state.data).toEqual(payload);
      expect(state.updatedAt).toBeGreaterThan(0);
    }
  });

  it.each(["pages-tree", "categories", "blog-list"])(
    "odrzucone zapytanie `%s` zdejmuje cache wspólny",
    async (name) => {
      h.failing.add(name);
      const run = await runLoader();

      expect(run.degraded).toBe(true);
      expect(h.cacheControl).toHaveLength(1);
      expect(h.cacheControl[0]).toBe("private, no-store");
    },
  );

  it("nagłówek wychodzi DOPIERO po pracy - jedno wywołanie, nie dwa", async () => {
    // Gdyby polityka czystego renderu wracała na początek loadera, ten
    // przypadek zobaczyłby dwie wartości (albo jedną, ale cache'owalną mimo
    // awarii). Jedno wywołanie Z `no-store` jest dowodem KOLEJNOŚCI, a nie
    // tylko wartości.
    h.failing.add("categories");
    await runLoader();
    expect(h.cacheControl).toEqual(["private, no-store"]);
  });

  it("BŁĄD JEDNEGO zapytania degraduje TYLKO nagłówek - reszta danych zostaje", async () => {
    // Degradacja jest CZĘŚCIOWA: brak kategorii nie ma prawa wykasować stron
    // ani wpisów z dokumentu. Gdyby loader zasiewał fallbacki hurtem (albo
    // gdyby jedno odrzucenie przerywało całą równoległą falę), mapa traciłaby
    // treść, której backend w tym żądaniu oddał komplet.
    h.failing.add("categories");
    const run = await runLoader();

    expect(h.cacheControl).toEqual(["private, no-store"]);
    expect(stateOf(run, "pages-tree").data).toEqual(h.pageRows);
    expect(stateOf(run, "pages-tree").updatedAt).toBeGreaterThan(0);
    expect(stateOf(run, "blog-list").data).toEqual(h.blogResult);
    expect(stateOf(run, "blog-list").updatedAt).toBeGreaterThan(0);
    // Zdegradowany klucz dostaje PUSTĄ strukturę w swoim typie, ze stemplem
    // `updatedAt: 0` - komponent renderuje sekcję pustą, a klient dociąga.
    expect(stateOf(run, "categories")).toEqual({ data: [], updatedAt: 0, status: "success" });
  });

  it("ZWIS WSZYSTKICH TRZECH zapytań na serwerze kończy loader w budżecie i zasiewa fallbacki", async () => {
    // To jest przypadek, którego `settleWithinBudget` NIE domykał: loader
    // wracał, ale cache zapytań zostawał pusty, więc `useSuspenseQuery`
    // w komponencie zawieszał render na tych samych, wciąż biegnących
    // fetchach. Dowodem naprawy nie jest sam nagłówek, tylko TRZY zasiane
    // klucze - dopiero one pozwalają wyrenderować mapę (z `<h1>`) od razu.
    renderOnServer();
    h.hanging.add("pages-tree");
    h.hanging.add("categories");
    h.hanging.add("blog-list");
    const started = Date.now();
    const run = await runLoader();

    expect(run.degraded).toBe(true);
    expect(h.cacheControl).toEqual(["private, no-store"]);
    expect(stateOf(run, "pages-tree")).toEqual({ data: [], updatedAt: 0, status: "success" });
    expect(stateOf(run, "categories")).toEqual({ data: [], updatedAt: 0, status: "success" });
    expect(stateOf(run, "blog-list")).toEqual({
      data: { posts: [] },
      updatedAt: 0,
      status: "success",
    });
    // Termin trasy (2 000 ms), a nie watchdog zapytań SSR (5 000 ms) - zapas
    // na wolny runner. Trzy zapytania dzielą JEDEN termin, więc zwis wszystkich
    // trzech kosztuje tyle co zwis jednego.
    expect(Date.now() - started).toBeLessThan(4_000);
  });
});
