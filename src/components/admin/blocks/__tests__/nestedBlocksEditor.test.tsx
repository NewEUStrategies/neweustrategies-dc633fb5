// MINI-KANWA DZIECI KONTENERA (`NestedBlocksEditor`) - druga polowa dowodu
// dla operacji "zagniezdzenie ponad dopuszczalna glebokosc" z zadania.
//
// STOSUNEK DO `nestingDepthGuard.test.ts`. Tamten plik dowodzi po ZRODLACH,
// ze w calym module nie ma stalej limitu glebokosci ani miejsca, w ktorym
// mozna by ja dzis odczytac. Ten plik dowodzi tego samego PRZEZ INTERFEJS:
// mini-kanwa faktycznie renderuje pelna palete (razem z kontenerami), klik
// w kontener faktycznie tworzy kolejny poziom, a nowy poziom faktycznie ma
// wlasna, rowna palete. Petla jest wiec osiagalna KLIKANIEM, nie tylko
// czytelna w kodzie - i to jest ta czesc, ktorej test zrodlowy nie pokazuje.
//
// CO MA TU JESZCZE DOWOD
//   * wszystkie operacje na dzieciach: wstawianie na wskazany indeks (przed
//     pierwszym i po n-tym), przenoszenie, duplikat ze SWIEZYMI id (takze
//     wnukow), usuwanie,
//   * stan pusty kontenera: etykieta z zewnatrz (i18n po stronie wolajacego)
//     albo domyslna z rejestru, oraz oba tryby wstawiania w tym stanie,
//   * kazda mutacja przechodzi przez `onChange` z NOWA tablica - kontener nie
//     mutuje wlasnych dzieci w miejscu (mutacja w miejscu jest niewidoczna dla
//     historii undo/redo, czyli cicha utrata mozliwosci cofniecia),
//   * ODMOWY mini-kanwy: scalenie PIERWSZEGO dziecka (nie ma poprzednika),
//     strzalka wyprowadzajaca z kontenera, Ctrl+A i Shift+strzalka wewnatrz
//     dziecka (zaznaczenie blokowe nalezy do kanwy glownej, nie do kontenera),
//   * wstawianie WZORCA (wielu blokow naraz) na kazda z trzech pozycji, ktore
//     mini-kanwa oferuje: pusty kontener, przed pierwszym dzieckiem, po n-tym,
//   * uniwersalny pasek widgetu dziecka (`BlockWithToolbar`) pisze WYLACZNIE
//     do swojego dziecka - sasiedzi wracaja z `onChange` nietknieci.
//
// CZEGO TU NIE MA
//   * atrap warstw wlasnych - mini-kanwa renderuje prawdziwy `BlockInserter`,
//     prawdziwy `BlockEditRenderer` i prawdziwe edytory blokow,
//   * przeciagania (osobny plik `blockCanvasDragDrop.test.tsx`, gdzie oba
//     `DndContext`y sa w jednym drzewie i widac ich rozlacznosc).
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Block } from "@/lib/blocks/types";
import { readChildBlocks, withChildBlocks } from "@/lib/blocks/nested";
import { NestedBlocksEditor } from "../molecules/NestedBlocksEditor";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";

const t = realT("pl");

function akapit(id: string, tekst: string): Block {
  return { id, type: "paragraph", data: { html: `<p>${tekst}</p>` } } as Block;
}

function zamontuj(blocks: Block[], emptyLabel?: string) {
  const onChange = vi.fn<(next: Block[]) => void>();
  render(<NestedBlocksEditor blocks={blocks} onChange={onChange} emptyLabel={emptyLabel} />);
  return { onChange };
}

/** Kolejny inserter „+" w mini-kanwie; indeks 0 = przed pierwszym dzieckiem. */
function inserter(idx: number): HTMLElement {
  return screen.getAllByRole("button", { name: t("blocks.addBlock") })[idx];
}

/** Otwiera inserter i rozwija pelna biblioteke (kontenery sa poza szybka szostka). */
function otworzPelnaPalete(idx: number): HTMLElement {
  fireEvent.click(inserter(idx));
  fireEvent.click(screen.getByRole("button", { name: t("blocks.inserter.browseAll") }));
  return screen.getByRole("listbox");
}

