// Przełożenie STANU URL-a katalogu osób na filtry warstwy danych.
//
// ATOM: czysta funkcja, bez Reacta. Po jednej stronie krótkie parametry adresu
// (`?role=`, `?verified=1`, `?open=`, `?sem=1`), po drugiej kontrakt
// `usePeopleDirectory`. Nazwy się NIE pokrywają (`role` -> `jobTitle`), więc to
// tłumaczenie jest miejscem, w którym literówka kosztuje cicho zignorowany
// filtr - i dlatego ma własny dowód, a nie montaż całej trasy.
//
// FLAGI: tylko dokładna wartość "1" włącza filtr. Kanonizację wejścia
// (`true`/"true" -> "1") robi wcześniej `parsePeopleSearchParams`, więc tutaj
// obowiązuje już jedna postać - dwie postaci tej samej flagi to dwa wpisy
// w cache'u zapytań o identyczny wynik.
import { normalizeProfileIntents } from "@/lib/profile/intents";
import type { PeopleFilters } from "@/lib/chat/usePeopleDirectory";
import type { PeopleSearchParams } from "@/lib/profile/peopleSearchParams";

export function peopleFiltersFromSearch(search: PeopleSearchParams): PeopleFilters {
  return {
    specialization: search.specialization ?? null,
    company: search.company ?? null,
    location: search.location ?? null,
    jobTitle: search.role ?? null,
    verifiedOnly: search.verified === "1",
    openTo: normalizeProfileIntents(search.open ?? ""),
    semantic: search.sem === "1",
  };
}
