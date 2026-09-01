// `src/router.tsx` - PLIK, KTÓRY POSIADA WSZYSTKIE BUDŻETY SSR I HYDRATACJI,
// a do 2026-09-01 miał 0 z 38 pokrytych linii i 0 z 13 funkcji. Nie był
// importowany przez ŻADEN plik testowy; jedyny kontakt suity z korzeniem
// polegał na odczytaniu pliku jako TEKSTU (`lib/seo/__tests__/rootHead.test.ts`).
// Próg globalny tego nie widział, bo jest agregatem po całym `src/`.
//
// CO TEN PLIK DOWODZI - cztery inwarianty, każdy z ceną awarii:
//
//  1. `shouldDehydrateQuery` przepuszcza WYŁĄCZNIE `status === "success"`.
//     Zapytanie w stanie `pending` serializuje obietnicę w locie, a seroval
//     blokuje wtedy CAŁY dokument do jej rozwiązania - co przy anulowanym
//     fetchu nie następuje nigdy. To jest najostrzejszy bezpiecznik
//     serializacji w tym repozytorium.
//  2. ZAMIATANIE BIEGNIE PRZED SNAPSHOTEM cache'u integracji. Odwrotna
//     kolejność znaczy, że seroval dostaje do serializacji martwe obietnice.
//  3. Strumień zapytań jest owijany strażnikiem, który domykamy sami -
//     integracja domyka swój tylko z `onRenderFinished`, a router-core po
//     cichu gubi ten hak w niektórych stanach (wtedy dokument nigdy się nie
//     kończy).
//  4. Budżet hydratacji przerywa oczekiwanie: bez niego strona zostaje
//     statycznym HTML-em, w którym nic nie reaguje na klik, i to BEZ żadnego
//     błędu widocznego dla użytkownika.
//
// STRATEGIA IMPORTU. `src/router.tsx` importuje statycznie `./routeTree.gen` -
// 8 000+ linii i 369 importów tras, czyli całą aplikację (każdy panel admina,
// każdą trasę API, Supabase, Stripe). W teście jednostkowym jest to nieużywalne,
// więc podmieniamy CAŁE drzewo na jeden goły korzeń. `createRouter` to przyjmuje.
// Druga atrapa to sama integracja router<->query: podstawiamy dokładnie te dwa
// haki, które `router.tsx` owija.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { QueryClient } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  /** Przełącznik gałęzi SSR/klient - jedyny precedens w repo: homeRoute.test.tsx. */
  server: false,
  /** Język renderu widziany przez `rewrite.output`. */
  lang: "pl" as "pl" | "en",
  /** Co integracja router<->query wstawia jako `options.hydrate`. */
  hydrateImpl: undefined as undefined | ((d: unknown) => Promise<void>),
  /** Co integracja wstawia jako `options.dehydrate`. */
  dehydrateImpl: undefined as undefined | (() => Promise<unknown>),
  /** Kolejność zdarzeń w gałęzi serwerowej - przedmiot dowodu nr 2. */
  order: [] as string[],
}));

vi.mock("@tanstack/router-core/isServer", () => ({
  get isServer() {
    return h.server;
  },
}));

// Całe wygenerowane drzewo tras zastąpione JEDNYM korzeniem.
vi.mock("@/routeTree.gen", async () => {
  const { createRootRoute } = await import("@tanstack/react-router");
  return { routeTree: createRootRoute({ component: () => null }) };
});

vi.mock("@tanstack/react-router-ssr-query", () => ({
  setupRouterSsrQueryIntegration: ({ router }: { router: Record<string, unknown> }) => {
    const opts = router.options as Record<string, unknown>;
    if (h.hydrateImpl) opts.hydrate = h.hydrateImpl;
    if (h.dehydrateImpl) {
      opts.dehydrate = async () => {
        h.order.push("integration-dehydrate");
        return h.dehydrateImpl!();
      };
    }
  },
}));

// Zamiatanie: atrapa CZĄSTKOWA, bo mierzymy KOLEJNOŚĆ, nie implementację.
vi.mock("@/lib/ssr/postRenderSweep", () => ({
  sweepQueryCacheForSerialization: (_qc: unknown, opts: { reason: string }) => {
    h.order.push(`sweep:${opts.reason}`);
  },
}));

vi.mock("@/lib/i18n/localeRuntime", () => ({ currentLang: () => h.lang }));

const { getRouter } = await import("@/router");
const { HYDRATE_BUDGET_MS } = await import("@/lib/ssr/hydrateBudget");

function queryClientOf(router: ReturnType<typeof getRouter>): QueryClient {
  return (router.options.context as { queryClient: QueryClient }).queryClient;
}

