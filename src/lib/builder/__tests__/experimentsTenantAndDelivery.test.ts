// TESTY A/B - dostarczenie zdarzenia i najemca w rejestrze (kontrakty
// wprowadzone 2026-10-18 przy naprawie dawnych `it.fails`).
//
// Siostrzany experiments.test.ts pilnuje arytmetyki, beaconu i kształtu
// zapytań. Ten plik domyka to, co doszło przy naprawie:
//   1. ZNACZNIK DEDUPU = ZDARZENIE NAPRAWDĘ WYSZŁO. Beacon odrzucony przez
//      przeglądarkę (`sendBeacon` -> false) przechodzi na fetch; fetch
//      odrzucony zdejmuje znacznik; wyjątek przy budowie ładunku znacznika nie
//      zostawia. Inaczej jedna nieudana próba zabierała zdarzenie całej sesji.
//   2. BEZ NAJEMCY REJESTR NIE PISZE. `create` -> null, `setStatus`/`remove`
//      -> false, statystyki nie startują - bez jednego zapytania.
//   3. `setStatus` MÓWI O WYNIKU. `true` + unieważnienie przy sukcesie,
//      `false` bez unieważnienia przy odmowie (panel nie udaje zmiany statusu).
//   4. LICZNIKI LEJKA LICZĄ NAJEMCĘ SESJI (2026-10-19, migracja
//      20261019090000 dała `builder_experiment_events.tenant_id`). Zapytanie
//      niesie najemcę z `useCurrentTenantId`, więc nawet tabela oddająca
//      wiersze bez RLS nie dosypie do statystyk zdarzeń obcego najemcy.
//
// Granice: atrapa klienta Supabase, hooka najemcy, `navigator.sendBeacon`
// i `fetch` (sieć). Magazyny przeglądarki są prawdziwe (happy-dom).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabase";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  tenantId: null as string | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nie została zainicjalizowana");
      return h.db.from(table);
    },
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "redaktor-1" } } },
        error: null,
      }),
    },
  },
}));

vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
}));

import { fail, ok, okCount, supabaseFromStub } from "@/test/supabase";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { recordExperimentEvent, useExperimentStats, useExperimentsAdmin } from "../experiments";

const TENANT = "11111111-1111-4111-8111-111111111111";
const TABELA = "builder_experiments";
const TABELA_ZDARZEN = "builder_experiment_events";
const ZNACZNIK = "cms_ab_exposure_exp-1";

const ORYGINALNY_BEACON = navigator.sendBeacon;

function ustawBeacon(value: unknown): void {
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, writable: true, value });
}

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa bazy nie została zainicjalizowana");
  return h.db;
}

function odpowiedzRejestru(parts: { lista?: SupabaseResult; zapis?: SupabaseResult }): void {
  db().setResponse(TABELA, (chain: RecordedChain) => {
    if (chain.has("insert")) return ok({ id: "exp-nowy" });
    if (chain.has("update") || chain.has("delete")) return parts.zapis ?? ok(null);
    return parts.lista ?? ok([]);
  });
}

/** Domknięcie mikrotasków po odrzuceniu obietnicy fetch. */
async function przemiel(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  h.db = supabaseFromStub();
  h.tenantId = TENANT;
  window.localStorage.clear();
  window.sessionStorage.clear();
  // Odwiedzający już ma identyfikator - testy dotyczą wysyłki, nie tożsamości.
  window.localStorage.setItem("cms_visitor_id", "odwiedzajacy-1");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  ustawBeacon(ORYGINALNY_BEACON);
  window.localStorage.clear();
  window.sessionStorage.clear();
  h.db = null;
});

