// REZERWA PASKA CHROME A URZĄDZENIE I DANE Z BAZY (`sectionHeightEstimate`).
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// `sectionHeightEstimate.test.ts` pilnuje geometrii rzędu (pasek narzędzi jako
// jeden rząd, kolumny obok siebie, kalibracja z artefaktu). Tu domykamy to, co
// ten plik pomijał, a co przesuwa stronę równie skutecznie:
// * UKRYCIE NA URZĄDZENIU (`advanced.hideOn`) na każdym poziomie paska -
//   sekcja, sekcja zagnieżdżona, kolumna, widget. Szkielet nagłówka jest
//   MALOWANY i podmieniany na realny pasek, więc rząd ukryty na telefonie,
//   policzony mimo to, zostawia na telefonie pustą belkę i skok przy podmianie,
// * sekcję zagnieżdżoną w pasku (kolumny obok siebie - decyduje najwyższa),
// * wysokość autorską z TREŚCI zapisaną jako napis z jednostką (`"64px"` -
//   tak zapisuje ją panel obrazka) i odrzucenie śmieci z kolumny jsonb,
// * to samo ukrycie w szacunku sekcji TREŚCI (sekcja zagnieżdżona ukryta).
//
// ── GRANICE ────────────────────────────────────────────────────────────────
// Czyste funkcje - bez atrap. Oczekiwane liczby składamy z wyeksportowanych
// stałych, żeby kalibracja tabeli nie unieważniała dowodu reguł.
import { describe, expect, it } from "vitest";
import type { ColumnNode, InnerSectionNode, SectionNode, WidgetNode } from "@/lib/builder/types";
import {
  CHROME_ROW_DEFAULT_WIDGET_HEIGHT_PX,
  CHROME_ROW_WIDGET_HEIGHT_PX,
  WIDGET_HEIGHT_ESTIMATE_PX,
  estimateChromeColumnHeight,
  estimateChromeRowHeight,
  estimateChromeRowHeights,
  estimateChromeWidgetHeight,
  estimateSectionHeight,
} from "@/lib/builder/sectionHeightEstimate";
import { COLUMN_SAFE_AREA_PX } from "@/lib/builder/sectionStyles";

const SAFE = 2 * COLUMN_SAFE_AREA_PX;
const MENU = CHROME_ROW_WIDGET_HEIGHT_PX.menu!;
const SZUKAJ = CHROME_ROW_WIDGET_HEIGHT_PX["search-button"]!;

let licznik = 0;
const nastepneId = (prefiks: string) => `${prefiks}-${(licznik += 1)}`;

function widget(type: string, extra: Partial<WidgetNode> = {}): WidgetNode {
  return { kind: "widget", id: nastepneId("w"), type, content: {}, ...extra } as WidgetNode;
}

function column(children: WidgetNode[], extra: Partial<ColumnNode> = {}): ColumnNode {
  return {
    kind: "column",
    id: nastepneId("c"),
    span: { desktop: 12 },
    children,
    ...extra,
  } as ColumnNode;
}

function inner(columns: ColumnNode[], extra: Partial<InnerSectionNode> = {}): InnerSectionNode {
  return { kind: "inner-section", id: nastepneId("i"), columns, ...extra } as InnerSectionNode;
}

function section(
  children: Array<ColumnNode | InnerSectionNode>,
  extra: Partial<SectionNode> = {},
): SectionNode {
  return { kind: "section", id: nastepneId("s"), children, ...extra } as SectionNode;
}

const ukryty = (urzadzenia: Partial<Record<"desktop" | "tablet" | "mobile", boolean>>) => ({
  advanced: { hideOn: urzadzenia },
});

describe("pasek chrome - ukrycie na urządzeniu", () => {
  it("rząd ukryty na telefonie nie rezerwuje nic na telefonie i znika z listy rzędów", () => {
    const tylkoDesktop = section([column([widget("menu")])], ukryty({ mobile: true }));
    const zawsze = section([column([widget("search-button")])]);
    const naglowek = { version: 1 as const, sections: [tylkoDesktop, zawsze] };
    expect(estimateChromeRowHeight(tylkoDesktop, "mobile")).toBe(0);
    expect(estimateChromeRowHeights(naglowek, "mobile")).toEqual([SZUKAJ + SAFE]);
    // Na desktopie oba rzędy, w kolejności dokumentu.
    expect(estimateChromeRowHeights(naglowek, "desktop")).toEqual([MENU + SAFE, SZUKAJ + SAFE]);
  });

  it("kolumna ukryta na urządzeniu nie zawyża rzędu, sąsiednia decyduje", () => {
    const rzad = section([
      column([widget("search-button")], ukryty({ mobile: true })),
      column([widget("menu")]),
    ]);
    expect(estimateChromeRowHeight(rzad, "mobile")).toBe(MENU + SAFE);
    expect(estimateChromeRowHeight(rzad, "desktop")).toBe(SZUKAJ + SAFE);
  });

  it("widget ukryty na urządzeniu wypada ze stosu razem ze swoim odstępem", () => {
    const kolumna = column([widget("search-button", ukryty({ tablet: true })), widget("menu")]);
    expect(estimateChromeColumnHeight(kolumna, "tablet")).toBe(MENU + SAFE);
    expect(estimateChromeWidgetHeight(kolumna.children[0], "tablet")).toBe(0);
  });

  it("kolumna ukryta w całości to zero, a nie sam bezpieczny margines", () => {
    // Renderer nie maluje jej wcale (`hideOn` kolumny), więc nie ma też paddingu.
    expect(estimateChromeColumnHeight(column([widget("menu")], ukryty({ desktop: true })))).toBe(0);
  });
});