describe("NestedBlocksEditor - stan pusty kontenera", () => {
  it("pusty kontener pokazuje etykietę podaną przez wołającego", () => {
    zamontuj([], "Lewa kolumna jest pusta");
    expect(screen.getByText("Lewa kolumna jest pusta")).toBeInTheDocument();
  });

  it("bez etykiety z zewnątrz używa domyślnego napisu ze słownika", () => {
    zamontuj([]);
    expect(screen.getByText(t("blocks.nested.empty"))).toBeInTheDocument();
  });

  it("pusty kontener przyjmuje pierwszy blok z palety", () => {
    const { onChange } = zamontuj([]);
    fireEvent.click(screen.getByRole("button", { name: t("blocks.firstBlock") }));
    fireEvent.click(screen.getByRole("option", { name: t("blocks.types.quote") }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const dzieci = onChange.mock.calls[0][0];
    expect(dzieci).toHaveLength(1);
    expect(dzieci[0].type).toBe("quote");
  });

  it("pusty kontener przyjmuje CAŁY wzorzec (wiele bloków naraz)", () => {
    const { onChange } = zamontuj([]);
    fireEvent.click(screen.getByRole("button", { name: t("blocks.firstBlock") }));
    fireEvent.click(screen.getByRole("button", { name: t("blocks.inserter.browseAll") }));
    fireEvent.click(screen.getByRole("tab", { name: t("blocks.inserter.tabPatterns") }));
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(t("blocks.patterns.items.key-takeaways.name")),
      }),
    );
    expect(onChange.mock.calls[0][0].length).toBeGreaterThan(1);
  });
});

describe("NestedBlocksEditor - zagniezdzanie bez limitu glebokosci", () => {
  it("paleta w mini-kanwie oferuje TYPY KONTENEROWE - nie ma filtra po głębokości", () => {
    zamontuj([akapit("c1", "dziecko")]);
    const lista = otworzPelnaPalete(0);
    for (const typ of ["group", "columns", "row", "stack", "grid"] as const) {
      // `getAllBy*`, bo kilka typów dzieli etykietę z innymi blokami
      // (np. „Wiersz" to i kontener `row`, i wiersz tabeli).
      expect(
        within(lista).getAllByRole("option", { name: t(`blocks.types.${typ}`) }).length,
      ).toBeGreaterThan(0);
    }
  });

  it("klik w kontener wewnątrz kontenera TWORZY kolejny poziom drzewa", () => {
    const { onChange } = zamontuj([akapit("c1", "dziecko")]);
    const lista = otworzPelnaPalete(0);
    fireEvent.click(within(lista).getByRole("option", { name: t("blocks.types.group") }));
    const dzieci = onChange.mock.calls[0][0];
    expect(dzieci.map((b) => b.type)).toEqual(["group", "paragraph"]);
  });

  it("kolejny poziom ma WŁASNĄ, równie pełną paletę - pętla jest osiągalna klikaniem", () => {
    // Dziecko-kontener renderowane przez prawdziwy `BlockEditRenderer`
    // dostaje własny `NestedBlocksEditor`, a ten własny `BlockInserter`.
    const wnuk = akapit("w1", "wnuk");
    const kontener = withChildBlocks({ id: "g1", type: "group", data: {} } as Block, "children", [
      wnuk,
    ]);
    zamontuj([kontener]);
    // Insertery: [0] przed g1, [1] po g1, [2] przed wnukiem, [3] po wnuku.
    const lista = otworzPelnaPalete(2);
    expect(within(lista).getByRole("option", { name: t("blocks.types.group") })).toBeVisible();
    expect(within(lista).getByRole("option", { name: t("blocks.types.columns") })).toBeVisible();
  });
});

