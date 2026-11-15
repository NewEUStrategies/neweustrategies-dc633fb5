// Odczyty zapasowe adresu bez treści (`lookupMissingPath`).
//
// CO TO DOWODZI. Gramatyka (`resolvePublicPath.test.ts`) dowodzi, jaką decyzję
// dają WYNIKI tych odczytów; sklejenie trasy (`publicResolverRoute.test.tsx`)
// - że loader woła je jedną falą i zamienia decyzję na `notFound()` /
// `redirect()`. Ten plik dowodzi samego I/O: KTÓRE zapytania idą dla jakiego
// kształtu adresu i jak ich wyniki składają się w wejście gramatyki.
//
// Zero sieci: Supabase to atrapa łańcucha z `@/test/supabaseChain`, a stary
// adres wpisu (`fetchLegacyPostPath`) ma własne testy obok. Pamięć izolatu
// (`edgeTtlCache`) jest w tym środowisku przezroczysta - co do niej trafia,
// dowodzi `missingPathLookupsCache.test.ts` na prawdziwym magazynie.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";

const stub = supabaseFromStub();

const harness = vi.hoisted(() => ({
  legacyPath: null as string | null,
  legacyError: null as Error | null,
  legacySlugs: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => stub.from(table) },
}));

vi.mock("../legacyPostPath", () => ({
  fetchLegacyPostPath: async (slug: string) => {
    harness.legacySlugs.push(slug);
    if (harness.legacyError) throw harness.legacyError;
    return harness.legacyPath;
  },
}));

import { lookupMissingPath } from "../missingPathLookups";

beforeEach(() => {
  stub.reset();
  harness.legacyPath = null;
  harness.legacyError = null;
  harness.legacySlugs = [];
  stub.setResponse("categories", ok(null));
  stub.setResponse("tags", ok(null));
});

describe("lookupMissingPath - które odczyty dla jakiego adresu", () => {
  it("goły slug: kategoria, tag i stary adres wpisu - po jednym zapytaniu", async () => {
    await expect(lookupMissingPath(["nie-ma"])).resolves.toEqual({
      categorySlug: null,
      tagSlug: null,
      legacyPostPath: null,
    });
    expect(stub.chainsFor("categories")).toHaveLength(1);
    expect(stub.chainsFor("tags")).toHaveLength(1);
    expect(harness.legacySlugs).toEqual(["nie-ma"]);
  });

  it("adres wielosegmentowy: bez taksonomii, stary adres wpisu po OSTATNIM segmencie", async () => {
    harness.legacyPath = "analizy/atom";
    await expect(lookupMissingPath(["stara-sekcja", "atom"])).resolves.toEqual({
      categorySlug: null,
      tagSlug: null,
      legacyPostPath: "analizy/atom",
    });
    expect(stub.chains).toEqual([]);
    expect(harness.legacySlugs).toEqual(["atom"]);
  });

  it("zapytania o taksonomię filtrują po slugu i biorą co najwyżej jeden wiersz", async () => {
    await lookupMissingPath(["afryka"]);
    for (const table of ["categories", "tags"]) {
      const chain = stub.lastChain(table);
      expect(chain?.argsOf("select")).toEqual(["slug"]);
      expect(chain?.argsOf("eq")).toEqual(["slug", "afryka"]);
      expect(chain?.has("maybeSingle")).toBe(true);
    }
  });

  it("oddaje wszystkie trafienia naraz - o pierwszeństwie decyduje gramatyka, nie ten moduł", async () => {
    stub.setResponse("categories", ok({ slug: "atom" }));
    stub.setResponse("tags", ok({ slug: "atom" }));
    harness.legacyPath = "analizy/atom";
    await expect(lookupMissingPath(["atom"])).resolves.toEqual({
      categorySlug: "atom",
      tagSlug: "atom",
      legacyPostPath: "analizy/atom",
    });
  });

  it("błąd jednego odczytu taksonomii nie zabiera pozostałych wyników", async () => {
    stub.setResponse("categories", fail("połączenie zerwane", "PGRST000"));
    stub.setResponse("tags", ok({ slug: "atom" }));
    harness.legacyPath = "analizy/atom";
    await expect(lookupMissingPath(["atom"])).resolves.toEqual({
      categorySlug: null,
      tagSlug: "atom",
      legacyPostPath: "analizy/atom",
    });
  });

  it("błąd odczytu starego adresu wpisu nie zabiera trafionego archiwum i nie rzuca", async () => {
    // Wyjątek stąd leciałby z loadera trasy `/$` i wywalał stronę zamiast 404.
    stub.setResponse("categories", ok({ slug: "atom" }));
    harness.legacyError = new Error("statement timeout");
    await expect(lookupMissingPath(["atom"])).resolves.toEqual({
      categorySlug: "atom",
      tagSlug: null,
      legacyPostPath: null,
    });
  });

  it.each([
    { nazwa: "plik skanera", segments: ["wp-login.php"] },
    { nazwa: "plik konfiguracji", segments: [".env"] },
    { nazwa: "wielkie litery", segments: ["HNAP1"] },
    {
      nazwa: "ostatni segment adresu wielosegmentowego",
      segments: ["vendor", "phpunit", "eval-stdin.php"],
    },
  ])(
    "segment, który nie może być slugiem ($nazwa), nie kosztuje zapytania",
    async ({ segments }) => {
      // Nawet gdyby baza coś „znalazła", reguła nie pyta - wynik jest negatywny
      // z samego kształtu adresu.
      stub.setResponse("categories", ok({ slug: "nie-do-znalezienia" }));
      harness.legacyPath = "analizy/nie-do-znalezienia";
      await expect(lookupMissingPath(segments)).resolves.toEqual({
        categorySlug: null,
        tagSlug: null,
        legacyPostPath: null,
      });
      expect(stub.chains).toEqual([]);
      expect(harness.legacySlugs).toEqual([]);
    },
  );

  it("o tym, czy pytać, decyduje OSTATNI segment - nietypowy rodzic nie blokuje starego adresu wpisu", async () => {
    harness.legacyPath = "analizy/atom";
    await expect(lookupMissingPath(["Stara_Sekcja", "atom"])).resolves.toMatchObject({
      legacyPostPath: "analizy/atom",
    });
    expect(harness.legacySlugs).toEqual(["atom"]);
  });

  it("pusty adres nie kosztuje ani jednego zapytania", async () => {
    await expect(lookupMissingPath([])).resolves.toEqual({
      categorySlug: null,
      tagSlug: null,
      legacyPostPath: null,
    });
    expect(stub.chains).toEqual([]);
    expect(harness.legacySlugs).toEqual([]);
  });
});
