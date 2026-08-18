// Odczyt edytowalnych treści maili transakcyjnych po stronie serwera.
//
// Ten plik ma jedną regułę i jest nią FAIL-SOFT: cokolwiek pójdzie nie tak
// przy odczycie nadpisań (brak wiersza, brak uprawnień, zepsuty JSON), mail i
// tak musi wyjść - z treścią domyślną. Awaria panelu redakcyjnego nie może
// zatrzymać maila z resetem hasła. Testy pilnują właśnie tego: KAŻDA ścieżka
// błędu kończy się kompletnym zestawem treści, nigdy `null`/wyjątkiem.
//
// Reguły parsowania (`parseTxOverrides`) mają własny test w txOverrides.test.ts
// - tutaj sprawdzamy warstwę, która je karmi.
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { loadTxOverrides } from "@/lib/email/txOverrides.server";
import { TX_OVERRIDES_DEFAULTS, TX_OVERRIDES_SETTING_KEY } from "@/lib/email/txOverrides";

const db = supabaseFromStub();
const client = () => ({ from: db.from }) as unknown as SupabaseClient;

beforeEach(() => {
  db.reset();
});

describe("loadTxOverrides", () => {
  it("czyta nadpisania spod ustalonego klucza ustawień", async () => {
    db.setResponse("site_settings", ok({ value: {} }));

    await loadTxOverrides(client());

    const chain = db.lastChain("site_settings");
    expect(chain?.argsOf("eq")).toEqual(["key", TX_OVERRIDES_SETTING_KEY]);
    expect(chain?.argsOf("select")).toEqual(["value"]);
  });

  it("przepuszcza zapisaną wartość przez parser i oddaje komplet treści", async () => {
    db.setResponse("site_settings", ok({ value: {} }));

    const result = await loadTxOverrides(client());

    expect(result).toEqual(TX_OVERRIDES_DEFAULTS);
    expect(Object.keys(result).length).toBeGreaterThan(0);
  });

  it("błąd odczytu NIE zatrzymuje maila - wracają treści domyślne", async () => {
    db.setResponse("site_settings", fail("permission denied", "42501"));

    const result = await loadTxOverrides(client());

    expect(result).toEqual(TX_OVERRIDES_DEFAULTS);
    expect(db.chainsFor("site_settings")).toHaveLength(1);
  });

  it("brak wiersza ustawień to stan normalny, nie awaria", async () => {
    db.setResponse("site_settings", ok(null));

    const result = await loadTxOverrides(client());

    expect(result).toEqual(TX_OVERRIDES_DEFAULTS);
    expect(result).not.toBeNull();
  });

  it("wyjątek z klienta też schodzi na treści domyślne", async () => {
    const throwing = {
      from: () => {
        throw new Error("klient nieosiągalny");
      },
    } as unknown as SupabaseClient;

    const result = await loadTxOverrides(throwing);

    expect(result).toEqual(TX_OVERRIDES_DEFAULTS);
    expect(result).toBeDefined();
  });

  it("zepsuty kształt wartości nie wycieka do maila", async () => {
    db.setResponse("site_settings", ok({ value: "to nie jest obiekt nadpisań" }));

    const result = await loadTxOverrides(client());

    expect(result).toEqual(TX_OVERRIDES_DEFAULTS);
    expect(typeof result).toBe("object");
  });
});