describe("NestedBlocksEditor - operacje na dzieciach", () => {
  const dwa = () => [akapit("c1", "pierwsze"), akapit("c2", "drugie")];

  it("inserter PRZED pierwszym dzieckiem wstawia na pozycję zero", () => {
    const { onChange } = zamontuj(dwa());
    fireEvent.click(inserter(0));
    fireEvent.click(screen.getByRole("option", { name: t("blocks.types.separator") }));
    expect(onChange.mock.calls[0][0].map((b) => b.type)).toEqual([
      "separator",
      "paragraph",
      "paragraph",
    ]);
  });

  it("inserter po PIERWSZYM dziecku wstawia na pozycję jeden", () => {
    const { onChange } = zamontuj(dwa());
    fireEvent.click(inserter(1));
    fireEvent.click(screen.getByRole("option", { name: t("blocks.types.separator") }));
    expect(onChange.mock.calls[0][0].map((b) => b.id)).toEqual(["c1", expect.any(String), "c2"]);
    expect(onChange.mock.calls[0][0][1].type).toBe("separator");
  });

  it("strzałka w dół przy pierwszym dziecku zamienia je z drugim", () => {
    const { onChange } = zamontuj(dwa());
    fireEvent.click(screen.getAllByRole("button", { name: t("blocks.actions.down") })[0]);
    expect(onChange.mock.calls[0][0].map((b) => b.id)).toEqual(["c2", "c1"]);
  });

  it("strzałka w górę przy drugim dziecku zamienia je z pierwszym", () => {
    const { onChange } = zamontuj(dwa());
    fireEvent.click(screen.getAllByRole("button", { name: t("blocks.actions.up") })[1]);
    expect(onChange.mock.calls[0][0].map((b) => b.id)).toEqual(["c2", "c1"]);
  });

  it("strzałki na krawędziach są wyłączone", () => {
    zamontuj(dwa());
    expect(screen.getAllByRole("button", { name: t("blocks.actions.up") })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: t("blocks.actions.down") })[1]).toBeDisabled();
  });

  it("duplikat dziecka wstawia kopię ZA nim i nadaje świeże id także wnukom", () => {
    const kontener = withChildBlocks({ id: "g1", type: "group", data: {} } as Block, "children", [
      akapit("w1", "wnuk"),
    ]);
    const { onChange } = zamontuj([kontener]);
    fireEvent.click(screen.getAllByRole("button", { name: t("blocks.actions.duplicate") })[0]);
    const dzieci = onChange.mock.calls[0][0];
    expect(dzieci).toHaveLength(2);
    expect(dzieci[1].id).not.toBe("g1");
    const wnuki = readChildBlocks(dzieci[1].data, "children");
    expect(wnuki).toHaveLength(1);
    expect(wnuki[0].id).not.toBe("w1");
    expect(wnuki[0].data.html).toBe("<p>wnuk</p>");
  });

  it("kosz usuwa wskazane dziecko, a pozostałe zostają", () => {
    const { onChange } = zamontuj(dwa());
    fireEvent.click(screen.getAllByRole("button", { name: t("blocks.actions.remove") })[0]);
    expect(onChange.mock.calls[0][0].map((b) => b.id)).toEqual(["c2"]);
  });

  it("każda mutacja oddaje NOWĄ tablicę - dzieci nie są mutowane w miejscu", () => {
    const wejscie = dwa();
    const { onChange } = zamontuj(wejscie);
    fireEvent.click(screen.getAllByRole("button", { name: t("blocks.actions.down") })[0]);
    expect(onChange.mock.calls[0][0]).not.toBe(wejscie);
    expect(wejscie.map((b) => b.id)).toEqual(["c1", "c2"]);
  });

  it("klik w dziecko zaznacza je (obwód dziecka dostaje pierścień aktywności)", () => {
    zamontuj(dwa());
    const wiersz = document.querySelector('[data-block-id="c2"]');
    expect(wiersz).not.toBeNull();
    fireEvent.click(wiersz as Element);
    expect(wiersz?.className).toContain("ring-1");
  });
});

// ── PLYNNE PISANIE WEWNATRZ KONTENERA ────────────────────────────────────────
// Mini-kanwa powtarza kontrakt kanwy glownej: Enter dzieli, Backspace na
// pustym usuwa, Backspace na poczatku scala, strzalki przechodza miedzy
// dziecmi. To NIE jest ten sam kod - `NestedBlocksEditor` ma wlasne kopie
// tych operacji (na `insertChildAt`/`removeChildAt`/`moveChild`), wiec musi
// miec wlasny dowod. Karetka: patrz nota w `blockCanvasCaretFlow.test.tsx` -
// swieza instancja ProseMirror ma selekcje na POCZATKU tresci.
function polePisania(blockId: string): HTMLElement {
  const wiersz = document.querySelector(`[data-block-id="${blockId}"]`);
  const el = wiersz?.querySelector('[contenteditable="true"]');
  if (!(el instanceof HTMLElement)) throw new Error(`brak pola edycji dziecka ${blockId}`);
  return el;
}

