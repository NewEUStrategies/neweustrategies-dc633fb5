// EDYTORY `gallery` i `table` - CO REDAKTOR WIDZI I CO ZAPISUJE.
//
// PO CO TEN PLIK. Po zdjęciu przejazdu tabeli (`blockEditMatrix.*`, PR #475)
// edytor galerii nie miał żadnego wykonania, a edytor tabeli tylko
// przypadkowe (render z dyspozytora). Oba trzymają LISTY w `block.data`
// i oba mają zapis „po indeksie", w którym najłatwiej trafić w sąsiada.
//
// CO MA TU DOWÓD
//  * galeria: pusty stan, miniatury z `alt`, edycja/dopisanie/usunięcie
//    trafiają w TEN obraz, a edycja URL-a nie gubi pozostałych pól obrazu;
//    obiekt w miejscu URL-a nie wycieka jako „[object Object]”,
//  * tabela: edycja komórki, dopisanie i usunięcie wiersza/kolumny - razem
//    z METADANYMI importu (`spans`/`aligns`), które muszą zostać wyrównane
//    z komórkami, bo renderer czyta je po tych samych indeksach,
//  * tabela: nagłówek włącza wyłącznie `true` (czytnik `bool` renderera),
//    a „usunięcie" ostatniego wiersza czy kolumny niczego nie zapisuje.
//
// GRANICE. Fabryki `vi.mock` niesie moduł wspólny tabeli edytorów (import
// PIERWSZY). i18n PRAWDZIWE (`realT`).
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";
import { GalleryBlock } from "../Gallery";
import { TableBlockEdit } from "../Table";

const t = realT("pl");
const gal = (key: string) => t(`blocks.editors.gallery.${key}`) as string;
const tab = (key: string) => t(`blocks.editors.table.${key}`) as string;

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `blk-${type}`, type, data };
}

function ostatniZapis(changes: Block[]): Block {
  expect(changes.length, "edytor nie zapisał niczego").toBeGreaterThan(0);
  return changes[changes.length - 1];
}

// ---------------------------------------------------------------------------
// Galeria
// ---------------------------------------------------------------------------

