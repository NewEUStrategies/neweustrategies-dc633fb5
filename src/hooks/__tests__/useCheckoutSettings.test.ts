// USTAWIENIA KASY - jeden odczyt (kasa, faktury, paywall) i jeden pisarz.
//
// CO TEN PLIK DOWODZI.
//   1. Klucz z fabryki `checkoutKeys.settings()` i JEDEN kształt danych pod nim
//      (z tokenem) - kasa i edytor nie mają już dwóch `queryFn` pod jednym kluczem.
//   2. Zapis: patch pięciu kolumn + `updated_by`, UPDATE warunkowany SUROWYM
//      tokenem (0 wierszy = `40001`), INSERT przy braku wiersza (23505 = `40001`),
//      zero `upsert` (dawny nadpisywał bez względu na to, co admin widział).
//   3. Unieważnienie: reguła szyny `checkout_settings.changed.v1` + pulpit
//      monetyzacji (DIAGNOZA #8) + diagnostyka huba.
//   4. Moduł czyta publiczna kasa - żadnego importu z panelu.
import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({ db: null as SupabaseFromStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.db!.from(table),
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { user: { id: "admin-1" } } }, error: null }),
    },
  },
}));

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { bezKomentarzy } from "@/lib/ci/sourceScan";
import { checkoutKeys } from "@/lib/access/keys";
import { billingKeys } from "@/lib/billing/keys";
import { DEFAULT_CHECKOUT_SETTINGS } from "@/lib/billing/checkoutSettings";
import { revenueKeys } from "@/lib/revenue/keys";
import {
  checkoutSettingsInvalidationKeys,
  checkoutSettingsQueryOptions,
  fetchCheckoutSettings,
  saveCheckoutSettings,
  useCheckoutSettings,
  useSaveCheckoutSettings,
} from "../useCheckoutSettings";

const TOKEN = "2026-10-19T10:00:00.123456+00:00";
const ROW = {
  allow_promotion_codes: true,
  automatic_tax: false,
  tax_id_collection: true,
  billing_address_collection: "required",
  invoice_creation: false,
  updated_at: TOKEN,
};

function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

beforeEach(() => {
  h.db = supabaseFromStub();
});

