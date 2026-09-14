// LOADER MAPY STRONY (`src/routes/sitemap.tsx`) - nagłówek `Cache-Control`
// bramkowany czystością renderu.
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
// Mapa strony jest powierzchnią, z której crawler czerpie strukturę serwisu
// (każdy URL w zasięgu dwóch kliknięć), więc jej okrojona wersja utrwalona
// w cache'u kosztuje indeks, a nie kosmetykę.
//
// Zero sieci: trzy fabryki zapytań są podmienione na atrapy o sterowanym
// wyniku, a nagłówki odpowiedzi są rejestrem, nie efektem ubocznym h3.
import { QueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Wartości `setCacheControlHeader(...)` w kolejności wywołań. */
  cacheControl: [] as string[],
  /** Które z trzech zapytań mają ODRZUCIĆ (nazwa -> odrzuca). */
  failing: new Set<string>(),
}));

vi.mock("@/lib/http/responseHeaders", async (o) => ({
  ...(await o<typeof import("@/lib/http/responseHeaders")>()),
  setCacheControlHeader: (value: string) => {
    h.cacheControl.push(value);
  },
}));

/**
 * Trzy fabryki zapytań podmienione na atrapy o STEROWANYM wyniku. Podmiana
 * dotyczy wyłącznie tych trzech - reszta modułu (typy, pozostałe fabryki)
 * zostaje prawdziwa, bo przedmiotem dowodu jest loader, nie warstwa zapytań.
 */
function stubOptions(name: string) {
  return () =>
    queryOptions({
      queryKey: ["stub", name] as const,
      queryFn: async () => {
        if (h.failing.has(name)) throw new Error(`${name} unreachable`);
        return [] as unknown[];
      },
      retry: false,
    });
}

vi.mock("@/lib/queries/public", async (o) => ({
  ...(await o<typeof import("@/lib/queries/public")>()),
  publicPagesTreeQueryOptions: stubOptions("pages-tree"),
  publicCategoriesQueryOptions: stubOptions("categories"),
  blogListQueryOptions: stubOptions("blog-list"),
}));

import { Route } from "@/routes/sitemap";

type Loader = (args: { context: { queryClient: QueryClient } }) => Promise<unknown>;

async function runLoader(): Promise<void> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const loader = Route.options.loader as unknown as Loader;
  await loader({ context: { queryClient } });
}

beforeEach(() => {
  h.cacheControl = [];
  h.failing = new Set<string>();
});

describe("loader `/sitemap` - `Cache-Control` bramkowany czystością renderu", () => {
  it("KOMPLETNA mapa wchodzi do cache'u wspólnego (kontrola pozytywna)", async () => {
    await runLoader();
    expect(h.cacheControl).toHaveLength(1);
    expect(h.cacheControl[0]).toContain("s-maxage=900");
    expect(h.cacheControl[0]).not.toContain("no-store");
  });

  it.each(["pages-tree", "categories", "blog-list"])(
    "odrzucone zapytanie `%s` zdejmuje cache wspólny",
    async (name) => {
      h.failing.add(name);
      await runLoader();
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
});