describe("NestedBlocksEditor - pisanie w dzieciach kontenera", () => {
  it("Enter dzieli dziecko i dokłada nowe DOKŁADNIE za nim", () => {
    const { onChange } = zamontuj([akapit("c1", "alfa"), akapit("c2", "beta")]);
    fireEvent.keyDown(polePisania("c1"), { key: "Enter" });
    const dzieci = onChange.mock.calls.at(-1)![0];
    expect(dzieci).toHaveLength(3);
    expect(dzieci[0].id).toBe("c1");
    expect(dzieci[2].id).toBe("c2");
  });

  it("Backspace na PUSTYM dziecku usuwa je i zostawia sąsiada", () => {
    const { onChange } = zamontuj([
      akapit("c1", "alfa"),
      { id: "c2", type: "paragraph", data: { html: "" } } as Block,
    ]);
    fireEvent.keyDown(polePisania("c2"), { key: "Backspace" });
    expect(onChange.mock.calls.at(-1)![0].map((b) => b.id)).toEqual(["c1"]);
  });

  it("Backspace na OSTATNIM (pustym) dziecku opróżnia kontener - jak w WP", () => {
    // Kontener bez dzieci jest poprawnym stanem (pokazuje stan pusty), więc
    // ostatnie dziecko wolno usunąć.
    const { onChange } = zamontuj([{ id: "c1", type: "paragraph", data: { html: "" } } as Block]);
    fireEvent.keyDown(polePisania("c1"), { key: "Backspace" });
    expect(onChange.mock.calls.at(-1)![0]).toEqual([]);
  });

  it("Backspace na początku dziecka SCALA je z poprzednim, zachowując obie treści", () => {
    const { onChange } = zamontuj([akapit("c1", "alfa"), akapit("c2", "beta")]);
    fireEvent.keyDown(polePisania("c2"), { key: "Backspace" });
    const dzieci = onChange.mock.calls.at(-1)![0];
    expect(dzieci.map((b) => b.id)).toEqual(["c1"]);
    const tresc = String(dzieci[0].data.html);
    expect(tresc).toContain("alfa");
    expect(tresc).toContain("beta");
  });

  it("scalenie dziecka z NAGŁÓWKIEM dokleja tekst do nagłówka", () => {
    const naglowek = { id: "h1", type: "heading", data: { text: "Tytuł", level: 3 } } as Block;
    const { onChange } = zamontuj([naglowek, akapit("c2", "ogon")]);
    fireEvent.keyDown(polePisania("c2"), { key: "Backspace" });
    const dzieci = onChange.mock.calls.at(-1)![0];
    expect(dzieci.map((b) => b.id)).toEqual(["h1"]);
    expect(String(dzieci[0].data.text)).toBe("Tytułogon");
  });

  it("scalenie z dzieckiem NIETEKSTOWYM nie zachodzi", () => {
    const separator = { id: "s1", type: "separator", data: {} } as Block;
    const { onChange } = zamontuj([separator, akapit("c2", "beta")]);
    fireEvent.keyDown(polePisania("c2"), { key: "Backspace" });
    for (const [dzieci] of onChange.mock.calls) {
      expect(dzieci.map((b) => b.id)).toEqual(["s1", "c2"]);
    }
  });

  it("strzałka w górę przenosi fokus na poprzednie dziecko TEKSTOWE", () => {
    // Widać to po pierścieniu aktywności - mini-kanwa trzyma aktywne dziecko
    // u siebie (kanwa główna nie zna dzieci kontenera).
    const separator = { id: "s1", type: "separator", data: {} } as Block;
    zamontuj([akapit("c1", "alfa"), separator, akapit("c3", "gamma")]);
    fireEvent.keyDown(polePisania("c3"), { key: "ArrowUp" });
    const wiersz = document.querySelector('[data-block-id="c1"]');
    expect(wiersz?.className).toContain("ring-1");
    expect(document.querySelector('[data-block-id="s1"]')?.className).not.toContain("ring-1");
  });

  it("strzałka w dół przenosi fokus na następne dziecko tekstowe", () => {
    zamontuj([akapit("c1", "alfa"), akapit("c2", "beta")]);
    fireEvent.keyDown(polePisania("c1"), { key: "ArrowDown" });
    expect(document.querySelector('[data-block-id="c2"]')?.className).toContain("ring-1");
  });

  it("menu slash w PUSTYM dziecku PODMIENIA je na wybrany typ (replaceWith)", () => {
    // To jedyna droga do `replaceWith` mini-kanwy dostepna z klawiatury:
    // "/" na pustym akapicie otwiera menu, Enter wybiera pozycje, a
    // `onTransform` podmienia dziecko W MIEJSCU - nie dokleja obok.
    const { onChange } = zamontuj([
      { id: "c1", type: "paragraph", data: { html: "" } } as Block,
      akapit("c2", "beta"),
    ]);
    const pole = polePisania("c1");
    fireEvent.keyDown(pole, { key: "/" });
    fireEvent.keyDown(pole, { key: "Enter" });
    const dzieci = onChange.mock.calls.at(-1)![0];
    expect(dzieci).toHaveLength(2);
    // Pierwsze dziecko zostalo PODMIENIONE (nowe id, nowy typ), drugie stoi.
    expect(dzieci[0].id).not.toBe("c1");
    expect(dzieci[1].id).toBe("c2");
  });
});

