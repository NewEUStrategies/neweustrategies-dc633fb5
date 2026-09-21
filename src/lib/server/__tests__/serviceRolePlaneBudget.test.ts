// TERMIN PŁASZCZYZNY ROLI SERWISOWEJ PRZED ROUTEREM (punkt A9 zlecenia
// `docs/PROMPT_SSR_PIERWSZE_WCZYTANIE.md` - pozycja nazwana tam BLOKUJĄCĄ).
//
// CO DOKŁADNIE DOWODZI TEN PLIK I DLACZEGO POKRYCIE GO NIE WYKRYŁO.
// `redirects.server.ts` miał 63/63 linii i 11/11 funkcji, `tenant.server.ts`
// 68/70 i 17/17 - obydwa po 100% na funkcjach. Brakowało nie testu; brakowało
// TERMINU. Oba round-tripy rolą serwisową biegły PRZED routerem i przed
// `documentCacheMiddleware` (pozycja 10 w `requestMiddleware`), a ich jedyną
// obroną był `try/catch`, który broni przed BŁĘDEM, nie przed POWOLNOŚCIĄ:
// zawieszone połączenie nie rzuca, ono czeka - i czeka, zanim cache dokumentów
// zdąży odpowiedzieć, co przewraca całą logikę „HIT to mikrosekundy".
//
// KSZTAŁT KONTROLI NEGATYWNEJ, wprost, bo to jest jedyne, co czyni ten plik
// dowodem, a nie deklaracją: atrapa `supabaseAdmin` NIGDY nie rozstrzyga.
// Każdy przypadek najpierw sprawdza, że tuż PRZED terminem obietnica jeszcze
// nie jest rozstrzygnięta (czyli że termin nie jest zerem i nie mierzymy
// natychmiastowego zejścia), a potem że TUŻ PO terminie już jest. Po zdjęciu
// `settleWithinBudget` z kodu produkcyjnego druga asercja zapala się na
// czerwono - bez zawieszania przebiegu, bo zegar jest atrapą.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TENANT_DIRECTORY_BUDGET_MS,
  getTenantDirectory,
  invalidateTenantDirectoryCache,
  resolveTenantForHost,
} from "@/lib/server/tenant.server";
import { getRedirectIndexForTenant, invalidateRedirectCache } from "@/lib/seo/redirects.server";

/**
 * Sterowanie atrapą roli serwisowej. `mode`:
 *   * `rows`    - zapytanie rozstrzyga się wierszami (kontrola pozytywna),
 *   * `hang`    - NIGDY nie rozstrzyga (to jest cały sens tego pliku),
 *   * `error`   - odrzuca, czyli gałąź, którą repozytorium miało już wcześniej.
 */
const state = vi.hoisted(() => ({
  mode: "rows" as "rows" | "hang" | "error",
  tenants: [] as Array<{ id: string; slug: string; domain: string | null; is_default: boolean }>,
  redirects: [] as Array<{
    id: string;
    source_path: string;
    target_path: string;
    status_code: number;
  }>,
}));

function respond(rows: unknown[]): Promise<{ data: unknown[]; error: null }> {
  if (state.mode === "hang") return new Promise(() => {});
  if (state.mode === "error") return Promise.reject(new Error("PostgREST unreachable"));
  return Promise.resolve({ data: rows, error: null });
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () =>
        table === "tenants"
          ? { limit: () => respond(state.tenants) }
          : {
              eq: () => ({
                eq: () => ({ limit: () => respond(state.redirects) }),
              }),
            },
    }),
  },
}));

const NES = { id: "t-nes", slug: "nes", domain: "nes.example", is_default: true };
const RULE = { id: "r1", source_path: "/stary", target_path: "/nowy", status_code: 301 };

/**
 * Rozstrzygnięcie obietnicy jako obserwowalna FLAGA, a nie `await`. `await` na
 * obietnicy, która nigdy nie rozstrzyga, zawiesiłby przebieg zamiast go oblać -
 * a test, który wisi, nie jest kontrolą negatywną, tylko awarią CI.
 */
function watch<T>(promise: Promise<T>): { settled: () => boolean; value: () => T | undefined } {
  let done = false;
  let result: T | undefined;
  void promise.then((value) => {
    done = true;
    result = value;
  });
  return { settled: () => done, value: () => result };
}

let warns: string[];

