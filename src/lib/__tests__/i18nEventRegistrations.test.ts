// Słownik modułu zapisów: parytet PL/EN i pokrycie wartości słownikowych bazy.
//
// DLACZEGO. Brakujący klucz w jednej wersji językowej nie wysypuje ekranu -
// i18next renderuje surowy klucz („adminEventRegistration.statuses.no_show"),
// czyli awarię widzi dopiero użytkownik drugiego języka. Drugi test pilnuje
// czegoś innego: każda wartość z CHECK-ów migracji
// `20260823150000_event_people_registration.sql` musi mieć etykietę, bo nowy
// typ pola dodany w SQL-u renderuje się w panelu jako `consent` zamiast „Zgoda".
//
// TU JEST TEŻ DOWÓD JEDNEGO ŹRÓDŁA: stałe czytamy z `registrationsApi`, więc
// rozjazd między listą wartości w kodzie a etykietami przewraca test, zamiast
// kończyć się pustą opcją na liście rozwijanej.
import { describe, expect, it } from "vitest";
import {
  adminEventRegistrationEn,
  adminEventRegistrationPl,
} from "@/lib/i18n-admin-event-registration";
import {
  QUALIFY_OPERATORS,
  QUALIFY_OUTCOMES,
  REGISTRATION_ACTIONS,
  REGISTRATION_FIELD_TYPES,
  REGISTRATION_STATUSES,
} from "@/lib/events/registrationsApi";

type Bundle = typeof adminEventRegistrationPl;

function flatten(input: unknown, prefix = ""): string[] {
  if (typeof input !== "object" || input === null) return [prefix];
  return Object.entries(input as Record<string, unknown>).flatMap(([key, value]) =>
    flatten(value, prefix === "" ? key : `${prefix}.${key}`),
  );
}

function valueAt(bundle: Bundle, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], bundle);
}

const bundles: readonly [string, Bundle][] = [
  ["pl", adminEventRegistrationPl],
  ["en", adminEventRegistrationEn],
];

describe("słownik zapisów wydarzenia", () => {
  it("PL i EN mają dokładnie te same klucze", () => {
    const pl = flatten(adminEventRegistrationPl).sort();
    const en = flatten(adminEventRegistrationEn).sort();
    expect(en.filter((key) => !pl.includes(key))).toEqual([]);
    expect(pl.filter((key) => !en.includes(key))).toEqual([]);
  });

  it.each(bundles)("żadna wartość (%s) nie jest pusta", (_lang, bundle) => {
    const empty = flatten(bundle).filter((key) => {
      const value = valueAt(bundle, key);
      return typeof value !== "string" || value.trim() === "";
    });
    expect(empty).toEqual([]);
  });

  const dictionaries = [
    ["statuses", REGISTRATION_STATUSES],
    ["actions", REGISTRATION_ACTIONS],
    ["fieldTypes", REGISTRATION_FIELD_TYPES],
    ["qualifyOperators", QUALIFY_OPERATORS],
    ["qualifyOutcomes", QUALIFY_OUTCOMES],
  ] as const;

  it.each(dictionaries)("każda wartość bazy z %s ma etykietę w obu językach", (group, values) => {
    for (const [lang, bundle] of bundles) {
      for (const value of values) {
        expect(
          valueAt(bundle, `adminEventRegistration.${group}.${value}`),
          `${lang}: ${group}.${value}`,
        ).toBeTruthy();
      }
    }
  });

  it("mapper odmów ma dokąd trafić: `unknown` jest ostatnią linią obrony", () => {
    for (const [, bundle] of bundles) {
      expect(valueAt(bundle, "adminEventRegistration.errors.unknown")).toBeTruthy();
    }
  });
});
