// EDYTORY USTAWIEŃ WIDŻETÓW I KONTENERÓW - spis treści, chmura tagów,
// archiwa, lista kategorii, live blog, kontener (`group`/`row`/`stack`/`grid`),
// kolumny i separator. PANEL MA POKAZAĆ TO, CO NARYSUJE STRONA.
//
// CO MA TU DOWÓD. Te edytory nie mają treści - mają USTAWIENIA (liczby, flagi,
// listy wyboru), które czyta renderer publiczny przez `num`/`bool`/`str`
// z `renderer/data.ts` i klamruje do własnych granic. Każdy przypadek niżej
// zestawia DWIE rzeczy: to, co pokazuje pole, i to, co zapisuje `onChange`
// (cały blok - `id`, `type` i pozostałe klucze nietknięte). Kontenery mają
// dodatkowo dowód, że edycja dziecka w jednej kolumnie nie rusza drugiej.
//
// NAPRAWIONE 2026-10-18 (wcześniej bez testu, defekty wykryte tym plikiem):
//  * spis treści: głębokość nie-liczbowa dawała podpowiedź „H2-HNaN", a
//    ułamkowa „H2-H3.5" - pole pokazywało wtedy H2, choć strona zbierała
//    H2-H3. Teraz `num` (jak renderer) + obcięcie do całości + granice 2-4,
//  * flagi (spis numerowany/przyklejony, liczniki wpisów, hierarchia) czytane
//    przez `Boolean(x)`: napis „nie" zaznaczał pole, a strona brała wartość
//    domyślną `false`. Teraz `bool`, jak renderer,
//  * chmura tagów: liczba spoza 1-200 (albo nie-liczba) stała w polu, choć
//    zapytanie i tak klamruje `limit` do 1-200; pole nie miało też żadnej
//    nazwy dostępnej (klucz `countPh` był w słowniku, ale nieużyty),
//  * kontener: odstęp spoza 0-120 (albo nie-liczba) w polu i w zapisie, choć
//    renderer klamruje do 0-120; `row`/`stack`/`grid` pokazywały domyślne
//    16 px, a strona rysuje je BEZ odstępu (domyślne 0); układ-obiekt w danych
//    WYWRACAŁ kanwę („Objects are not valid as a React child").
//
// GRANICE. Fabryki `vi.mock` (sonner, Radix, `<Link>` routera, Supabase,
// `fetch`) niesie moduł wspólny tabeli - jego import jest PIERWSZY. Edytor
// zagnieżdżony (`NestedBlocksEditor`) jest PRAWDZIWY: przedmiotem dowodu jest
// to, co kolumna i kontener robią z tablicą dzieci, którą on oddaje.
import { renderEditor } from "./blockEditMatrix.shared";

import { describe, expect, it } from "vitest";
import { fireEvent, within } from "@testing-library/react";

import { realT } from "@/test/i18nReal";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { ArchivesBlock } from "../Archives";
import { CategoriesListBlock } from "../CategoriesList";
import { ColumnsBlock } from "../Columns";
import { GroupBlock } from "../Group";
import { LiveBlogBlock } from "../LiveBlog";
import { SeparatorBlock } from "../Separator";
import { TagCloudBlock } from "../TagCloud";
import { TocBlock } from "../Toc";

const t = realT("pl");
const ed = (grupa: string, klucz: string, o?: Record<string, unknown>) =>
  t(`blocks.editors.${grupa}.${klucz}`, o);

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `blk-${type}`, type, data };
}

function poZapisie(start: Block, patch: Record<string, Json>): Block {
  return { ...start, data: { ...start.data, ...patch } };
}

function lista(container: HTMLElement): HTMLSelectElement {
  const el = container.querySelector("select");
  if (!el) throw new Error("brak listy wyboru");
  return el;
}

