// @vitest-environment node
//
// Warstwa L2 `edgeTtlCache` (audyt CWV 2026-09-20, F03 / plan 1.3): migawka w
// Cache API per-colo pod L1 izolatu. Ten plik testuje POLITYKĘ w `ssrCache.ts`
// (kolejność na chybieniu, termin odczytu, biała lista, limit rozmiaru,
// obejście po unieważnieniu) na wstrzykniętym adapterze; adresowanie i I/O
// prawdziwego adaptera sprawdza `ssrCacheL2.server.test.ts`. Node environment
// = brak `window`, więc biegnie ścieżka serwerowa.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EDGE_TTL_CHROME_MAX_AGE_MS,
  EDGE_TTL_L2_MAX_BYTES,
  EDGE_TTL_L2_READ_TIMEOUT_MS,
  clearEdgeTtlCache,
  edgeTtlCache,
  invalidateEdgeTtlCache,
  setEdgeTtlL2Adapter,
} from "@/lib/ssrCache";
import type { EdgeTtlL2Adapter, EdgeTtlL2Snapshot } from "@/lib/ssrCacheL2.server";

const state = vi.hoisted(() => ({
  host: null as string | null,
  /** Prace zarejestrowane „za odpowiedzią" przez `completeAfterResponse`. */
  afterResponse: [] as Promise<unknown>[],
}));

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve(state.host),
  requestPublicHost: () => state.host,
}));

// Rejestracja pracy w tle przez `runAfterResponse` JEST kontraktem
// produkcyjnym (na Workers `void promise` bywa ucinane po domknięciu
// odpowiedzi) - atrapa zbiera obietnice, a `settleBackground()` je domyka.
vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>) => {
    state.afterResponse.push(work);
  },
}));

/**
 * Domyka pracę w tle. `completeAfterResponse` rejestruje ją przez import
 * dynamiczny (mikrozadania), więc najpierw kilka obrotów pętli, potem
 * `await` na zebranych obietnicach - deterministycznie, bez zegara.
 */
async function settleBackground(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await Promise.all(state.afterResponse.map((p) => p.catch(() => undefined)));
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function snapshot<T>(value: T, ageMs: number, ttlMs: number): EdgeTtlL2Snapshot<T> {
  return { value, at: Date.now() - ageMs, stale: ageMs >= ttlMs };
}

/** Atrapa adaptera: sterowany odczyt, rejestrowany zapis. */
function fakeAdapter(read: EdgeTtlL2Adapter["read"] = async () => null) {
  const adapter = {
    enabled: vi.fn(() => true),
    read: vi.fn(read),
    write: vi.fn<EdgeTtlL2Adapter["write"]>(async () => undefined),
  };
  setEdgeTtlL2Adapter(adapter);
  return adapter;
}

const TTL = 60_000;
const KEY = "site_settings_public:all";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2099-06-15T12:00:00Z"));
  clearEdgeTtlCache();
  state.host = "a.example";
  state.afterResponse.length = 0;
});

afterEach(() => {
  setEdgeTtlL2Adapter(undefined);
  vi.useRealTimers();
});

