// @vitest-environment node
//
// edgeTtlCache scopes every entry by the request host (re-audit N2): an entry
// warmed while rendering tenant A's domain must never be served on tenant
// B's domain. Node environment = no window, so the server code path runs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearEdgeTtlCache, edgeTtlCache, invalidateEdgeTtlCache } from "@/lib/ssrCache";

const state = vi.hoisted(() => ({
  host: null as string | null,
  /** Prace zarejestrowane przez `completeAfterResponse` - patrz niżej. */
  afterResponse: [] as unknown[],
  /** Budzik dla `waitForAfterResponse()`; ustawiany na czas oczekiwania. */
  notify: null as null | (() => void),
}));

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve(state.host),
  requestPublicHost: () => state.host,
}));

// ── DLACZEGO TEN MOCK USUWA NIEDETERMINIZM POKRYCIA ────────────────────────
//
// ZMIERZONE (2026-09-03, dwa kolejne przebiegi SAMEGO tego pliku, ten sam
// HEAD, `--coverage.reporter=json-summary`):
//   przebieg 1: linie 48/51  funkcje  9/12  gałęzie 28/32  instrukcje 52/58
//   przebieg 2: linie 49/51  funkcje 10/12  gałęzie 28/32  instrukcje 53/58
// Różnica to DOKŁADNIE jedna funkcja i jedna linia, za każdym razem te same:
// strzałka `.then((m) => m.runAfterResponse(work))` w `completeAfterResponse`
// (`src/lib/ssrCache.ts:64`).
//
// MECHANIZM. `completeAfterResponse` jest FIRE-AND-FORGET z premedytacją
// (`void import(...)`) - i musi być, bo ten plik jest współdzielony z klientem,
// a statyczna krawędź wciągnęłaby moduł `.server` do chunku wejściowego
// przeglądarki. Skutkiem ubocznym jest jednak WYŚCIG: czy łańcuch mikrozadań
// importu dynamicznego zdąży się rozstrzygnąć, ZANIM plik testowy się
// zakończy. Zdąży albo nie zdąży - i to jest cała treść „niedeterministycznego
// pokrycia". NIE JEST to TTL ani czekanie na zegar (ten plik od początku
// używa `vi.useFakeTimers()` i nigdy nie czekał na prawdziwy czas) - zlecenie
// zakładało zegar, a przyczyna jest inna i zapisuję to wprost.
//
// PODMIANA MODUŁU sprawia, że import rozwiązuje się Z REJESTRU MODUŁÓW
// vitesta, a `waitForAfterResponse()` niżej daje testowi PUNKT ZACZEPIENIA:
// czeka na FAKT wywołania, nie na upływ czasu. Strzałka wykonuje się więc
// w KAŻDYM przebiegu, a nie w części z nich.
//
// I PRZY OKAZJI - to nie jest zaślepka, a przyrząd: rejestracja pracy w tle
// przez `runAfterResponse` JEST kontacktem produkcyjnym. Na Workers praca
// pozostawiona jako `void promise` bywa ucinana w połowie, gdy workerd ubije
// izolat po domknięciu odpowiedzi (patrz nagłówek `waitUntil.server.ts`), więc
// „odświeżenie w tle wystartowało" i „odświeżenie w tle się dokończy" to dwa
// różne zdania. Dotąd nie sprawdzało tego nic.
vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: unknown) => {
    state.afterResponse.push(work);
    state.notify?.();
  },
}));

/**
 * Czeka na REJESTRACJĘ pracy w tle - deterministycznie, bo budzi ją samo
 * wywołanie atrapy, a nie zegar. Gdyby rejestracja nie nastąpiła, test padnie
 * na `testTimeout` z widocznym komunikatem, a nie przemilczy braku.
 */
function waitForAfterResponse(): Promise<void> {
  if (state.afterResponse.length > 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    state.notify = () => {
      state.notify = null;
      resolve();
    };
  });
}

