// Detektor nagłówka poziomu 1 w dokumencie buildera.
//
// Ta funkcja jest jedyną podstawą decyzji "czy strona buildera potrzebuje
// dorysowanego h1" (patrz BuilderPageShell + routes/$.tsx). Jej pomyłka w jedną
// stronę daje dwa `h1` (defekt SEO), w drugą - zero `h1` (defekt a11y), więc
// każdy realny kształt dokumentu ma tu swój przypadek.
import { describe, expect, it } from "vitest";
import { builderDocHasTopHeading, widgetRendersTopHeading } from "@/lib/builder/headings";
import type { BuilderDocument, WidgetContent, WidgetNode, WidgetType } from "@/lib/builder/types";

function widget(type: string, content: WidgetContent): WidgetNode {
  return { id: `w-${type}`, kind: "widget", type: type as WidgetType, content };
}

/** Dokument z jedną sekcją, jedną kolumną i podanymi widgetami. */
function doc(...widgets: WidgetNode[]): BuilderDocument {
  return {
    version: 1,
    sections: [
      {
        id: "s1",
        kind: "section",
        children: [{ id: "c1", kind: "column", span: { desktop: 12 }, children: widgets }],
      },
    ],
  };
}

/** Dokument z widgetem schowanym w sekcji wewnętrznej (inner-section). */
function nestedDoc(...widgets: WidgetNode[]): BuilderDocument {
  return {
    version: 1,
    sections: [
      {
        id: "s1",
        kind: "section",
        children: [
          {
            id: "in1",
            kind: "inner-section",
            columns: [{ id: "c2", kind: "column", span: { desktop: 6 }, children: widgets }],
          },
        ],
      },
    ],
  };
}

describe("widgetRendersTopHeading", () => {
  it("widget nagłówka z tagiem h1 jest nagłówkiem poziomu 1", () => {
    expect(widgetRendersTopHeading(widget("heading", { text_pl: "Tytuł", tag: "h1" }))).toBe(true);
  });

  it("domyślny tag h2 nagłówkiem poziomu 1 nie jest", () => {
    expect(widgetRendersTopHeading(widget("heading", { text_pl: "Tytuł", tag: "h2" }))).toBe(false);
    // Brak klucza `tag` = default z rejestru (h2) - też nie.
    expect(widgetRendersTopHeading(widget("heading", { text_pl: "Tytuł" }))).toBe(false);
  });

  it("tag zapisany wersalikami / z białymi znakami liczy się tak samo", () => {
    expect(widgetRendersTopHeading(widget("animated-heading", { tag: "H1" }))).toBe(true);
    expect(widgetRendersTopHeading(widget("text-rotate", { tag: " h1 " }))).toBe(true);
  });

  it("nagłówek wpisany wprost w HTML widgetu tekstowego też się liczy", () => {
    expect(
      widgetRendersTopHeading(
        widget("text", { html_pl: '<h1 class="mt-2">Raport</h1><p>Wstęp</p>' }),
      ),
    ).toBe(true);
    // Wariant EN - dokument dwujęzyczny ma nagłówek w obu polach treści.
    expect(widgetRendersTopHeading(widget("text", { html_en: "<H1>Report</H1>" }))).toBe(true);
  });

  it("sam tekst o h1 (bez znacznika) nie jest nagłówkiem", () => {
    expect(
      widgetRendersTopHeading(widget("text", { html_pl: "<p>Ustaw h1 w ustawieniach</p>" })),
    ).toBe(false);
  });

  it("widgety zależne od kontekstu wpisu NIE są dowodem na h1", () => {
    // `post-title` ma domyślnie tag h1, ale na STRONIE nie ma kontekstu wpisu
    // i renderuje się do null - zaliczenie go zostawiłoby stronę bez nagłówka.
    expect(widgetRendersTopHeading(widget("post-title", { tag: "h1" }))).toBe(false);
    expect(widgetRendersTopHeading(widget("archive-title", { tag: "h1" }))).toBe(false);
  });

  it("brak widgetu / obcy węzeł nie wysadza detektora", () => {
    expect(widgetRendersTopHeading(null)).toBe(false);
    expect(widgetRendersTopHeading(undefined)).toBe(false);
  });
});

describe("builderDocHasTopHeading", () => {
  it("pusty, brakujący i uszkodzony dokument = brak nagłówka (trasa dorysuje h1)", () => {
    expect(builderDocHasTopHeading(null)).toBe(false);
    expect(builderDocHasTopHeading(undefined)).toBe(false);
    expect(builderDocHasTopHeading({ version: 1, sections: [] })).toBe(false);
    expect(
      builderDocHasTopHeading({ version: 1, sections: null } as unknown as BuilderDocument),
    ).toBe(false);
  });

  it("znajduje nagłówek w kolumnie sekcji", () => {
    expect(builderDocHasTopHeading(doc(widget("heading", { tag: "h1" })))).toBe(true);
    expect(builderDocHasTopHeading(doc(widget("heading", { tag: "h3" })))).toBe(false);
  });

  it("znajduje nagłówek zagnieżdżony w sekcji wewnętrznej", () => {
    expect(builderDocHasTopHeading(nestedDoc(widget("heading", { tag: "h1" })))).toBe(true);
    expect(builderDocHasTopHeading(nestedDoc(widget("image", { src: "/a.png" })))).toBe(false);
  });

  it("wystarczy jeden nagłówek wśród wielu widgetów", () => {
    expect(
      builderDocHasTopHeading(
        doc(
          widget("image", { src: "/hero.png" }),
          widget("text", { html_pl: "<p>Lead</p>" }),
          widget("heading", { tag: "h1", text_pl: "Program" }),
        ),
      ),
    ).toBe(true);
  });

  it("dokument z samymi widgetami dynamicznymi nadal wymaga h1 z tytułu", () => {
    expect(
      builderDocHasTopHeading(doc(widget("post-title", { tag: "h1" }), widget("post-meta", {}))),
    ).toBe(false);
  });
});