describe("recordExperimentEvent - znacznik dedupu po wysyłce", () => {
  it("przyjęty beacon stawia znacznik, więc drugie wywołanie nic nie wysyła", () => {
    const beacon = vi.fn((_url: string, _body?: BodyInit) => true);
    ustawBeacon(beacon);

    recordExperimentEvent("exp-1", "a", "exposure");
    recordExperimentEvent("exp-1", "a", "exposure");

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(ZNACZNIK)).toBe("1");
  });

  it("odrzucony beacon przechodzi na fetch z keepalive i dopiero wtedy stawia znacznik", () => {
    ustawBeacon(vi.fn(() => false));
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null));
    vi.stubGlobal("fetch", fetchMock);

    recordExperimentEvent("exp-1", "b", "exposure");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/public/experiment-event");
    expect(init?.keepalive).toBe(true);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      experimentId: "exp-1",
      variant: "b",
      event: "exposure",
      visitorId: "odwiedzajacy-1",
    });
    expect(window.sessionStorage.getItem(ZNACZNIK)).toBe("1");
  });

  it("odrzucony fetch zdejmuje znacznik, więc kolejna próba w tej sesji znów wysyła", async () => {
    ustawBeacon(undefined);
    const fetchMock = vi
      .fn(async (_url: string, _init?: RequestInit) => new Response(null))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    recordExperimentEvent("exp-1", "a", "exposure");
    await przemiel();
    expect(window.sessionStorage.getItem(ZNACZNIK)).toBeNull();

    recordExperimentEvent("exp-1", "a", "exposure");
    await przemiel();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(window.sessionStorage.getItem(ZNACZNIK)).toBe("1");
  });

  it("wyjątek przy budowie ładunku nie zostawia znacznika - następna próba wysyła", () => {
    const beacon = vi.fn((_url: string, _body?: BodyInit) => true);
    ustawBeacon(beacon);
    vi.stubGlobal(
      "Blob",
      class {
        constructor() {
          throw new Error("test: Blob niedostępny");
        }
      },
    );

    recordExperimentEvent("exp-1", "a", "exposure");
    expect(window.sessionStorage.getItem(ZNACZNIK)).toBeNull();

    vi.unstubAllGlobals();
    recordExperimentEvent("exp-1", "a", "exposure");

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(ZNACZNIK)).toBe("1");
  });
});