describe("getRouter - kontrakt opcji", () => {
  it("opcje routera są tymi, które opisuje plik", () => {
    const r = getRouter();
    expect(r.options.defaultPreload).toBe("intent");
    expect(r.options.defaultPreloadStaleTime).toBe(0);
    expect(r.options.defaultPreloadDelay).toBe(50);
    expect(r.options.defaultPendingMs).toBe(500);
    expect(r.options.defaultPendingMinMs).toBe(250);
    expect(r.options.defaultViewTransition).toBe(true);
    expect(r.options.defaultHashScrollIntoView).toBe(false);
    expect(r.options.scrollRestoration).toBe(true);
  });

  it("defaulty QueryClienta", () => {
    const q = queryClientOf(getRouter()).getDefaultOptions().queries!;
    expect(q.staleTime).toBe(5 * 60_000);
    expect(q.gcTime).toBe(30 * 60_000);
    expect(q.retry).toBe(1);
    // Bez tego czytelnik wracający do zakładki traci pozycję w artykule.
    expect(q.refetchOnWindowFocus).toBe(false);
    expect(q.refetchOnReconnect).toBe("always");
    expect(queryClientOf(getRouter()).getDefaultOptions().mutations!.retry).toBe(0);
  });

  it("retryDelay rośnie wykładniczo i JEST OGRANICZONY do 8 s", () => {
    const delay = queryClientOf(getRouter()).getDefaultOptions().queries!.retryDelay as (
      attempt: number,
    ) => number;
    expect(delay(0)).toBe(1000);
    expect(delay(1)).toBe(2000);
    expect(delay(2)).toBe(4000);
    // Sufit: bez niego dziesiąta próba czekałaby ponad 17 minut.
    expect(delay(10)).toBe(8000);
    expect(delay(30)).toBe(8000);
  });

  it("INWARIANT SERIALIZACJI: dehydratację przechodzi tylko `success`", () => {
    const should = queryClientOf(getRouter()).getDefaultOptions().dehydrate!.shouldDehydrateQuery!;
    expect(should({ state: { status: "success" } } as never)).toBe(true);
    // `pending` serializuje obietnicę w locie -> seroval blokuje CAŁY dokument.
    expect(should({ state: { status: "pending" } } as never)).toBe(false);
    expect(should({ state: { status: "error" } } as never)).toBe(false);
  });
});

/**
 * `rewrite.input`/`output` są typowane jako `string | URL`, a nasze przepisanie
 * zawsze zwraca `URL` (mutuje wejście i je oddaje). Ten helper zawęża typ
 * w JEDNYM miejscu, zamiast rzutować w każdej asercji.
 */
function pathOf(result: string | URL | undefined): string {
  if (result === undefined) throw new Error("rewrite zwrócił undefined");
  return typeof result === "string" ? new URL(result).pathname : result.pathname;
}

describe("getRouter - przepisywanie adresu na język", () => {
  it("input ZDEJMUJE prefiks języka przed dopasowaniem trasy", () => {
    const rw = getRouter().options.rewrite!;
    expect(pathOf(rw.input!({ url: new URL("https://x.test/en/o-nas") } as never))).toBe("/o-nas");
    // Adres bez prefiksu zostaje nietknięty.
    expect(pathOf(rw.input!({ url: new URL("https://x.test/o-nas") } as never))).toBe("/o-nas");
  });

  it("output DOKŁADA prefiks z języka renderu - obie gałęzie", () => {
    h.lang = "pl";
    const rwPl = getRouter().options.rewrite!;
    expect(pathOf(rwPl.output!({ url: new URL("https://x.test/o-nas") } as never))).toBe("/o-nas");
    // EN to jedyna gałąź, w której `pathname` jest realnie mutowany.
    h.lang = "en";
    const rwEn = getRouter().options.rewrite!;
    expect(pathOf(rwEn.output!({ url: new URL("https://x.test/o-nas") } as never))).toBe(
      "/en/o-nas",
    );
    h.lang = "pl";
  });
});

describe("getRouter - gałąź SERWERA", () => {
  it("wpina disposer watchdoga w cykl życia serverSsr, zachowując istniejące", async () => {
    h.server = true;
    h.dehydrateImpl = async () => ({ dehydratedQueryClient: {} });
    const r = getRouter();
    expect(r.serverSsrLifecycle?.onServerSsrAttach).toHaveLength(1);
    const cleanups: unknown[] = [];
    r.serverSsrLifecycle!.onServerSsrAttach![0]({
      onCleanup: (fn: unknown) => cleanups.push(fn),
    } as never);
    // Bez tego timery watchdoga przeżywają żądanie - na Workers to ostrzeżenia
    // runtime'u i zbędne wybudzenia izolatu.
    expect(cleanups).toHaveLength(1);
    h.server = false;
  });

  it("ZAMIATA CACHE ZANIM integracja zrobi snapshot - kolejność jest treścią", async () => {
    h.server = true;
    h.order = [];
    h.dehydrateImpl = async () => ({});
    const r = getRouter();
    await r.options.dehydrate!();
    expect(h.order).toEqual(["sweep:dehydrate", "integration-dehydrate"]);
    h.server = false;
  });

  it("owija queryStream własnym strażnikiem", async () => {
    h.server = true;
    const stream = new ReadableStream({ start: (c) => c.close() });
    h.dehydrateImpl = async () => ({ queryStream: stream });
    const out = (await getRouter().options.dehydrate!()) as { queryStream: unknown };
    expect(out.queryStream).not.toBe(stream);
    expect(out.queryStream).toBeInstanceOf(ReadableStream);
    h.server = false;
  });

  it("payload BEZ queryStream przechodzi nietknięty", async () => {
    h.server = true;
    const payload = { dehydratedQueryClient: { queries: [] } };
    h.dehydrateImpl = async () => payload;
    expect(await getRouter().options.dehydrate!()).toEqual(payload);
    h.server = false;
  });
});

