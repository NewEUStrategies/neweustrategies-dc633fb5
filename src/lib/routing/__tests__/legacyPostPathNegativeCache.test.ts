// @vitest-environment node
//
// Stary adres wpisu a PAMIĘĆ IZOLATU: co wolno zapamiętać, a czego nie.
//
// CO TO DOWODZI. `legacyPostPath.test.ts` obok sprawdza zapytanie i kształt
// wyniku na PRZEZROCZYSTEJ atrapie cache'u. Tu cache jest PRAWDZIWY
// (`edgeTtlCache`, środowisko node = gałąź serwerowa), bo przedmiotem dowodu
// jest właśnie to, co do niego trafia:
//   * „wpisu nie ma" (odpowiedź bazy) - zapamiętane: usunięte i nigdy
//     nieistniejące adresy nie młócą bazy przy każdym żądaniu bota;
//   * błąd bazy - NIEZAPAMIĘTANY: jedna czkawka nie może przypiąć w izolacie
//     „takiego wpisu nie ma" na 5 minut, bo stary adres z linkami z indeksu
//     odpowiadałby 404 zamiast 301 długo po powrocie bazy.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";

const stub = supabaseFromStub();

const harness = vi.hoisted(() => ({
  rpc: { data: null as unknown, error: null as { message: string } | null },
  rpcCalls: 0,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => stub.from(table),
    rpc: () => {
      harness.rpcCalls += 1;
      return Promise.resolve(harness.rpc);
    },
  },
}));

// Zakres najemcy po hoście jest przedmiotem testów `ssrCache`; tu jeden host.
vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve("przyklad.test"),
}));

import { clearEdgeTtlCache } from "@/lib/ssrCache";

import { fetchLegacyPostPath, resolveLegacyPostPath } from "../legacyPostPath";

beforeEach(() => {
  clearEdgeTtlCache();
  stub.reset();
  harness.rpc = { data: null, error: null };
  harness.rpcCalls = 0;
});

describe("resolveLegacyPostPath - pamięć izolatu", () => {
  it("„wpisu nie ma” zapamiętuje: drugie pytanie o ten sam slug nie idzie do bazy", async () => {
    stub.setResponse("posts", ok(null));
    await expect(resolveLegacyPostPath("nie-ma")).resolves.toBeNull();
    await expect(resolveLegacyPostPath("nie-ma")).resolves.toBeNull();
    expect(stub.chainsFor("posts")).toHaveLength(1);
  });

  it("błędu odczytu wpisu NIE zapamiętuje: następne żądanie pyta ponownie i dostaje 301", async () => {
    stub.setResponse("posts", fail("połączenie zerwane", "PGRST000"));
    await expect(resolveLegacyPostPath("atom")).resolves.toBeNull();

    // Baza wróciła - ten sam izolat, ten sam slug, bez czekania na TTL.
    stub.setResponse("posts", ok({ slug: "atom", parent_page_id: "page-1" }));
    harness.rpc = { data: "analizy", error: null };
    await expect(resolveLegacyPostPath("atom")).resolves.toBe("analizy/atom");
    expect(stub.chainsFor("posts")).toHaveLength(2);
  });

  it("błędu odczytu ścieżki rodzica też nie zapamiętuje", async () => {
    stub.setResponse("posts", ok({ slug: "atom", parent_page_id: "page-1" }));
    harness.rpc = { data: null, error: { message: "statement timeout" } };
    await expect(resolveLegacyPostPath("atom")).resolves.toBeNull();

    harness.rpc = { data: "analizy", error: null };
    await expect(resolveLegacyPostPath("atom")).resolves.toBe("analizy/atom");
    expect(harness.rpcCalls).toBe(2);
  });
});

describe("fetchLegacyPostPath - odczyt bez cache", () => {
  it("rzuca przy błędzie bazy, żeby wołający nie mógł go wziąć za „wpisu nie ma”", async () => {
    stub.setResponse("posts", fail("połączenie zerwane", "PGRST000"));
    await expect(fetchLegacyPostPath("atom")).rejects.toThrow("połączenie zerwane");
  });

  it("brak wpisu to wynik, nie błąd", async () => {
    stub.setResponse("posts", ok(null));
    await expect(fetchLegacyPostPath("nie-ma")).resolves.toBeNull();
    expect(harness.rpcCalls).toBe(0);
  });

  it("pusty slug nie kosztuje zapytania", async () => {
    await expect(fetchLegacyPostPath("")).resolves.toBeNull();
    expect(stub.chains).toEqual([]);
  });
});
