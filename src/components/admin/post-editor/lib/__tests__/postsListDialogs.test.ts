import { describe, expect, it } from "vitest";
import {
  confirmPurgeMany,
  confirmPurgeOne,
  confirmRestoreMany,
  confirmRestoreOne,
  confirmTrashMany,
  confirmTrashOne,
  type PostsListConfirmCopy,
} from "../postsListDialogs";

const ALL = [
  confirmTrashOne("Wpis"),
  confirmTrashMany(3),
  confirmRestoreOne("Wpis"),
  confirmRestoreMany(3),
  confirmPurgeOne("Wpis"),
  confirmPurgeMany(3),
];

describe("okna potwierdzeń listy wpisów", () => {
  it("każde okno ma tytuł, opis i etykietę przycisku", () => {
    // Puste pole zostawiłoby użytkownika z oknem „ ” i przyciskiem
    // „Potwierdź” z domyślnego tłumaczenia - bez informacji, co potwierdza.
    for (const copy of ALL) {
      expect(copy.title.length, JSON.stringify(copy)).toBeGreaterThan(0);
      expect(copy.description.length, JSON.stringify(copy)).toBeGreaterThan(0);
      expect(copy.confirmLabel.length, JSON.stringify(copy)).toBeGreaterThan(0);
    }
  });

  it("REGRESJA: operacje zabierające wpis z widoku mają czerwony przycisk", () => {
    // `destructive` maluje przycisk potwierdzenia na czerwono. To jedyny
    // sygnał wizualny odróżniający „Usuń trwale” od „Przywróć” w tym samym
    // oknie - bez niego trwałe usunięcie wygląda jak każde inne potwierdzenie.
    expect(confirmTrashOne("W").destructive).toBe(true);
    expect(confirmTrashMany(2).destructive).toBe(true);
    expect(confirmPurgeOne("W").destructive).toBe(true);
    expect(confirmPurgeMany(2).destructive).toBe(true);
  });

  it("REGRESJA: przywracanie NIE jest oznaczone jako destrukcyjne", () => {
    // Przywrócenie z kosza tylko odbudowuje wpis. Czerwony przycisk
    // zniechęcałby do operacji bezpiecznej i rozmywał znaczenie koloru
    // w oknach, w których naprawdę o coś chodzi.
    expect(confirmRestoreOne("W").destructive).toBeUndefined();
    expect(confirmRestoreMany(2).destructive).toBeUndefined();
  });

  it("REGRESJA: kosz obiecuje powrót, usunięcie trwałe ostrzega przed brakiem powrotu", () => {
    // Te dwa okna wywołuje sąsiadująca para ikon kosza (na liście aktywnej
    // i w koszu). Zamiana treści oznaczałaby, że użytkownik kasuje archiwum
    // w przekonaniu, że jeszcze je odzyska.
    expect(confirmTrashOne("W").description).toContain("przywrócić");
    expect(confirmTrashOne("W").description).not.toContain("nie można cofnąć");
    expect(confirmPurgeOne("W").description).toContain("nie można cofnąć");
    expect(confirmPurgeMany(5).description).toContain("nie można cofnąć");
  });

  it("okna pojedyncze niosą TYTUŁ wpisu, którego dotyczą", () => {
    // Ikony akcji stoją w wierszu bez etykiety - tytuł w oknie jest jedynym
    // potwierdzeniem, że kliknięto właściwy wiersz.
    expect(confirmTrashOne("Szczyt w Brukseli").description).toContain("Szczyt w Brukseli");
    expect(confirmRestoreOne("Szczyt w Brukseli").description).toContain("Szczyt w Brukseli");
    expect(confirmPurgeOne("Szczyt w Brukseli").description).toContain("Szczyt w Brukseli");
  });

  it("okna masowe niosą LICZBĘ zaznaczonych wpisów", () => {
    expect(confirmTrashMany(12).title).toBe("Przenieść do kosza 12 wpisów?");
    expect(confirmRestoreMany(12).title).toBe("Przywrócić 12 wpisów?");
    expect(confirmPurgeMany(12).title).toBe("Usunąć trwale 12 wpisów?");
  });

  it("liczba w tytule pochodzi z argumentu, nie ze stałej", () => {
    // Rozjazd liczby z zaznaczeniem to najgorszy możliwy błąd tego okna:
    // użytkownik zatwierdza usunięcie „3 wpisów”, a znika ich czterdzieści.
    expect(confirmPurgeMany(1).title).toContain("1");
    expect(confirmPurgeMany(40).title).toContain("40");
    expect(confirmPurgeMany(0).title).toContain("0");
  });

  it("etykiety przycisków nazywają operację, a nie samo potwierdzenie", () => {
    // „OK” nie mówi, co się zaraz stanie. Etykieta jest ostatnią rzeczą,
    // którą użytkownik czyta przed kliknięciem.
    const labels = ALL.map((c: PostsListConfirmCopy) => c.confirmLabel);
    expect(labels).toEqual([
      "Przenieś do kosza",
      "Przenieś do kosza",
      "Przywróć",
      "Przywróć",
      "Usuń trwale",
      "Usuń trwale",
    ]);
  });

  it("stan zastany: treść okien jest po polsku na sztywno, poza i18n", () => {
    // Reszta listy tłumaczy się przez `t(...)`, te sześć okien nie -
    // anglojęzyczny administrator dostaje polskie okno przy operacji
    // nieodwracalnej. Przypięte, bo naprawa wymaga decyzji redakcyjnej
    // o brzmieniu kluczy PL/EN (i ich dodania w obu nakładkach), a nie samej
    // zmiany technicznej. Zgłoszone w raporcie modułu.
    expect(ALL.map((c: PostsListConfirmCopy) => c.title)).toEqual([
      "Przenieść do kosza?",
      "Przenieść do kosza 3 wpisów?",
      "Przywrócić wpis?",
      "Przywrócić 3 wpisów?",
      "Usunąć trwale?",
      "Usunąć trwale 3 wpisów?",
    ]);
  });
});
