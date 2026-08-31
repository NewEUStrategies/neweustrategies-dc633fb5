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
//     historii undo/redo, czyli cicha utrata mozliwosci cofniecia).
//
// CZEGO TU NIE MA
//   * atrap warstw wlasnych - mini-kanwa renderuje prawdziwy `BlockInserter`,
//     prawdziwy `BlockEditRenderer` i prawdziwe edytory blokow,
//   * przeciagania (osobny plik `blockCanvasDragDrop.test.tsx`, gdzie oba
//     `DndContext`y sa w jednym drzewie i widac ich rozlacznosc).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Block } from "@/lib/blocks/types";
import { readChildBlocks, withChildBlocks } from "@/lib/blocks/nested";
import { NestedBlocksEditor } from "../molecules/NestedBlocksEditor";
import { realT } from "@/test/i18nReal";

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