describe("edgeTtlCache L2: kolejność na chybieniu L1", () => {
  it("świeża migawka wraca bez fn() i zasila L1 (drugi odczyt nie dotyka L2)", async () => {
    const l2 = fakeAdapter(async () => snapshot({ site_title: "z kolonii" }, 10_000, TTL));
    const fetcher = vi.fn().mockResolvedValue({ site_title: "z bazy" });

    await expect(edgeTtlCache(KEY, TTL, fetcher)).resolves.toEqual({ site_title: "z kolonii" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(l2.read).toHaveBeenCalledTimes(1);
    expect(l2.read).toHaveBeenCalledWith("a.example", KEY, TTL, EDGE_TTL_CHROME_MAX_AGE_MS);
    // Wartość z migawki NIE wraca do L2 - nie ma czego odświeżać.
    expect(l2.write).not.toHaveBeenCalled();

    await expect(edgeTtlCache(KEY, TTL, fetcher)).resolves.toEqual({ site_title: "z kolonii" });
    expect(l2.read).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("L1 zasilone z migawki liczy świeżość od ORYGINALNEGO `at` migawki", async () => {
    // Migawka ma 50 s; po kolejnych 15 s wpis L1 musi być NIEŚWIEŻY (65 s),
    // a nie świeży „od odczytu z kolonii" - inaczej wartość zyskiwałaby drugie
    // 60 s życia przy każdym przejściu przez L2.
    fakeAdapter(async () => snapshot("v-l2", 50_000, TTL));
    await edgeTtlCache(KEY, TTL, () => Promise.resolve("MISS"));
    vi.advanceTimersByTime(15_000);
    const refresher = vi.fn().mockResolvedValue("v-fresh");
    // Stale-hit L1: nieświeża wartość od ręki + odświeżenie w tle.
    await expect(edgeTtlCache(KEY, TTL, refresher)).resolves.toBe("v-l2");
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it("nieświeża migawka wraca NATYCHMIAST, a fn() odświeża L1 i L2 w tle", async () => {
    const l2 = fakeAdapter(async () => snapshot("v-stale", 90_000, TTL));
    let release!: (v: string) => void;
    const gate = new Promise<string>((r) => (release = r));
    const fetcher = vi.fn().mockReturnValue(gate);

    // Odpowiedź nie czeka na fetcher (obietnica wisi), ale fetcher już wystartował.
    await expect(edgeTtlCache(KEY, TTL, fetcher)).resolves.toBe("v-stale");
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Drugi odczyt w trakcie odświeżania: nadal nieświeża wartość, bez drugiego fn().
    const dup = vi.fn().mockResolvedValue("dup");
    await expect(edgeTtlCache(KEY, TTL, dup)).resolves.toBe("v-stale");
    expect(dup).not.toHaveBeenCalled();

    release("v-fresh");
    await settleBackground();
    expect(state.afterResponse.length).toBeGreaterThanOrEqual(1);
    // L1 ma świeżą wartość, L2 dostało zapis z tym samym `at` i oknem 5 x TTL.
    await expect(edgeTtlCache(KEY, TTL, () => Promise.resolve("MISS"))).resolves.toBe("v-fresh");
    expect(l2.write).toHaveBeenCalledTimes(1);
    expect(l2.write).toHaveBeenCalledWith(
      "a.example",
      KEY,
      { at: Date.now(), value: "v-fresh" },
      TTL,
      EDGE_TTL_CHROME_MAX_AGE_MS,
    );
  });

  it("brak migawki: fn() blokująco, L1 od razu, L2 za odpowiedzią", async () => {
    const l2 = fakeAdapter(async () => null);
    const fetcher = vi.fn().mockResolvedValue(["post-1"]);
    await expect(edgeTtlCache("trending_posts:7:10", TTL, fetcher)).resolves.toEqual(["post-1"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await settleBackground();
    expect(l2.write).toHaveBeenCalledWith(
      "a.example",
      "trending_posts:7:10",
      { at: Date.now(), value: ["post-1"] },
      TTL,
      TTL * 5,
    );
    // Zapis L2 poszedł „za odpowiedzią", nie w ścieżce odpowiedzi.
    expect(state.afterResponse).toHaveLength(1);
  });

  it("równoległe chybienia dzielą JEDEN odczyt L2 i jeden fetch (single-flight)", async () => {
    let releaseRead!: (v: null) => void;
    const l2 = fakeAdapter(() => new Promise<null>((r) => (releaseRead = r)));
    const fetcher = vi.fn().mockResolvedValue("shared");
    const p1 = edgeTtlCache(KEY, TTL, fetcher);
    const p2 = edgeTtlCache(KEY, TTL, fetcher);
    // Lot dochodzi do odczytu L2 po kilku mikrozadaniach (host, adapter) -
    // czekamy na FAKT wywołania, nie na zegar.
    for (let i = 0; i < 50 && l2.read.mock.calls.length === 0; i++) await Promise.resolve();
    expect(l2.read).toHaveBeenCalledTimes(1);
    releaseRead(null);
    await expect(p1).resolves.toBe("shared");
    await expect(p2).resolves.toBe("shared");
    expect(l2.read).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("edgeTtlCache L2: termin odczytu i awarie", () => {
  it("zwlekające Cache API nie blokuje fali głównej: po terminie idzie fn()", async () => {
    // Odczyt, który NIGDY się nie rozstrzyga - symulacja zwisu Cache API.
    const l2 = fakeAdapter(() => new Promise(() => undefined));
    const fetcher = vi.fn().mockResolvedValue("z bazy");
    const pending = edgeTtlCache(KEY, TTL, fetcher);
    await vi.advanceTimersByTimeAsync(EDGE_TTL_L2_READ_TIMEOUT_MS - 1);
    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe("z bazy");
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Świeży wynik i tak trafia do L2 - kolonia nie zostaje bez migawki.
    await settleBackground();
    expect(l2.write).toHaveBeenCalledTimes(1);
  });

  it("odrzucony odczyt L2 = chybienie, fn() biegnie normalnie", async () => {
    fakeAdapter(() => Promise.reject(new Error("cache offline")));
    const fetcher = vi.fn().mockResolvedValue("z bazy");
    await expect(edgeTtlCache(KEY, TTL, fetcher)).resolves.toBe("z bazy");
  });

  it("wyłączony adapter (brak Cache API) = no-op: bez odczytu i bez zapisu", async () => {
    const l2 = fakeAdapter(async () => snapshot("nigdy", 0, TTL));
    l2.enabled.mockReturnValue(false);
    const fetcher = vi.fn().mockResolvedValue("z bazy");
    await expect(edgeTtlCache(KEY, TTL, fetcher)).resolves.toBe("z bazy");
    await settleBackground();
    expect(l2.read).not.toHaveBeenCalled();
    expect(l2.write).not.toHaveBeenCalled();
    // Bez adaptera w ogóle (klient, vitest bez wstrzyknięcia) - to samo.
    setEdgeTtlL2Adapter(null);
    clearEdgeTtlCache();
    await expect(edgeTtlCache(KEY, TTL, fetcher)).resolves.toBe("z bazy");
  });

  it("błąd fn() nie zapisuje niczego do L2 i propaguje jak dotąd", async () => {
    const l2 = fakeAdapter(async () => null);
    await expect(edgeTtlCache(KEY, TTL, () => Promise.reject(new Error("db")))).rejects.toThrow(
      "db",
    );
    await settleBackground();
    expect(l2.write).not.toHaveBeenCalled();
  });
});

describe("edgeTtlCache L2: biała lista i wartości niecache'owalne", () => {
  it("klucz spoza białej listy nie dotyka L2 (ani odczyt, ani zapis)", async () => {
    const l2 = fakeAdapter(async () => snapshot("nigdy", 0, TTL));
    const fetcher = vi.fn().mockResolvedValue({ amount: 1 });
    await expect(edgeTtlCache("donations:config", TTL, fetcher)).resolves.toEqual({ amount: 1 });
    await settleBackground();
    expect(l2.read).not.toHaveBeenCalled();
    expect(l2.write).not.toHaveBeenCalled();
  });

  it("opcja `l2` nadpisuje białą listę w obie strony", async () => {
    const l2 = fakeAdapter(async () => snapshot("z kolonii", 0, TTL));
    // Klucz spoza listy z jawnym opt-in czyta L2...
    await expect(
      edgeTtlCache("archive-layout:post", TTL, () => Promise.resolve("MISS"), { l2: true }),
    ).resolves.toBe("z kolonii");
    // ...a klucz z listy z jawnym opt-out omija L2.
    const fetcher = vi.fn().mockResolvedValue("z bazy");
    await expect(edgeTtlCache(KEY, TTL, fetcher, { l2: false })).resolves.toBe("z bazy");
    expect(l2.read).toHaveBeenCalledTimes(1);
  });

  it.each([null, undefined])("nie zapisuje do L2 wartości %s (L1 nadal ją trzyma)", async (v) => {
    const l2 = fakeAdapter(async () => null);
    const fetcher = vi.fn().mockResolvedValue(v);
    await expect(edgeTtlCache("public:resolved:brak", TTL, fetcher)).resolves.toBe(v);
    await settleBackground();
    expect(l2.write).not.toHaveBeenCalled();
    // L1 dalej buforuje „nie znaleziono" per izolat - fetcher nie biegnie drugi raz.
    await edgeTtlCache("public:resolved:brak", TTL, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("nie zapisuje do L2 wartości większej niż EDGE_TTL_L2_MAX_BYTES po serializacji", async () => {
    const l2 = fakeAdapter(async () => null);
    const huge = { html: "x".repeat(EDGE_TTL_L2_MAX_BYTES) };
    await edgeTtlCache("public:resolved:duzy", TTL, () => Promise.resolve(huge));
    const fitting = { html: "x".repeat(EDGE_TTL_L2_MAX_BYTES - 32) };
    await edgeTtlCache("public:resolved:maly", TTL, () => Promise.resolve(fitting));
    await settleBackground();
    expect(l2.write).toHaveBeenCalledTimes(1);
    expect(l2.write.mock.calls[0][1]).toBe("public:resolved:maly");
  });

  it("nie zapisuje do L2 wartości nieserializowalnej (cykl)", async () => {
    const l2 = fakeAdapter(async () => null);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    await edgeTtlCache("public:home-page", TTL, () => Promise.resolve(cyclic));
    await settleBackground();
    expect(l2.write).not.toHaveBeenCalled();
  });
});

describe("edgeTtlCache L2: unieważnienie operatora", () => {
  it("po invalidateEdgeTtlCache najbliższe chybienie omija migawkę i nadpisuje ją świeżym wynikiem", async () => {
    const l2 = fakeAdapter(async () => snapshot("sprzed zapisu", 1_000, TTL));
    await expect(edgeTtlCache(KEY, TTL, () => Promise.resolve("MISS"))).resolves.toBe(
      "sprzed zapisu",
    );
    await invalidateEdgeTtlCache(KEY);
    // Bez obejścia ten odczyt wciągnąłby z L2 tę samą wartość sprzed zapisu.
    const fetcher = vi.fn().mockResolvedValue("po zapisie");
    await expect(edgeTtlCache(KEY, TTL, fetcher)).resolves.toBe("po zapisie");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(l2.read).toHaveBeenCalledTimes(1);
    await settleBackground();
    expect(l2.write).toHaveBeenCalledWith(
      "a.example",
      KEY,
      { at: Date.now(), value: "po zapisie" },
      TTL,
      EDGE_TTL_CHROME_MAX_AGE_MS,
    );
    // Obejście jest jednorazowe: po twardym wygaśnięciu L1 migawka znów działa.
    vi.advanceTimersByTime(EDGE_TTL_CHROME_MAX_AGE_MS + 1);
    await expect(edgeTtlCache(KEY, TTL, () => Promise.resolve("MISS"))).resolves.toBe(
      "sprzed zapisu",
    );
    expect(l2.read).toHaveBeenCalledTimes(2);
  });

  it("migawka odczytana w trakcie unieważnienia nie zatruwa L1", async () => {
    let releaseRead!: (v: EdgeTtlL2Snapshot<string>) => void;
    fakeAdapter(() => new Promise<EdgeTtlL2Snapshot<string>>((r) => (releaseRead = r)));
    const p = edgeTtlCache(KEY, TTL, () => Promise.resolve("MISS"));
    await Promise.resolve();
    await invalidateEdgeTtlCache(KEY);
    releaseRead(snapshot("stara", 0, TTL));
    await expect(p).resolves.toBe("stara");
    // Strażnik generacji odrzucił zapis L1 - kolejny odczyt fetchuje od nowa.
    setEdgeTtlL2Adapter(null);
    const refetch = vi.fn().mockResolvedValue("nowa");
    await expect(edgeTtlCache(KEY, TTL, refetch)).resolves.toBe("nowa");
  });
});

describe("edgeTtlCache L2: zakres hosta", () => {
  it("klucz L2 niesie host żądania, a bez hosta zakres no-host", async () => {
    const l2 = fakeAdapter(async () => null);
    await edgeTtlCache("menu-with-items:main", TTL, () => Promise.resolve({ key: "main" }));
    state.host = null;
    await edgeTtlCache("menu-with-items:main", TTL, () => Promise.resolve({ key: "main" }));
    expect(l2.read.mock.calls.map((c) => c[0])).toEqual(["a.example", "no-host"]);
  });
});