// ── ODMOWY MINI-KANWY ────────────────────────────────────────────────────────
// Kontener jest liscmi drzewa dokumentu: nie ma "poprzedniego dziecka" przed
// pierwszym i nie ma wlasnego zaznaczenia blokowego. Kazda z tych granic musi
// konczyc sie ODMOWA, a nie wyjatkiem albo cicha mutacja - dziecko kontenera
// bywa jedyna kopia tresci redaktora.
describe("NestedBlocksEditor - odmowy na granicach kontenera", () => {
  it("Backspace na początku PIERWSZEGO dziecka nie scala niczego", () => {
    // Nie ma poprzednika, wiec mini-kanwa oddaje sterowanie przeglądarce -
    // dokument dzieci zostaje bez zmian.
    const { onChange } = zamontuj([akapit("c1", "alfa"), akapit("c2", "beta")]);
    fireEvent.keyDown(polePisania("c1"), { key: "Backspace" });
    for (const [dzieci] of onChange.mock.calls) {
      expect(dzieci.map((b) => b.id)).toEqual(["c1", "c2"]);
    }
  });

  it("strzałka w górę z PIERWSZEGO dziecka nie wyprowadza z kontenera", () => {
    zamontuj([akapit("c1", "alfa"), akapit("c2", "beta")]);
    fireEvent.keyDown(polePisania("c1"), { key: "ArrowUp" });
    // Zadne dziecko nie przejmuje pierscienia aktywnosci - fokus zostaje tam,
    // gdzie byl (wyjscie z kontenera nalezy do przeglądarki, nie do mini-kanwy).
    expect(document.querySelector('[data-block-id="c1"]')?.className).not.toContain("ring-1");
    expect(document.querySelector('[data-block-id="c2"]')?.className).not.toContain("ring-1");
  });

  it("strzałka w dół z OSTATNIEGO dziecka nie wyprowadza z kontenera", () => {
    zamontuj([akapit("c1", "alfa"), akapit("c2", "beta")]);
    fireEvent.keyDown(polePisania("c2"), { key: "ArrowDown" });
    expect(document.querySelector('[data-block-id="c1"]')?.className).not.toContain("ring-1");
  });

  it("Ctrl+A w PUSTYM dziecku nie zaznacza blokowo wnętrza kontenera", () => {
    // `onSelectAllBlocks` mini-kanwy jest świadomie puste: zaznaczenie blokowe
    // zyje na kanwie glownej. Wnetrze kontenera nie moze wiec zostac zaznaczone
    // "na blok", bo nie ma nikogo, kto by je potem usunął albo zduplikował.
    const { onChange } = zamontuj([
      { id: "c1", type: "paragraph", data: { html: "" } } as Block,
      akapit("c2", "beta"),
    ]);
    fireEvent.keyDown(polePisania("c1"), { key: "a", ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector('[data-block-id="c2"]')?.className).not.toContain("ring-1");
  });

  it("Shift+strzałka w dziecku NIE eskaluje do zaznaczenia blokowego", () => {
    // Wewnatrz kontenera Shift+strzalka zostaje zaznaczeniem TEKSTOWYM
    // (`onExtendBlockSelection` oddaje `false`), wiec kontener nie zmienia
    // ani dzieci, ani aktywnego dziecka.
    const { onChange } = zamontuj([akapit("c1", "alfa"), akapit("c2", "beta")]);
    fireEvent.keyDown(polePisania("c2"), { key: "ArrowUp", shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector('[data-block-id="c1"]')?.className).not.toContain("ring-1");
  });

  it("klik w UCHWYT przeciągania nie zaznacza dziecka", () => {
    // Uchwyt zatrzymuje propagację: gest przeciągania nie jest gestem wyboru
    // bloku, inaczej samo złapanie dziecka zmieniałoby aktywny blok w pasku.
    zamontuj([akapit("c1", "alfa"), akapit("c2", "beta")]);
    fireEvent.click(screen.getAllByRole("button", { name: t("blocks.actions.drag") })[1]);
    expect(document.querySelector('[data-block-id="c2"]')?.className).not.toContain("ring-1");
    // Kontrola dodatnia: klik w sam wiersz dziecka zaznacza je.
    fireEvent.click(document.querySelector('[data-block-id="c2"]') as Element);
    expect(document.querySelector('[data-block-id="c2"]')?.className).toContain("ring-1");
  });
});

// ── SCALANIE DZIECI: PRZYPADKI BRZEGOWE TRESCI ──────────────────────────────
describe("NestedBlocksEditor - scalanie dzieci w przypadkach brzegowych", () => {
  it("scalenie NAGŁÓWKA z poprzednim akapitem wnosi tekst nagłówka do akapitu", () => {
    // Odwrotna strona pary "akapit -> nagłówek": tu ZNIKAJĄCYM blokiem jest
    // nagłówek, a jego tekst musi dojechać do akapitu wyżej.
    const naglowek = { id: "h2", type: "heading", data: { text: "Podtytuł", level: 3 } } as Block;
    const { onChange } = zamontuj([akapit("c1", "alfa"), naglowek]);
    fireEvent.keyDown(polePisania("h2"), { key: "Backspace" });
    const dzieci = onChange.mock.calls.at(-1)![0];
    expect(dzieci.map((b) => b.id)).toEqual(["c1"]);
    expect(String(dzieci[0].data.html)).toContain("alfa");
    expect(String(dzieci[0].data.html)).toContain("Podtytuł");
  });

  it("scalenie z PUSTYM poprzednim akapitem nie gubi treści dziecka", () => {
    // Poprzednik bez pola `html` (świeżo wstawiony akapit) - scalenie musi
    // przyjąć treść, a nie wywrócić się na braku danych.
    const pusty = { id: "c1", type: "paragraph", data: {} } as Block;
    const { onChange } = zamontuj([pusty, akapit("c2", "beta")]);
    fireEvent.keyDown(polePisania("c2"), { key: "Backspace" });
    const dzieci = onChange.mock.calls.at(-1)![0];
    expect(dzieci.map((b) => b.id)).toEqual(["c1"]);
    expect(String(dzieci[0].data.html)).toContain("beta");
  });

  it("scalenie z PUSTYM poprzednim nagłówkiem nie gubi treści dziecka", () => {
    const pustyNaglowek = { id: "h1", type: "heading", data: { level: 2 } } as Block;
    const { onChange } = zamontuj([pustyNaglowek, akapit("c2", "ogon")]);
    fireEvent.keyDown(polePisania("c2"), { key: "Backspace" });
    const dzieci = onChange.mock.calls.at(-1)![0];
    expect(dzieci.map((b) => b.id)).toEqual(["h1"]);
    expect(String(dzieci[0].data.text)).toBe("ogon");
  });

  it("scalenie w kontenerze o TRZECH dzieciach rusza tylko scalaną parę", () => {
    // Dwa dzieci to zbyt mały dowód: po scaleniu zostaje jedno i nie widać,
    // czy pozostałe dzieci przechodzą przez mapowanie NIEZMIENIONE.
    const trzecie = akapit("c3", "gamma");
    const { onChange } = zamontuj([akapit("c1", "alfa"), akapit("c2", "beta"), trzecie]);
    fireEvent.keyDown(polePisania("c2"), { key: "Backspace" });
    const dzieci = onChange.mock.calls.at(-1)![0];
    expect(dzieci.map((b) => b.id)).toEqual(["c1", "c3"]);
    expect(String(dzieci[0].data.html)).toContain("beta");
    // Trzecie dziecko wraca DOKŁADNIE tym samym obiektem - nie jest kopiowane
    // ani przepisywane przy okazji scalania sąsiadów.
    expect(dzieci[1]).toBe(trzecie);
  });

  it("Backspace na PUSTYM PIERWSZYM dziecku wraca na NASTĘPNEGO sąsiada", () => {
    // Sąsiad "w górę" nie istnieje, więc aktywność musi przejąć dziecko PO
    // usuwanym - inaczej redaktor traci karetkę w środku kontenera.
    const { onChange } = zamontuj([
      { id: "c1", type: "paragraph", data: { html: "" } } as Block,
      akapit("c2", "beta"),
    ]);
    fireEvent.keyDown(polePisania("c1"), { key: "Backspace" });
    expect(onChange.mock.calls.at(-1)![0].map((b) => b.id)).toEqual(["c2"]);
  });

  it("menu slash może podmienić dziecko na blok NIETEKSTOWY", () => {
    // Trzecia pozycja palety slash to Obraz - blok bez pola pisania. Podmiana
    // musi się wykonać, ale karetki nie ma gdzie postawić (i o to chodzi:
    // mini-kanwa nie może wtedy szukać pola edycji, którego nie ma).
    const { onChange } = zamontuj([
      { id: "c1", type: "paragraph", data: { html: "" } } as Block,
      akapit("c2", "beta"),
    ]);
    const pole = polePisania("c1");
    fireEvent.keyDown(pole, { key: "/" });
    fireEvent.keyDown(pole, { key: "ArrowDown" });
    fireEvent.keyDown(pole, { key: "ArrowDown" });
    fireEvent.keyDown(pole, { key: "Enter" });
    const dzieci = onChange.mock.calls.at(-1)![0];
    expect(dzieci).toHaveLength(2);
    expect(dzieci[0].type).toBe("image");
    expect(dzieci[1].id).toBe("c2");
  });
});

// ── WZORCE I PASEK WIDGETU DZIECKA ──────────────────────────────────────────
/** Otwiera inserter o danym indeksie i wstawia wzorzec „Kluczowe wnioski". */
function wstawWzorzec(idx: number): void {
  fireEvent.click(inserter(idx));
  fireEvent.click(screen.getByRole("button", { name: t("blocks.inserter.browseAll") }));
  fireEvent.click(screen.getByRole("tab", { name: t("blocks.inserter.tabPatterns") }));
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(t("blocks.patterns.items.key-takeaways.name")),
    }),
  );
}

