// Czyste pomocniki panelu prezentow: mapa klas pigulki zdarzenia
// (EVENT_PILL_CLS) i straznik znanego typu (isKnownEventType).
//
// PO CO TEN PLIK ISTNIEJE. `GiftEventAdminRow.event_type` jest CELOWO otwartym
// stringiem (patrz komentarz w `lib/gifting-admin.functions.ts`): audyt ma
// pokazywac takze zdarzenia, ktorych ten build jeszcze nie zna. To znaczy, ze
// jedyne, co dzieli panel od `EVENT_PILL_CLS[undefined]` w klasie CSS - albo od
// wyjatku w renderze przy indeksowaniu mapy wartoscia spoza unii - jest
// `isKnownEventType`. Kompilator tego nie zlapie, bo po stronie danych typem
// jest `string`. Dlatego straznik dostaje test JAWNY, a nie tylko posrednio
// przez EventPill.
//
// Drugi dowod: mapa MUSI miec wpis dla kazdego typu z unii. Brak wpisu daje
// `undefined` w interpolacji klasy, czyli pigulke bez tla i bez ramki -
// wizualnie "znika" na tle wiersza, a nic nie pada.
import { describe, expect, it } from "vitest";
import { EVENT_PILL_CLS, isKnownEventType } from "@/components/admin/gifting/model";
import type { GiftEventType } from "@/lib/gifting-admin.functions";

/**
 * Lustro unii `GiftEventType`. Ta stala jest tu wypisana RECZNIE, zeby test
 * padl przy poszerzeniu unii bez poszerzenia mapy - `Object.keys(EVENT_PILL_CLS)`
 * porownane samo ze soba dowodzilo by wylacznie tautologii.
 */
const ALL_EVENT_TYPES: readonly GiftEventType[] = [
  "created",
  "redeemed",
  "revoked",
  "expired",
  "exhausted",
];

describe("EVENT_PILL_CLS", () => {
  it("ma wpis dla KAZDEGO znanego typu zdarzenia", () => {
    for (const type of ALL_EVENT_TYPES) {
      expect(EVENT_PILL_CLS[type], `brak klasy dla zdarzenia ${type}`).toBeTruthy();
    }
  });

  it("nie ma wpisow ponad unie (mapa nie rozjezdza sie z typem)", () => {
    expect(Object.keys(EVENT_PILL_CLS).sort()).toEqual([...ALL_EVENT_TYPES].sort());
  });

  it.each(ALL_EVENT_TYPES)("klasa dla %s niesie tlo, kolor tekstu i ramke", (type) => {
    // Pigulka bez ktorejkolwiek z trzech warstw czyta sie jak zwykly tekst -
    // a to jedyny sygnal typu zdarzenia w wierszu audytu.
    const cls = EVENT_PILL_CLS[type];
    expect(cls).toMatch(/\bbg-/);
    expect(cls).toMatch(/\btext-/);
    expect(cls).toMatch(/\bborder/);
  });

  it("rozroznia zdarzenia wizualnie - kazdy typ ma inna klase", () => {
    // Dwa typy z ta sama klasa znacza, ze pigulka przestaje niesc informacje.
    const values = Object.values(EVENT_PILL_CLS);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("isKnownEventType", () => {
  it.each(ALL_EVENT_TYPES)("przepuszcza znany typ %s", (type) => {
    expect(isKnownEventType(type)).toBe(true);
  });

  it.each([
    ["pusty napis", ""],
    ["typ z przyszlej migracji", "throttled"],
    ["inna wielkosc liter", "Created"],
    ["napis z bialymi znakami", " created "],
    ["wartosc numeryczna jako napis", "0"],
  ])("odrzuca %s", (_opis, value) => {
    expect(isKnownEventType(value)).toBe(false);
  });

  it("odrzuca nazwe wlasnosci dziedziczonej po Object - `hasOwnProperty`", () => {
    // Kontrola pozytywna dla it.fails ponizej: straznik ma odrzucac KAZDA
    // nazwe spoza mapy. Ten przypadek dzis przechodzi, bo happy-dom nie
    // dokleja `hasOwnProperty` jako wlasnosci wyliczalnej - wiec jesli kiedys
    // zacznie padac, to znaczy, ze zmienil sie sam obiekt mapy, a nie straznik.
    expect(Object.prototype.hasOwnProperty.call(EVENT_PILL_CLS, "hasOwnProperty")).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // DEFEKT (nienaprawiany w tym zadaniu - testy nie ruszaja kodu produkcyjnego).
  //
  // CO JEST ZLE. `isKnownEventType` jest zaimplementowany jako
  // `return type in EVENT_PILL_CLS`. Operator `in` przeszukuje CALY LANCUCH
  // PROTOTYPOW, nie same wlasnosci wlasne obiektu. `EVENT_PILL_CLS` to zwykly
  // literal obiektu, wiec dziedziczy po `Object.prototype` - a to znaczy, ze
  // straznik zwraca `true` dla "constructor", "toString", "valueOf",
  // "isPrototypeOf" i kilkunastu innych nazw. Deklaracja `type is GiftEventType`
  // jest wiec NIEPRAWDZIWA: predykat potwierdza przynaleznosc do unii dla
  // wartosci, ktorej w unii nie ma.
  //
  // DLACZEGO TO RYZYKO. Straznik istnieje wylacznie po to, zeby nieznany typ
  // zdarzenia dostal neutralna tonacje zamiast wysypac render (patrz komentarz
  // nad `EventPill`). Przy nazwie z prototypu ta obrona sie odwraca: EventPill
  // wchodzi w galaz "znany" i robi `EVENT_PILL_CLS["constructor"]`, czyli
  // wstawia do atrybutu `class` FUNKCJE (`function Object() { [native code] }`).
  // Zamiast pigulki w audycie laduje wtedy smiec w DOM. `event_type` jest
  // CELOWO otwartym stringiem po stronie typow (`GiftEventAdminRow`), a jedyne,
  // co dzis blokuje te wartosci, to CHECK w bazie - czyli warstwa, ktorej ten
  // modul swiadomie NIE traktuje jako gwarancji (inaczej straznik bylby zbedny).
  // Utrata tego CHECK-a, import historyczny albo nowe zrodlo zdarzen zamienia
  // luke teoretyczna w widoczna.
  //
  // DLACZEGO NIE NAPRAWIAM. Zadanie ma zakres testowy, a nie naprawczy.
  // Poprawka jest jednolinijkowa - `Object.prototype.hasOwnProperty.call(
  // EVENT_PILL_CLS, type)` albo `Object.hasOwn(EVENT_PILL_CLS, type)` - i po
  // niej ten wpis nalezy zamienic z `it.fails` na zwykle `it`.
  // ---------------------------------------------------------------------------
  it.fails("odrzuca nazwy z lancucha prototypu Object (DEFEKT: operator `in`)", () => {
    for (const name of ["constructor", "toString", "valueOf", "isPrototypeOf"]) {
      expect(isKnownEventType(name), `${name} nie jest typem zdarzenia`).toBe(false);
    }
  });
});
