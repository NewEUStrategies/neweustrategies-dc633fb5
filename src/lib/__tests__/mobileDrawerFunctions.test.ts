// Server fn konfiguracji mobilnej szuflady - do 18.08.2026 na 0 z 4 funkcji.
//
// Dwie rzeczy, których nie pilnuje nic innego po stronie klienta:
//   1. ODCZYT nie może się wywalić. Szuflada jest jedyną nawigacją telefonu,
//      więc brak rekordu albo błąd bazy ma dać układ DOMYŚLNY, a nie pusty
//      ekran z hamburgerem prowadzącym donikąd.
//   2. ZAPIS ma bramkę `is_super_admin` PONAD RLS-em - RLS też ją wymusza, ale
//      odpowiada kodem 42501, którego nie da się pokazać administratorowi.
//
// Same reguły bazy (RLS, izolacja tenanta) zostają pgTAP-owi w supabase/tests.
import { describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
import { DEFAULT_DRAWER_CONFIG, type DrawerConfig } from "@/lib/mobileDrawer";
import { readMobileDrawerConfig, writeMobileDrawerConfig } from "@/lib/mobileDrawer.functions";

const VALID_CONFIG: DrawerConfig = {
  section_order: ["nav", "account"],
  top_tools: { search: true, theme: true, language: false },
  nav_items: [
    {
      id: "n1",
      label_pl: "Wydarzenia",
      label_en: "Events",
      href: "/wydarzenia",
      icon: "calendar",
      enabled: true,
    },
  ],
};

function readClient(response: SupabaseResult) {
  const stub = supabaseFromStub();
  stub.setResponse("mobile_drawer_configs", response);
  return { stub, client: { from: stub.from } as never };
}

describe("readMobileDrawerConfig", () => {
  it("zwraca zapisaną konfigurację tenanta", async () => {
    const { stub, client } = readClient(ok(VALID_CONFIG));
    expect(await readMobileDrawerConfig(client)).toEqual(VALID_CONFIG);
    // Bez filtra w zapytaniu - host-aware RLS wybiera wiersz bieżącego tenanta.
    expect(stub.lastChain("mobile_drawer_configs")?.has("eq")).toBe(false);
  });

  it("brak rekordu daje układ domyślny", async () => {
    const { client } = readClient(ok(null));
    expect(await readMobileDrawerConfig(client)).toEqual(DEFAULT_DRAWER_CONFIG);
  });

  it("błąd bazy daje układ domyślny, nie wyjątek na ścieżce SSR", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = readClient(fail("statement timeout"));
    expect(await readMobileDrawerConfig(client)).toEqual(DEFAULT_DRAWER_CONFIG);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("USZKODZONY rekord też schodzi na domyślny", async () => {
    // `section_order`, `top_tools` i `nav_items` to kolumny JSONB - mógł je
    // zapisać starszy panel albo ręczny UPDATE.
    const { client } = readClient(ok({ section_order: ["nie-ma-takiej"], top_tools: 7 }));
    expect(await readMobileDrawerConfig(client)).toEqual(DEFAULT_DRAWER_CONFIG);
  });

  it("duplikat w kolejności sekcji jest odrzucany w całości", async () => {
    const { client } = readClient(ok({ ...VALID_CONFIG, section_order: ["nav", "nav"] }));
    expect(await readMobileDrawerConfig(client)).toEqual(DEFAULT_DRAWER_CONFIG);
  });
});

interface WriteRecorder {
  client: never;
  upserts: Record<string, unknown>[];
  conflicts: string[];
}

function writeClient(options: {
  isSuper?: boolean;
  rpcError?: string;
  profile?: SupabaseResult;
  profileError?: string;
  upsert?: SupabaseResult;
}): WriteRecorder {
  const upserts: Record<string, unknown>[] = [];
  const conflicts: string[] = [];
  const client = {
    rpc: (_fn: string, _args: Record<string, unknown>) =>
      Promise.resolve(options.rpcError ? fail(options.rpcError) : ok(options.isSuper ?? true)),
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(
              options.profileError
                ? fail(options.profileError)
                : (options.profile ?? ok({ tenant_id: "t1" })),
            ),
        }),
      }),
      upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => {
        upserts.push(row);
        conflicts.push(opts.onConflict);
        return {
          select: () => ({
            single: () => Promise.resolve(options.upsert ?? ok(VALID_CONFIG)),
          }),
        };
      },
    }),
  };
  return { client: client as never, upserts, conflicts };
}