describe("spis treści (`toc`) - głębokość i flagi jak na stronie", () => {
  it("wybór głębokości zapisuje LICZBĘ, a tytuł i flagi własne klucze", () => {
    const start = blok("toc", { title: "Spis", maxLevel: 3, ordered: false, sticky: false });
    const { container, changes, getByLabelText } = renderEditor(TocBlock, start);
    expect(lista(container).value).toBe("3");
    fireEvent.change(lista(container), { target: { value: "4" } });
    fireEvent.change(container.querySelector(`[placeholder="${ed("toc", "titlePh")}"]`)!, {
      target: { value: "Treść" },
    });
    fireEvent.click(getByLabelText(ed("toc", "ordered")));
    fireEvent.click(getByLabelText(ed("toc", "sticky")));
    expect(changes).toEqual([
      poZapisie(start, { maxLevel: 4 }),
      poZapisie(start, { title: "Treść" }),
      poZapisie(start, { ordered: true }),
      poZapisie(start, { sticky: true }),
    ]);
  });

  it.each([
    ["nie-liczba „głęboko”", "3", "głęboko"],
    ["ułamek 3,5 (strona zbiera poziomy ≤ 3,5)", "3", 3.5],
    ["za płytko (1)", "2", 1],
    ["za głęboko (9)", "4", 9],
    ["liczba jako napis „4”", "4", "4"],
  ] as const)("głębokość: %s -> pole i podpowiedź H2-H%s", (_opis, oczekiwana, maxLevel) => {
    const { container, getByText } = renderEditor(TocBlock, blok("toc", { maxLevel }));
    expect(lista(container).value).toBe(oczekiwana);
    expect(getByText(ed("toc", "autoHint", { max: Number(oczekiwana) }))).toBeTruthy();
    expect(container.textContent).not.toContain("NaN");
  });

  it("flagi-NAPISY „nie”/„tak” pokazują pola niezaznaczone - strona bierze `false`", () => {
    const { getByLabelText } = renderEditor(
      TocBlock,
      blok("toc", { ordered: "nie", sticky: "tak" }),
    );
    expect((getByLabelText(ed("toc", "ordered")) as HTMLInputElement).checked).toBe(false);
    expect((getByLabelText(ed("toc", "sticky")) as HTMLInputElement).checked).toBe(false);
  });
});

describe("chmura tagów (`tag-cloud`) - liczba w granicach zapytania", () => {
  const nazwa = () => ed("tagCloud", "countPh");

  it("pole liczby ma nazwę dostępną i zapisuje LICZBĘ", () => {
    const start = blok("tag-cloud", { count: 30, showCount: false });
    const { getByRole, getByLabelText, changes } = renderEditor(TagCloudBlock, start);
    const liczba = getByRole("spinbutton", { name: nazwa() });
    fireEvent.change(liczba, { target: { value: "12" } });
    fireEvent.click(getByLabelText(ed("tagCloud", "showCount")));
    expect(changes).toEqual([
      poZapisie(start, { count: 12 }),
      poZapisie(start, { showCount: true }),
    ]);
  });

  it.each([
    ["nie-liczba", "dużo", "30"],
    ["zero", 0, "1"],
    ["ujemna", -5, "1"],
    ["miliard", 1e9, "200"],
  ] as const)("liczba %s (%j) pokazuje się jako %s - tyle pobierze strona", (_o, count, widac) => {
    const { getByRole } = renderEditor(TagCloudBlock, blok("tag-cloud", { count }));
    expect((getByRole("spinbutton", { name: nazwa() }) as HTMLInputElement).value).toBe(widac);
  });

  it("wpis spoza zakresu zapisuje granicę, ułamek - całość, a puste pole - domyślne 30", () => {
    const start = blok("tag-cloud", { count: 30 });
    const { getByRole, changes } = renderEditor(TagCloudBlock, start);
    const liczba = getByRole("spinbutton", { name: nazwa() });
    fireEvent.change(liczba, { target: { value: "500" } });
    fireEvent.change(liczba, { target: { value: "" } });
    // Ułamek idzie do `limit` zapytania, które przyjmuje tylko liczby całkowite.
    fireEvent.change(liczba, { target: { value: "7.4" } });
    expect(changes).toEqual([
      poZapisie(start, { count: 200 }),
      poZapisie(start, { count: 30 }),
      poZapisie(start, { count: 7 }),
    ]);
  });

  it("licznik wpisów jako napis „tak” jest niezaznaczony - strona go nie pokaże", () => {
    const { getByLabelText } = renderEditor(TagCloudBlock, blok("tag-cloud", { showCount: "tak" }));
    expect((getByLabelText(ed("tagCloud", "showCount")) as HTMLInputElement).checked).toBe(false);
  });
});