describe("pasek chrome - sekcja zagnieżdżona", () => {
  it("kolumny sekcji zagnieżdżonej stoją obok siebie - decyduje najwyższa", () => {
    const rzad = section([
      inner([column([widget("menu")]), column([widget("search-button")])]),
      column([widget("copyright")]),
    ]);
    expect(estimateChromeRowHeight(rzad)).toBe(SZUKAJ + SAFE);
  });

  it("sekcja zagnieżdżona ukryta na urządzeniu nie liczy się do rzędu", () => {
    const rzad = section([
      inner([column([widget("search-button")])], ukryty({ mobile: true })),
      column([widget("menu")]),
    ]);
    expect(estimateChromeRowHeight(rzad, "mobile")).toBe(MENU + SAFE);
    expect(estimateChromeRowHeight(rzad, "desktop")).toBe(SZUKAJ + SAFE);
  });

  it("sekcja zagnieżdżona bez listy kolumn (jsonb) nie wywraca szacunku", () => {
    const rzad = section([inner([], { columns: undefined }), column([widget("menu")])]);
    expect(estimateChromeRowHeight(rzad)).toBe(MENU + SAFE);
  });
});

describe("pasek chrome - wysokość autorska z treści", () => {
  it.each([
    ['"64px"', "64px", 64],
    ['" 48.5px " z białymi znakami', " 48.5px ", 48.5],
    ["liczba", 52, 52],
  ])("wysokość %s jest honorowana", (_opis, wartosc, oczekiwana) => {
    expect(estimateChromeWidgetHeight(widget("image", { content: { heightPx: wartosc } }))).toBe(
      oczekiwana,
    );
  });

  it.each([
    ["napis bez jednostki px", "64"],
    ["procent", "50%"],
    ["zero", "0px"],
    ["liczba ujemna", -10],
    ["NaN", Number.NaN],
    ["nieskończoność", Number.POSITIVE_INFINITY],
    ["obiekt", { px: 64 }],
  ])("ODMOWA: %s z bazy nie zastępuje tabeli", (_opis, smiec) => {
    expect(
      estimateChromeWidgetHeight(widget("button", { content: { heightPx: smiec } as never })),
    ).toBe(CHROME_ROW_WIDGET_HEIGHT_PX.button);
  });

  it("widget bez obiektu treści i bez wpisu w tabeli dostaje jedną kontrolkę", () => {
    expect(estimateChromeWidgetHeight(widget("nieznany", { content: undefined }))).toBe(
      CHROME_ROW_DEFAULT_WIDGET_HEIGHT_PX,
    );
  });
});

describe("puste węzły z kolumny jsonb", () => {
  // Renderer pomija puste dzieci (`!!c` w `RenderSection`/`RenderInner`), więc
  // szacunek też musi - wcześniej `null` w liście dzieci wywracał
  // `estimateSectionHeight`, a z nim `sectionIslandInfo` całej listy sekcji
  // (NAPRAWIONE 2026-10-18, wykryte przy pisaniu testów wysp).
  /** `null` tak, jak przychodzi z parsowania kolumny jsonb. */
  const PUSTY: ColumnNode = JSON.parse("null");
  const zDziurami = () =>
    section([PUSTY, inner([PUSTY, column([widget("search-button")])]), column([widget("menu")])]);

  it("sekcja treści: puste dziecko i pusta kolumna zagnieżdżona nic nie zajmują", () => {
    expect(() => estimateSectionHeight(zDziurami())).not.toThrow();
    expect(estimateSectionHeight(zDziurami())).toBe(
      estimateSectionHeight(
        section([inner([column([widget("search-button")])]), column([widget("menu")])]),
      ),
    );
  });

  it("pasek chrome: puste dziecko i pusta kolumna zagnieżdżona nic nie zajmują", () => {
    expect(estimateChromeRowHeight(zDziurami())).toBe(SZUKAJ + SAFE);
  });
});

describe("sekcja treści - sekcja zagnieżdżona ukryta na urządzeniu", () => {
  it("ukryta sekcja zagnieżdżona nie zawyża rezerwy sekcji na tym urządzeniu", () => {
    const wysoka = inner(
      [column([widget("post-list"), widget("post-list")])],
      ukryty({ mobile: true }),
    );
    const niska = column([widget("heading")]);
    const s = section([wysoka, niska]);
    expect(estimateSectionHeight(s, "mobile")).toBeLessThan(estimateSectionHeight(s, "desktop"));
    expect(estimateSectionHeight(s, "mobile")).toBe(
      estimateSectionHeight(section([niska]), "mobile"),
    );
    expect(WIDGET_HEIGHT_ESTIMATE_PX["post-list"]).toBeGreaterThan(0);
  });
});
