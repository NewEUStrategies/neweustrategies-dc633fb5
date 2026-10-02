// CO DOWODZI TEN PLIK
// Trzy zachowania loadera indeksu przekierowań (`redirects.server.ts`), które
// audyt wydania 11 wskazał jako niedowiedzione na poziomie TEGO modułu:
//   1. TERMIN odczytu (`REDIRECT_INDEX_BUDGET_MS = 1_500` przez
//      `settleWithinBudget` -> `degradedIndex(tenantId, "timeout")`): wisząca
//      baza kończy się NA terminie, z ostrzeżeniem właściwym dla lapsusu
//      (innym niż „index load failed"), a zejście serwuje POPRZEDNI indeks,
//      gdy jest, i pusty, gdy go nie ma - bez publikowania migawki L2,
//   2. ZIMNY izolat z NIEŚWIEŻĄ migawką L2 (`readBootstrapSnapshot` z `at`
//      sprzed TTL): odpowiedź od ręki z migawki i DOKŁADNIE JEDNO odświeżenie
//      w tle, także przy równoległych żądaniach (single-flight
//      `startIndexRefresh`),
//   3. limit 5 000 wierszy: ostrzeżenie dokładnie od progu, nie przed nim.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
//   * `src/lib/server/__tests__/serviceRolePlaneBudget.test.ts` - ten sam
//     termin dla katalogu tenantów i pierwsze przypięcie lapsusu indeksu
//     (zimny cache). Tu dochodzi gałąź CIEPŁA (poprzedni indeks), backoff
//     po lapsusie i brak migawki po zejściu.
//   * `src/lib/server/__tests__/bootstrapRouting.test.ts` - migawki L2 na
//     prawdziwym Cache API (walidacja kształtu, doba przetrwania, zimny
//     izolat po ciszy). Tu Cache API jest atrapą, bo przedmiotem dowodu jest
//     LICZBA odświeżeń przy współbieżności, a nie zapis do Cache API.
//
// Moduł jest importowany od nowa w każdym teście (`vi.resetModules`):
// `invalidateRedirectCache` celowo wyłącza odczyt migawek współdzielonych do
// końca życia izolatu, więc tylko świeży moduł odtwarza zimny izolat.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RedirectRule } from "@/lib/seo/redirects";

type Mode = "rows" | "hang" | "hold" | "error";

const state = vi.hoisted(() => ({
  mode: "rows" as Mode,
  rows: [] as RedirectRule[],
  /** Liczba odczytów tabeli `redirects` (round-tripy planu service-role). */
  reads: 0,
  limits: [] as number[],
  /** Wstrzymane odczyty (`mode: "hold"`) - test zwalnia je ręcznie. */
  held: [] as Array<() => void>,
  snapshot: null as { at: number; value: RedirectRule[]; stale: boolean } | null,
  snapshotReads: 0,
  snapshotValidator: null as ((value: unknown) => boolean) | null,
  snapshotWrites: [] as Array<{ key: string; at: number; count: number }>,
  background: [] as Array<Promise<unknown>>,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: (count: number) => {
              state.reads += 1;
              state.limits.push(count);
              const reply = { data: state.rows, error: null };
              if (state.mode === "hang") return new Promise(() => {});
              if (state.mode === "error") return Promise.reject(new Error("PostgREST unreachable"));
              if (state.mode === "hold") {
                return new Promise((resolve) => state.held.push(() => resolve(reply)));
              }
              return Promise.resolve(reply);
            },
          }),
        }),
      }),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}));

vi.mock("@/lib/http/bootstrapCache.server", () => ({
  readBootstrapSnapshot: (
    _key: string,
    _ttlMs: number,
    validate: (value: unknown) => boolean,
  ): Promise<unknown> => {
    state.snapshotReads += 1;
    state.snapshotValidator = validate;
    return Promise.resolve(state.snapshot);
  },
  writeBootstrapSnapshot: (
    key: string,
    snapshot: { at: number; value: RedirectRule[] },
  ): Promise<void> => {
    state.snapshotWrites.push({ key, at: snapshot.at, count: snapshot.value.length });
    return Promise.resolve();
  },
}));

vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>) => {
    state.background.push(work);
  },
}));

const TENANT = "t-nes";
const TTL_MS = 30_000;
const BUDGET_MS = 1_500;
const RULE_OLD: RedirectRule = {
  id: "r1",
  source_path: "/stary",
  target_path: "/nowy",
  status_code: 301,
};
const RULE_NEW: RedirectRule = {
  id: "r2",
  source_path: "/inny",
  target_path: "/cel",
  status_code: 301,
};

let warns: string[];

async function freshModule(): Promise<typeof import("@/lib/seo/redirects.server")> {
  return import("@/lib/seo/redirects.server");
}

/** Rozstrzygnięcie jako FLAGA - `await` na wiszącej obietnicy zawiesiłby przebieg. */
function watch<T>(promise: Promise<T>): { settled: () => boolean; value: () => T | undefined } {
  let done = false;
  let result: T | undefined;
  void promise.then((value) => {
    done = true;
    result = value;
  });
  return { settled: () => done, value: () => result };
}

function rules(count: number): RedirectRule[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${i}`,
    source_path: `/s${i}`,
    target_path: `/t${i}`,
    status_code: 301,
  }));
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T09:00:00Z"));
  state.mode = "rows";
  state.rows = [RULE_OLD];
  state.reads = 0;
  state.limits = [];
  state.held = [];
  state.snapshot = null;
  state.snapshotReads = 0;
  state.snapshotValidator = null;
  state.snapshotWrites = [];
  state.background = [];
  warns = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warns.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("termin odczytu indeksu (REDIRECT_INDEX_BUDGET_MS = 1 500 ms)", () => {
  it("zimny cache: wisząca baza kończy się NA terminie pustym indeksem", async () => {
    state.mode = "hang";
    const { getRedirectIndexForTenant } = await freshModule();

    const pending = watch(getRedirectIndexForTenant(TENANT));

    await vi.advanceTimersByTimeAsync(BUDGET_MS - 1);
    expect(pending.settled(), "przed terminem indeks NIE MOŻE być rozstrzygnięty").toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(pending.settled(), "po terminie indeks MUSI wrócić z zejściem").toBe(true);
    expect(pending.value()?.exact.size).toBe(0);
    expect(pending.value()?.wildcards).toHaveLength(0);
  });

  it("lapsus loguje ostrzeżenie TERMINU, a nie ścieżkę błędu bazy", async () => {
    state.mode = "hang";
    const { getRedirectIndexForTenant } = await freshModule();

    void getRedirectIndexForTenant(TENANT);
    await vi.advanceTimersByTimeAsync(BUDGET_MS + 1);

    expect(warns).toEqual([
      `[redirects] index load timed out after ${BUDGET_MS}ms (budget lapsed, no database error)`,
    ]);
  });

  it("błąd bazy loguje „index load failed” i NIE udaje lapsusu (kontrola negatywna)", async () => {
    state.mode = "error";
    const { getRedirectIndexForTenant } = await freshModule();

    await getRedirectIndexForTenant(TENANT);

    expect(warns.some((line) => line.startsWith("[redirects] index load failed:"))).toBe(true);
    expect(warns.some((line) => line.includes("timed out"))).toBe(false);
  });

  it("ciepły cache: lapsus odświeżenia serwuje POPRZEDNI indeks, nie pusty", async () => {
    const { getRedirectIndexForTenant } = await freshModule();
    expect((await getRedirectIndexForTenant(TENANT)).exact.has("/stary")).toBe(true);
    await Promise.all(state.background);
    expect(state.snapshotWrites).toHaveLength(1);

    // TTL mija, baza zawisa. SWR: stary indeks od ręki, odświeżenie w tle.
    vi.advanceTimersByTime(TTL_MS + 1_000);
    state.mode = "hang";
    state.rows = [RULE_NEW];
    expect((await getRedirectIndexForTenant(TENANT)).exact.has("/stary")).toBe(true);
    await vi.advanceTimersByTimeAsync(BUDGET_MS + 1);
    await Promise.all(state.background);

    // Zejście po terminie zapisało do cache POPRZEDNI indeks - 301-ki dalej
    // działają, zamiast zniknąć na cały kolejny TTL.
    const after = await getRedirectIndexForTenant(TENANT);
    expect(after.exact.has("/stary")).toBe(true);
    expect(after.exact.has("/inny")).toBe(false);
    expect(warns.some((line) => line.includes("index load timed out"))).toBe(true);
    // Migawka współdzielona powstaje WYŁĄCZNIE po udanym odczycie.
    expect(state.snapshotWrites).toHaveLength(1);
  });

  it("po lapsusie kolejny odczyt czeka pełny TTL (backoff), a potem się leczy", async () => {
    const { getRedirectIndexForTenant } = await freshModule();
    await getRedirectIndexForTenant(TENANT);
    vi.advanceTimersByTime(TTL_MS + 1_000);
    state.mode = "hang";
    await getRedirectIndexForTenant(TENANT);
    await vi.advanceTimersByTimeAsync(BUDGET_MS + 1);
    expect(state.reads).toBe(2);

    // Wpis zejścia ma świeże `at`: wisząca baza nie jest odpytywana przy
    // każdym żądaniu (inaczej każde dokładałoby do tła kolejne 1,5 s).
    vi.advanceTimersByTime(TTL_MS - BUDGET_MS - 100);
    await getRedirectIndexForTenant(TENANT);
    expect(state.reads).toBe(2);

    // Po TTL i z żywą bazą indeks wraca do prawdy.
    state.mode = "rows";
    state.rows = [RULE_NEW];
    vi.advanceTimersByTime(TTL_MS);
    await getRedirectIndexForTenant(TENANT);
    await Promise.all(state.background);
    expect(state.reads).toBe(3);
    expect((await getRedirectIndexForTenant(TENANT)).exact.has("/inny")).toBe(true);
  });
});

describe("zimny izolat z NIEŚWIEŻĄ migawką L2", () => {
  it("serwuje migawkę od ręki i robi DOKŁADNIE JEDNO odświeżenie dla równoległych żądań", async () => {
    state.snapshot = { at: Date.now() - (TTL_MS + 5_000), value: [RULE_OLD], stale: true };
    state.rows = [RULE_NEW];
    // Odczyt bazy WSTRZYMANY: gdyby którekolwiek żądanie na niego czekało,
    // `Promise.all` niżej nigdy by się nie rozstrzygnął.
    state.mode = "hold";
    const { getRedirectIndexForTenant } = await freshModule();

    const indexes = await Promise.all([
      getRedirectIndexForTenant(TENANT),
      getRedirectIndexForTenant(TENANT),
      getRedirectIndexForTenant(TENANT),
    ]);

    for (const index of indexes) expect(index.exact.has("/stary")).toBe(true);
    // Jedna migawka na zimny izolat (single-flight ładowania) i jedno
    // odświeżenie w tle, nie trzy.
    expect(state.snapshotReads).toBe(1);
    await vi.waitFor(() => expect(state.reads).toBe(1));

    // Czwarte żądanie w trakcie odświeżenia też się do niego dosiada.
    expect((await getRedirectIndexForTenant(TENANT)).exact.has("/stary")).toBe(true);
    expect(state.reads).toBe(1);

    for (const release of state.held) release();
    await Promise.all(state.background);

    const refreshed = await getRedirectIndexForTenant(TENANT);
    expect(refreshed.exact.has("/inny")).toBe(true);
    expect(refreshed.exact.has("/stary")).toBe(false);
    expect(state.reads).toBe(1);
    // Odświeżona migawka wraca do kolonii z NOWYM `at`.
    expect(state.snapshotWrites).toEqual([
      { key: `redirects:${TENANT}`, at: Date.now(), count: 1 },
    ]);
  });

  it("ŚWIEŻA migawka (przed TTL) nie uruchamia żadnego odczytu bazy (kontrola negatywna)", async () => {
    state.snapshot = { at: Date.now() - 1_000, value: [RULE_OLD], stale: false };
    const { getRedirectIndexForTenant } = await freshModule();

    await Promise.all([getRedirectIndexForTenant(TENANT), getRedirectIndexForTenant(TENANT)]);
    await Promise.all(state.background);

    expect(state.reads).toBe(0);
    expect(state.snapshotWrites).toHaveLength(0);
  });

  it("brak migawki: zimny izolat blokuje JEDEN raz dla równoległych żądań", async () => {
    const { getRedirectIndexForTenant } = await freshModule();

    const [a, b] = await Promise.all([
      getRedirectIndexForTenant(TENANT),
      getRedirectIndexForTenant(TENANT),
    ]);

    expect(a.exact.has("/stary")).toBe(true);
    expect(b).toBe(a);
    expect(state.reads).toBe(1);
  });
});

describe("limit 5 000 wierszy odczytu", () => {
  it("osiągnięcie limitu loguje ostrzeżenie z tenantem", async () => {
    state.rows = rules(5000);
    const { getRedirectIndexForTenant } = await freshModule();

    const index = await getRedirectIndexForTenant(TENANT);

    expect(index.exact.size).toBe(5000);
    expect(state.limits).toEqual([5000]);
    expect(warns).toEqual([
      `[redirects] rule set hit the 5000-row read limit for tenant ${TENANT} - rules beyond it are SILENTLY not served`,
    ]);
  });

  it("4 999 wierszy NIE loguje niczego (próg, nie przybliżenie)", async () => {
    state.rows = rules(4999);
    const { getRedirectIndexForTenant } = await freshModule();

    await getRedirectIndexForTenant(TENANT);

    expect(warns).toEqual([]);
  });

  it("walidator migawki przyjmuje dokładnie limit i odrzuca wiersz ponad nim", async () => {
    const { getRedirectIndexForTenant } = await freshModule();
    await getRedirectIndexForTenant(TENANT);

    // Migawka z pełnym limitem MUSI wracać - inaczej najwięksi tenanci
    // płaciliby blokujący odczyt przy każdym zimnym izolacie.
    expect(state.snapshotValidator?.(rules(5000))).toBe(true);
    expect(state.snapshotValidator?.(rules(5001))).toBe(false);
  });
});

describe("współdzielony import klienta service-role", () => {
  afterEach(() => {
    vi.doUnmock("@/integrations/supabase/client.server");
  });

  it("nieudany import NIE jest zapamiętywany - następna próba importuje od nowa", async () => {
    // Pierwszy import modułu klienta wybucha (np. Workers bez sekretu w
    // trakcie rolloutu). Gdyby obietnica importu została w pamięci modułu,
    // izolat już nigdy nie odczytałby reguł, choć sekret wrócił.
    vi.doMock("@/integrations/supabase/client.server", () => {
      throw new Error("import klienta service-role nieudany");
    });
    const { getRedirectIndexForTenant } = await freshModule();
    expect((await getRedirectIndexForTenant(TENANT)).exact.size).toBe(0);
    expect(warns.some((line) => line.startsWith("[redirects] index load failed:"))).toBe(true);
    expect(state.reads).toBe(0);

    vi.doUnmock("@/integrations/supabase/client.server");
    vi.doMock("@/integrations/supabase/client.server", () => ({
      supabaseAdmin: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => {
                  state.reads += 1;
                  return Promise.resolve({ data: [RULE_NEW], error: null });
                },
              }),
            }),
          }),
        }),
      },
    }));
    vi.advanceTimersByTime(TTL_MS + 1);
    await getRedirectIndexForTenant(TENANT);
    await Promise.all(state.background);

    expect(state.reads).toBe(1);
    expect((await getRedirectIndexForTenant(TENANT)).exact.has("/inny")).toBe(true);
  });
});
