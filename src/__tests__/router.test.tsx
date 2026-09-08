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
    const Pending = r.options.defaultPendingComponent!;
    expect(renderToStaticMarkup(<Pending />)).toContain('aria-busy="true"');
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

  it("real integration does not await an open query stream; later data still hydrates", async () => {
    const { setupCoreRouterSsrQueryIntegration } = await import("@tanstack/router-ssr-query-core");
    const { QueryClient, dehydrate } = await import("@tanstack/query-core");
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const integrationRouter = { isServer: false, options: {} as Record<string, unknown> };
    const target = new QueryClient();
    const source = new QueryClient();
    setupCoreRouterSsrQueryIntegration({ router: integrationRouter, queryClient: target } as never);
    let controller!: ReadableStreamDefaultController;
    const queryStream = new ReadableStream({
      start: (c) => {
        controller = c;
      },
    });
    h.server = false;
    h.hydrateImpl = integrationRouter.options.hydrate as (data: unknown) => Promise<void>;
    try {
      let done = false;
      const work = Promise.resolve(getRouter().options.hydrate!({ queryStream } as never)).then(
        () => {
          done = true;
        },
      );
      await vi.advanceTimersByTimeAsync(2);
      expect(done).toBe(true);
      await work;
      source.setQueryData(["late-stream-data"], { value: 42 });
      controller.enqueue(dehydrate(source));
      await vi.advanceTimersByTimeAsync(2);
      expect(target.getQueryData(["late-stream-data"])).toEqual({ value: 42 });
      await vi.advanceTimersByTimeAsync(2 * HYDRATE_BUDGET_MS);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      controller.close();
      h.hydrateImpl = undefined;
      target.clear();
      source.clear();
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  // ── TERMINALNY ODCZYT STRUMIENIA ZAPYTAŃ: DLACZEGO LOGU NIE MA ───────────
  //
  // `e2e/boot-artifact.spec.ts` toleruje na zbudowanym artefakcie jeden
  // `console.error` na dokument:
  //   Error reading query stream: TypeError: Cannot read properties of
  //   undefined (reading 'mutations')
  // Ta zgoda stoi na KONIUNKCJI dwóch warunków i bez OBU nie ma podstawy.
  //
  // WARUNEK (A), KSZTAŁT PĘTLI - PRAWDZIWY DZIŚ. `@tanstack/router-ssr-query-core`
  // 1.169.1 (dist/esm/index.js:93-96) woła `hydrate` PRZED sprawdzeniem `done`:
  //   reader.read().then(async function handle({ done, value }) {
  //     hydrate(queryClient, value, hydrateOptions);   // <- WOŁANE PRZED...
  //     if (done) return;                              // <- ...sprawdzeniem `done`
  // Odczyt terminalny domkniętego strumienia to z definicji
  // `{done: true, value: undefined}`, więc `hydrate(qc, undefined)` PADA na
  // każdym dokumencie. Warunku (A) pilnuje drugi test w tym bloku.
  //
  // WARUNEK (B), CZY `hydrate` TO PRZEŻYWA - FAŁSZYWY DZIŚ. Na PRZYPIĘTEJ
  // `@tanstack/query-core` 5.101.2 (bun.lock:682) funkcja otwiera się strażnikiem
  //   if (typeof dehydratedState !== "object" || dehydratedState === null) return;
  // więc `undefined` wychodzi CICHO, nie dotykając `.mutations`. ZMIERZONE
  // WYKONANIEM na czterech buildach pobranych z npm: 5.101.2 i 5.102.0 NIE
  // rzucają, 5.102.1 i 5.102.8 rzucają `TypeError: Cannot read properties of
  // undefined (reading 'mutations')`. Granica to 5.102.0 -> 5.102.1: tam strażnik
  // ZNIKA, a typ parametru zmienia się z `unknown` na `Partial<DehydratedState>`.
  //
  // DLACZEGO POPRZEDNIA WERSJA TEGO TESTU ŚWIECIŁA NA CZERWONO W CI. Zakładała
  // `toThrow(/mutations/)`, czyli warunek (B) prawdziwy - a powstała na drzewie,
  // w którym `node_modules` STAŁO PONAD `bun.lock`: `package.json` dopuszcza
  // `^5.101.2`, więc instalacja bez locka wciąga 5.102.x. Ślad jest w opisie
  // commita b2e4f34: `tsc` odrzucił tam argument, bo parametr był typowany
  // `Partial<DehydratedState>` - sygnatura istniejąca WYŁĄCZNIE od 5.102.1,
  // podczas gdy przypięty build typuje go `unknown`. CI instaluje z locka, więc
  // dostaje 5.101.2 i asercja o rzucie była tam niespełnialna z definicji:
  // żadna zmiana w kodzie TEGO repozytorium nie mogła jej zazielenić.
  //
  // CO MIERZY TEN TEST TERAZ. Nie wnętrze biblioteki, tylko OBJAW na tej samej
  // ścieżce, którą ogląda bramka bootu: prawdziwa integracja, prawdziwy
  // `QueryClient`, prawdziwy strumień doprowadzony do odczytu TERMINALNEGO -
  // i zero `console.error`. Zapali się dokładnie wtedy, gdy koniunkcja znów
  // stanie się prawdziwa, czyli po podbiciu query-core do >= 5.102.1 - a więc
  // wtedy, gdy zgoda w `e2e/boot-artifact.spec.ts` znów będzie miała podstawę.
  // Dopóki jest zielony, tamta zgoda jest MARTWA i przepuszcza klasę
  // komunikatów, której na przypiętym drzewie nikt nie produkuje.
  describe("integracja router<->query: terminalny odczyt strumienia", () => {
    it("PRAWDZIWA pętla odczytu hydratuje porcję i NIE loguje na odczycie terminalnym", async () => {
      // Tu jedzie PRAWDZIWA integracja, nie atrapa z góry pliku: atrapa podmienia
      // `@tanstack/react-router-ssr-query`, a pętla odczytu mieszka piętro niżej,
      // w `@tanstack/router-ssr-query-core`, i tamtędy przechodzi przeglądarka.
      const { setupCoreRouterSsrQueryIntegration } =
        await import("@tanstack/router-ssr-query-core");
      const { QueryClient, dehydrate } = await import("@tanstack/query-core");

      // Gałąź wybiera `isServer ?? router.isServer`. ZMIERZONE: pod vitest
      // `isServer` z `@tanstack/router-core/isServer` ma wartość `undefined`, bo
      // build serwerowy zwraca `void 0` przy `NODE_ENV === "test"` - a atrapa
      // z góry tego pliku NIE sięga do node_modules (paczka jest zewnętrzna).
      // O gałęzi decyduje więc `router.isServer` i ustawiamy je JAWNIE, zamiast
      // opierać test na tym, że pola nie ma; `h.server` ustawiamy dla porządku,
      // gdyby paczka kiedyś została wciągnięta do transformacji vite.
      h.server = false;
      const router = { isServer: false, options: {} as Record<string, unknown> };
      const queryClient = new QueryClient();
      setupCoreRouterSsrQueryIntegration({ router, queryClient } as never);

      // Ładunek o PRAWDZIWYM kształcie - dokładnie to, co serwer wysyła w porcji.
      const source = new QueryClient();
      source.setQueryData(["terminalny-odczyt"], { v: 42 });
      const chunk = dehydrate(source);

      // Odczyt TERMINALNY mierzymy WPROST, opakowując czytnik - bo to on jest
      // jedynym miejscem, w którym biblioteka woła `hydrate(qc, undefined)`
      // (`router-ssr-query-core/dist/esm/index.js:93-98`: `hydrate` stoi PRZED
      // `if (done) return`).
      //
      // NIE liczymy tu wywołań `pull`, i to jest poprawka błędu, nie stylu:
      // `pull` numer 2 odpala się przy ZDJĘCIU porcji z kolejki podczas odczytu
      // PIERWSZEGO, a nie przy wywołaniu drugiego `read()`. Zmierzone: przy
      // urwanej pętli (`return;` zamiast `return handle(await reader.read())`)
      // licznik `pull` i tak dochodził do 2, więc asercja o nim przechodziła
      // w scenariuszu, który miała wykluczać. `reads` zbiera flagi `done`
      // zwrócone przez KAŻDY `read()`, więc `[false, true]` znaczy dosłownie:
      // była porcja, po niej był odczyt domykający.
      const source$ = new ReadableStream({
        start: (c) => {
          c.enqueue(chunk);
          c.close();
        },
      });
      const reads: boolean[] = [];
      const queryStream = {
        getReader: () => {
          const reader = source$.getReader();
          return {
            read: async () => {
              const result = await reader.read();
              reads.push(result.done);
              return result;
            },
          };
        },
      };

      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      await (router.options.hydrate as (d: unknown) => Promise<void>)({ queryStream });
      // Pętla jest FIRE-AND-FORGET (biblioteka jej nie awaituje), więc ustępujemy
      // makrozadanie - inaczej mierzylibyśmy stan sprzed obu odczytów.
      await new Promise((r) => setTimeout(r, 0));
      const logged = err.mock.calls.map((c) => c.map(String).join(" "));
      err.mockRestore();

      expect(reads).toEqual([false, true]);
      // Porcja NAPRAWDĘ wylądowała w cache'u docelowego klienta - to odróżnia
      // „nic się nie zepsuło" od „nic się nie wydarzyło".
      expect(queryClient.getQueryData(["terminalny-odczyt"])).toEqual({ v: 42 });
      // Tyle logów na dokument widzi bramka bootu.
      expect(logged).toEqual([]);
    });

    it("biblioteka nadal woła `hydrate` PRZED sprawdzeniem `done`", async () => {
      // Asercja po ŹRÓDLE paczki, a nie po zachowaniu, i to jest konieczne:
      // to warunek (A) koniunkcji, a przy ŻYWYM strażniku w query-core
      // kolejność tych dwóch instrukcji jest z zewnątrz NIEOBSERWOWALNA -
      // `hydrate(qc, undefined)` wychodzi cicho, więc test wyżej przechodzi
      // niezależnie od niej. Dopiero razem obie asercje pilnują całej
      // koniunkcji: ta - że defekt w górze rzeki nadal tam jest, tamta - że
      // przypięta wersja query-core nadal go znosi.
      const { readFileSync } = await import("node:fs");
      const source = readFileSync(
        "node_modules/@tanstack/router-ssr-query-core/dist/esm/index.js",
        "utf8",
      );
      const readLoop = source.slice(source.indexOf("reader.read().then"));
      const hydrateAt = readLoop.indexOf("hydrate(queryClient, value");
      const doneAt = readLoop.indexOf("if (done)");
      expect(
        hydrateAt,
        "kształt pętli odczytu się zmienił - przejrzyj defekt od nowa",
      ).toBeGreaterThan(-1);
      expect(
        doneAt,
        "kształt pętli odczytu się zmienił - przejrzyj defekt od nowa",
      ).toBeGreaterThan(-1);
      // GDY TO PRZESTANIE BYĆ PRAWDĄ, defekt jest naprawiony w górze rzeki:
      // wtedy log nie wróci NAWET po podbiciu query-core ponad 5.102.0,
      // a zgoda w `e2e/boot-artifact.spec.ts` traci ostatnią podstawę.
      expect(hydrateAt).toBeLessThan(doneAt);
    });
  });
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
