// @vitest-environment node
//
// KOMPAKTOWA KOPERTA ZAPYTAŃ (P3.7b, T1) - dowód na PRAWDZIWYM `dehydrate()`
// i `hydrate()` przypiętego query-core, nie na ręcznie złożonych obiektach.
// Jednostką jest tablica zapytań, tak jak w ładunku integracji router<->query
// (`query.initial` i każda porcja `query.stream`, router-ssr-query-core 1.169.3):
//  1. ROUND-TRIP: `expand(compact(q))` równa się `q` dla każdego kształtu, który
//     może trafić do przesyłki (sukces, odświeżone dwa razy, `meta`, zapytanie
//     nieskończone, błąd po danych, klucz z obiektem o innej kolejności pól);
//  2. CACHE PO HYDRATACJI jest identyczny dla obu kopert (hash i stan);
//  3. PORCJA STRUMIENIA po zamontowaniu obserwatora dostaje dane - to jest
//     scenariusz, w którym brak `queryHash` gubiłby dane (kontrola negatywna);
//  4. własny `queryKeyHashFn` i klucz z instancją klasy zachowują hash, `data`
//     zostaje tą samą referencją;
//  5. strumień i ładunek routera: PRAWDZIWA integracja serwerowa -> kompaktowanie
//     -> rozwinięcie -> PRAWDZIWA integracja kliencka hydratuje porcję początkową
//     i porcję strumienia renderu.
import { describe, expect, it } from "vitest";
import {
  QueryClient,
  QueryObserver,
  dehydrate,
  hashKey,
  hydrate,
  type DehydratedState,
} from "@tanstack/react-query";

import {
  DEFAULT_SUCCESS_STATE,
  compactDehydratedQueries,
  compactRouterDehydrated,
  expandDehydratedQueries,
  expandRouterDehydrated,
  mapQueryStream,
  type DehydratedQuery,
  type RouterQueryPayload,
} from "../dehydratedQueryEnvelope";

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

/** Cache z każdym kształtem zapytania, który może trafić do przesyłki. */
async function richClient(): Promise<QueryClient> {
  const qc = client();
  await qc.fetchQuery({ queryKey: ["prosty"], queryFn: () => ({ v: 1 }) });
  // Odświeżone dwa razy: `dataUpdateCount` 2 - pole RÓŻNE od stałej zostaje.
  let n = 0;
  const twice = { queryKey: ["dwa-razy"], queryFn: () => ({ n: ++n }) };
  await qc.fetchQuery(twice);
  await qc.refetchQueries({ queryKey: ["dwa-razy"] });
  await qc.fetchQuery({ queryKey: ["z-meta"], queryFn: () => "m", meta: { zrodlo: "test" } });
  await qc.fetchInfiniteQuery({
    queryKey: ["nieskonczone"],
    queryFn: ({ pageParam }) => [pageParam],
    initialPageParam: 0,
    getNextPageParam: (last: number[]) => last[0] + 1,
  });
  // Klucz z obiektem: `hashKey` sortuje pola, więc kolejność w kluczu jest bez znaczenia.
  await qc.fetchQuery({
    queryKey: ["builder-post-list", { variant: "ranked", limit: 5, lang: "pl" }],
    queryFn: () => [{ id: "a" }],
  });
  // Błąd PO danych (odwodniony tylko z `shouldDehydrateQuery: () => true`).
  let fail = false;
  await qc.fetchQuery({
    queryKey: ["blad-po-danych"],
    queryFn: () => (fail ? Promise.reject(new Error("blip")) : Promise.resolve("stare")),
  });
  fail = true;
  await qc.refetchQueries({ queryKey: ["blad-po-danych"] }).catch(() => undefined);
  return qc;
}

/** Zapytania tak, jak integracja wysyła je w porcji (`dehydrateQuery` każdego zapytania). */
function everything(qc: QueryClient): DehydratedQuery[] {
  return dehydrate(qc, { shouldDehydrateQuery: () => true, shouldRedactErrors: () => false })
    .queries;
}

function cacheSnapshot(qc: QueryClient) {
  return qc
    .getQueryCache()
    .getAll()
    .map((q) => [q.queryHash, q.state] as const);
}

