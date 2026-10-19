// LISTA MIESZANA Z WORDA - typ listy PER POZYCJA (`itemsOrdered`) jedzie razem
// z pozycją przy Enterze i Backspace.
//
// PO CO OSOBNY PLIK. Wklejka listy wielopoziomowej z Worda, w której poziomy
// mają różne typy (numerowane kroki, a pod nimi punktowane uwagi), zapisuje
// obok `items` i `levels` trzecią tablicę równoległą: `itemsOrdered`
// (`wordPaste.ts`). Render publiczny czyta ją INDEKSEM pozycji
// (`orderedRaw[i]` w `renderList`), dokładnie tak jak `levels`.
//
// DEFEKT (naprawiony 2026-10-18). Edytor listy wstawiał i usuwał pozycje
// w `items` i `levels`, ale `itemsOrdered` zostawiał bez zmian. Po Enterze
// na pierwszym kroku każda pozycja za kursorem dostawała typ POPRZEDNICZKI:
// punktowana uwaga stawała się na stronie numerowanym krokiem, a nowa pusta
// pozycja - punktem. Po Backspace na pustej pozycji - przesunięcie w drugą
// stronę. Redaktor nie widział tego w panelu (edytor rysuje jedną listę),
// tylko czytelnik na stronie.
//
// CO MA TU DOWÓD
//  * Enter wstawia do `itemsOrdered` typ BIEŻĄCEJ pozycji (jak poziom),
//    a pozycje za nią zachowują swoje typy,
//  * Backspace na pustej pozycji usuwa także jej typ,
//  * tablica krótsza od listy jest dopełniana typem całej listy (`ordered`) -
//    tak samo czyta ją render publiczny,
//  * lista BEZ `itemsOrdered` (zwykła) nie dostaje tego klucza, a edycja
//    treści pozycji nie rusza go wcale.
//
// GRANICE. Fabryki `vi.mock` niesie moduł wspólny tabeli edytorów, dlatego
// jego import jest PIERWSZY. Pozycje to prawdziwy `InlineHtmlEditable`.
import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, Json } from "@/lib/blocks/types";
import { ListBlockEdit } from "../ListBlock";

function lista(data: Record<string, Json>): Block {
  return { id: "blk-lista", type: "list", data };
}

function pozycje(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-field="list-item"]'));
}

function ostatni(changes: readonly Block[]): Block {
  const zapis = changes.at(-1);
  if (!zapis) throw new Error("edytor nie zapisał niczego");
  expect({ id: zapis.id, type: zapis.type }).toEqual({ id: "blk-lista", type: "list" });
  return zapis;
}

// Kształt z wklejki Worda: kroki numerowane, pod pierwszym punktowana uwaga.
const KROKI = {
  ordered: true,
  items: ["Krok 1", "Uwaga", "Krok 2"],
  levels: [1, 2, 1],
  itemsOrdered: [true, false, true],
};

describe("lista mieszana - typ pozycji idzie za pozycją", () => {
  it("Enter na kroku wstawia pozycję tego samego typu, a uwaga zostaje punktowana", () => {
    const { container, changes } = renderEditor(ListBlockEdit, lista(KROKI));
    fireEvent.keyDown(pozycje(container)[0], { key: "Enter" });
    const zapis = ostatni(changes);
    expect(zapis.data.items).toEqual(["Krok 1", "", "Uwaga", "Krok 2"]);
    expect(zapis.data.levels).toEqual([1, 1, 2, 1]);
    expect(zapis.data.itemsOrdered).toEqual([true, true, false, true]);
  });

  it("Enter na uwadze wstawia kolejną PUNKTOWANĄ uwagę na jej poziomie", () => {
    const { container, changes } = renderEditor(ListBlockEdit, lista(KROKI));
    fireEvent.keyDown(pozycje(container)[1], { key: "Enter" });
    const zapis = ostatni(changes);
    expect(zapis.data.levels).toEqual([1, 2, 2, 1]);
    expect(zapis.data.itemsOrdered).toEqual([true, false, false, true]);
  });

  it("Backspace na pustej pozycji usuwa także jej typ - kolejne nie zmieniają typu", () => {
    const { container, changes } = renderEditor(
      ListBlockEdit,
      lista({
        ordered: true,
        items: ["Krok 1", "", "Uwaga"],
        levels: [1, 1, 2],
        itemsOrdered: [true, true, false],
      }),
    );
    fireEvent.keyDown(pozycje(container)[1], { key: "Backspace" });
    const zapis = ostatni(changes);
    expect(zapis.data.items).toEqual(["Krok 1", "Uwaga"]);
    expect(zapis.data.itemsOrdered).toEqual([true, false]);
  });

  it("tablica typów krótsza od listy jest dopełniana typem CAŁEJ listy", () => {
    // Render publiczny: `typeof orderedRaw[i] === "boolean" ? orderedRaw[i] : ordered`.
    const { container, changes } = renderEditor(
      ListBlockEdit,
      lista({ ordered: true, items: ["a", "b"], levels: [1, 2], itemsOrdered: [false] }),
    );
    fireEvent.keyDown(pozycje(container)[1], { key: "Enter" });
    expect(ostatni(changes).data.itemsOrdered).toEqual([false, true, true]);
  });
});

describe("lista zwykła i edycja treści", () => {
  it("lista BEZ typów per pozycja nie dostaje klucza `itemsOrdered`", () => {
    const { container, changes } = renderEditor(
      ListBlockEdit,
      lista({ ordered: true, items: ["a", "b"] }),
    );
    fireEvent.keyDown(pozycje(container)[0], { key: "Enter" });
    expect("itemsOrdered" in ostatni(changes).data).toBe(false);
  });

  it("wpis w pozycję zostawia typy pozycji DOKŁADNIE takie, jakie były", () => {
    const { container, changes } = renderEditor(ListBlockEdit, lista(KROKI));
    const uwaga = pozycje(container)[1];
    uwaga.innerHTML = "Uwaga: sprawdź dane";
    fireEvent.input(uwaga);
    const zapis = ostatni(changes);
    expect(zapis.data.items).toEqual(["Krok 1", "Uwaga: sprawdź dane", "Krok 2"]);
    expect(zapis.data.itemsOrdered).toEqual([true, false, true]);
  });
});