describe("moduł publicznej kasy", () => {
  it("nie importuje modułów panelu ani warstwy zapisu S1", () => {
    const kod = bezKomentarzy(readFileSync("src/hooks/useCheckoutSettings.ts", "utf8"));
    const importy = [...kod.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(importy.filter((p) => /admin|planQueries|components\//.test(p))).toEqual([]);
  });

  it("`CHECKOUT_SETTINGS_QUERY_KEY` zniknął - klucz tylko z fabryki", async () => {
    const mod = await import("../useCheckoutSettings");
    expect("CHECKOUT_SETTINGS_QUERY_KEY" in mod).toBe(false);
  });
});

describe("odczyt", () => {
  it("klucz z fabryki, staleTime, wiersz z tokenem", async () => {
    const opts = checkoutSettingsQueryOptions();
    expect(opts.queryKey).toEqual(checkoutKeys.settings());
    expect(opts.staleTime).toBe(5 * 60_000);
    h.db!.setResponse("checkout_settings", ok(ROW));
    await expect((opts.queryFn as () => Promise<unknown>)()).resolves.toEqual(ROW);
    expect(h.db!.lastChain("checkout_settings")!.argsOf("select")![0]).toMatch(/, updated_at$/);
  });

  it("brak wiersza: bezpieczne domyślne + token `null` (zapis utworzy wiersz)", async () => {
    h.db!.setResponse("checkout_settings", ok(null));
    await expect(fetchCheckoutSettings()).resolves.toEqual({
      ...DEFAULT_CHECKOUT_SETTINGS,
      updated_at: null,
    });
  });

  it("useCheckoutSettings czyta przez ten sam wpis cache", async () => {
    h.db!.setResponse("checkout_settings", ok(ROW));
    const { qc, wrapper } = harness();
    const { result } = renderHook(() => useCheckoutSettings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(checkoutKeys.settings())).toEqual(ROW);
  });
});

describe("zapis", () => {
  const settings = {
    allow_promotion_codes: true,
    automatic_tax: true,
    tax_id_collection: false,
    billing_address_collection: "auto" as const,
    invoice_creation: true,
  };

  it("UPDATE: pięć kolumn + updated_by, filtr po SUROWYM tokenie, bez upsert", async () => {
    h.db!.setResponse("checkout_settings", ok([{ ...ROW, updated_at: "nowy" }]));
    const saved = await saveCheckoutSettings({ settings, expectedUpdatedAt: TOKEN });
    const chain = h.db!.lastChain("checkout_settings")!;
    expect(chain.argsOf("update")).toEqual([{ ...settings, updated_by: "admin-1" }]);
    expect(chain.argsOf("eq")).toEqual(["updated_at", TOKEN]);
    expect(chain.has("upsert")).toBe(false);
    expect(saved.updated_at).toBe("nowy");
  });

  it("0 wierszy = 40001; brak wiersza → INSERT; 23505 = 40001", async () => {
    h.db!.setResponse("checkout_settings", ok([]));
    await expect(
      saveCheckoutSettings({ settings, expectedUpdatedAt: TOKEN }),
    ).rejects.toMatchObject({ code: "40001", message: "stale_write" });

    h.db!.setResponse("checkout_settings", ok(ROW));
    await saveCheckoutSettings({ settings, expectedUpdatedAt: null });
    expect(h.db!.lastChain("checkout_settings")!.argsOf("insert")).toEqual([
      { ...settings, updated_by: "admin-1" },
    ]);

    h.db!.setResponse("checkout_settings", fail("duplicate", "23505"));
    await expect(saveCheckoutSettings({ settings, expectedUpdatedAt: null })).rejects.toMatchObject(
      {
        code: "40001",
      },
    );
  });

  it("hak: nowy token w cache i unieważnienie czytelników z pulpitem monetyzacji", async () => {
    h.db!.setResponse("checkout_settings", ok([{ ...ROW, updated_at: "po-zapisie" }]));
    const { qc, wrapper } = harness();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useSaveCheckoutSettings(), { wrapper });
    await result.current.mutateAsync({ settings, expectedUpdatedAt: TOKEN });
    expect(qc.getQueryData(checkoutKeys.settings())).toMatchObject({ updated_at: "po-zapisie" });
    const keys = spy.mock.calls.map(([f]) => (f as { queryKey: QueryKey }).queryKey);
    expect(keys).toEqual(checkoutSettingsInvalidationKeys());
    expect(keys).toContainEqual(billingKeys.admin.monetization());
    expect(keys).toContainEqual(revenueKeys.domain("diagnostics"));
  });
});

// Okno porzucenia kasy (`abandon_after_minutes`, I9a): kolumna w TYM SAMYM
// odczycie co token, zapis tym samym mutatorem i bez przycinania.
describe("okno porzucenia kasy (I9a)", () => {
  const settings = { ...DEFAULT_CHECKOUT_SETTINGS };

  it("odczyt wybiera kolumnę razem z tokenem i oddaje ją w stanie", async () => {
    h.db!.setResponse("checkout_settings", ok({ ...ROW, abandon_after_minutes: 90 }));
    await expect(fetchCheckoutSettings()).resolves.toMatchObject({ abandon_after_minutes: 90 });
    const columns = String(h.db!.lastChain("checkout_settings")!.argsOf("select")![0]);
    expect(columns).toMatch(/abandon_after_minutes, updated_at$/);
  });

  it("brak wiersza: pole nieobecne (formularz pokaże domyślne bazy)", async () => {
    h.db!.setResponse("checkout_settings", ok(null));
    const state = await fetchCheckoutSettings();
    expect("abandon_after_minutes" in state).toBe(false);
  });

  it("zapis wysyła okno bez zmian obok pięciu kolumn; brak okna = kolumna nietknięta", async () => {
    h.db!.setResponse("checkout_settings", ok([{ ...ROW, abandon_after_minutes: 45 }]));
    const saved = await saveCheckoutSettings({
      settings: { ...settings, abandon_after_minutes: 45 },
      expectedUpdatedAt: TOKEN,
    });
    expect(h.db!.lastChain("checkout_settings")!.argsOf("update")).toEqual([
      { ...settings, abandon_after_minutes: 45, updated_by: "admin-1" },
    ]);
    expect(saved.abandon_after_minutes).toBe(45);

    await saveCheckoutSettings({ settings, expectedUpdatedAt: TOKEN });
    expect(h.db!.lastChain("checkout_settings")!.argsOf("update")?.[0]).not.toHaveProperty(
      "abandon_after_minutes",
    );
  });

  it("wartość spoza zakresu NIE jest przycinana - CHECK bazy (23514) wraca jako błąd", async () => {
    h.db!.setResponse("checkout_settings", fail("violates check constraint", "23514"));
    await expect(
      saveCheckoutSettings({
        settings: { ...settings, abandon_after_minutes: 20 },
        expectedUpdatedAt: TOKEN,
      }),
    ).rejects.toMatchObject({ code: "23514" });
    expect(h.db!.lastChain("checkout_settings")!.argsOf("update")?.[0]).toMatchObject({
      abandon_after_minutes: 20,
    });
  });
});