describe("useExperimentsAdmin - bez najemcy i wynik setStatus", () => {
  it("bez najemcy create, setStatus i remove odmawiają bez jednego zapytania", async () => {
    h.tenantId = null;
    odpowiedzRejestru({});

    const { result } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const wyniki: unknown[] = [];
    await act(async () => {
      wyniki.push(await result.current.create("Test w ciemno"));
      wyniki.push(await result.current.setStatus("exp-1", "paused"));
      wyniki.push(await result.current.remove("exp-1"));
    });

    expect(wyniki).toEqual([null, false, false]);
    expect(db().chainsFor(TABELA)).toHaveLength(0);
  });

  it("udany setStatus oddaje true, a odrzucony false i NIE unieważnia cache", async () => {
    let odmowa = false;
    db().setResponse(TABELA, (chain: RecordedChain) => {
      if (chain.has("update")) return odmowa ? fail("permission denied", "42501") : ok(null);
      return ok([]);
    });

    const { result, queryClient } = renderHookWithQueryClient(() => useExperimentsAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const wyniki: boolean[] = [];
    await act(async () => {
      wyniki.push(await result.current.setStatus("exp-1", "completed"));
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);

    invalidateSpy.mockClear();
    odmowa = true;
    await act(async () => {
      wyniki.push(await result.current.setStatus("exp-1", "running"));
    });

    expect(wyniki).toEqual([true, false]);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("useExperimentStats - bez najemcy", () => {
  it("nie liczy zdarzeń, dopóki najemca jest nieznany", async () => {
    h.tenantId = null;
    db().setResponse(TABELA_ZDARZEN, () => okCount(5));

    const { result } = renderHookWithQueryClient(() => useExperimentStats("exp-1"));
    await act(async () => {
      await Promise.resolve();
    });

    // Klucz bez najemcy łączyłby liczniki dwóch obszarów roboczych w cache.
    expect(db().chainsFor(TABELA_ZDARZEN)).toHaveLength(0);
    expect(result.current.data).toBeUndefined();
  });
});

// ── liczniki zawężone do najemcy sesji ─────────────────────────────────────

const OBCY = "22222222-2222-4222-8222-222222222222";

/** Wiersz tabeli zdarzeń - dokładnie te kolumny, po których panel liczy. */
interface WierszZdarzenia {
  readonly experiment_id: string;
  readonly tenant_id: string;
  readonly variant: "a" | "b";
  readonly event: "exposure" | "conversion";
}

function powiel(n: number, wiersz: WierszZdarzenia): WierszZdarzenia[] {
  return Array.from({ length: n }, () => wiersz);
}

/**
 * Tabela zdarzeń BEZ RLS - to, co widzi zapytanie, gdy polityka zawiedzie
 * (albo pod rolą serwisową). COUNT liczy wiersze spełniające WSZYSTKIE ogniwa
 * `.eq`, które zapytanie naprawdę wysłało, i nic ponad nie dokłada.
 */
function tabelaZdarzenBezRls(wiersze: readonly WierszZdarzenia[]): void {
  db().setResponse(TABELA_ZDARZEN, (chain: RecordedChain) => {
    const filtry = chain.calls
      .filter((c) => c.method === "eq")
      .map((c) => [String(c.args[0]), c.args[1]] as const);
    const pasuje = (w: WierszZdarzenia) =>
      filtry.every(([kolumna, wartosc]) => w[kolumna as keyof WierszZdarzenia] === wartosc);
    return okCount(wiersze.filter(pasuje).length);
  });
}

/** Ten sam identyfikator eksperymentu z wierszami DWÓCH najemców. */
const ZDARZENIA_DWOCH_NAJEMCOW: readonly WierszZdarzenia[] = [
  ...powiel(3, { experiment_id: "exp-1", tenant_id: TENANT, variant: "a", event: "exposure" }),
  ...powiel(1, { experiment_id: "exp-1", tenant_id: TENANT, variant: "a", event: "conversion" }),
  ...powiel(4, { experiment_id: "exp-1", tenant_id: TENANT, variant: "b", event: "exposure" }),
  ...powiel(2, { experiment_id: "exp-1", tenant_id: TENANT, variant: "b", event: "conversion" }),
  ...powiel(50, { experiment_id: "exp-1", tenant_id: OBCY, variant: "a", event: "exposure" }),
  ...powiel(40, { experiment_id: "exp-1", tenant_id: OBCY, variant: "b", event: "conversion" }),
];

describe("useExperimentStats - liczniki zawężone do najemcy sesji", () => {
  it("baza bez RLS oddaje wiersze obcego najemcy, a panel liczy WYŁĄCZNIE najemcę sesji", async () => {
    tabelaZdarzenBezRls(ZDARZENIA_DWOCH_NAJEMCOW);

    const { result } = renderHookWithQueryClient(() => useExperimentStats("exp-1"));
    await waitFor(() => expect(result.current.data).toBeDefined());

    // Zdarzenia obcego najemcy dosypane do lejka przestawiają z-score: tutaj
    // 40 sfabrykowanych konwersji „b" zrobiłoby z wariantu B zwycięzcę.
    expect(result.current.data).toEqual({
      exposures: { a: 3, b: 4 },
      conversions: { a: 1, b: 2 },
    });
  });

  it("najemca liczników pochodzi z sesji - przełączenie obszaru liczy zdarzenia nowego najemcy", async () => {
    tabelaZdarzenBezRls(ZDARZENIA_DWOCH_NAJEMCOW);

    const { result, rerender } = renderHookWithQueryClient(() => useExperimentStats("exp-1"));
    await waitFor(() => expect(result.current.data).toBeDefined());

    h.tenantId = OBCY;
    rerender();
    await waitFor(() =>
      expect(result.current.data).toEqual({
        exposures: { a: 50, b: 0 },
        conversions: { a: 0, b: 40 },
      }),
    );
  });
});