describe("compact/expand na prawdziwym dehydrate()", () => {
  it("round-trip: expand(compact(q)) równa się q dla każdego kształtu zapytania", async () => {
    const queries = everything(await richClient());
    expect(queries.map((q) => q.queryKey[0])).toEqual([
      "prosty",
      "dwa-razy",
      "z-meta",
      "nieskonczone",
      "builder-post-list",
      "blad-po-danych",
    ]);
    expect(expandDehydratedQueries(compactDehydratedQueries(queries))).toEqual(queries);
  });

  it("koperta kompaktowa nie niesie `queryHash` ani pól równych stałej; reszta zostaje", async () => {
    const queries = everything(await richClient());
    const c = compactDehydratedQueries(queries);
    for (const q of c) {
      expect(q).not.toHaveProperty("queryHash");
      expect(q).toHaveProperty("dehydratedAt");
      expect(q.state).toHaveProperty("dataUpdatedAt");
      for (const [key, value] of Object.entries(q.state)) {
        if (key in DEFAULT_SUCCESS_STATE) {
          expect(value).not.toBe(DEFAULT_SUCCESS_STATE[key as keyof typeof DEFAULT_SUCCESS_STATE]);
        }
      }
    }
    const byKey = (key: string) => c.find((q) => q.queryKey[0] === key)!;
    // Zapytanie sukcesu w stanie domyślnym: zostają wyłącznie dane i znacznik czasu.
    expect(Object.keys(byKey("prosty").state).sort()).toEqual(["data", "dataUpdatedAt"]);
    expect(byKey("dwa-razy").state.dataUpdateCount).toBe(2);
    expect(byKey("z-meta").meta).toEqual({ zrodlo: "test" });
    expect(byKey("nieskonczone").queryType).toBe("infinite");
    expect(byKey("blad-po-danych").state).toMatchObject({ status: "error", data: "stare" });
    expect(JSON.stringify(c).length).toBeLessThan(JSON.stringify(queries).length);
  });

  it("kompaktowanie jest idempotentne, a rozwinięcie pełnej koperty jej nie zmienia", async () => {
    const queries = everything(await richClient());
    const c = compactDehydratedQueries(queries);
    const again = compactDehydratedQueries(c);
    expect(again).toEqual(c);
    // Bez pól `undefined`: druga kompaktacja nie dokłada `queryHash: undefined` do przesyłki.
    expect(JSON.stringify(again)).toBe(JSON.stringify(c));
    // Dokument sprzed zmiany (pełna koperta) hydratuje się bez różnicy.
    expect(expandDehydratedQueries(queries)).toEqual(queries);
  });

  it("nie mutuje wejścia: integracja trzyma hashe oryginałów w `sentQueries`", async () => {
    const queries = everything(await richClient());
    const before = structuredClone(queries.map((q) => [q.queryHash, q.state.status]));
    compactDehydratedQueries(queries);
    expect(queries.map((q) => [q.queryHash, q.state.status])).toEqual(before);
  });

  it("cache po hydratacji: obie koperty dają identyczne hashe i stany", async () => {
    const queries = everything(await richClient());
    const full = client();
    const compact = client();
    hydrate(full, { queries });
    hydrate(compact, { queries: expandDehydratedQueries(compactDehydratedQueries(queries)) });
    expect(cacheSnapshot(compact)).toEqual(cacheSnapshot(full));
  });

  it("`data` zostaje TĄ SAMĄ referencją (seroval dalej emituje `$R[n]`)", async () => {
    const qc = client();
    const shared = { builder_data: { sections: [] } };
    qc.setQueryData(["public", "home-page"], shared);
    const c = compactDehydratedQueries(dehydrate(qc).queries);
    expect(c[0].state.data).toBe(shared);
    expect(expandDehydratedQueries(c)[0].state.data).toBe(shared);
  });

  it("hash z własnej funkcji (`queryKeyHashFn`) zostaje w przesyłce", async () => {
    const qc = client();
    await qc.fetchQuery({
      queryKey: ["wlasny-hash", 1],
      queryFn: () => "x",
      queryKeyHashFn: () => "wlasny",
    });
    const c = compactDehydratedQueries(dehydrate(qc).queries);
    expect(c[0].queryHash).toBe("wlasny");
    const target = client();
    hydrate(target, { queries: expandDehydratedQueries(c) });
    expect(target.getQueryCache().get("wlasny")?.state.data).toBe("x");
  });

  it("klucz z instancją klasy zachowuje hash (po deserializacji byłby obiektem prostym)", async () => {
    class Filtr {
      constructor(
        readonly zakres: string,
        readonly autor: string,
      ) {}
    }
    const qc = client();
    // Pola instancji NIE są sortowane przez `hashKey` (tylko obiekty proste), a po
    // deserializacji seroval klient dostałby obiekt prosty i hash z innym porządkiem.
    const key = ["filtr", new Filtr("tydzien", "a1")];
    await qc.fetchQuery({ queryKey: key, queryFn: () => "x" });
    await qc.fetchQuery({ queryKey: ["prosty", { b: 1, a: 2 }], queryFn: () => "y" });
    const c = compactDehydratedQueries(dehydrate(qc).queries);
    const byKey = (name: string) => c.find((q) => q.queryKey[0] === name)!;
    expect(byKey("filtr").queryHash).toBe(hashKey(key));
    expect(byKey("prosty")).not.toHaveProperty("queryHash");
  });
});