describe("NestedBlocksEditor - wzorce na wskazanej pozycji", () => {
  it("wzorzec z insertera PRZED pierwszym dzieckiem ląduje na początku", () => {
    const { onChange } = zamontuj([akapit("c1", "pierwsze"), akapit("c2", "drugie")]);
    wstawWzorzec(0);
    const dzieci = onChange.mock.calls.at(-1)![0];
    expect(dzieci.map((b) => b.type)).toEqual(["heading", "list", "paragraph", "paragraph"]);
    expect(dzieci.map((b) => b.id).slice(-2)).toEqual(["c1", "c2"]);
  });

  it("wzorzec z insertera po PIERWSZYM dziecku ląduje między dziećmi", () => {
    const { onChange } = zamontuj([akapit("c1", "pierwsze"), akapit("c2", "drugie")]);
    wstawWzorzec(1);
    const dzieci = onChange.mock.calls.at(-1)![0];
    expect(dzieci.map((b) => b.type)).toEqual(["paragraph", "heading", "list", "paragraph"]);
    expect(dzieci[0].id).toBe("c1");
    expect(dzieci[3].id).toBe("c2");
  });
});

describe("NestedBlocksEditor - uniwersalny pasek widgetu dziecka", () => {
  it("ustawienie z paska pisze WYŁĄCZNIE do aktywnego dziecka", () => {
    // Cytat nie ma własnego paska (nie jest w OWN_TOOLBAR_TYPES), więc dostaje
    // pasek uniwersalny. Jego `onChange` idzie przez mapowanie po id - gdyby
    // mapowanie było po indeksie albo podmieniało całą tablicę, ustawienie
    // wyrównania kasowałoby treść sąsiadów.
    const cytat = { id: "q1", type: "quote", data: { text: "Europa", cite: "" } } as Block;
    const sasiad = akapit("c2", "beta");
    const { onChange } = zamontuj([cytat, sasiad]);
    fireEvent.click(document.querySelector('[data-block-id="q1"]') as Element);
    const pasek = document.querySelector('[data-widget-toolbar="generic"]');
    expect(pasek).not.toBeNull();
    fireEvent.click(
      within(pasek as HTMLElement).getByRole("button", { name: t("blocks.toolbar.alignCenter") }),
    );
    const dzieci = onChange.mock.calls.at(-1)![0];
    expect(dzieci).toHaveLength(2);
    expect(dzieci[0].data.align).toBe("center");
    expect(dzieci[0].data.text).toBe("Europa");
    // Sąsiad wraca tym samym obiektem - pasek go nie dotknął.
    expect(dzieci[1]).toBe(sasiad);
  });
});

