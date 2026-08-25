// Parytet PL/EN słownika zapisów i biletów + kompletność wartości słownikowych bazy.
//
// DLACZEGO. Brakujący klucz w jednej wersji językowej nie wysypuje ekranu -
// i18next pokazuje surowy klucz („adminEventRegistrations.statuses.waitlist")
// na liście zgłoszeń, czyli awarię widzi dopiero użytkownik EN. Drugi test
// pilnuje czegoś innego: każda wartość z CHECK-ów migracji musi mieć etykietę,
// bo nowy status dodany w SQL-u renderuje się w tabeli jako `no_show` zamiast
// „Nieobecność".
import { describe, expect, it } from "vitest";
import {
  adminEventRegistrationsEn,
  adminEventRegistrationsPl,
} from "@/lib/i18n-admin-event-registrations";
import {
  QUALIFY_OPERATORS,
  QUALIFY_OUTCOMES,
  REGISTRATION_ACTIONS,
  REGISTRATION_FIELD_TYPES,
  REGISTRATION_STATUSES,
} from "@/lib/events/registrationsApi";

function flatten(input: unknown, prefix = ""): string[] {
  if (typeof input !== "object" || input === null) return [prefix];
  return Object.entries(input as Record<string, unknown>).flatMap(([key, value]) =>
    flatten(value, prefix === "" ? key : `${prefix}.${key}`),
  );
}

describe("słownik zapisów wydarzenia", () => {
  it("PL i EN mają dokładnie te same klucze", () => {
    const pl = flatten(adminEventRegistrationsPl).sort();
    const en = flatten(adminEventRegistrationsEn).sort();
    expect(en.filter((key) => !pl.includes(key))).toEqual([]);
    expect(pl.filter((key) => !en.includes(key))).toEqual([]);
  });

  it("żadna wartość nie jest pusta", () => {
    for (const bundle of [adminEventRegistrationsPl, adminEventRegistrationsEn]) {
      const empty = flatten(bundle).filter((key) => {
        const value = key
          .split(".")
          .reduce<unknown>(
            (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
            bundle,
          );
        return typeof value !== "string" || value.trim() === "";
      });
      expect(empty).toEqual([]);
    }
  });

  const dictionaries = [
    ["statuses", REGISTRATION_STATUSES],
    ["actions", REGISTRATION_ACTIONS],
    ["fieldTypes", REGISTRATION_FIELD_TYPES],
    ["qualifyOperators", QUALIFY_OPERATORS],
    ["qualifyOutcomes", QUALIFY_OUTCOMES],
  ] as const;

  it.each(dictionaries)("każda wartość bazy z %s ma etykietę w obu językach", (group, values) => {
    for (const bundle of [adminEventRegistrationsPl, adminEventRegistrationsEn]) {
      const section = (
        bundle.adminEventRegistrations as unknown as Record<string, Record<string, string>>
      )[group];
      for (const value of values) {
        expect(section?.[value], `${group}.${value}`).toBeTruthy();
      }
    }
  });

  it("każdy komunikat odmowy ma zdanie w obu językach", () => {
    const pl = Object.keys(adminEventRegistrationsPl.adminEventRegistrations.errors);
    const en = Object.keys(adminEventRegistrationsEn.adminEventRegistrations.errors);
    expect(pl.sort()).toEqual(en.sort());
    // `unknown` jest ostatnią linią obrony mappera - bez niego pokazałby klucz.
    expect(pl).toContain("unknown");
  });
});
