// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW
//
// BRAMKA na prawdziwych katalogach migracji. Lovable nie wdraza plikow
// wiekszych niz ok. 52 KB - migracja 62-199 KB przechodzi przez CI na zielono
// i utyka na wdrozeniu, a kod, ktory na niej polega, jest juz na main. Bramka
// zapala sie na KAZDYM pliku supabase ponad limitem z wersja wyzsza od linii
// bazowej (i na jego blizniaku drizzle) z poleceniem, ktore go potnie.
// Uruchamia ja krok CI "CI gate module tests" (`bun run check:ci-gates`).
import { describe, expect, it } from "vitest";
import { MIGRATION_LANES } from "../migrationLaneParity";
import { analyzeMigrationSizes, collectMigrationSizes, renderSizeReport } from "../migrationSize";

describe("bramka rozmiaru migracji (stan faktyczny repozytorium)", () => {
  const sizes = collectMigrationSizes();

  it("bramka faktycznie cos widzi - pusty skan nie moze byc zielony", () => {
    expect(sizes.supabase.length).toBeGreaterThan(500);
    expect(sizes.drizzle.length).toBeGreaterThan(0);
  });

  it("zadna migracja ponad linia bazowa (ani jej blizniak drizzle) nie przekracza limitu Lovable", () => {
    const report = analyzeMigrationSizes({ ...sizes, lanes: MIGRATION_LANES });
    expect(renderSizeReport(report)).toContain("Zgodne.");
  });
});