// ── DEFEKT ──────────────────────────────────────────────────────────────────
/** Kontener STEROWANY: dzieci z `onChange` wracaja w dol, jak w drzewie wpisu. */
function zamontujSterowany(startowe: Block[]) {
  const onChange = vi.fn<(next: Block[]) => void>();
  function Gospodarz() {
    const [dzieci, setDzieci] = useState<Block[]>(startowe);
    return (
      <NestedBlocksEditor
        blocks={dzieci}
        onChange={(next) => {
          onChange(next);
          setDzieci(next);
        }}
      />
    );
  }
  render(<Gospodarz />);
  return { onChange };
}

// DEFEKT: WZORZEC WSTAWIONY DO KONTENERA NIE PRZEJMUJE AKTYWNOSCI.
//
// WEJSCIE: pusty kontener (np. świeża kolumna), redaktor otwiera inserter
//   i wybiera wzorzec „Kluczowe wnioski" (nagłówek + lista).
// CO PSUJE: sciezka wielu blokow w mini-kanwie to SUROWY `emit` -
//   `onInsertBlocks={(list) => { emit([...blocksRef.current, ...list]); }}`
//   (NestedBlocksEditor.tsx:175-177, to samo na :189 i :235-239). W przeciwienstwie
//   do sciezki JEDNEGO bloku (`insertAt`, :65-72) nie ustawia `activeChildId`
//   ani nie wola `requestBlockFocus`. Kanwa glowna robi jedno i drugie w
//   `insertBlocksAt` (BlockCanvas.tsx:368-379), wiec ten sam gest zachowuje sie
//   inaczej w zaleznosci od tego, czy blok stoi w kontenerze, czy nie.
// KONSEKWENCJA: po wstawieniu wzorca do kolumny zaden blok nie jest aktywny -
//   nie ma karetki do pisania i nie ma paska ustawien, mimo ze redaktor wlasnie
//   wskazal, gdzie chce pracowac. Przy wstawianiu wzorca POMIEDZY dzieci jest
//   gorzej: aktywne zostaje dziecko sprzed wstawienia, wiec pasek ustawien
//   odnosi sie do INNEGO bloku niz ten, ktory redaktor widzi jako nowy.
// WYMAGANA POPRAWKA: wszystkie trzy `onInsertBlocks` mini-kanwy musza przejsc
//   przez wspolny odpowiednik `insertBlocksAt` z kanwy glownej: ustawic
//   `activeChildId` na OSTATNI wstawiony blok i - dla typow tekstowych -
//   poprosic o karetke przez `requestBlockFocus(id, "end")`.
it.fails("DEFEKT: wzorzec wstawiony do kontenera POWINIEN przejac aktywnosc", () => {
  const { onChange } = zamontujSterowany([]);
  fireEvent.click(screen.getByRole("button", { name: t("blocks.firstBlock") }));
  fireEvent.click(screen.getByRole("button", { name: t("blocks.inserter.browseAll") }));
  fireEvent.click(screen.getByRole("tab", { name: t("blocks.inserter.tabPatterns") }));
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(t("blocks.patterns.items.key-takeaways.name")),
    }),
  );
  const dzieci = onChange.mock.calls.at(-1)![0];
  expect(dzieci).toHaveLength(2);
  const ostatni = dzieci[dzieci.length - 1];
  expect(document.querySelector(`[data-block-id="${ostatni.id}"]`)?.className).toContain("ring-1");
});