beforeEach(() => {
  clearEdgeTtlCache();
  state.host = null;
  state.afterResponse.length = 0;
  state.notify = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("edgeTtlCache host scoping", () => {
  it("caches within the TTL for one host", async () => {
    state.host = "a.example";
    const fetcher = vi.fn().mockResolvedValue("data-a");
    await expect(edgeTtlCache("k", 60_000, fetcher)).resolves.toBe("data-a");
    await expect(edgeTtlCache("k", 60_000, fetcher)).resolves.toBe("data-a");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never serves one host's entry to another host (same key)", async () => {
    state.host = "a.example";
    await edgeTtlCache("home", 60_000, () => Promise.resolve("tenant-a-home"));

    state.host = "b.example";
    const forB = await edgeTtlCache("home", 60_000, () => Promise.resolve("tenant-b-home"));
    expect(forB).toBe("tenant-b-home");

    state.host = "a.example";
    const backOnA = await edgeTtlCache("home", 60_000, () => Promise.resolve("MISS"));
    expect(backOnA).toBe("tenant-a-home");
  });

  it("requests without a host share the no-host scope, separate from real hosts", async () => {
    state.host = null;
    await edgeTtlCache("k", 60_000, () => Promise.resolve("no-host-data"));

    state.host = "a.example";
    const forA = await edgeTtlCache("k", 60_000, () => Promise.resolve("a-data"));
    expect(forA).toBe("a-data");

    state.host = null;
    await expect(edgeTtlCache("k", 60_000, () => Promise.resolve("MISS"))).resolves.toBe(
      "no-host-data",
    );
  });

  it("serves stale within the serve-stale window and refreshes in the background", async () => {
    vi.useFakeTimers();
    state.host = "a.example";
    await edgeTtlCache("k", 1_000, () => Promise.resolve("v1"));
    vi.advanceTimersByTime(1_500);
    // Stale hit (po TTL, w oknie 5x TTL): nieświeża wartość wraca NATYCHMIAST,
    // a odświeżenie startuje w tle - render SSR nie blokuje się na fetchu.
    let release!: (v: string) => void;
    const gate = new Promise<string>((r) => (release = r));
    const refresher = vi.fn().mockReturnValue(gate);
    await expect(edgeTtlCache("k", 1_000, refresher)).resolves.toBe("v1");
    expect(refresher).toHaveBeenCalledTimes(1);
    // ODŚWIEŻENIE W TLE MUSI BYĆ ZAREJESTROWANE „ZA ODPOWIEDZIĄ", nie tylko
    // wystartowane: na Workers `void promise` bywa ucinane, gdy workerd ubije
    // izolat po domknięciu odpowiedzi. To jest asercja na kontrakt, a
    // jednocześnie punkt, który zdejmuje wyścig z pomiaru pokrycia tego pliku
    // (mechanizm rozpisany przy `vi.mock` na górze).
    await waitForAfterResponse();
    expect(state.afterResponse).toHaveLength(1);
    // Drugi stale-hit w trakcie TRWAJĄCEGO odświeżania nie startuje drugiego
    // fetcha i nadal serwuje nieświeżą wartość.
    const dup = vi.fn().mockResolvedValue("v2-dup");
    await expect(edgeTtlCache("k", 1_000, dup)).resolves.toBe("v1");
    expect(dup).not.toHaveBeenCalled();
    // Po rozstrzygnięciu odświeżenia (mikrotaski) kolejny odczyt widzi v2.
    release("v2");
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await expect(edgeTtlCache("k", 1_000, () => Promise.resolve("MISS"))).resolves.toBe("v2");
  });

  it("hard-expires entries beyond the serve-stale window (blocking refetch)", async () => {
    vi.useFakeTimers();
    state.host = "a.example";
    await edgeTtlCache("k", 1_000, () => Promise.resolve("v1"));
    // Powyżej STALE_FACTOR (5x TTL) wpis jest twardym missem.
    vi.advanceTimersByTime(5_500);
    await expect(edgeTtlCache("k", 1_000, () => Promise.resolve("v2"))).resolves.toBe("v2");
  });

  it("dedupes concurrent cold misses into a single fetch (single-flight)", async () => {
    state.host = "a.example";
    let release!: (v: string) => void;
    const gate = new Promise<string>((r) => (release = r));
    const fetcher = vi.fn().mockReturnValue(gate);
    const p1 = edgeTtlCache("sf", 60_000, fetcher);
    const p2 = edgeTtlCache("sf", 60_000, fetcher);
    release("shared");
    await expect(p1).resolves.toBe("shared");
    await expect(p2).resolves.toBe("shared");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("a read after invalidation does not join a pre-invalidation in-flight fetch", async () => {
    state.host = "a.example";
    let releaseOld!: (v: string) => void;
    const oldGate = new Promise<string>((r) => (releaseOld = r));
    const preInvalidation = edgeTtlCache("inv2", 60_000, () => oldGate);
    await invalidateEdgeTtlCache("inv2");
    // Odczyt PO invalidacji startuje świeży fetch zamiast dołączyć do lotu
    // sprzed niej - inaczej dostałby sprzed-operatorskie dane.
    const fresh = vi.fn().mockResolvedValue("fresh");
    const postInvalidation = edgeTtlCache("inv2", 60_000, fresh);
    releaseOld("pre-invalidation");
    await expect(preInvalidation).resolves.toBe("pre-invalidation");
    await expect(postInvalidation).resolves.toBe("fresh");
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("a fetch started before invalidation cannot store pre-invalidation data", async () => {
    state.host = "a.example";
    let release!: (v: string) => void;
    const gate = new Promise<string>((r) => (release = r));
    const p = edgeTtlCache("inv", 60_000, () => gate);
    // Operator unieważnia wpis, gdy fetch jeszcze wisi w locie.
    await invalidateEdgeTtlCache("inv");
    release("pre-invalidation");
    // Wołający dostaje swoje dane...
    await expect(p).resolves.toBe("pre-invalidation");
    // ...ale magazyn NIE został zatruty: kolejny odczyt fetchuje od nowa.
    const refetch = vi.fn().mockResolvedValue("fresh");
    await expect(edgeTtlCache("inv", 60_000, refetch)).resolves.toBe("fresh");
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("bounds the store and evicts the oldest entries beyond the cap (isolate-OOM guard)", async () => {
    state.host = "a.example";
    const MAX = 500;
    // Fill past the cap with distinct keys (the unbounded-growth scenario:
    // many hosts x per-slug keys over an isolate's lifetime).
    for (let i = 0; i < MAX + 50; i++) {
      await edgeTtlCache(`k${i}`, 60_000, () => Promise.resolve(`v${i}`));
    }

    // The oldest key must have been evicted -> a re-fetch misses and re-runs.
    const oldest = vi.fn().mockResolvedValue("k0-refetched");
    await expect(edgeTtlCache("k0", 60_000, oldest)).resolves.toBe("k0-refetched");
    expect(oldest).toHaveBeenCalledTimes(1);

    // A recent key is still cached -> fetcher never runs.
    const recent = vi.fn().mockResolvedValue("MISS");
    await expect(edgeTtlCache(`k${MAX + 49}`, 60_000, recent)).resolves.toBe(`v${MAX + 49}`);
    expect(recent).not.toHaveBeenCalled();
  });
});
