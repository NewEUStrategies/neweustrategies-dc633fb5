// Lista czytelnicza GOŚCIA w `localStorage`.
//
// CO TO DOWODZI. Gość zapisuje artykuły przed zalogowaniem, a jedynym
// magazynem jest `localStorage`. Uszkodzona wartość - ręczna edycja, obcięty
// zapis, wpis z innej wersji aplikacji - NIE MOŻE wywalić renderu listy
// czytelniczej: `JSON.parse` w komponencie to wyjątek w drzewie Reacta, czyli
// biały ekran na stronie, którą czytelnik sam sobie zbudował.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. `useSaveArticle` (zapis, wygaśnięcie wpisów
// gościa, scalanie po zalogowaniu) ma własne testy w
// `src/hooks/__tests__/useSaveArticle.test.tsx`. Tutaj chodzi wyłącznie
// o ODCZYT i o to, co uznajemy za poprawny zapis.
//
// ZACHOWANIE ZASTANE, NIE ULEPSZONE - przypięte świadomie: moduł NIE
// deduplikuje po adresie, NIE ma limitu długości listy i NIE odsiewa wpisów
// przeterminowanych. Każda z tych zmian jest zmianą tego, co czytelnik widzi,
// więc należy do osobnej decyzji, nie do pracy testowej.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GUEST_SAVED_ARTICLES_KEY } from "@/lib/storageKeys";
import {
  parseGuestSaved,
  readGuestSaved,
  withoutGuestSaved,
  writeGuestSaved,
  type GuestSavedItem,
} from "../guestSaved";

const KEY = GUEST_SAVED_ARTICLES_KEY.key;

function item(url: string, title = "Tytuł", savedAt = 1_000): GuestSavedItem {
  return { url, title, savedAt };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("parseGuestSaved - nic nie może rzucić", () => {
  it("czyta poprawną listę", () => {
    const raw = JSON.stringify([item("/a"), item("/b")]);
    expect(parseGuestSaved(raw).map((i) => i.url)).toEqual(["/a", "/b"]);
  });

  it.each([
    { nazwa: "brak wartości", raw: null },
    { nazwa: "pusty ciąg", raw: "" },
    { nazwa: "uszkodzony JSON", raw: "[{" },
    { nazwa: "obcięty zapis", raw: '[{"url":"/a"' },
    { nazwa: "nie-tablica: obiekt", raw: '{"url":"/a"}' },
    { nazwa: "nie-tablica: liczba", raw: "42" },
    { nazwa: "nie-tablica: tekst", raw: '"lista"' },
    { nazwa: "nie-tablica: null", raw: "null" },
  ])("$nazwa daje pustą listę, nie wyjątek", ({ raw }) => {
    expect(() => parseGuestSaved(raw)).not.toThrow();
    expect(parseGuestSaved(raw)).toEqual([]);
  });

  it("odsiewa elementy o złym kształcie, zachowując poprawne", () => {
    // Jedno uszkodzone wejście nie może zabrać czytelnikowi całej listy.
    const raw = JSON.stringify([
      item("/ok-1"),
      null,
      42,
      "tekst",
      { title: "bez adresu" },
      { url: 7 },
      [],
      item("/ok-2"),
    ]);
    expect(parseGuestSaved(raw).map((i) => i.url)).toEqual(["/ok-1", "/ok-2"]);
  });

  it("wymaga WYŁĄCZNIE adresu - taką regułę miała trasa", () => {
    // Wpis bez tytułu i bez znacznika czasu zostaje: adres wystarcza, żeby
    // pozycja była klikalna.
    expect(parseGuestSaved(JSON.stringify([{ url: "/a" }]))).toEqual([{ url: "/a" }]);
  });

  it("NIE deduplikuje po adresie - zachowanie zastane", () => {
    // Widok używa `url` jako `key` listy Reacta, więc duplikat daje ostrzeżenie
    // o zduplikowanym kluczu. Zmiana tego jest zmianą zachowania widoku.
    const raw = JSON.stringify([item("/a"), item("/a")]);
    expect(parseGuestSaved(raw)).toHaveLength(2);
  });

  it("NIE ma limitu długości listy - zachowanie zastane", () => {
    const raw = JSON.stringify(Array.from({ length: 250 }, (_, i) => item(`/a-${i}`)));
    expect(parseGuestSaved(raw)).toHaveLength(250);
  });

  it("NIE odsiewa wpisów starych - wygaśnięcie egzekwuje zapis, nie odczyt", () => {
    const raw = JSON.stringify([item("/stary", "Stary", 0)]);
    expect(parseGuestSaved(raw)).toHaveLength(1);
  });
});

describe("readGuestSaved", () => {
  it("czyta listę z magazynu przeglądarki", () => {
    localStorage.setItem(KEY, JSON.stringify([item("/a")]));
    expect(readGuestSaved().map((i) => i.url)).toEqual(["/a"]);
  });

  it("brak klucza daje pustą listę", () => {
    expect(readGuestSaved()).toEqual([]);
  });

  it("uszkodzona wartość w magazynie daje pustą listę", () => {
    localStorage.setItem(KEY, "{{{");
    expect(readGuestSaved()).toEqual([]);
  });
});

describe("writeGuestSaved", () => {
  it("zapisuje listę i zgłasza sukces", () => {
    expect(writeGuestSaved([item("/a")])).toBe(true);
    expect(parseGuestSaved(localStorage.getItem(KEY)).map((i) => i.url)).toEqual(["/a"]);
  });

  it("pusta lista jest poprawnym zapisem", () => {
    // Usunięcie ostatniej pozycji musi zapisać `[]`, a nie zostawić starą listę.
    writeGuestSaved([item("/a")]);
    expect(writeGuestSaved([])).toBe(true);
    expect(readGuestSaved()).toEqual([]);
  });

  it("odmowa magazynu jest zgłaszana WYNIKIEM, nie wyjątkiem", () => {
    // Tryb prywatny Safari i wyczerpany limit odmawiają zapisu. Czytelnik nie
    // może zobaczyć efektu kliknięcia, którego w magazynie nie ma - dlatego
    // funkcja zwraca `false`, a nie rzuca.
    // Podmiana na INSTANCJI, nie na `Storage.prototype`: w happy-dom metody
    // magazynu nie są dziedziczone z prototypu, więc nadpisanie prototypu
    // nie przechwytuje wywołania (sprawdzone - test przechodził na zielono
    // przy rzucającym prototypie, czyli nie dowodził niczego).
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      expect(writeGuestSaved([item("/a")])).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("withoutGuestSaved", () => {
  it("usuwa pozycję po adresie", () => {
    const items = [item("/a"), item("/b"), item("/c")];
    expect(withoutGuestSaved(items, "/b").map((i) => i.url)).toEqual(["/a", "/c"]);
  });

  it("usuwa WSZYSTKIE wystąpienia tego samego adresu", () => {
    // Skoro moduł dopuszcza duplikaty, usunięcie musi wyczyścić wszystkie -
    // inaczej kliknięcie „usuń" zostawia pozycję na liście.
    const items = [item("/a"), item("/a"), item("/b")];
    expect(withoutGuestSaved(items, "/a").map((i) => i.url)).toEqual(["/b"]);
  });

  it("nieznany adres nie zmienia listy", () => {
    const items = [item("/a")];
    expect(withoutGuestSaved(items, "/nie-ma")).toEqual(items);
  });

  it("nie mutuje wejścia", () => {
    const items = [item("/a"), item("/b")];
    withoutGuestSaved(items, "/a");
    expect(items).toHaveLength(2);
  });
});
