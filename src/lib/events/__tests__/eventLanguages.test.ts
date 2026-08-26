// Testy katalogu jezykow TRESCI wydarzenia.
//
// `events.languages` jedzie do bazy jako tablica kodow i wraca do uczestnika
// jako zdanie „sesje po polsku i angielsku". Dwa wymagania trzymaja ten kontrakt
// w ryzach: do bazy wchodza WYLACZNIE kody ISO 639-1 (ewentualnie z regionem),
// a na ekranie lista stoi posortowana NAZWA w jezyku interfejsu - bo lista
// posortowana po kodzie jest nieprzeszukiwalna wzrokiem w obu jezykach naraz.
import { describe, expect, it } from "vitest";
import {
  EVENT_CONTENT_LANGUAGES,
  EVENT_DEFAULT_LANGUAGES,
  eventLanguageLabel,
  eventLanguageOptions,
  normalizeEventLanguages,
} from "@/lib/events/eventLanguages";

describe("normalizacja listy jezykow do zapisu", () => {
  it("usuwa duplikaty, schodzi do malych liter i obcina biale znaki", () => {
    expect(normalizeEventLanguages(["PL", " pl ", "pl", "EN"])).toEqual(["en", "pl"]);
  });

  it("odrzuca wszystko, co nie jest kodem `xx` ani `xx-yy`", () => {
    expect(
      normalizeEventLanguages(["polski", "p", "en_US", "", "   ", "123", "english", "pl-PL-x"]),
    ).toEqual([]);
  });

  it("przyjmuje kod z regionem i sprowadza go do malych liter", () => {
    expect(normalizeEventLanguages(["en-US", "PT-br"])).toEqual(["en-us", "pt-br"]);
  });

  it("zwraca liste posortowana, a nie w kolejnosci klikniec", () => {
    expect(normalizeEventLanguages(["uk", "de", "pl", "ar", "en"])).toEqual([
      "ar",
      "de",
      "en",
      "pl",
      "uk",
    ]);
  });

  it("pusta lista zostaje pusta", () => {
    expect(normalizeEventLanguages([])).toEqual([]);
  });

  it("jest idempotentna - drugi przebieg nic nie zmienia", () => {
    const once = normalizeEventLanguages([" PL", "en", "EN"]);
    expect(normalizeEventLanguages(once)).toEqual(once);
  });

  it("domyslny zestaw wydarzenia przechodzi normalizacje bez zmian", () => {
    expect(normalizeEventLanguages(EVENT_DEFAULT_LANGUAGES)).toEqual(["en", "pl"]);
  });

  it("caly katalog panelu przechodzi wlasna walidacje", () => {
    // Kod dodany do katalogu, ale odrzucany przez normalizacje, bylby pozycja
    // na checkliscie, ktorej nie da sie zapisac.
    expect(normalizeEventLanguages(EVENT_CONTENT_LANGUAGES)).toHaveLength(
      EVENT_CONTENT_LANGUAGES.length,
    );
  });
});

describe("katalog jezykow do checklisty", () => {
  it("oferuje komplet kodow z katalogu, bez gubienia i bez dokladania", () => {
    const options = eventLanguageOptions("pl");
    expect(options).toHaveLength(EVENT_CONTENT_LANGUAGES.length);
    expect(options.map((option) => option.code).sort()).toEqual(
      [...EVENT_CONTENT_LANGUAGES].sort(),
    );
  });

  it("zawiera polski i angielski - jezyki domyslne wydarzenia", () => {
    const codes = eventLanguageOptions("pl").map((option) => option.code);
    expect(codes).toContain("pl");
    expect(codes).toContain("en");
  });

  it("stoi posortowany NAZWA w jezyku interfejsu, a nie kodem", () => {
    for (const ui of ["pl", "en"]) {
      const labels = eventLanguageOptions(ui).map((option) => option.label);
      const sorted = [...labels].sort((a, b) => a.localeCompare(b, ui));
      expect(labels).toEqual(sorted);
    }
  });

  it("ten sam kod dostaje inne miejsce w liscie polskiej i angielskiej", () => {
    // Dowod, ze sortowanie idzie po nazwie: „Niemiecki" i „German" nie stoja
    // w tym samym miejscu alfabetu.
    const pl = eventLanguageOptions("pl").map((option) => option.code);
    const en = eventLanguageOptions("en").map((option) => option.code);
    expect(pl).not.toEqual(en);
  });

  it("kazda pozycja ma niepusta etykiete zaczynajaca sie wielka litera", () => {
    for (const option of eventLanguageOptions("pl")) {
      expect(option.label).not.toBe("");
      expect(option.label.charAt(0)).toBe(option.label.charAt(0).toLocaleUpperCase("pl"));
    }
  });
});

describe("nazwa jezyka", () => {
  it("oddaje nazwe w jezyku interfejsu, nie w jezyku kodu", () => {
    expect(eventLanguageLabel("pl", "pl")).toBe("Polski");
    expect(eventLanguageLabel("pl", "en")).toBe("Polish");
    expect(eventLanguageLabel("de", "pl")).toBe("Niemiecki");
    expect(eventLanguageLabel("de", "en")).toBe("German");
  });

  it("powtorne wywolanie daje ten sam wynik - pamiec podreczna nie psuje danych", () => {
    expect(eventLanguageLabel("uk", "pl")).toBe(eventLanguageLabel("uk", "pl"));
    expect(eventLanguageLabel("uk", "pl")).not.toBe(eventLanguageLabel("uk", "en"));
  });

  it("kod, ktorego `Intl` nie przyjmuje, degraduje do samego kodu zamiast rzucac", () => {
    // `Intl.DisplayNames.of` rzuca `RangeError` na napisie, ktory nie jest
    // poprawnym tagiem jezyka - a etykieta w checkliscie nie ma prawa wywrocic
    // ekranu tylko dlatego, ze w kolumnie zostal smiec po imporcie.
    expect(eventLanguageLabel("nie jest kodem", "pl")).toBe("nie jest kodem");
    expect(eventLanguageLabel("x", "pl")).toBe("x");
    expect(eventLanguageLabel("", "pl")).toBe("");
  });
});