describe("archiwa i lista kategorii - układ i liczniki", () => {
  it("archiwa: układ z listy i licznik wpisów zapisują się pod własne klucze", () => {
    const start = blok("archives", { layout: "dropdown", showCount: false });
    const { container, getByLabelText, changes } = renderEditor(ArchivesBlock, start);
    expect(lista(container).value).toBe("dropdown");
    fireEvent.change(lista(container), { target: { value: "list" } });
    fireEvent.click(getByLabelText(ed("archives", "showCount")));
    expect(changes).toEqual([
      poZapisie(start, { layout: "list" }),
      poZapisie(start, { showCount: true }),
    ]);
  });

  it("lista kategorii: układ, licznik i hierarchia zapisują się pod własne klucze", () => {
    const start = blok("categories-list", { layout: "dropdown" });
    const { container, getByLabelText, changes } = renderEditor(CategoriesListBlock, start);
    fireEvent.change(lista(container), { target: { value: "list" } });
    fireEvent.click(getByLabelText(ed("categoriesList", "showCount")));
    fireEvent.click(getByLabelText(ed("categoriesList", "hierarchical")));
    expect(changes).toEqual([
      poZapisie(start, { layout: "list" }),
      poZapisie(start, { showCount: true }),
      poZapisie(start, { hierarchical: true }),
    ]);
  });

  it.each([
    ["archiwa", ArchivesBlock, "archives", "archives"],
    ["lista kategorii", CategoriesListBlock, "categories-list", "categoriesList"],
  ] as const)(
    "%s: nieznany układ pokazuje „Lista”, a licznik-napis „false” jest wyłączony",
    (_n, Editor, type, grupa) => {
      // Renderer: `str(layout) === "dropdown" ? "dropdown" : "list"` oraz
      // `bool(showCount, false)` - napis „false" to dla niego brak flagi.
      const { container, getByLabelText } = renderEditor(
        Editor,
        blok(type, { layout: "kafelki", showCount: "false" }),
      );
      expect(lista(container).value).toBe("list");
      expect((getByLabelText(ed(grupa, "showCount")) as HTMLInputElement).checked).toBe(false);
    },
  );
});

describe("live blog - tytuł, flagi domyślnie włączone i droga do moderacji", () => {
  it("bez danych obie flagi są włączone, jak na stronie", () => {
    const { getByLabelText } = renderEditor(LiveBlogBlock, blok("liveblog", {}));
    expect((getByLabelText(ed("liveBlog", "newestOnTop")) as HTMLInputElement).checked).toBe(true);
    expect((getByLabelText(ed("liveBlog", "realtime")) as HTMLInputElement).checked).toBe(true);
  });

  it("tytuł i wyłączenie flag zapisują się pod własne klucze", () => {
    const start = blok("liveblog", { title: "Relacja" });
    const { getByLabelText, changes } = renderEditor(LiveBlogBlock, start);
    fireEvent.change(getByLabelText(ed("liveBlog", "titleFieldLabel")), {
      target: { value: "Wybory" },
    });
    fireEvent.click(getByLabelText(ed("liveBlog", "newestOnTop")));
    fireEvent.click(getByLabelText(ed("liveBlog", "realtime")));
    expect(changes).toEqual([
      poZapisie(start, { title: "Wybory" }),
      poZapisie(start, { reverseChronological: false }),
      poZapisie(start, { autoRefresh: false }),
    ]);
  });

  it("link moderacji prowadzi do panelu Live blog", () => {
    const { getByRole } = renderEditor(LiveBlogBlock, blok("liveblog", {}));
    expect(getByRole("link", { name: ed("liveBlog", "moderate") }).getAttribute("href")).toBe(
      "/admin/live-blog",
    );
  });
});