describe("porcja strumienia po zamontowaniu obserwatora", () => {
  /** Obserwator `useQuery` zamontowany PRZED porcją: zapytanie istnieje, bez danych. */
  function mounted(key: readonly unknown[]): QueryClient {
    const target = client();
    const observer = new QueryObserver(target, { queryKey: key, enabled: false });
    observer.subscribe(() => undefined);
    expect(target.getQueryCache().find({ queryKey: key })?.state.status).toBe("pending");
    return target;
  }

  it("rozwinięta porcja trafia w istniejące zapytanie i daje dane", async () => {
    const source = client();
    const key = ["builder-post-list", { variant: "minimal", lang: "pl" }];
    source.setQueryData(key, [{ id: "p1" }]);
    const chunk = compactDehydratedQueries(dehydrate(source).queries);
    const target = mounted(key);
    hydrate(target, { queries: expandDehydratedQueries(chunk) });
    expect(target.getQueryData(key)).toEqual([{ id: "p1" }]);
    expect(target.getQueryCache().find({ queryKey: key })?.state.status).toBe("success");
  });

  it("KONTROLA NEGATYWNA: porcja bez rozwinięcia gubi dane (powód odtwarzania przed hydrate)", async () => {
    const source = client();
    const key = ["builder-post-list", { variant: "list", lang: "pl" }];
    source.setQueryData(key, [{ id: "p2" }]);
    const chunk = compactDehydratedQueries(dehydrate(source).queries);
    const target = mounted(key);
    // Rzutowanie jest tu przedmiotem testu: typ `hydrate` nie przyjmuje koperty kompaktowej,
    // a podajemy ją celowo, żeby pokazać, co by się stało bez `expandDehydratedQueries` (tak
    // wygląda porcja, którą klient dostaje z sieci).
    hydrate(target, { queries: chunk as unknown as DehydratedState["queries"] });
    expect(target.getQueryData(key)).toBeUndefined();
  });
});