beforeEach(() => {
  invalidateTenantDirectoryCache();
  invalidateRedirectCache();
  state.mode = "rows";
  state.tenants = [NES];
  state.redirects = [RULE];
  warns = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warns.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("katalog tenantów - termin round-tripu roli serwisowej", () => {
  it("zawieszona baza rozstrzyga się NA terminie, nie nigdy (kontrola negatywna terminu)", async () => {
    vi.useFakeTimers();
    state.mode = "hang";

    const pending = watch(getTenantDirectory());

    await vi.advanceTimersByTimeAsync(TENANT_DIRECTORY_BUDGET_MS - 1);
    expect(pending.settled(), "przed terminem katalog NIE MOŻE być rozstrzygnięty").toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    expect(pending.settled(), "po terminie katalog MUSI wrócić z zejściem").toBe(true);
    expect(pending.value()?.byDomain.size).toBe(0);
    expect(pending.value()?.defaultTenant).toBeNull();
  });

  it("lapsus terminu ma WŁASNĄ telemetrię, odróżnialną od błędu bazy", async () => {
    vi.useFakeTimers();
    state.mode = "hang";
    void getTenantDirectory();
    await vi.advanceTimersByTimeAsync(TENANT_DIRECTORY_BUDGET_MS + 1);

    expect(warns.some((line) => line.includes("[tenant] directory load timed out"))).toBe(true);
    expect(warns.some((line) => line.includes("[tenant] directory load failed"))).toBe(false);
  });

  it("BŁĄD bazy nadal loguje się jako błąd, nie jako lapsus terminu", async () => {
    state.mode = "error";
    await expect(getTenantDirectory()).resolves.toMatchObject({ defaultTenant: null });

    expect(warns.some((line) => line.includes("[tenant] directory load failed"))).toBe(true);
    expect(warns.some((line) => line.includes("timed out"))).toBe(false);
  });

  it("termin NIE zatruwa katalogu - nieświeży wpis przeżywa lapsus odświeżenia", async () => {
    vi.useFakeTimers();
    await expect(resolveTenantForHost("nes.example")).resolves.toMatchObject({ id: "t-nes" });

    // Baza wisi, a wpis wychodzi poza TTL (60 s): SWR serwuje nieświeży
    // katalog od ręki, odświeżenie biegnie w tle i przekracza termin.
    state.mode = "hang";
    await vi.advanceTimersByTimeAsync(61_000);
    await expect(resolveTenantForHost("nes.example")).resolves.toMatchObject({ id: "t-nes" });
    await vi.advanceTimersByTimeAsync(TENANT_DIRECTORY_BUDGET_MS + 1);

    // Zejście po terminie bierze NIEŚWIEŻY katalog, a nie EMPTY_DIRECTORY -
    // inaczej jeden wolny odczyt kasowałby rozpoznawanie domen na cały TTL.
    const after = await getTenantDirectory();
    expect(after.byDomain.get("nes.example")?.id).toBe("t-nes");
  });

  it("zdrowa baza nadal jedzie bez żadnego opóźnienia (kontrola pozytywna)", async () => {
    const directory = await getTenantDirectory();
    expect(directory.byDomain.get("nes.example")?.id).toBe("t-nes");
    expect(warns).toEqual([]);
  });
});

describe("indeks przekierowań - termin round-tripu roli serwisowej", () => {
  it("zawieszona baza rozstrzyga się NA terminie, nie nigdy (kontrola negatywna terminu)", async () => {
    vi.useFakeTimers();
    state.mode = "hang";

    const pending = watch(getRedirectIndexForTenant("t-nes"));

    // Ten sam budżet co katalog tenantów (1 500 ms); stała jest prywatna dla
    // modułu, więc test celuje w jej wartość, nie w import - gdyby ktoś ją
    // zmienił, ten przypadek ma o tym powiedzieć.
    await vi.advanceTimersByTimeAsync(1_499);
    expect(pending.settled(), "przed terminem indeks NIE MOŻE być rozstrzygnięty").toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    expect(pending.settled(), "po terminie indeks MUSI wrócić z zejściem").toBe(true);
    expect(pending.value()?.exact.size).toBe(0);
    expect(pending.value()?.wildcards).toHaveLength(0);
  });

  it("lapsus terminu ma WŁASNĄ telemetrię, odróżnialną od błędu bazy", async () => {
    vi.useFakeTimers();
    state.mode = "hang";
    void getRedirectIndexForTenant("t-nes");
    await vi.advanceTimersByTimeAsync(1_501);

    expect(warns.some((line) => line.includes("[redirects] index load timed out"))).toBe(true);
    expect(warns.some((line) => line.includes("[redirects] index load failed"))).toBe(false);
  });

  it("BŁĄD bazy nadal loguje się jako błąd, nie jako lapsus terminu", async () => {
    state.mode = "error";
    const index = await getRedirectIndexForTenant("t-nes");
    expect(index.exact.size).toBe(0);

    expect(warns.some((line) => line.includes("[redirects] index load failed"))).toBe(true);
    expect(warns.some((line) => line.includes("timed out"))).toBe(false);
  });

  it("zdrowa baza nadal oddaje reguły (kontrola pozytywna)", async () => {
    const index = await getRedirectIndexForTenant("t-nes");
    expect(index.exact.has("/stary")).toBe(true);
    expect(warns).toEqual([]);
  });

  it("osiągnięcie limitu odczytu przestaje być NIEWIDOCZNE", async () => {
    state.redirects = Array.from({ length: 5000 }, (_, i) => ({
      id: `r${i}`,
      source_path: `/s${i}`,
      target_path: `/t${i}`,
      status_code: 301,
    }));
    await getRedirectIndexForTenant("t-nes");

    // Reguła 5 001. i dalsze NIE są serwowane, a do 2026-09-12 nic tego nie
    // mówiło. Limit zostaje (obniżenie go cicho wyłączyłoby 301-ki), ale
    // jego osiągnięcie jest od teraz w logu.
    expect(warns.some((line) => line.includes("hit the 5000-row read limit"))).toBe(true);
  });
});