describe("writeMobileDrawerConfig - bramka", () => {
  it("super-admin przechodzi", async () => {
    const rec = writeClient({ isSuper: true });
    await expect(writeMobileDrawerConfig(rec.client, "u1", VALID_CONFIG)).resolves.toEqual(
      VALID_CONFIG,
    );
  });

  it("zwykły administrator NIE przechodzi i nie dotyka tabeli", async () => {
    const rec = writeClient({ isSuper: false });
    await expect(writeMobileDrawerConfig(rec.client, "u1", VALID_CONFIG)).rejects.toThrow(
      /Forbidden: super_admin required/,
    );
    expect(rec.upserts).toEqual([]);
  });

  it("błąd RPC bramki jest czytelny, a zapis nie dochodzi do skutku", async () => {
    const rec = writeClient({ rpcError: "function is_super_admin does not exist" });
    await expect(writeMobileDrawerConfig(rec.client, "u1", VALID_CONFIG)).rejects.toThrow(
      /is_super_admin: function is_super_admin does not exist/,
    );
    expect(rec.upserts).toEqual([]);
  });
});

describe("writeMobileDrawerConfig - zapis", () => {
  it("wstawia tenanta JAWNIE i zderza po nim rekordy", async () => {
    // Bez jawnego `tenant_id` upsert liczyłby na domyślną wartość kolumny,
    // a `onConflict` jest tym, co zamienia zapis w „jeden wiersz na tenanta".
    const rec = writeClient({});
    await writeMobileDrawerConfig(rec.client, "u1", VALID_CONFIG);
    expect(rec.upserts[0]).toMatchObject({
      tenant_id: "t1",
      updated_by: "u1",
      section_order: VALID_CONFIG.section_order,
      top_tools: VALID_CONFIG.top_tools,
      nav_items: VALID_CONFIG.nav_items,
    });
    expect(rec.conflicts).toEqual(["tenant_id"]);
  });

  it("użytkownik bez tenanta dostaje jasny komunikat, nie zapis w próżnię", async () => {
    const rec = writeClient({ profile: ok({ tenant_id: null }) });
    await expect(writeMobileDrawerConfig(rec.client, "u1", VALID_CONFIG)).rejects.toThrow(
      /No tenant context/,
    );
    expect(rec.upserts).toEqual([]);
  });

  it("brak profilu też przerywa zapis", async () => {
    const rec = writeClient({ profile: ok(null) });
    await expect(writeMobileDrawerConfig(rec.client, "u1", VALID_CONFIG)).rejects.toThrow(
      /No tenant context/,
    );
  });

  it("błąd odczytu profilu jest propagowany z nazwą kroku", async () => {
    const rec = writeClient({ profileError: "permission denied" });
    await expect(writeMobileDrawerConfig(rec.client, "u1", VALID_CONFIG)).rejects.toThrow(
      /profile: permission denied/,
    );
  });

  it("błąd zapisu jest propagowany", async () => {
    const rec = writeClient({ upsert: fail("violates check constraint") });
    await expect(writeMobileDrawerConfig(rec.client, "u1", VALID_CONFIG)).rejects.toThrow(
      /violates check constraint/,
    );
  });

  it("odpowiedź bazy przechodzi przez TEN SAM parser co odczyt", async () => {
    // Baza mogła zapisać coś, czego panel nie wysłał (trigger, migracja).
    // Klient dostaje wtedy układ domyślny zamiast konfiguracji nie do wyrenderowania.
    const rec = writeClient({ upsert: ok({ section_order: ["duch"] }) });
    await expect(writeMobileDrawerConfig(rec.client, "u1", VALID_CONFIG)).resolves.toEqual(
      DEFAULT_DRAWER_CONFIG,
    );
  });
});

describe("obwoluty server fn", () => {
  it("moduł wystawia obie funkcje serwerowe", async () => {
    const mod = await import("@/lib/mobileDrawer.functions");
    expect(typeof mod.getMobileDrawerConfig).toBe("function");
    expect(typeof mod.upsertMobileDrawerConfig).toBe("function");
  });
});
