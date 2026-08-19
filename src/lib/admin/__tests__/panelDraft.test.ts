// Reguły wspólne czterech paneli modułu 1. Każda z nich istniała wcześniej w
// kilku rozjechanych kopiach wprost w komponentach - test pilnuje umowy, którą
// scalenie ustaliło, a nie „czy funkcja się wykonała".
import { describe, it, expect } from "vitest";
import { clampNumber, draftDirty, toggleIndex } from "@/lib/admin/panelDraft";

describe("draftDirty - czy panel ma niezapisane zmiany", () => {
  it("identyczna treść nie jest zmianą (przycisk zapisu zostaje wyłączony)", () => {
    const persisted = { enabled: true, position: 3 };
    expect(draftDirty({ enabled: true, position: 3 }, persisted)).toBe(false);
    expect(draftDirty(persisted, persisted)).toBe(false);
  });

  it("zmiana JEDNEGO pola zapala niezapisane zmiany", () => {
    expect(draftDirty({ enabled: true, position: 4 }, { enabled: true, position: 3 })).toBe(true);
    expect(draftDirty({ enabled: false, position: 3 }, { enabled: true, position: 3 })).toBe(true);
  });

  it("zmiana w ZAGNIEŻDŻONYM obiekcie też się liczy (kolory ToC siedzą o poziom głębiej)", () => {
    const persisted = { colors: { bg: "#fff", accent: "#f00" } };
    expect(draftDirty({ colors: { bg: "#fff", accent: "#f00" } }, persisted)).toBe(false);
    expect(draftDirty({ colors: { bg: "#000", accent: "#f00" } }, persisted)).toBe(true);
  });

  it("PRZYPIĘTA WŁAŚCIWOŚĆ: inna KOLEJNOŚĆ kluczy czyta się jako zmiana", () => {
    // Porównanie idzie przez `JSON.stringify`, więc kolejność ma znaczenie.
    // Panele budują szkic przez rozwinięcie poprzedniego stanu, co kolejność
    // zachowuje - ale szkic zbudowany od zera (np. z odpowiedzi serwera)
    // zapaliłby „niezapisane zmiany" przy identycznej treści.
    expect(draftDirty({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(draftDirty({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(false);
  });

  it("brak wartości i wartość pusta to RÓŻNE stany", () => {
    expect(draftDirty({ title: "" }, { title: undefined })).toBe(true);
    expect(draftDirty({ title: null }, { title: undefined })).toBe(true);
  });
});

describe("clampNumber - przycięcie pola liczbowego do granic", () => {
  const bounds = { min: -1, max: 20 };

  it("wartość w zakresie przechodzi bez zmian, jako liczba", () => {
    expect(clampNumber("7", bounds)).toBe(7);
    expect(clampNumber(7, bounds)).toBe(7);
  });

  it("wartość PONAD górną granicą schodzi do maksimum (nie do bazy)", () => {
    expect(clampNumber("999", bounds)).toBe(20);
    expect(clampNumber(21, bounds)).toBe(20);
  });

  it("wartość PONIŻEJ dolnej granicy podchodzi do minimum", () => {
    expect(clampNumber("-50", bounds)).toBe(-1);
    expect(clampNumber(-2, bounds)).toBe(-1);
  });

  it("PUSTE pole czyta się jak zero, a nie jak dolna granica", () => {
    // Dla pozycji ToC dolna granica to -1, czyli „ukryj spis w treści".
    // Samo wyczyszczenie pola nie może wywołać ukrycia - stąd zero.
    expect(clampNumber("", bounds)).toBe(0);
    expect(Number.isNaN(clampNumber("", bounds))).toBe(false);
  });

  it("puste pole w polu o dolnej granicy DODATNIEJ schodzi do tej granicy", () => {
    expect(clampNumber("", { min: 1, max: 20 })).toBe(1);
    expect(clampNumber("", { min: 3, max: 9 })).toBe(3);
  });

  it("ŚMIECI w polu dają minimum, nie NaN (NaN zapisałby się jako null)", () => {
    expect(clampNumber("abc", bounds)).toBe(-1);
    expect(clampNumber("1,5", bounds)).toBe(-1);
  });

  it("nieskończoność nie przechodzi jako maksimum przez przypadek", () => {
    expect(clampNumber(Number.POSITIVE_INFINITY, bounds)).toBe(-1);
    expect(clampNumber(Number.NEGATIVE_INFINITY, bounds)).toBe(-1);
  });

  it("wartość niecałkowita jest zaokrąglana (wszystkie te pola są całkowite)", () => {
    expect(clampNumber("3.4", bounds)).toBe(3);
    expect(clampNumber("3.6", bounds)).toBe(4);
  });

  it("granice są ZAMKNIĘTE - min i max są dozwolonymi wartościami", () => {
    expect(clampNumber(-1, bounds)).toBe(-1);
    expect(clampNumber(20, bounds)).toBe(20);
  });
});

describe("toggleIndex - lista wybranych indeksów", () => {
  it("nowy indeks dochodzi do listy", () => {
    expect(toggleIndex([], 2)).toEqual([2]);
    expect(toggleIndex([0], 2)).toEqual([0, 2]);
  });

  it("obecny indeks wypada z listy", () => {
    expect(toggleIndex([0, 2], 2)).toEqual([0]);
    expect(toggleIndex([2], 2)).toEqual([]);
  });

  it("KOLEJNOŚĆ ROSNĄCA jest utrzymana (ten sam wiersz w bazie niezależnie od kliknięć)", () => {
    expect(toggleIndex([2, 0], 1)).toEqual([0, 1, 2]);
    expect(toggleIndex([5], 1)).toEqual([1, 5]);
  });

  it("nie mutuje wejścia (stan Reacta musi zostać nietknięty)", () => {
    const input = [0, 1];
    const out = toggleIndex(input, 2);
    expect(input).toEqual([0, 1]);
    expect(out).not.toBe(input);
  });
});