describe("kontener (`group`/`row`/`stack`/`grid`) - odstęp, tło i dzieci", () => {
  const nazwaOdstepu = () => ed("group", "padding");
  const odstep = (container: HTMLElement) =>
    container.querySelector<HTMLInputElement>(`input[placeholder="${nazwaOdstepu()}"]`)!;

  it("tło i odstęp zapisują się pod własne klucze; odstęp spoza 0-120 - do granicy", () => {
    const start = blok("group", { background: "", padding: 16 });
    const { container, changes } = renderEditor(GroupBlock, start);
    fireEvent.change(container.querySelector(`[placeholder="${ed("group", "background")}"]`)!, {
      target: { value: "#f4f4f5" },
    });
    fireEvent.change(odstep(container), { target: { value: "24" } });
    fireEvent.change(odstep(container), { target: { value: "500" } });
    fireEvent.change(odstep(container), { target: { value: "" } });
    expect(changes).toEqual([
      poZapisie(start, { background: "#f4f4f5" }),
      poZapisie(start, { padding: 24 }),
      poZapisie(start, { padding: 120 }),
      poZapisie(start, { padding: 0 }),
    ]);
  });

  it.each([
    ["group", {}, "16"],
    ["row", {}, "0"],
    ["stack", {}, "0"],
    ["grid", {}, "0"],
    ["group", { padding: "dużo" }, "16"],
    ["group", { padding: 500 }, "120"],
    ["row", { padding: -10 }, "0"],
  ] as const)("%s z %j pokazuje odstęp %s px - tyle narysuje strona", (type, data, widac) => {
    const { container } = renderEditor(GroupBlock, blok(type, { ...data }));
    expect(odstep(container).value).toBe(widac);
  });

  it("etykieta pokazuje układ z danych, a układ-OBIEKT nie wywraca kanwy", () => {
    const zDanych = renderEditor(GroupBlock, blok("group", { layout: "stack" }));
    expect(zDanych.container.textContent).toContain("stack");
    const obiekt = renderEditor(GroupBlock, blok("row", { layout: { type: "flex" } }));
    expect(obiekt.container.textContent).toContain("row");
    expect(obiekt.container.textContent).not.toContain("[object Object]");
  });

  it("licznik dzieci i usunięcie dziecka - reszta danych kontenera zostaje", () => {
    const start = blok("group", {
      background: "#fff",
      children: [
        { id: "s1", type: "separator", data: { variant: "line" } },
        { id: "s2", type: "separator", data: { variant: "dots" } },
      ],
    });
    const { container, changes, getByText } = renderEditor(GroupBlock, start);
    expect(getByText(ed("group", "childCount", { count: 2 }))).toBeTruthy();
    const wiersz = container.querySelector<HTMLElement>('[data-block-id="s1"]')!;
    fireEvent.click(within(wiersz).getByRole("button", { name: t("blocks.actions.remove") }));
    expect(changes).toEqual([
      poZapisie(start, { children: [{ id: "s2", type: "separator", data: { variant: "dots" } }] }),
    ]);
  });
});

describe("kolumny - każda kolumna to osobna tablica dzieci", () => {
  it("usunięcie bloku z lewej kolumny zapisuje `left`, a prawa zostaje nietknięta", () => {
    const prawa: Json = [{ id: "r1", type: "separator", data: {} }];
    const start = blok("columns", {
      left: [
        { id: "l1", type: "separator", data: {} },
        { id: "l2", type: "separator", data: { variant: "wide" } },
      ],
      right: prawa,
    });
    const { container, changes, getByText } = renderEditor(ColumnsBlock, start);
    expect(getByText(ed("columns", "left"))).toBeTruthy();
    expect(getByText(ed("columns", "right"))).toBeTruthy();
    const wiersz = container.querySelector<HTMLElement>('[data-block-id="l1"]')!;
    fireEvent.click(within(wiersz).getByRole("button", { name: t("blocks.actions.remove") }));
    expect(changes).toEqual([
      poZapisie(start, {
        left: [{ id: "l2", type: "separator", data: { variant: "wide" } }],
        right: prawa,
      }),
    ]);
  });

  it("pusta kolumna pokazuje własną podpowiedź", () => {
    const { getAllByText } = renderEditor(ColumnsBlock, blok("columns", {}));
    expect(getAllByText(ed("columns", "emptyColumn"))).toHaveLength(2);
  });
});

describe("separator - sam podgląd wariantu, bez pól", () => {
  it("kropki rysują „···” zamiast linii", () => {
    const { container, queryByRole } = renderEditor(
      SeparatorBlock,
      blok("separator", { variant: "dots" }),
    );
    expect(container.textContent).toBe("···");
    expect(queryByRole("separator")).toBeNull();
  });

  it.each([["line"], ["wide"], ["nieznany"]])("wariant %s to linia podziału", (variant) => {
    const { getAllByRole, container } = renderEditor(
      SeparatorBlock,
      blok("separator", { variant }),
    );
    expect(getAllByRole("separator")).toHaveLength(1);
    expect(container.querySelector("input, textarea, select")).toBeNull();
  });
});