describe("strumień i ładunek routera", () => {
  async function drain<T>(stream: ReadableStream<T>): Promise<T[]> {
    const out: T[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return out;
      out.push(value);
    }
  }

  function streamOf<T>(...chunks: T[]): ReadableStream<T> {
    return new ReadableStream<T>({
      start(c) {
        for (const chunk of chunks) c.enqueue(chunk);
        c.close();
      },
    });
  }

  it("mapQueryStream przepisuje każdą porcję i przenosi koniec strumienia", async () => {
    expect(await drain(mapQueryStream(streamOf(1, 2), (n) => `#${n * 10}`))).toEqual([
      "#10",
      "#20",
    ]);
  });

  it("mapQueryStream przenosi błąd źródła", async () => {
    const source = new ReadableStream<number>({
      start(c) {
        c.error(new Error("zerwany strumień"));
      },
    });
    await expect(drain(mapQueryStream(source, (n) => n))).rejects.toThrow("zerwany strumień");
  });

  it("anulowanie strumienia wynikowego anuluje źródło", async () => {
    let cancelled: unknown;
    const source = new ReadableStream<number>({
      cancel(reason) {
        cancelled = reason;
      },
    });
    await mapQueryStream(source, (n) => n).cancel("koniec");
    expect(cancelled).toBe("koniec");
  });

  it("ładunek bez `query` (albo bez strumienia) wraca TYM SAMYM obiektem", () => {
    const payload = { manifest: { a: 1 } };
    expect(compactRouterDehydrated(payload)).toBe(payload);
    expect(expandRouterDehydrated(payload)).toBe(payload);
    const noStream = { query: { initial: [] } };
    expect(compactRouterDehydrated(noStream)).toBe(noStream);
    expect(expandRouterDehydrated(noStream)).toBe(noStream);
    expect(compactRouterDehydrated(undefined)).toBeUndefined();
    expect(expandRouterDehydrated(undefined)).toBeUndefined();
  });

  it("serwer: nowy ładunek z kompaktową porcją początkową i porcjami strumienia; oryginały nietknięte", async () => {
    const queries = everything(await richClient());
    const chunk = everything(await richClient()).slice(0, 2);
    const manifest = { routes: {} };
    const payload = { manifest, query: { initial: queries, stream: streamOf(chunk) } };
    // Typ wyniku to typ wejścia (ładunek jest dla router-core nieprzezroczysty) - treść
    // sprawdzają asercje.
    const out = compactRouterDehydrated(payload);
    expect(out).not.toBe(payload);
    expect(out.manifest).toBe(manifest);
    expect(out.query.initial).toEqual(compactDehydratedQueries(queries));
    expect(await drain(out.query.stream)).toEqual([compactDehydratedQueries(chunk)]);
    // Integracja zapisała hashe oryginałów w `sentQueries` - zostają nietknięte.
    expect(payload.query.initial).toBe(queries);
    expect(queries.every((q) => typeof q.queryHash === "string")).toBe(true);
    // Bez porcji początkowej (integracja pomija pustą) - bez klucza `initial`.
    const streamOnly = compactRouterDehydrated({
      query: { stream: streamOf<DehydratedQuery[]>() },
    });
    expect(streamOnly.query).not.toHaveProperty("initial");
  });

  it("PRAWDZIWA integracja: serwer -> kompaktowanie -> rozwinięcie -> klient (porcja początkowa i strumień)", async () => {
    const { setupCoreRouterSsrQueryIntegration } = await import("@tanstack/router-ssr-query-core");

    // SERWER: ten sam predykat co `src/router.tsx` (wyłącznie `success`).
    const serverClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        dehydrate: { shouldDehydrateQuery: (query) => query.state.status === "success" },
      },
    });
    serverClient.setQueryData(["site_settings_public", "all"], { seo: { a: 1 } });
    const renderFinished: Array<() => void> = [];
    const serverRouter = {
      isServer: true,
      options: {} as Record<string, unknown>,
      serverSsr: { onRenderFinished: (listener: () => void) => renderFinished.push(listener) },
    };
    setupCoreRouterSsrQueryIntegration({
      router: serverRouter,
      queryClient: serverClient,
    } as never);
    // Kształt wyniku haka - kontrakt integracji (`dehydratedQueryEnvelope.ts`, nagłówek).
    const dehydrateHook = serverRouter.options.dehydrate as () => Promise<{
      query: RouterQueryPayload<DehydratedQuery>;
    }>;
    const wire = compactRouterDehydrated(await dehydrateHook());
    // Zapytanie fazy renderu - jedzie porcją strumienia, potem koniec renderu domyka strumień.
    await serverClient.prefetchQuery({
      queryKey: ["newsletter-settings", "inline"],
      queryFn: async () => ({ heading_pl: "Zapisz się" }),
    });
    for (const listener of renderFinished) listener();

    // Na drucie: ani jednego `queryHash` i żadnego pola ze stałego ogona stanu.
    const initial = wire.query.initial ?? [];
    expect(initial).toHaveLength(1);
    expect(initial[0]).not.toHaveProperty("queryHash");
    expect(initial[0].state).not.toHaveProperty("status");

    // KLIENT
    const target = client();
    const clientRouter = { isServer: false, options: {} as Record<string, unknown> };
    setupCoreRouterSsrQueryIntegration({ router: clientRouter, queryClient: target } as never);
    await (clientRouter.options.hydrate as (d: unknown) => Promise<void>)(
      expandRouterDehydrated(wire),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(target.getQueryData(["site_settings_public", "all"])).toEqual({ seo: { a: 1 } });
    expect(target.getQueryData(["newsletter-settings", "inline"])).toEqual({
      heading_pl: "Zapisz się",
    });
    for (const q of target.getQueryCache().getAll()) {
      expect(q.queryHash).toBe(hashKey(q.queryKey));
      expect(q.state).toMatchObject({
        status: "success",
        errorUpdateCount: 0,
        fetchStatus: "idle",
      });
    }
    serverClient.clear();
  });
});
