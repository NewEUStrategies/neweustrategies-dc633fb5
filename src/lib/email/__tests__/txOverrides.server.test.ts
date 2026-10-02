// Odczyt edytowalnych treści maili transakcyjnych po stronie serwera.
//
// Ten plik ma dwie reguły.
//
// FAIL-SOFT: cokolwiek pójdzie nie tak przy odczycie nadpisań (brak wiersza,
// brak uprawnień, zepsuty JSON), mail i tak musi wyjść - z treścią domyślną.
// Awaria panelu redakcyjnego nie może zatrzymać maila z resetem hasła. KAŻDA
// ścieżka błędu kończy się kompletnym zestawem treści, nigdy `null`/wyjątkiem.
//
// GRANICA NAJEMCY: sender czyta te treści kluczem serwisowym, czyli ponad RLS.
// `site_settings` ma klucz (tenant_id, key), więc każda organizacja ma własny
// wiersz - i jedynym, co dzieli je przy odczycie, jest filtr w tym module.
// Atrapa bazy poniżej trzyma DWA wiersze pod tym samym kluczem i odpowiada
// zgodnie z filtrem, tak jak Postgres: zapytanie bez `tenant_id` dostaje
// wiersz obcego najemcy, dokładnie tak jak w produkcji przed poprawką.
//
// Reguły parsowania (`parseTxOverrides`) mają własny test w txOverrides.test.ts
// - tutaj sprawdzamy warstwę, która je karmi.
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";
import { loadTxOverrideFor, loadTxOverrides } from "@/lib/email/txOverrides.server";
import {
  EMPTY_TX_COPY_OVERRIDE,
  TX_OVERRIDES_DEFAULTS,
  TX_OVERRIDES_SETTING_KEY,
} from "@/lib/email/txOverrides";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const db = supabaseFromStub();
const client = () => ({ from: db.from }) as unknown as SupabaseClient;

/** Wszystkie filtry równościowe łańcucha (atrapa `argsOf` oddaje tylko pierwszy). */
function eqFilters(chain: RecordedChain | undefined): ReadonlyArray<unknown>[] {
  return (chain?.calls ?? []).filter((c) => c.method === "eq").map((c) => [...c.args]);
}

/** Wartość filtra `tenant_id` albo `undefined`, gdy zapytanie go nie ma. */
function tenantFilter(chain: RecordedChain): unknown {
  return eqFilters(chain).find(([column]) => column === "tenant_id")?.[1];
}

/** Nadpisania dwóch organizacji pod TYM SAMYM kluczem - kształt z panelu. */
const STORED: Record<string, unknown> = {
  [TENANT_A]: { team_seat_grace: { pl: { subject: "Temat redakcji A" } } },
  [TENANT_B]: { team_seat_grace: { pl: { subject: "Temat redakcji B" } } },
};

/**
 * Baza z dwoma najemcami. Bez filtra `tenant_id` oddaje wiersz B - tak jak
 * `limit 1` bez porządku oddaje „któryś", a nie „właściwy".
 */
function seedTwoTenants(): void {
  db.setResponse("site_settings", (chain) => {
    const tenant = tenantFilter(chain);
    if (tenant === undefined) return ok({ value: STORED[TENANT_B] });
    const value = typeof tenant === "string" ? STORED[tenant] : undefined;
    return ok(value === undefined ? null : { value });
  });
}

beforeEach(() => {
  db.reset();
});

