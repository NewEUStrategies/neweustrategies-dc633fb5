// Atomy katalogu osób: tekst „czego szukam", filtry z adresu, klucz pustego stanu.
//
// CO TO DOWODZI. Trzy czyste decyzje wyprowadzone z 666-linijkowej trasy
// `/people`. Każda ma konsekwencję widoczną dla czytelnika:
//   * `seekingText` - czy w profilu widać, czego ktoś szuka, i w jakim języku;
//   * `peopleFiltersFromSearch` - czy filtr z adresu (udostępniony link, zakładka)
//     odtwarza TEN SAM widok; pomyłka w mapowaniu daje ciche zignorowanie filtru,
//     bez żadnego komunikatu;
//   * `peopleEmptyKey` - czy pusty wynik mówi PRAWDĘ: „brak wyników dla filtrów"
//     to inny komunikat niż „katalog jest pusty", a wybór złego zostawia
//     czytelnika bez podpowiedzi, co zrobić dalej.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. `normalizeProfileIntents` ma własne testy
// w `src/lib/profile/`; tutaj sprawdzamy tylko, że filtry PRZEZ nią przechodzą.
// Walidacja `PeopleSearchParams` należy do `validateSearch` trasy.
import { describe, expect, it } from "vitest";

import { peopleEmptyKey } from "../peopleEmptyKey";
import { peopleFiltersFromSearch } from "../peopleFilters";
import { seekingText } from "../seekingText";

describe("seekingText - język interfejsu z zapasem na drugi", () => {
  it.each([
    {
      nazwa: "PL ma treść, interfejs PL",
      person: { seeking_pl: "Szukam wspólnika", seeking_en: "Looking for a partner" },
      lang: "pl",
      oczekiwane: "Szukam wspólnika",
    },
    {
      nazwa: "EN ma treść, interfejs EN",
      person: { seeking_pl: "Szukam wspólnika", seeking_en: "Looking for a partner" },
      lang: "en",
      oczekiwane: "Looking for a partner",
    },
    {
      nazwa: "brak wersji EN - spadek na PL",
      person: { seeking_pl: "Szukam wspólnika", seeking_en: null },
      lang: "en",
      oczekiwane: "Szukam wspólnika",
    },
    {
      nazwa: "brak wersji PL - spadek na EN",
      person: { seeking_pl: null, seeking_en: "Looking for a partner" },
      lang: "pl",
      oczekiwane: "Looking for a partner",
    },
    {
      nazwa: "brak obu wersji",
      person: { seeking_pl: null, seeking_en: null },
      lang: "pl",
      oczekiwane: null,
    },
    {
      nazwa: "same spacje traktowane jak brak - i spadek na drugi język",
      person: { seeking_pl: "   ", seeking_en: "Looking" },
      lang: "pl",
      oczekiwane: "Looking",
    },
    {
      nazwa: "same spacje w obu wersjach dają null, nie puste pole",
      person: { seeking_pl: "  ", seeking_en: "\n\t" },
      lang: "pl",
      oczekiwane: null,
    },
    {
      nazwa: "pusty ciąg traktowany jak brak",
      person: { seeking_pl: "", seeking_en: "Looking" },
      lang: "pl",
      oczekiwane: "Looking",
    },
    {
      nazwa: "nieznany kod języka zachowuje się jak PL",
      // `lang` przychodzi z runtime i18n jako `string`, więc kod inny niż
      // `pl`/`en` jest realnym wejściem, nie hipotezą.
      person: { seeking_pl: "Polski", seeking_en: "English" },
      lang: "de",
      oczekiwane: "Polski",
    },
  ])("$nazwa", ({ person, lang, oczekiwane }) => {
    expect(seekingText(person, lang)).toBe(oczekiwane);
  });

  it("zachowuje treść z otaczającymi spacjami w postaci obciętej", () => {
    expect(seekingText({ seeking_pl: "  Szukam  ", seeking_en: null }, "pl")).toBe("Szukam");
  });
});

