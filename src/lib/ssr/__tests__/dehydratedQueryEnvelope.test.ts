// @vitest-environment node
//
// KOMPAKTOWA KOPERTA ZAPYTAŃ (P3.7b, T1) - dowód na PRAWDZIWYM `dehydrate()`
// i `hydrate()` przypiętego query-core, nie na ręcznie złożonych obiektach:
//  1. ROUND-TRIP: `expand(compact(d))` równa się `d` (bez pustej listy mutacji,
//     której klient nie odtwarza - `hydrate` czyta `mutations || []`) dla
//     każdego kształtu, który może trafić do przesyłki (sukces, odświeżone dwa
//     razy, `meta`, zapytanie nieskończone, błąd po danych, klucz z obiektem
//     o innej kolejności pól);
//  2. CACHE PO HYDRATACJI jest identyczny dla obu kopert (hash i stan);
//  3. PORCJA STRUMIENIA po zamontowaniu obserwatora dostaje dane - to jest
//     scenariusz, w którym brak `queryHash` gubiłby dane (kontrola negatywna);
//  4. własny `queryKeyHashFn` i klucz z instancją klasy zachowują hash, `data`
//     zostaje tą samą referencją;
//  5. strumień i ładunek routera: prawdziwa integracja router<->query hydratuje
//     kompaktową barierę i kompaktową porcję strumienia.
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
  compactDehydratedState,
  expandDehydratedState,
  expandRouterDehydrated,
  mapQueryStream,
  type CompactDehydratedState,
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

function everything(qc: QueryClient): DehydratedState {
  return dehydrate(qc, { shouldDehydrateQuery: () => true, shouldRedactErrors: () => false });
}

function cacheSnapshot(qc: QueryClient) {
  return qc
    .getQueryCache()
    .getAll()
    .map((q) => [q.queryHash, q.state] as const);
}

