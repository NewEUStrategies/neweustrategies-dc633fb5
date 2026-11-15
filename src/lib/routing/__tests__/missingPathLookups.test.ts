// Odczyty zapasowe adresu bez treści (`lookupMissingPath`).
//
// CO TO DOWODZI. Gramatyka (`resolvePublicPath.test.ts`) dowodzi, jaką decyzję
// dają WYNIKI tych odczytów; sklejenie trasy (`publicResolverRoute.test.tsx`)
// - że loader woła je jedną falą i zamienia decyzję na `notFound()` /
// `redirect()`. Ten plik dowodzi samego I/O: KTÓRE zapytania idą dla jakiego
// kształtu adresu i jak ich wyniki składają się w wejście gramatyki.
//
// Zero sieci: Supabase to atrapa łańcucha z `@/test/supabaseChain`, a stary
// adres wpisu (`resolveLegacyPostPath`) ma własne testy obok.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";

const stub = supabaseFromStub();

const harness = vi.hoisted(() => ({
  legacyPath: null as string | null,
  legacySlugs: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => stub.from(table) },
}));

vi.mock("../legacyPostPath", () => ({
  resolveLegacyPostPath: async (slug: string) => {
    harness.legacySlugs.push(slug);
    return harness.legacyPath;
  },
}));

import { lookupMissingPath } from "../missingPathLookups";

beforeEach(() => {
  stub.reset();
  harness.legacyPath = null;
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
});