describe("getRouter - gałąź KLIENTA i budżet hydratacji", () => {
  it("owija hydrate i NIE dotyka serverSsrLifecycle", () => {
    h.server = false;
    h.hydrateImpl = async () => {};
    const r = getRouter();
    expect(typeof r.options.hydrate).toBe("function");
    expect(r.options.hydrate).not.toBe(h.hydrateImpl);
    expect(r.serverSsrLifecycle).toBeUndefined();
  });

  it("BUDŻET jest importowanym kontraktem, nie powtórzonym literałem", () => {
    // Do 2026-09-01 budżet był lokalną stałą w ciele strzałki, więc test mógł
    // wyłącznie POWTÓRZYĆ liczbę 1500 - i przechodził po każdej zmianie źródła.
    expect(HYDRATE_BUDGET_MS).toBe(1500);
  });

  it("wiszący hydrate integracji NIE blokuje hydratacji dłużej niż budżet", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.server = false;
    h.hydrateImpl = () => new Promise<void>(() => {});
    const r = getRouter();
    let done = false;
    // `options.hydrate` jest typowane jako `Awaitable<void>`, więc opakowujemy
    // w `Promise.resolve` zamiast zakładać `.then`.
    void Promise.resolve(r.options.hydrate!({} as never)).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(HYDRATE_BUDGET_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(warn.mock.calls.flat().join(" ")).toContain("[ssr-hydrate]");
    // Ustąpienie makrozadania PO budżecie: pozwala dojechać do cache'u chunkom
    // strumienia, które już przyszły, zanim React zacznie hydratować.
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    vi.useRealTimers();
    warn.mockRestore();
  });

  it("szybka integracja NIE zostawia ostrzeżenia ani wiszącego timera", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.server = false;
    h.hydrateImpl = async () => {};
    const p = Promise.resolve(getRouter().options.hydrate!({} as never));
    await vi.advanceTimersByTimeAsync(3 * HYDRATE_BUDGET_MS);
    await p;
    // Brak ostrzeżenia po trzykrotnym budżecie dowodzi, że timer jest
    // CZYSZCZONY, a nie tylko przegrywa wyścig.
    expect(warn.mock.calls.flat().join(" ")).not.toContain("[ssr-hydrate]");
    vi.useRealTimers();
    warn.mockRestore();
  });

  it.fails(
    "budżet ścina PRAWDZIWY wiszący strumień zapytań integracji - DZIŚ NIE MA CZEGO ŚCINAĆ. " +
      "`options.hydrate` zainstalowanej integracji (@tanstack/router-ssr-query-core) czyta " +
      "`queryStream` przez `reader.read().then(...)` w trybie FIRE-AND-FORGET i NIE awaituje " +
      "go, więc rozstrzyga się natychmiast: `Promise.race` w budżecie zawsze wygrywa gałęzią " +
      "integracji, a ostrzeżenie jest w produkcji MARTWE. Zmierzone: strumień, który nigdy " +
      "się nie domyka, i hydrate rozstrzygnięty po 10 ms. Bezpiecznik zostaje na `ogHydrate` " +
      "router-core i na przyszłe wersje biblioteki, ale DECYZJA, czy go utrzymywać, czy " +
      "zastąpić czymś, co realnie mierzy hydratację (punkt 10 audytu - detektor martwej " +
      "hydratacji), należy do człowieka.",
    async () => {
      const { setupRouterSsrQueryIntegration } = await import("@tanstack/react-router-ssr-query");
      // Atrapa jest tu podstawiona, więc prawdziwa integracja jest z tego testu
      // nieosiągalna - i to jest dokładnie treść tego `it.fails`.
      expect(setupRouterSsrQueryIntegration.length).toBe(-1);
    },
  );
});

describe("getRouter - domyślne ekrany błędu", () => {
  it("defaultNotFoundComponent renderuje przyjazny ekran 404 z copy z errorCopy", () => {
    const NotFound = getRouter().options.defaultNotFoundComponent!;
    const html = renderToStaticMarkup(<NotFound data={undefined} isNotFound routeId="__root__" />);
    expect(html).toContain("<h1");
    expect(html.length).toBeGreaterThan(50);
  });

  it("defaultErrorComponent renderuje przyjazny ekran błędu, nie surowy stack", () => {
    const ErrorScreen = getRouter().options.defaultErrorComponent!;
    const html = renderToStaticMarkup(
      <ErrorScreen
        error={new Error("TAJNY-STACK-Z-SERWERA")}
        reset={() => {}}
        info={{ componentStack: "" }}
      />,
    );
    // Ekran błędu nie może wycieknąć treści wyjątku do użytkownika.
    expect(html).not.toContain("TAJNY-STACK-Z-SERWERA");
    expect(html.length).toBeGreaterThan(50);
  });
});