describe("peopleFiltersFromSearch - filtr z adresu odtwarza widok", () => {
  it("pusty adres daje filtry puste, nie undefined", () => {
    // `null` znaczy „bez filtru" dla warstwy zapytań; `undefined` weszłoby do
    // łańcucha jako `.eq("col", undefined)`, czyli filtr na wartości nieznanej.
    expect(peopleFiltersFromSearch({})).toEqual({
      specialization: null,
      company: null,
      location: null,
      jobTitle: null,
      verifiedOnly: false,
      openTo: [],
      semantic: false,
    });
  });

  it("przepisuje wszystkie filtry tekstowe, w tym `role` -> `jobTitle`", () => {
    // Nazwa pola w adresie (`role`) różni się od nazwy w warstwie zapytań
    // (`jobTitle`) - to jedyne miejsce, gdzie to tłumaczenie istnieje.
    expect(
      peopleFiltersFromSearch({
        specialization: "prawo",
        company: "NES",
        location: "Bruksela",
        role: "analityk",
      }),
    ).toMatchObject({
      specialization: "prawo",
      company: "NES",
      location: "Bruksela",
      jobTitle: "analityk",
    });
  });

  it.each([
    { raw: "1", oczekiwane: true },
    { raw: "0", oczekiwane: false },
    { raw: "true", oczekiwane: false },
    { raw: "", oczekiwane: false },
  ])("`verified=$raw` -> $oczekiwane", ({ raw, oczekiwane }) => {
    // Przełącznik jest włączany WYŁĄCZNIE dokładną wartością "1"; śmieć
    // w adresie nie może włączyć filtru weryfikacji.
    expect(peopleFiltersFromSearch({ verified: raw }).verifiedOnly).toBe(oczekiwane);
  });

  it.each([
    { raw: "1", oczekiwane: true },
    { raw: "0", oczekiwane: false },
    { raw: "yes", oczekiwane: false },
  ])("`sem=$raw` -> szukanie semantyczne $oczekiwane", ({ raw, oczekiwane }) => {
    expect(peopleFiltersFromSearch({ sem: raw }).semantic).toBe(oczekiwane);
  });

  it("intencje przechodzą przez normalizację, a nie wprost z adresu", () => {
    // Bez normalizacji śmieć z adresu wszedłby do zapytania jako kod intencji.
    const openTo = peopleFiltersFromSearch({ open: "hiring,nie-ma-takiej-intencji" }).openTo;
    expect(Array.isArray(openTo)).toBe(true);
    expect(openTo).not.toContain("nie-ma-takiej-intencji");
  });

  it("brak parametru intencji daje pustą listę, nie undefined", () => {
    expect(peopleFiltersFromSearch({}).openTo).toEqual([]);
  });
});

describe("peopleEmptyKey - pusty wynik musi mówić prawdę", () => {
  it.each([
    {
      nazwa: "aktywne filtry - komunikat o filtrach wygrywa nawet z frazą",
      wejscie: { hasActiveFilters: true, hasQuery: true },
      klucz: "people.emptyFiltered",
    },
    {
      nazwa: "aktywne filtry bez frazy",
      wejscie: { hasActiveFilters: true, hasQuery: false },
      klucz: "people.emptyFiltered",
    },
    {
      nazwa: "sama fraza - brak wyników szukania",
      wejscie: { hasActiveFilters: false, hasQuery: true },
      klucz: "people.empty",
    },
    {
      nazwa: "ani filtrów, ani frazy - katalog jest pusty",
      // Ten komunikat mówi coś innego: nie „nie znaleziono", a „nie ma jeszcze
      // profili". Pomylenie ich zostawia czytelnika bez podpowiedzi.
      wejscie: { hasActiveFilters: false, hasQuery: false },
      klucz: "people.emptyDirectory",
    },
  ])("$nazwa -> $klucz", ({ wejscie, klucz }) => {
    expect(peopleEmptyKey(wejscie)).toBe(klucz);
  });

  it("zwraca KLUCZ, nie gotowy tekst", () => {
    // Warunek i18n: bramka parytetu PL/EN ma co porównywać tylko wtedy, gdy
    // funkcja oddaje klucz.
    for (const wejscie of [
      { hasActiveFilters: true, hasQuery: true },
      { hasActiveFilters: false, hasQuery: true },
      { hasActiveFilters: false, hasQuery: false },
    ]) {
      expect(peopleEmptyKey(wejscie)).toMatch(/^people\.[A-Za-z]+$/);
    }
  });
});
