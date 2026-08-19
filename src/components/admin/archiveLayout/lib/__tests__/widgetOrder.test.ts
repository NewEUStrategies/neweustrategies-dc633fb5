// Kolejność i skład panelu bocznego archiwum. Reguła wyjęta z ciała
// `ArchiveLayoutAdmin.tsx` (patrz nagłówek `widgetOrder.ts`).
//
// To ta lista decyduje, CO widzi czytelnik obok wyników kategorii i w jakiej
// kolejności. Trzy rzeczy mogą się tu zepsuć po cichu: duplikat wpisu po
// ponownym kliknięciu przełącznika, mutacja tablicy w miejscu (panel nie
// przerysowuje się, bo referencja się nie zmienia) i ruch poza zakres na
// krańcach listy.
import { describe, expect, it } from "vitest";
import { moveWidget, toggleWidget } from "../widgetOrder";
import type { SidebarWidgetKey } from "@/lib/archive-layout-settings";

const ALL: SidebarWidgetKey[] = ["popular", "related", "newsletter", "ads"];

describe("moveWidget", () => {
  it("przesuwa wpis w górę", () => {
    expect(moveWidget(ALL, "related", -1)).toEqual(["related", "popular", "newsletter", "ads"]);
  });

  it("przesuwa wpis w dół", () => {
    expect(moveWidget(ALL, "popular", 1)).toEqual(["related", "popular", "newsletter", "ads"]);
  });

  it("NIE MUTUJE wejścia - panel trzyma listę w stanie Reacta", () => {
    // Mutacja w miejscu nie zmieniłaby referencji, więc React nie
    // przerysowałby panelu bocznego i podglądu na żywo.
    const input = [...ALL];
    moveWidget(input, "related", -1);
    expect(input).toEqual(ALL);
  });

  it("na SZCZYCIE listy ruch w górę nic nie zmienia", () => {
    expect(moveWidget(ALL, "popular", -1)).toEqual(ALL);
  });

  it("na KOŃCU listy ruch w dół nic nie zmienia", () => {
    expect(moveWidget(ALL, "ads", 1)).toEqual(ALL);
  });

  it("oddaje TĘ SAMĄ referencję, gdy ruch jest niemożliwy", () => {
    // Panel porównuje referencje, żeby nie odnotowywać zmiany tam, gdzie
    // nic się nie stało.
    expect(moveWidget(ALL, "popular", -1)).toBe(ALL);
    expect(moveWidget(ALL, "ads", 1)).toBe(ALL);
  });

  it("widget spoza listy nie da się przesunąć", () => {
    const only: SidebarWidgetKey[] = ["popular"];
    expect(moveWidget(only, "ads", 1)).toBe(only);
    expect(moveWidget(only, "ads", -1)).toBe(only);
  });

  it("lista jednoelementowa jest odporna na oba kierunki", () => {
    const one: SidebarWidgetKey[] = ["ads"];
    expect(moveWidget(one, "ads", -1)).toBe(one);
    expect(moveWidget(one, "ads", 1)).toBe(one);
  });

  it("pusta lista jest odporna", () => {
    const empty: SidebarWidgetKey[] = [];
    expect(moveWidget(empty, "ads", 1)).toBe(empty);
  });

  it("seria ruchów przenosi wpis przez całą listę bez gubienia pozostałych", () => {
    let widgets: readonly SidebarWidgetKey[] = ALL;
    for (let i = 0; i < 3; i += 1) widgets = moveWidget(widgets, "popular", 1);

    expect(widgets).toEqual(["related", "newsletter", "ads", "popular"]);
    expect(new Set(widgets)).toEqual(new Set(ALL));
  });
});

describe("toggleWidget", () => {
  it("włączenie dokłada wpis NA KOŃCU", () => {
    // Redaktor porządkuje kolejność osobnymi strzałkami; wstawianie w środek
    // przestawiałoby to, co już ustawił.
    expect(toggleWidget(["popular"], "ads", true)).toEqual(["popular", "ads"]);
  });

  it("wyłączenie usuwa wpis, zostawiając kolejność reszty", () => {
    expect(toggleWidget(ALL, "newsletter", false)).toEqual(["popular", "related", "ads"]);
  });

  it("PONOWNE włączenie nie duplikuje wpisu", () => {
    // Duplikat renderowałby ten sam widget dwa razy w panelu bocznym.
    const once = toggleWidget(["popular"], "ads", true);
    expect(toggleWidget(once, "ads", true)).toEqual(["popular", "ads"]);
  });

  it("wyłączenie wpisu, którego nie ma, nic nie zmienia", () => {
    expect(toggleWidget(["popular"], "ads", false)).toEqual(["popular"]);
  });

  it("oddaje TĘ SAMĄ referencję, gdy stan już obowiązuje", () => {
    expect(toggleWidget(ALL, "popular", true)).toBe(ALL);
    expect(toggleWidget(["popular"], "ads", false)).toEqual(["popular"]);
  });

  it("NIE MUTUJE wejścia", () => {
    const input = [...ALL];
    toggleWidget(input, "popular", false);
    expect(input).toEqual(ALL);
  });

  it("da się wyłączyć WSZYSTKIE widgety", () => {
    // Pusty panel boczny jest uznawaną decyzją redaktora - `coerce` po stronie
    // danych nie zamienia pustej listy z powrotem na domyślną.
    let widgets: readonly SidebarWidgetKey[] = ALL;
    for (const key of ALL) widgets = toggleWidget(widgets, key, false);
    expect(widgets).toEqual([]);
  });

  it("da się odbudować pełną listę po wyczyszczeniu", () => {
    let widgets: readonly SidebarWidgetKey[] = [];
    for (const key of ALL) widgets = toggleWidget(widgets, key, true);
    expect(widgets).toEqual(ALL);
  });
});
