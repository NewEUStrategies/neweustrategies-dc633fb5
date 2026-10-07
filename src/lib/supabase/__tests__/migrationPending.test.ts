// Okno wdrożenia „kod przed migracją" - jedna definicja dla ścieżek zastępczych.
// Wąskość jest tu całym kontraktem: ścieżka zastępcza wolno uruchomić TYLKO
// wtedy, gdy bazy nie ma funkcji, nigdy przy odmowie uprawnień czy awarii.
import { describe, expect, it } from "vitest";

import { isMigrationPending, MIGRATION_PENDING_CODES } from "@/lib/supabase/migrationPending";

describe("isMigrationPending", () => {
  it.each(["PGRST202", "42883"])("%s to brak funkcji przed migracją", (code) => {
    expect(isMigrationPending({ code, message: "no function" })).toBe(true);
  });

  it.each([
    ["odmowa uprawnień", "42501"],
    ["brak relacji", "42P01"],
    ["limit prób", "P0001"],
    ["PostgREST: brak wiersza", "PGRST116"],
    ["sieć bez kodu", undefined],
  ])("%s NIE jest oknem wdrożenia", (_label, code) => {
    expect(isMigrationPending({ code, message: "x" })).toBe(false);
  });

  it("brak błędu to nie okno wdrożenia", () => {
    expect(isMigrationPending(null)).toBe(false);
    expect(isMigrationPending(undefined)).toBe(false);
  });

  it("zbiór kodów jest dokładnie dwuelementowy", () => {
    expect([...MIGRATION_PENDING_CODES].sort()).toEqual(["42883", "PGRST202"]);
  });
});
