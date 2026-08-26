// Adres strukturalny wydarzenia: jedna linia i odnosnik do map.
//
// TEN MODUL MA DWA WEJSCIA I MUSI DAWAC JEDNO WYJSCIE. Panel podaje szkic
// formularza (pola sa pustymi napisami), a strona publiczna wiersz z bazy
// (pola sa nullami). Test sprawdza obie postacie wprost, bo rozjazd miedzy
// nimi konczy sie adresem widocznym w panelu i nieobecnym na stronie - czyli
// dokladnie tym bledem, ktory ten modul mial zamknac.
import { describe, expect, it } from "vitest";

import { eventAddressLine, eventMapUrl } from "@/lib/events/eventAddress";

const FULL = {
  streetAddress: "Krucza 1",
  postalCode: "00-001",
  city: "Warszawa",
  region: "mazowieckie",
  country: "Polska",
};

describe("eventAddressLine", () => {
  it("skleja kod pocztowy z miastem w JEDEN czlon", () => {
    expect(eventAddressLine(FULL)).toBe("Krucza 1, 00-001 Warszawa, mazowieckie, Polska");
  });

  it("pomija czlony puste, zamiast zostawiac przecinki", () => {
    expect(eventAddressLine({ ...FULL, streetAddress: "", region: "", country: "" })).toBe(
      "00-001 Warszawa",
    );
    expect(eventAddressLine({ ...FULL, postalCode: "", region: "" })).toBe(
      "Krucza 1, Warszawa, Polska",
    );
    expect(eventAddressLine({ ...FULL, city: "", postalCode: "" })).toBe(
      "Krucza 1, mazowieckie, Polska",
    );
  });

  it("czyta `null` z kolumny tak samo jak pusty napis ze szkicu", () => {
    expect(
      eventAddressLine({
        streetAddress: null,
        postalCode: null,
        city: "Bruksela",
        region: null,
        country: "Belgia",
      }),
    ).toBe("Bruksela, Belgia");
  });

  it("obiekt bez zadnego pola daje pusty napis, a nie wywraca sie", () => {
    expect(eventAddressLine({})).toBe("");
  });

  it("bialy znak nie jest trescia - same spacje daja pusty napis", () => {
    expect(
      eventAddressLine({
        streetAddress: " ",
        postalCode: " ",
        city: " ",
        region: " ",
        country: " ",
      }),
    ).toBe("");
  });
});

describe("eventMapUrl", () => {
  it("buduje zapytanie `?api=1&query=` z calego adresu", () => {
    expect(eventMapUrl(FULL)).toBe(
      "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent("Krucza 1, 00-001 Warszawa, mazowieckie, Polska"),
    );
  });

  it("koduje przecinki i znaki narodowe, zeby nie rozjechac parametru", () => {
    const url = eventMapUrl({ city: "Kraków", country: "Polska" });
    // Przecinek i spacja nie moga zostac dosłownie w wartosci parametru.
    expect(url).toContain("%2C%20");
    expect(url).not.toContain("Kraków");
    expect(url).toContain(encodeURIComponent("Kraków"));
  });

  it("bez adresu zwraca null, zamiast prowadzic w puste wyszukiwanie", () => {
    expect(eventMapUrl({})).toBeNull();
    expect(eventMapUrl({ city: "   ", country: null })).toBeNull();
  });
});