describe("compact/expand na prawdziwym dehydrate()", () => {
  it("round-trip: expand(compact(d)) równa się d dla każdego kształtu zapytania", async () => {
    const d = everything(await richClient());
    expect(d.queries.map((q) => q.queryKey[0])).toEqual([
      "prosty",
      "dwa-razy",
      "z-meta",
      "nieskonczone",
      "builder-post-list",
      "blad-po-danych",
    ]);
    const { mutations, ...withoutMutations } = d;
    expect(mutations).toEqual([]);
    expect(expandDehydratedState(compactDehydratedState(d))).toEqual(withoutMutations);
  });

  it("koperta kompaktowa nie niesie `queryHash` ani pól równych stałej; reszta zostaje", async () => {
    const d = everything(await richClient());
    const c = compactDehydratedState(d) as CompactDehydratedState;
    // Pusta lista mutacji też znika (`hydrate` czyta `mutations || []`).
    expect(c).not.toHaveProperty("mutations");
    for (const q of c.queries) {
      expect(q).not.toHaveProperty("queryHash");
      expect(q).toHaveProperty("dehydratedAt");
      expect(q.state).toHaveProperty("dataUpdatedAt");
      for (const [key, value] of Object.entries(q.state)) {
        if (key in DEFAULT_SUCCESS_STATE) {
          expect(value).not.toBe(DEFAULT_SUCCESS_STATE[key as keyof typeof DEFAULT_SUCCESS_STATE]);
        }
      }
    }
    const byKey = (key: string) => c.queries.find((q) => q.queryKey[0] === key)!;
    // Zapytanie sukcesu w stanie domyślnym: zostają wyłącznie dane i znacznik czasu.
    expect(Object.keys(byKey("prosty").state).sort()).toEqual(["data", "dataUpdatedAt"]);
    expect(byKey("dwa-razy").state.dataUpdateCount).toBe(2);
    expect(byKey("z-meta").meta).toEqual({ zrodlo: "test" });
    expect(byKey("nieskonczone").queryType).toBe("infinite");
    expect(byKey("blad-po-danych").state).toMatchObject({ status: "error", data: "stare" });
    expect(JSON.stringify(c).length).toBeLessThan(JSON.stringify(d).length);
  });

  it("kompaktowanie jest idempotentne, a rozwinięcie pełnej koperty jej nie zmienia", async () => {
    const d = everything(await richClient());
    const c = compactDehydratedState(d);
    expect(compactDehydratedState(c)).toEqual(c);
    // Dokument sprzed zmiany (pełna koperta) hydratuje się bez różnicy.
    expect(expandDehydratedState(d)).toEqual(d);
  });

  it("nie mutuje wejścia: integracja trzyma hashe oryginałów w `sentQueries`", async () => {
    const d = everything(await richClient());
    const before = structuredClone(d.queries.map((q) => [q.queryHash, q.state.status]));
    compactDehydratedState(d);
    expect(d.queries.map((q) => [q.queryHash, q.state.status])).toEqual(before);
    expect(d.mutations).toEqual([]);
  });

  it("cache po hydratacji: obie koperty dają identyczne hashe i stany", async () => {
    const d = everything(await richClient());
    const full = client();
    const compact = client();
    hydrate(full, d);
    hydrate(compact, expandDehydratedState(compactDehydratedState(d)));
    expect(cacheSnapshot(compact)).toEqual(cacheSnapshot(full));
  });

  it("`data` zostaje TĄ SAMĄ referencją (seroval dalej emituje `$R[n]`)", async () => {
    const qc = client();
    const shared = { builder_data: { sections: [] } };
    qc.setQueryData(["public", "home-page"], shared);
    const c = compactDehydratedState(dehydrate(qc)) as CompactDehydratedState;
    expect(c.queries[0].state.data).toBe(shared);
    expect((expandDehydratedState(c) as DehydratedState).queries[0].state.data).toBe(shared);
  });

  it("hash z własnej funkcji (`queryKeyHashFn`) zostaje w przesyłce", async () => {
    const qc = client();
    await qc.fetchQuery({
      queryKey: ["wlasny-hash", 1],
      queryFn: () => "x",
      queryKeyHashFn: () => "wlasny",
    });
    const c = compactDehydratedState(dehydrate(qc)) as CompactDehydratedState;
    expect(c.queries[0].queryHash).toBe("wlasny");
    const target = client();
    hydrate(target, expandDehydratedState(c));
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
    const c = compactDehydratedState(dehydrate(qc)) as CompactDehydratedState;
    const byKey = (name: string) => c.queries.find((q) => q.queryKey[0] === name)!;
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
    const chunk = compactDehydratedState(dehydrate(source));
    const target = mounted(key);
    hydrate(target, expandDehydratedState(chunk));
    expect(target.getQueryData(key)).toEqual([{ id: "p1" }]);
    expect(target.getQueryCache().find({ queryKey: key })?.state.status).toBe("success");
  });

  it("KONTROLA NEGATYWNA: porcja bez rozwinięcia gubi dane (powód odtwarzania przed hydrate)", async () => {
    const source = client();
    const key = ["builder-post-list", { variant: "list", lang: "pl" }];
    source.setQueryData(key, [{ id: "p2" }]);
    const chunk = compactDehydratedState(dehydrate(source));
    const target = mounted(key);
    hydrate(target, chunk);
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

  it("mapQueryStream przepisuje każdą porcję i przenosi koniec strumienia", async () => {
    const source = new ReadableStream<number>({
      start(c) {
        c.enqueue(1);
        c.enqueue(2);
        c.close();
      },
    });
    expect(await drain(mapQueryStream(source, (n) => n * 10))).toEqual([10, 20]);
  });

  it("mapQueryStream przenosi błąd źródła", async () => {
    const source = new ReadableStream<number>({
      start(c) {
        c.error(new Error("zerwany strumień"));
      },
    });
    await expect(drain(mapQueryStream(source, (n) => n))).rejects.toThrow("zerwany strumień");
  });

  it("ładunek bez koperty i strumienia wraca bez zmiany treści", () => {
    const payload = { manifest: { a: 1 } };
    const out = expandRouterDehydrated(payload) as Record<string, unknown>;
    expect(out.manifest).toBe(payload.manifest);
    expect(out.dehydratedQueryClient).toBeUndefined();
    expect(out).not.toHaveProperty("queryStream");
    expect(expandRouterDehydrated(undefined)).toBeUndefined();
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

  it("PRAWDZIWA integracja hydratuje kompaktową barierę i kompaktową porcję strumienia", async () => {
    const { setupCoreRouterSsrQueryIntegration } = await import("@tanstack/router-ssr-query-core");
    const router = { isServer: false, options: {} as Record<string, unknown> };
    const target = client();
    setupCoreRouterSsrQueryIntegration({ router, queryClient: target } as never);

    const barrierSource = client();
    barrierSource.setQueryData(["site_settings_public", "all"], { seo: { a: 1 } });
    const chunkSource = client();
    chunkSource.setQueryData(["newsletter-settings", "inline"], { heading_pl: "Zapisz się" });
    const queryStream = new ReadableStream({
      start(c) {
        c.enqueue(compactDehydratedState(dehydrate(chunkSource)));
        c.close();
      },
    });
    const dehydrated = {
      dehydratedQueryClient: compactDehydratedState(dehydrate(barrierSource)),
      queryStream,
    };
    await (router.options.hydrate as (d: unknown) => Promise<void>)(
      expandRouterDehydrated(dehydrated),
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
  });
});
