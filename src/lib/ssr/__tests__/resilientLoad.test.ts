// @vitest-environment node
//
// PO CO TU ŚRODOWISKO `node`. Od recenzji PR #382 (P1) `loadResilient` ma DWA
// zachowania, a rozstrzyga je środowisko: budżet czasowy obowiązuje wyłącznie
// w renderze serwerowym, w przeglądarce loader czeka na zapytanie do skutku.
// Globalne happy-dom dawałoby `document` zawsze, więc KAŻDY test budżetu
// opisywałby tu ścieżkę przeglądarki i sprawdzał zachowanie, którego już nie
// ma. Ten plik nie dotyka DOM (QueryClient i atrapy `queryFn`), więc modeluje
// serwer wprost - a ścieżkę przeglądarki włącza jawnym stubem `document`.
import { QueryClient, queryOptions } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RESILIENT_LOAD_BUDGET_MS,
  anyDegraded,
  loadResilient,
  resilientCacheControl,
} from "@/lib/ssr/resilientLoad";

interface Row {
  readonly id: string;
}

const EMPTY: readonly Row[] = [];

function client(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

/** Zapytanie, które nigdy się nie rozstrzyga - odwzorowuje zwis backendu. */
function hangingOptions(key: string) {
  return queryOptions({
    queryKey: ["hang", key] as const,
    queryFn: () => new Promise<readonly Row[]>(() => {}),
  });
}

function failingOptions(key: string) {
  return queryOptions({
    queryKey: ["fail", key] as const,
    queryFn: async (): Promise<readonly Row[]> => {
      throw new Error("backend down");
    },
  });
}

function okOptions(key: string, rows: readonly Row[]) {
  return queryOptions({
    queryKey: ["ok", key] as const,
    queryFn: async (): Promise<readonly Row[]> => rows,
  });
}

describe("loadResilient", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("kanarek środowiska: ten plik modeluje SERWER (brak `document`)", () => {
    // Bez tej asercji cały blok mógłby przejść w happy-dom, dowodząc czegoś
    // przeciwnego niż głosi: tam budżet jest wyłączony z definicji.
    expect(typeof document).toBe("undefined");
  });

  it("shares an absolute deadline across consecutive query phases", async () => {
    vi.useFakeTimers();
    const qc = client();
    const deadlineAt = Date.now() + 600;
    const first = loadResilient(qc, hangingOptions("first-phase"), EMPTY, {
      budgetMs: 400,
      deadlineAt,
    });
    await vi.advanceTimersByTimeAsync(400);
    expect((await first).degraded).toBe(true);
    const second = loadResilient(qc, hangingOptions("second-phase"), EMPTY, { deadlineAt });
    await vi.advanceTimersByTimeAsync(200);
    expect((await second).degraded).toBe(true);
    expect(Date.now()).toBe(deadlineAt);
  });

  it("does not start a request or wait unboundedly when the deadline expired", async () => {
    const qc = client();
    const queryFn = vi.fn(() => new Promise<readonly Row[]>(() => {}));
    const options = { queryKey: ["expired"], queryFn };
    const result = await loadResilient(qc, options, EMPTY, { deadlineAt: Date.now() - 1 });
    expect(queryFn).not.toHaveBeenCalled();
    expect(result.degraded).toBe(true);
    expect(qc.getQueryState(options.queryKey)).toMatchObject({
      status: "success",
      fetchStatus: "idle",
      dataUpdatedAt: 0,
    });
  });

  it("retains completed data even after the deadline", async () => {
    const qc = client();
    const options = okOptions("cached", EMPTY);
    qc.setQueryData(options.queryKey, EMPTY);
    expect(await loadResilient(qc, options, EMPTY, { deadlineAt: Date.now() - 1 })).toEqual({
      data: EMPTY,
      degraded: false,
    });
  });

  it("does not promote another loader's fallback into cacheable success", async () => {
    const qc = client();
    const options = okOptions("shared", EMPTY);
    qc.setQueryData(options.queryKey, EMPTY, { updatedAt: 0 });
    expect((await loadResilient(qc, options, EMPTY)).degraded).toBe(true);
  });

  it("a late response cannot overwrite the fallback already rendered", async () => {
    vi.useFakeTimers();
    const qc = client();
    let resolve: (rows: readonly Row[]) => void = () => {};
    const options = {
      queryKey: ["late"],
      queryFn: () =>
        new Promise<readonly Row[]>((done) => {
          resolve = done;
        }),
    };
    const result = loadResilient(qc, options, EMPTY, { deadlineAt: Date.now() + 600 });
    await vi.advanceTimersByTimeAsync(600);
    await result;
    resolve([{ id: "late-row" }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.getQueryData(options.queryKey)).toEqual(EMPTY);
    expect(qc.getQueryState(options.queryKey)?.fetchStatus).toBe("idle");
  });

  it("zwraca prawdziwe dane i degraded=false, gdy backend odpowiada", async () => {
    const qc = client();
    const rows: readonly Row[] = [{ id: "a" }];
    const result = await loadResilient(qc, okOptions("happy", rows), EMPTY);

    expect(result.degraded).toBe(false);
    expect(result.data).toEqual(rows);
  });

  it("degraduje zamiast rzucać, gdy zapytanie odrzuca", async () => {
    const qc = client();
    const result = await loadResilient(qc, failingOptions("err"), EMPTY);

    expect(result.degraded).toBe(true);
    expect(result.data).toEqual(EMPTY);
  });

  it("degraduje po przekroczeniu budżetu, nie czekając na zwis", async () => {
    const qc = client();
    const started = Date.now();
    const result = await loadResilient(qc, hangingOptions("slow"), EMPTY, { budgetMs: 30 });

    expect(result.degraded).toBe(true);
    // Budżet ma REALNIE ścinać oczekiwanie - inaczej watchdog SSR (5 s)
    // anulowałby zapytanie pierwszy i loader dostałby rzut.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("zasiewa fallback jako stan success, żeby useSuspenseQuery nie rzucił", async () => {
    const qc = client();
    const options = failingOptions("seed");
    await loadResilient(qc, options, EMPTY);

    const state = qc.getQueryState(options.queryKey);
    expect(state?.status).toBe("success");
    expect(state?.data).toEqual(EMPTY);
  });

  it("zasiew jest natychmiast przeterminowany (updatedAt: 0), więc klient sam się leczy", async () => {
    const qc = client();
    const options = failingOptions("stale");
    await loadResilient(qc, options, EMPTY);

    expect(qc.getQueryState(options.queryKey)?.dataUpdatedAt).toBe(0);
  });

  it("anuluje spóźniony fetch PRZED zasiewem - bez tego hydratacja rozjeżdża się z SSR", async () => {
    const qc = client();
    const cancel = vi.spyOn(qc, "cancelQueries");
    const setData = vi.spyOn(qc, "setQueryData");

    await loadResilient(qc, hangingOptions("order"), EMPTY, { budgetMs: 20 });

    expect(cancel).toHaveBeenCalled();
    expect(setData).toHaveBeenCalled();
    expect(cancel.mock.invocationCallOrder[0]!).toBeLessThan(setData.mock.invocationCallOrder[0]!);
  });

  it("nigdy nie rzuca, nawet gdy anulowanie zawiedzie", async () => {
    const qc = client();
    vi.spyOn(qc, "cancelQueries").mockRejectedValue(new Error("cancel exploded"));

    await expect(loadResilient(qc, failingOptions("cancel"), EMPTY)).resolves.toMatchObject({
      degraded: true,
    });
  });

  it("domyślny budżet jest niższy niż watchdog SSR (5 s)", () => {
    expect(RESILIENT_LOAD_BUDGET_MS).toBeLessThan(5_000);
  });
});

// ── NAWIGACJA SPA ──────────────────────────────────────────────────────────
// Defekt zamknięty przez recenzję PR #382 (P1): ten sam loader biegnie przy
// nawigacji po stronie klienta, a jego wynik jest NIEZMIENNY przez całe życie
// dopasowania trasy. Budżet 1,5 s ścinał więc zwykły, tylko powolny fetch i
// zostawiał komponentowi `degraded: true` na stałe - czytelnik oglądał
// komunikat awarii mimo danych, które dojechały sekundę później, aż do
// kolejnej nawigacji albo przeładowania.
describe("w przeglądarce budżet czasowy NIE obowiązuje", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Stub środowiska wystarcza zamiast osobnego pliku, bo `isSsrRequest()`
    // liczy `typeof document` PRZY KAŻDYM WYWOŁANIU, a nie raz przy imporcie.
    vi.stubGlobal("document", {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("kanarek środowiska: `document` istnieje", () => {
    expect(typeof document).not.toBe("undefined");
  });

  it("powolny fetch ponad budżet NIE degraduje - loader czeka na prawdziwe dane", async () => {
    vi.useFakeTimers();
    const qc = client();
    const cancel = vi.spyOn(qc, "cancelQueries");
    const setData = vi.spyOn(qc, "setQueryData");
    const rows: readonly Row[] = [{ id: "wolne-ale-prawdziwe" }];
    const options = {
      queryKey: ["spa-slow"],
      queryFn: () => new Promise<readonly Row[]>((done) => setTimeout(() => done(rows), 5_000)),
    };

    const pending = loadResilient(qc, options, EMPTY, {
      budgetMs: 30,
      deadlineAt: Date.now() + 30,
    });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await pending).toEqual({ data: rows, degraded: false });
    // Żadnego anulowania ani zasiewu: to one zamrażały fałszywą awarię.
    expect(cancel).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
    expect(qc.getQueryState(options.queryKey)?.dataUpdatedAt).toBeGreaterThan(0);
  });

  it("miniony deadline nie blokuje startu zapytania - to znacznik SERWEROWY", async () => {
    // W przeglądarce `QueryClient` żyje całą sesję, więc deadline z pierwszej
    // nawigacji byłby „miniony" dla każdej następnej. Na serwerze ta sama
    // opcja zabrania startu zapytania (test wyżej) - tu ma być bez znaczenia.
    const qc = client();
    const queryFn = vi.fn(async (): Promise<readonly Row[]> => [{ id: "spa" }]);
    const options = { queryKey: ["spa-expired"], queryFn };

    const result = await loadResilient(qc, options, EMPTY, { deadlineAt: Date.now() - 1 });

    expect(queryFn).toHaveBeenCalledOnce();
    expect(result.degraded).toBe(false);
  });

  it("BŁĄD nadal daje fallback i degraded=true", async () => {
    // Komunikat awarii PO AWARII jest prawdą - znika wyłącznie degradacja
    // z powodu czasu. Zasiew zostaje przeterminowany, więc komponent i tak
    // dociąga dane po zamontowaniu i strona sama się leczy.
    const qc = client();
    const options = failingOptions("spa-err");

    expect(await loadResilient(qc, options, EMPTY)).toEqual({ data: EMPTY, degraded: true });
    expect(qc.getQueryState(options.queryKey)).toMatchObject({
      status: "success",
      dataUpdatedAt: 0,
    });
  });
});

describe("równoległe składanie kilku zapytań", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("zachowuje typy i kolejność wyników", async () => {
    const qc = client();
    const rows: readonly Row[] = [{ id: "x" }];
    const [first, second] = await Promise.all([
      loadResilient(qc, okOptions("all-a", rows), EMPTY),
      loadResilient(qc, okOptions("all-b", EMPTY), EMPTY),
    ]);

    expect(anyDegraded(first, second)).toBe(false);
    expect(first.data).toEqual(rows);
    expect(second.data).toEqual(EMPTY);
  });

  it("degraduje tylko brakujące zapytanie, resztę oddaje prawdziwą", async () => {
    const qc = client();
    const rows: readonly Row[] = [{ id: "keep" }];
    const [ok, bad] = await Promise.all([
      loadResilient(qc, okOptions("mixed-ok", rows), EMPTY),
      loadResilient(qc, failingOptions("mixed-err"), EMPTY),
    ]);

    expect(anyDegraded(ok, bad)).toBe(true);
    expect(ok.degraded).toBe(false);
    expect(ok.data).toEqual(rows);
    expect(bad.data).toEqual(EMPTY);
  });

  it("budżety biegną współbieżnie, nie sumują się", async () => {
    const qc = client();
    const started = Date.now();
    await Promise.all([
      loadResilient(qc, hangingOptions("par-1"), EMPTY, { budgetMs: 60 }),
      loadResilient(qc, hangingOptions("par-2"), EMPTY, { budgetMs: 60 }),
      loadResilient(qc, hangingOptions("par-3"), EMPTY, { budgetMs: 60 }),
    ]);

    // Sekwencyjnie byłoby ~3x60 ms; równolegle ~60 ms. Górna granica z zapasem
    // na wolne CI, ale wciąż poniżej sumy budżetów.
    expect(Date.now() - started).toBeLessThan(150);
  });

  it("anyDegraded na pustej liście jest fałszywe (brak zapytań = render czysty)", () => {
    expect(anyDegraded()).toBe(false);
  });
});

describe("resilientCacheControl", () => {
  it("czysty render jest cache'owalny na brzegu", () => {
    const header = resilientCacheControl(false);
    expect(header).toContain("public");
    expect(header).toContain("s-maxage=");
  });

  it("zdegradowany render NIGDY nie trafia do cache'a wspólnego", () => {
    expect(resilientCacheControl(true)).toBe("private, no-store");
  });
});
