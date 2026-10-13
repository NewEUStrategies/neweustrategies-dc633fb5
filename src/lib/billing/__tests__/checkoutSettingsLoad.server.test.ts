// Odczyt ustawień checkoutu po stronie serwera: zawężenie do tenantu
// zamówienia i fail-safe na błędzie odczytu (konfiguracja nie może wywrócić
// płatności).
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_CHECKOUT_SETTINGS } from "@/lib/billing/checkoutSettings";
import { loadCheckoutSettings } from "@/lib/billing/checkoutSettings.server";

interface Recorded {
  table: string | null;
  columns: string | null;
  tenantFilter: string | null;
}

/**
 * Minimalna atrapa buildera PostgREST - notuje tabelę, listę kolumn i filtr
 * tenantu, żeby test pilnował KONTRAKTU zapytania, nie implementacji.
 */
function stubClient(result: { data: unknown; error: unknown }): {
  client: SupabaseClient;
  recorded: Recorded;
} {
  const recorded: Recorded = { table: null, columns: null, tenantFilter: null };
  const builder = {
    select(columns: string) {
      recorded.columns = columns;
      return this;
    },
    eq(column: string, value: string) {
      if (column === "tenant_id") recorded.tenantFilter = value;
      return this;
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
  };
  const client = {
    from(table: string) {
      recorded.table = table;
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, recorded };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadCheckoutSettings", () => {
  it("zawęża odczyt do tenantu zamówienia", async () => {
    const { client, recorded } = stubClient({
      data: {
        allow_promotion_codes: false,
        automatic_tax: true,
        tax_id_collection: false,
        billing_address_collection: "required",
        invoice_creation: false,
      },
      error: null,
    });

    const settings = await loadCheckoutSettings(client, "tenant-a");

    expect(recorded.table).toBe("checkout_settings");
    expect(recorded.tenantFilter).toBe("tenant-a");
    expect(recorded.columns).toContain("allow_promotion_codes");
    expect(recorded.columns).toContain("invoice_creation");
    expect(settings).toEqual({
      allow_promotion_codes: false,
      automatic_tax: true,
      tax_id_collection: false,
      billing_address_collection: "required",
      invoice_creation: false,
    });
  });

  it("bez tenantu polega wyłącznie na RLS (brak jawnego filtra)", async () => {
    const { client, recorded } = stubClient({ data: null, error: null });
    await loadCheckoutSettings(client, null);
    expect(recorded.tenantFilter).toBeNull();
  });

  it("brak wiersza -> bezpieczne domyślne", async () => {
    const { client } = stubClient({ data: null, error: null });
    await expect(loadCheckoutSettings(client, "tenant-a")).resolves.toEqual(
      DEFAULT_CHECKOUT_SETTINGS,
    );
  });

  it("błąd odczytu nie wywraca płatności - fail-safe na domyślne", async () => {
    const { client } = stubClient({ data: null, error: { message: "rls denied" } });
    await expect(loadCheckoutSettings(client, "tenant-a")).resolves.toEqual(
      DEFAULT_CHECKOUT_SETTINGS,
    );
  });

  it("błąd odczytu NIE otwiera pola kodu Stripe - domyślne są fail-closed (PAY-06)", async () => {
    // Chwilowa awaria bazy nie może włączyć ścieżki rabatu, której najemca nie
    // włączył: kod Stripe omija limity i zakres kuponów z bazy.
    const { client } = stubClient({ data: null, error: { message: "rls denied" } });
    const settings = await loadCheckoutSettings(client, "tenant-a");
    expect(settings.allow_promotion_codes).toBe(false);
  });

  it("ZAPISANY wybór najemcy (`true`) jest honorowany - kasa nie przepisuje go po cichu (PAY-06, 0.4)", async () => {
    // Migracja 20261012131100 zmienia wyłącznie DEFAULT kolumny. Wiersz
    // zapisany panelem przed zmianą może nieść `true` bez świadomej decyzji,
    // ale tabela nie odróżnia go od włączenia celowego - przegląd tych
    // wierszy jest krokiem operatora, a kod obcego najemcy zatrzymuje
    // realizacja zamówienia. Odczyt oddaje dokładnie to, co zapisano.
    const { client } = stubClient({
      data: {
        allow_promotion_codes: true,
        automatic_tax: false,
        tax_id_collection: true,
        billing_address_collection: "auto",
        invoice_creation: true,
      },
      error: null,
    });
    const settings = await loadCheckoutSettings(client, "tenant-a");
    expect(settings.allow_promotion_codes).toBe(true);
  });

  it("brak wiersza ustawień też nie otwiera pola kodu Stripe", async () => {
    const { client } = stubClient({ data: null, error: null });
    const settings = await loadCheckoutSettings(client, "tenant-a");
    expect(settings.allow_promotion_codes).toBe(false);
  });
});