describe("gallery", () => {
  const start = blok("gallery", {
    images: [
      { url: "https://cdn.example.com/1.jpg", alt: "Sala obrad" },
      { url: "https://cdn.example.com/2.jpg", alt: "Panel", mediaId: "m-2" },
    ],
  });

  it("pusty blok pokazuje podpowiedź, a przycisk dokłada pusty obraz; render nie zapisuje", () => {
    const { changes } = renderEditor(GalleryBlock, blok("gallery", {}));
    expect(screen.getByText(gal("emptyHint"))).toBeTruthy();
    expect(changes).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: gal("addImage") }));
    expect(ostatniZapis(changes).data).toEqual({ images: [{ url: "", alt: "" }] });
  });

  it("obraz z URL-em ma miniaturę z `alt`, obraz bez URL-a - napis „brak URL”", () => {
    renderEditor(
      GalleryBlock,
      blok("gallery", { images: [{ url: "https://cdn.example.com/1.jpg", alt: "Sala" }, {}] }),
    );
    expect(screen.getByRole<HTMLImageElement>("img", { name: "Sala" }).src).toBe(
      "https://cdn.example.com/1.jpg",
    );
    expect(screen.getByText(gal("noUrl"))).toBeTruthy();
  });

  it("edycja URL drugiego obrazu zmienia TYLKO jego URL - alt i pozostałe pola zostają", () => {
    // NAPRAWIONE 2026-10-18: zapis przepisywał każdy obraz do `{ url, alt }`,
    // więc pierwsza poprawka URL-a gubiła po cichu pozostałe pola obrazów
    // (tu `mediaId` z biblioteki mediów) w CAŁEJ galerii.
    const { changes } = renderEditor(GalleryBlock, start);
    fireEvent.change(screen.getAllByPlaceholderText(gal("urlPh"))[1], {
      target: { value: "https://cdn.example.com/2b.jpg" },
    });
    const zapis = ostatniZapis(changes);
    expect(zapis).toMatchObject({ id: start.id, type: "gallery" });
    expect(zapis.data.images).toEqual([
      { url: "https://cdn.example.com/1.jpg", alt: "Sala obrad" },
      { url: "https://cdn.example.com/2b.jpg", alt: "Panel", mediaId: "m-2" },
    ]);
  });

  it("usunięcie zabiera TEN obraz, dopisanie dokłada pusty na końcu", () => {
    const { changes } = renderEditor(GalleryBlock, start);
    fireEvent.click(screen.getAllByRole("button", { name: gal("remove") })[0]);
    expect(ostatniZapis(changes).data.images).toEqual([
      { url: "https://cdn.example.com/2.jpg", alt: "Panel", mediaId: "m-2" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: gal("addImage") }));
    expect(ostatniZapis(changes).data.images).toEqual([
      ...(start.data.images as Json[]),
      { url: "", alt: "" },
    ]);
  });

  it("pozycje-nieobiekty są pominięte, a obiekt w miejscu URL-a nie wycieka do pola", () => {
    // NAPRAWIONE 2026-10-18: `String(obj.url)` dawało „[object Object]” w polu
    // i jako `src` miniatury. `renderGallery` czyta URL czytnikiem `str` - dla
    // obiektu to brak URL-a, więc tyle pokazuje i panel.
    const { container } = renderEditor(
      GalleryBlock,
      blok("gallery", { images: ["https://cdn.example.com/luzny.jpg", null, { url: { a: 1 } }] }),
    );
    expect(container.textContent).not.toContain("[object Object]");
    expect(
      screen.getAllByPlaceholderText<HTMLInputElement>(gal("urlPh")).map((p) => p.value),
    ).toEqual([""]);
    expect(screen.getByText(gal("noUrl"))).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------

/** Wartości pól komórek, wiersz po wierszu (bez ostatniego wiersza z koszami kolumn). */
function komorki(): string[][] {
  const wiersze = within(screen.getByRole("table")).getAllByRole("row");
  return wiersze.slice(0, -1).map((w) =>
    within(w)
      .queryAllByRole<HTMLInputElement>("textbox")
      .map((p) => p.value),
  );
}

describe("table - odczyt", () => {
  it("nowy blok z palety pokazuje jedną pustą komórkę i wyłączony nagłówek, bez zapisu", () => {
    const { changes } = renderEditor(
      TableBlockEdit,
      blok("table", { rows: [[""]], header: false }),
    );
    expect(komorki()).toEqual([[""]]);
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: tab("headerRow") }).checked).toBe(
      false,
    );
    expect(changes).toEqual([]);
  });

  it.each([
    ["false", false],
    ["1", false],
    [1, false],
    [true, true],
  ] as const)(
    "nagłówek %j jest %s - włącza go tylko `true`, jak czytnik `bool` renderera",
    (h, on) => {
      // NAPRAWIONE 2026-10-18: `Boolean("false")` to `true` - panel pokazywał
      // włączony nagłówek, którego `renderTable` (czyta `bool(…, false)`) nie
      // narysuje.
      renderEditor(TableBlockEdit, blok("table", { rows: [["a"]], header: h }));
      expect(
        screen.getByRole<HTMLInputElement>("checkbox", { name: tab("headerRow") }).checked,
      ).toBe(on);
    },
  );

  it("wiersze spoza kształtu dają jedną pustą komórkę, a pierwszy zapis porządkuje dane", () => {
    const { changes } = renderEditor(TableBlockEdit, blok("table", { rows: {} as Json }));
    expect(komorki()).toEqual([[""]]);
    fireEvent.change(within(screen.getByRole("table")).getByRole("textbox"), {
      target: { value: "Kraj" },
    });
    expect(ostatniZapis(changes).data.rows).toEqual([["Kraj"]]);
  });
});