describe("loadTxOverrides", () => {
  it("czyta nadpisania spod ustalonego klucza ustawień - zawężone do najemcy", async () => {
    db.setResponse("site_settings", ok({ value: {} }));

    await loadTxOverrides(client(), TENANT_A);

    const chain = db.lastChain("site_settings");
    expect(eqFilters(chain)).toEqual([
      ["tenant_id", TENANT_A],
      ["key", TX_OVERRIDES_SETTING_KEY],
    ]);
    expect(chain?.argsOf("select")).toEqual(["value"]);
  });

  it("przy dwóch najemcach oddaje treść WŁASNEJ redakcji, nie pierwszej z brzegu", async () => {
    // Regresja: zapytanie po samym kluczu z `.limit(1)` oddawało wiersz
    // dowolnego najemcy - mail organizacji A wychodził z tematem redakcji B.
    seedTwoTenants();

    const a = await loadTxOverrides(client(), TENANT_A);
    const b = await loadTxOverrides(client(), TENANT_B);

    expect(a.team_seat_grace.pl.subject).toBe("Temat redakcji A");
    expect(b.team_seat_grace.pl.subject).toBe("Temat redakcji B");
  });

  it("nie maskuje niejednoznaczności `limit`-em - pełny klucz główny daje co najwyżej jeden wiersz", async () => {
    db.setResponse("site_settings", ok({ value: {} }));

    await loadTxOverrides(client(), TENANT_A);

    const chain = db.lastChain("site_settings");
    expect(chain?.has("limit")).toBe(false);
    expect(chain?.has("maybeSingle")).toBe(true);
  });

  it("najemca nierozstrzygnięty daje treści domyślne BEZ zapytania - nigdy cudze", async () => {
    seedTwoTenants();

    const result = await loadTxOverrides(client(), null);

    expect(result).toEqual(TX_OVERRIDES_DEFAULTS);
    expect(db.chainsFor("site_settings")).toHaveLength(0);
  });

  it("najemca bez własnego wiersza dostaje domyślne, a nie wiersz sąsiada", async () => {
    seedTwoTenants();

    const result = await loadTxOverrides(client(), "33333333-3333-4333-8333-333333333333");

    expect(result).toEqual(TX_OVERRIDES_DEFAULTS);
    expect(result.team_seat_grace.pl.subject).toBe("");
  });

  it("przepuszcza zapisaną wartość przez parser i oddaje komplet treści", async () => {
    db.setResponse("site_settings", ok({ value: {} }));

    const result = await loadTxOverrides(client(), TENANT_A);

    expect(result).toEqual(TX_OVERRIDES_DEFAULTS);
    expect(Object.keys(result).length).toBeGreaterThan(0);
  });

  it("błąd odczytu NIE zatrzymuje maila - wracają treści domyślne", async () => {
    db.setResponse("site_settings", fail("permission denied", "42501"));

    const result = await loadTxOverrides(client(), TENANT_A);

    expect(result).toEqual(TX_OVERRIDES_DEFAULTS);
    expect(db.chainsFor("site_settings")).toHaveLength(1);
  });

  it("brak wiersza ustawień to stan normalny, nie awaria", async () => {
    db.setResponse("site_settings", ok(null));

    const result = await loadTxOverrides(client(), TENANT_A);

    expect(result).toEqual(TX_OVERRIDES_DEFAULTS);
    expect(result).not.toBeNull();
  });

  it("wyjątek z klienta też schodzi na treści domyślne", async () => {
    const throwing = {
      from: () => {
        throw new Error("klient nieosiągalny");
      },
    } as unknown as SupabaseClient;

    const result = await loadTxOverrides(throwing, TENANT_A);

    expect(result).toEqual(TX_OVERRIDES_DEFAULTS);
    expect(result).toBeDefined();
  });

  it("zepsuty kształt wartości nie wycieka do maila", async () => {
    db.setResponse("site_settings", ok({ value: "to nie jest obiekt nadpisań" }));

    const result = await loadTxOverrides(client(), TENANT_A);

    expect(result).toEqual(TX_OVERRIDES_DEFAULTS);
    expect(typeof result).toBe("object");
  });
});

describe("loadTxOverrideFor - wejście sendera", () => {
  it("typ bez edytowalnej treści nie kosztuje zapytania do bazy", async () => {
    // 16 z 19 typów nie ma pól w panelu - wcześniej każdy z nich płacił
    // round-trip za wiersz, który `overrideFor` i tak wyrzucał.
    seedTwoTenants();

    const result = await loadTxOverrideFor(client(), TENANT_A, "payment_failed", "pl");

    expect(result).toEqual(EMPTY_TX_COPY_OVERRIDE);
    expect(db.chainsFor("site_settings")).toHaveLength(0);
  });

  it("typ edytowalny dostaje nadpisanie najemcy nadawcy w języku odbiorcy", async () => {
    seedTwoTenants();

    const pl = await loadTxOverrideFor(client(), TENANT_A, "team_seat_grace", "pl");
    const en = await loadTxOverrideFor(client(), TENANT_A, "team_seat_grace", "en");

    expect(pl.subject).toBe("Temat redakcji A");
    expect(en).toEqual(TX_OVERRIDES_DEFAULTS.team_seat_grace.en);
    expect(tenantFilter(db.chainsFor("site_settings")[0]!)).toBe(TENANT_A);
  });

  it("najemca nierozstrzygnięty daje puste nadpisanie bez zapytania", async () => {
    seedTwoTenants();

    const result = await loadTxOverrideFor(client(), null, "team_seat_access_ended", "pl");

    expect(result).toEqual(EMPTY_TX_COPY_OVERRIDE);
    expect(db.chainsFor("site_settings")).toHaveLength(0);
  });
});
