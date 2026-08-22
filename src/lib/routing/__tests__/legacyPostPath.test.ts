// Rozwiązywanie kanonicznej ścieżki wpisu ze starego adresu.
//
// CO TO DOWODZI. To druga - I/O-wa - połowa resolvera adresów publicznych:
// gramatyka (`resolvePublicPath`) decyduje, ŻE trzeba spytać, a ten moduł
// wykonuje zapytanie i składa `<pełna-ścieżka-rodzica>/<slug>`. Konsekwencja
// błędu jest w SEO, nie w funkcji: zły wynik daje albo 404 na adresie, który
// ma tysiące linków z indeksu, albo 301 w pętli.
//
// DWIE RZECZY, KTÓRE MUSZĄ BYĆ SPRAWDZONE RAZEM:
//   1. FILTRY - wpis musi być `status = 'published'` i `deleted_at IS NULL`.
//      Bez nich stary adres wersji roboczej przekierowywałby gościa na treść,
//      której nie ma prawa zobaczyć;
//   2. DEGRADACJA - brak wpisu, brak rodzica, błąd bazy i nieoczekiwany kształt
//      odpowiedzi RPC muszą dać `null`, nigdy wyjątku. Wyjątek tutaj leci
//      z loadera trasy `/$`, czyli wywala stronę zamiast pokazać 404.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Cache brzegowy (`edgeTtlCache`) ma własne testy
// i własny zakres najemcy po hoście - tu jest przezroczystą atrapą, żeby każdy
// przypadek widział świeże zapytanie. Rekurencyjne składanie ścieżki rodzica
// robi funkcja SQL `page_full_path` (dowód należy do bazy).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";

const stub = supabaseFromStub();

const harness = vi.hoisted(() => ({
  rpc: { data: null as unknown, error: null as { message: string } | null },
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => stub.from(table),
    rpc: (fn: string, args: unknown) => {
      harness.rpcCalls.push({ fn, args });
      return Promise.resolve(harness.rpc);
    },
  },
}));

// Przezroczysty cache: każdy przypadek ma widzieć własne zapytanie, a nie wynik
// poprzedniego. Zakres najemcy po hoście jest przedmiotem testów `ssrCache`.
vi.mock("@/lib/ssrCache", () => ({
  edgeTtlCache: <T>(_key: string, _ttl: number, fetcher: () => Promise<T>) => fetcher(),
}));

import { resolveLegacyPostPath } from "../legacyPostPath";

beforeEach(() => {
  stub.reset();
  harness.rpc = { data: null, error: null };
  harness.rpcCalls = [];
});

describe("resolveLegacyPostPath", () => {
  it("składa ścieżkę kanoniczną z ścieżki rodzica i slugu wpisu", async () => {
    stub.setResponse("posts", ok({ slug: "atom", parent_page_id: "page-1" }));
    harness.rpc = { data: "analizy/energetyka", error: null };
    await expect(resolveLegacyPostPath("atom")).resolves.toBe("analizy/energetyka/atom");
  });

  it("pyta o ścieżkę rodzica po jego identyfikatorze", async () => {
    stub.setResponse("posts", ok({ slug: "atom", parent_page_id: "page-1" }));
    harness.rpc = { data: "analizy", error: null };
    await resolveLegacyPostPath("atom");
    expect(harness.rpcCalls).toEqual([{ fn: "page_full_path", args: { _page_id: "page-1" } }]);
  });

  it("zawęża zapytanie do wpisu OPUBLIKOWANEGO i nieusuniętego", async () => {
    // Gdyby któregoś z tych filtrów zabrakło, stary adres wersji roboczej
    // przekierowywałby gościa na treść, której nie ma prawa zobaczyć.
    stub.setResponse("posts", ok({ slug: "atom", parent_page_id: "page-1" }));
    harness.rpc = { data: "analizy", error: null };
    await resolveLegacyPostPath("atom");
    const chain = stub.lastChain("posts");
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["slug", "atom"],
      ["status", "published"],
    ]);
    expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(chain?.has("maybeSingle")).toBe(true);
  });

  it("pusty slug nie kosztuje ani jednego zapytania", async () => {
    await expect(resolveLegacyPostPath("")).resolves.toBeNull();
    expect(stub.chains).toEqual([]);
    expect(harness.rpcCalls).toEqual([]);
  });

  it("brak wpisu daje null, nie wyjątek", async () => {
    stub.setResponse("posts", ok(null));
    await expect(resolveLegacyPostPath("nie-ma")).resolves.toBeNull();
    // Bez wpisu nie ma po co pytać o ścieżkę rodzica.
    expect(harness.rpcCalls).toEqual([]);
  });

  it("wpis BEZ rodzica daje null - nie ma z czego złożyć ścieżki", async () => {
    stub.setResponse("posts", ok({ slug: "atom", parent_page_id: null }));
    await expect(resolveLegacyPostPath("atom")).resolves.toBeNull();
    expect(harness.rpcCalls).toEqual([]);
  });

  it("błąd bazy daje null, nie wyjątek", async () => {
    // Wyjątek tutaj leci z loadera trasy `/$` i wywala stronę zamiast 404.
    stub.setResponse("posts", fail("połączenie zerwane", "PGRST000"));
    await expect(resolveLegacyPostPath("atom")).resolves.toBeNull();
  });

  it("puste rozwiązanie ścieżki rodzica daje null", async () => {
    stub.setResponse("posts", ok({ slug: "atom", parent_page_id: "page-1" }));
    harness.rpc = { data: null, error: null };
    await expect(resolveLegacyPostPath("atom")).resolves.toBeNull();
  });

  it("nieoczekiwany KSZTAŁT odpowiedzi RPC daje null, nie sklejony śmieć", async () => {
    // `page_full_path` zwraca tekst; liczba albo obiekt znaczą, że kontrakt
    // funkcji SQL się zmienił - wtedy 404 jest bezpieczniejsze niż
    // przekierowanie na `[object Object]/atom`.
    stub.setResponse("posts", ok({ slug: "atom", parent_page_id: "page-1" }));
    for (const data of [42, { path: "analizy" }, [], true]) {
      harness.rpc = { data, error: null };
      await expect(resolveLegacyPostPath("atom")).resolves.toBeNull();
    }
  });
});