describe("table - zapis", () => {
  const rows: Json = [
    ["Kraj", "PKB"],
    ["Polska", "3,1%"],
    ["Czechy", "1,2%"],
  ];
  const zImportu = blok("table", {
    rows,
    header: true,
    spans: [
      [
        [2, 1],
        [1, 1],
      ],
      [
        [1, 1],
        [1, 1],
      ],
      [
        [1, 2],
        [1, 1],
      ],
    ],
    aligns: [
      ["center", ""],
      ["", "right"],
      ["", "right"],
    ],
  });

  it("edycja komórki (2,1) zmienia TYLKO ją, a metadane importu zostają bez zmian", () => {
    const { changes } = renderEditor(TableBlockEdit, zImportu);
    fireEvent.change(within(screen.getAllByRole("row")[2]).getAllByRole("textbox")[1], {
      target: { value: "2,9%" },
    });
    const zapis = ostatniZapis(changes);
    expect(zapis).toMatchObject({ id: zImportu.id, type: "table" });
    expect(zapis.data).toEqual({
      ...zImportu.data,
      rows: [
        ["Kraj", "PKB"],
        ["Polska", "3,1%"],
        ["Czechy", "2,9%"],
      ],
    });
  });

  it("przełącznik nagłówka zapisuje WARTOŚĆ LOGICZNĄ pod `header`", () => {
    const { changes } = renderEditor(TableBlockEdit, blok("table", { rows }));
    fireEvent.click(screen.getByRole("checkbox", { name: tab("headerRow") }));
    expect(ostatniZapis(changes).data).toEqual({ rows, header: true });
  });

  it("nowy wiersz ma tyle komórek, ile NAJSZERSZY wiersz; bez metadanych nie dopisuje ich", () => {
    const { changes } = renderEditor(
      TableBlockEdit,
      blok("table", { rows: [["a"], ["b", "c", "d"]] }),
    );
    fireEvent.click(screen.getByRole("button", { name: tab("addRow") }));
    expect(ostatniZapis(changes).data).toEqual({ rows: [["a"], ["b", "c", "d"], ["", "", ""]] });
    expect(ostatniZapis(changes).data).not.toHaveProperty("spans");
    expect(ostatniZapis(changes).data).not.toHaveProperty("aligns");
  });

  it("dopisanie wiersza i kolumny dokłada NEUTRALNE metadane ([1,1] i „”) w tym samym miejscu", () => {
    const { changes } = renderEditor(TableBlockEdit, zImportu);

    fireEvent.click(screen.getByRole("button", { name: tab("addRow") }));
    let zapis = ostatniZapis(changes).data;
    expect((zapis.rows as Json[]).at(-1)).toEqual(["", ""]);
    expect((zapis.spans as Json[]).at(-1)).toEqual([
      [1, 1],
      [1, 1],
    ]);
    expect((zapis.aligns as Json[]).at(-1)).toEqual(["", ""]);

    fireEvent.click(screen.getByRole("button", { name: tab("addCol") }));
    zapis = ostatniZapis(changes).data;
    expect(zapis.rows).toEqual([
      ["Kraj", "PKB", ""],
      ["Polska", "3,1%", ""],
      ["Czechy", "1,2%", ""],
    ]);
    expect((zapis.spans as Json[][]).map((w) => w.at(-1))).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
    expect((zapis.aligns as Json[][]).map((w) => w.at(-1))).toEqual(["", "", ""]);
  });

  it("usunięcie wiersza i kolumny zabiera TEN wiersz/kolumnę razem z ich metadanymi", () => {
    const { changes } = renderEditor(TableBlockEdit, zImportu);

    fireEvent.click(screen.getAllByRole("button", { name: tab("removeRow") })[1]);
    expect(ostatniZapis(changes).data).toEqual({
      ...zImportu.data,
      rows: [
        ["Kraj", "PKB"],
        ["Czechy", "1,2%"],
      ],
      spans: [
        [
          [2, 1],
          [1, 1],
        ],
        [
          [1, 2],
          [1, 1],
        ],
      ],
      aligns: [
        ["center", ""],
        ["", "right"],
      ],
    });

    fireEvent.click(screen.getAllByRole("button", { name: tab("removeCol") })[0]);
    expect(ostatniZapis(changes).data).toEqual({
      ...zImportu.data,
      rows: [["PKB"], ["3,1%"], ["1,2%"]],
      spans: [[[1, 1]], [[1, 1]], [[1, 1]]],
      aligns: [[""], ["right"], ["right"]],
    });
  });

  it("import z samymi `aligns`, wierszem-nielistą i wierszem jednokomórkowym - usunięcie kolumny", () => {
    // Wiersz spoza kształtu to jedna pusta komórka (pierwszy zapis porządkuje
    // go do listy), wiersz z JEDNĄ komórką jej nie traci, a brak `spans`
    // w imporcie nie dopisuje ich przy zapisie.
    const start = blok("table", {
      rows: [["Kraj", "PKB"], "zepsuty", ["Razem"]],
      aligns: [["", "right"], null, [""]],
    });
    const { changes } = renderEditor(TableBlockEdit, start);
    expect(komorki()).toEqual([["Kraj", "PKB"], [""], ["Razem"]]);

    fireEvent.click(screen.getAllByRole("button", { name: tab("removeCol") })[1]);
    const zapis = ostatniZapis(changes).data;
    expect(zapis).toEqual({ rows: [["Kraj"], [""], ["Razem"]], aligns: [[""], [], [""]] });
    expect(zapis).not.toHaveProperty("spans");
  });

  it("„usunięcie” jedynego wiersza i jedynej kolumny niczego nie zapisuje", () => {
    // NAPRAWIONE 2026-10-18: kosz przy ostatnim wierszu/kolumnie nie zmieniał
    // danych, ale i tak wołał `onChange` z identyczną tabelą - dokument
    // stawał się „brudny" i dostawał wpis w historii cofania bez żadnej zmiany.
    const { changes } = renderEditor(TableBlockEdit, blok("table", { rows: [["jedyna"]] }));
    fireEvent.click(screen.getByRole("button", { name: tab("removeRow") }));
    fireEvent.click(screen.getByRole("button", { name: tab("removeCol") }));
    expect(changes).toEqual([]);
    expect(komorki()).toEqual([["jedyna"]]);
  });
});
