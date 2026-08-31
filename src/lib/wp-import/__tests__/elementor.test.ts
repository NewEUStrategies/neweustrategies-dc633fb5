// MAPER ELEMENTOR -> WIDGETY BUILDERA (`src/lib/wp-import/elementor.ts`).
//
// DLACZEGO TEN PLIK ISTNIEJE. Moduł stał na 3,28% instrukcji i 2% gałęzi, a jest
// jedynym miejscem, które decyduje, czy zaimportowana strona WordPressa dostanie
// prawdziwe widgety, czy jeden worek `rich-text`. Kiedy maper zwraca `null`,
// `convertHtmlToBuilder` CICHO spada do Gutenberga albo do fallbacku HTML -
// redakcja nie widzi żadnego komunikatu, tylko inny wynik importu.
//
// CO MA TU DOWÓD:
//   1. detekcja `isElementorHtml` po klasach i po `data-elementor-type`,
//   2. TRZY osobne wyjścia `null` (nie-Elementor, zero widgetów, zero sekcji po
//      czyszczeniu) - każde inną drogą, bo każde znaczy co innego,
//   3. pełny przełącznik `parseWidget`: 10 zmapowanych rodzin widgetów, gałąź
//      "nierozpoznany kontener" i domyślna z komunikatem
//      "Nieznany widget Elementor: ${kind}" (to jedyny sygnał utraty wierności),
//   4. `pickSpan`: SZEŚĆ mapowań szerokości kolumn Elementora na siatkę 12 plus
//      domyślne 12 dla szerokości nieznanej - pomyłka tutaj rozjeżdża układ
//      każdej zaimportowanej strony,
//   5. `extractOutermost`: zagnieżdżone dopasowania NIE są zwracane drugi raz,
//   6. pomocniki (esc, stripTags, readAttr, classesOf, hasClass,
//      hasAnyClassStart, widgetKind, firstMatch) - przez zachowanie widgetów,
//      które z nich korzystają, a nie przez osobne mikroasercje.
//
// CZEGO TU NIE MA. Nie testujemy `htmlToBlocks` ani `parseGutenberg` - to
// silnik bloków z własnymi testami; tutaj interesuje nas WYŁĄCZNIE to, co maper
// robi ze strukturą Elementora. Nie testujemy też `convertHtmlToBuilder`
// (osobny plik `convert.test.ts`).
//
// RODO: wszystkie URL-e w fixture'ach wyłącznie na example.com / example.org.
import { describe, expect, it } from "vitest";
import { elementorToBuilder, isElementorHtml, __internals } from "@/lib/wp-import/elementor";
import type { WidgetNode } from "@/lib/builder/types";

const widgetOpen = (kind: string, extra = ""): string =>
  `<div class="elementor-element elementor-widget elementor-widget-${kind}"${extra ? " " + extra : ""}>`;

/** Skrót: przepuszcza pojedynczy widget przez przełącznik `parseWidget`. */
function parseOne(kind: string, inner: string): { node: WidgetNode; warning?: string } {
  const parsed = __internals.parseWidget(widgetOpen(kind), inner);
  return { node: parsed.node, warning: parsed.warning };
}

function column(colClass: string, inner: string): string {
  return `<div class="elementor-column ${colClass}"><div class="elementor-widget-wrap">${inner}</div></div>`;
}

const HEADING_WIDGET = `${widgetOpen("heading")}<div class="elementor-widget-container"><h3 class="elementor-heading-title">Strategia dla regionu</h3></div></div>`;

function section(inner: string): string {
  return `<section class="elementor-section elementor-top-section">${inner}</section>`;
}

describe("isElementorHtml", () => {
  it("odrzuca pusty łańcuch i HTML bez znaczników Elementora", () => {
    expect(isElementorHtml("")).toBe(false);
    expect(isElementorHtml("<p>Zwykły akapit z WordPressa.</p>")).toBe(false);
    expect(isElementorHtml('<div class="entry-content">tekst</div>')).toBe(false);
  });

  it("rozpoznaje klasy Elementora oraz atrybut data-elementor-type", () => {
    expect(isElementorHtml('<div class="elementor-section">x</div>')).toBe(true);
    expect(isElementorHtml('<div class="foo elementor-widget bar">x</div>')).toBe(true);
    expect(isElementorHtml('<div class="elementor-container">x</div>')).toBe(true);
    expect(isElementorHtml('<div class="elementor-inner-section">x</div>')).toBe(true);
    expect(isElementorHtml('<div data-elementor-type="wp-page">x</div>')).toBe(true);
  });
});

describe("elementorToBuilder - trzy różne drogi do null", () => {
  it("1) HTML bez znaczników Elementora - maper w ogóle nie wchodzi", () => {
    expect(elementorToBuilder("<p>Akapit</p>")).toBeNull();
  });

  it("2) znaczniki Elementora są, ale nie ma ANI JEDNEGO widgetu", () => {
    // Marker w atrybucie, brak sekcji i brak `elementor-widget` - płaski przebieg
    // po widgetach zwraca pustą listę.
    expect(elementorToBuilder('<div data-elementor-type="wp-page"><p>puste</p></div>')).toBeNull();
  });

  it("3) sekcje i kolumny są, ale wszystkie puste - po czyszczeniu zostaje zero", () => {
    const html = section(column("elementor-col-50", "") + column("elementor-col-50", ""));
    expect(elementorToBuilder(html)).toBeNull();
  });
});

describe("elementorToBuilder - struktura dokumentu", () => {
  it("mapuje <section> z kolumnami na sekcję i kolumny buildera", () => {
    const html = section(
      column("elementor-col-66", HEADING_WIDGET) + column("elementor-col-33", HEADING_WIDGET),
    );
    const out = elementorToBuilder(html);
    expect(out).not.toBeNull();
    expect(out?.doc.version).toBe(1);
    expect(out?.doc.sections).toHaveLength(1);
    const cols = out?.doc.sections[0].children ?? [];
    expect(cols).toHaveLength(2);
    expect(cols[0].kind).toBe("column");
    expect(out?.coverage).toEqual({ elementorMapped: 2, fallback: 0, total: 2 });
    expect(out?.warnings).toEqual([]);
  });

  it("sekcja bez kolumn dostaje jedną kolumnę na pełne 12", () => {
    const out = elementorToBuilder(section(HEADING_WIDGET));
    const cols = out?.doc.sections[0].children ?? [];
    expect(cols).toHaveLength(1);
    expect(cols[0].kind === "column" ? cols[0].span : null).toEqual({ desktop: 12 });
  });

  it("<section> z SAMĄ klasą elementor-top-section też jest sekcją", () => {
    const out = elementorToBuilder(
      `<section class="elementor-top-section">${HEADING_WIDGET}</section>`,
    );
    expect(out?.doc.sections).toHaveLength(1);
    expect(out?.coverage.elementorMapped).toBe(1);
  });

  it("kontenery e-con / e-parent oraz div.elementor-top-section też są sekcjami", () => {
    for (const cls of ["e-con", "e-parent", "elementor-top-section"]) {
      const out = elementorToBuilder(`<div class="${cls}">${HEADING_WIDGET}</div>`);
      expect(out, cls).not.toBeNull();
      expect(out?.doc.sections, cls).toHaveLength(1);
    }
  });

  it("div.elementor-inner-section NIE jest brany jako sekcja nadrzędna", () => {
    // Sekcja wewnętrzna ma zostać częścią sekcji nadrzędnej, a nie zdublować jej
    // treść jako druga sekcja najwyższego poziomu.
    const html = `<div class="elementor-section elementor-inner-section">${HEADING_WIDGET}</div>`;
    const out = elementorToBuilder(html);
    // Brak sekcji nadrzędnej -> płaski przebieg po widgetach, JEDNA sekcja.
    expect(out?.doc.sections).toHaveLength(1);
    expect(out?.coverage.total).toBe(1);
  });

  it("płaski przebieg po widgetach, gdy Elementor jest, a sekcji nie ma", () => {
    const out = elementorToBuilder(HEADING_WIDGET);
    expect(out?.doc.sections).toHaveLength(1);
    const col = out?.doc.sections[0].children[0];
    expect(col?.kind === "column" ? col.children : []).toHaveLength(1);
  });

  it("usuwa puste kolumny, ale zachowuje te z widgetami", () => {
    const html = section(
      column("elementor-col-50", "") + column("elementor-col-50", HEADING_WIDGET),
    );
    const out = elementorToBuilder(html);
    expect(out?.doc.sections[0].children).toHaveLength(1);
  });

  it("zlicza fallbacki i zbiera ostrzeżenie dla nieznanego widgetu", () => {
    const unknown = `${widgetOpen("accordion")}<div>Harmonijka</div></div>`;
    const out = elementorToBuilder(section(column("elementor-col-100", HEADING_WIDGET + unknown)));
    expect(out?.coverage).toEqual({ elementorMapped: 1, fallback: 1, total: 2 });
    expect(out?.warnings).toEqual(["Nieznany widget Elementor: accordion"]);
  });
});

describe("pickSpan - szerokości kolumn Elementora na siatce 12", () => {
  const spanFor = (colClass: string): unknown => {
    const out = elementorToBuilder(section(column(colClass, HEADING_WIDGET)));
    const col = out?.doc.sections[0].children[0];
    return col?.kind === "column" ? col.span : null;
  };

  it("mapuje sześć znanych szerokości", () => {
    expect(spanFor("elementor-col-100")).toEqual({ desktop: 12 });
    expect(spanFor("elementor-col-66")).toEqual({ desktop: 8 });
    expect(spanFor("elementor-col-50")).toEqual({ desktop: 6 });
    expect(spanFor("elementor-col-33")).toEqual({ desktop: 4 });
    expect(spanFor("elementor-col-25")).toEqual({ desktop: 3 });
    expect(spanFor("elementor-col-20")).toEqual({ desktop: 3 });
    expect(spanFor("elementor-col-16")).toEqual({ desktop: 2 });
  });

  it("nieznana szerokość i brak klasy szerokości spadają do 12", () => {
    expect(spanFor("elementor-col-77")).toEqual({ desktop: 12 });
    expect(spanFor("elementor-column-wrap")).toEqual({ desktop: 12 });
  });
});

describe("parseWidget - pełny przełącznik rodzajów", () => {
  it("heading: poziom z tagu Hn, tekst bez tagów, opcjonalny link", () => {
    const { node } = parseOne(
      "heading",
      '<h4><a href="https://example.com/raport">Raport <em>roczny</em></a></h4>',
    );
    expect(node.type).toBe("heading");
    expect(node.content.level).toBe(4);
    expect(node.content.text_pl).toBe("Raport roczny");
    expect(node.content.text_en).toBe("Raport roczny");
    expect(node.content.href).toBe("https://example.com/raport");
  });

  it("heading bez tagu Hn: poziom domyślny 2 i brak klucza href", () => {
    const { node } = parseOne("heading", "<div>Sam tekst nagłówka</div>");
    expect(node.content.level).toBe(2);
    expect(node.content.text_pl).toBe("Sam tekst nagłówka");
    expect(node.content).not.toHaveProperty("href");
  });

  it("text-editor, text-path i theme-post-content trafiają w rich-text", () => {
    for (const kind of ["text-editor", "text-path", "theme-post-content"]) {
      const { node, warning } = parseOne(
        kind,
        '<div class="elementor-widget-container"><p>Treść akapitu.</p></div>',
      );
      expect(node.type, kind).toBe("rich-text");
      expect(warning, kind).toBeUndefined();
      expect(JSON.stringify(node.content.doc), kind).toContain("Treść akapitu.");
    }
  });

  it("text-editor bez treści daje pusty dokument bloków, a nie wyjątek", () => {
    const { node } = parseOne("text-editor", '<div class="elementor-widget-container">   </div>');
    expect(JSON.stringify(node.content.doc)).toContain('"blocks":[]');
  });

  it("button: href, etykieta, wariant z klasy i target=_blank", () => {
    const { node } = parseOne(
      "button",
      '<a class="elementor-button elementor-button-secondary" href="https://example.org/kontakt" target="_blank"><span>Napisz <b>do nas</b></span></a>',
    );
    expect(node.type).toBe("button");
    expect(node.content.href).toBe("https://example.org/kontakt");
    expect(node.content.label_pl).toBe("Napisz do nas");
    expect(node.content.variant).toBe("secondary");
    expect(node.content.target).toBe("_blank");
  });

  it("button bez <a>: href '#', wariant primary, bez target", () => {
    const { node } = parseOne("button", "<span>Zobacz</span>");
    expect(node.content.href).toBe("#");
    expect(node.content.variant).toBe("primary");
    expect(node.content.label_pl).toBe("Zobacz");
    expect(node.content).not.toHaveProperty("target");
  });

  it("button z <a> bez href dostaje '#' zamiast pustego łańcucha", () => {
    const { node } = parseOne("button", '<a class="elementor-button">Wyślij</a>');
    expect(node.content.href).toBe("#");
  });

  it("image i theme-post-featured-image: src, alt, link i podpis", () => {
    for (const kind of ["image", "theme-post-featured-image"]) {
      const { node } = parseOne(
        kind,
        '<figure><a href="https://example.com/pelny.jpg"><img src="https://example.com/foto.jpg" alt="Sala obrad" /></a><figcaption><em>Fot. Redakcja</em></figcaption></figure>',
      );
      expect(node.type, kind).toBe("image");
      expect(node.content.src, kind).toBe("https://example.com/foto.jpg");
      expect(node.content.alt_pl, kind).toBe("Sala obrad");
      expect(node.content.href, kind).toBe("https://example.com/pelny.jpg");
      expect(node.content.caption_pl, kind).toBe("Fot. Redakcja");
    }
  });

  it("image bez <img>: puste src, bez href i bez podpisu", () => {
    const { node } = parseOne("image", "<div>brak obrazka</div>");
    expect(node.content.src).toBe("");
    expect(node.content).not.toHaveProperty("href");
    expect(node.content).not.toHaveProperty("caption_pl");
  });

  it("icon-box i image-box: karta text z eskejpowanym HTML-em", () => {
    for (const kind of ["icon-box", "image-box"]) {
      const { node } = parseOne(
        kind,
        '<div class="elementor-icon-box-wrapper"><i class="fas fa-star"></i><h3 class="elementor-icon-box-title"><a href="https://example.com/a&b">Badania & analizy</a></h3><p class="elementor-icon-box-description">Opis <b>karty</b>.</p></div>',
      );
      expect(node.type, kind).toBe("text");
      const html = String(node.content.html_pl);
      expect(html, kind).toContain("<h3>Badania &amp; analizy</h3>");
      expect(html, kind).toContain("<p>Opis karty.</p>");
      expect(html, kind).toContain('href="https://example.com/a&amp;b"');
      expect(node.content.html_en, kind).toBe("");
      expect(node.content._iconHint, kind).toBe("fas fa-star");
    }
  });

  it("icon-box bez linku nie dokleja <a>", () => {
    const { node } = parseOne(
      "icon-box",
      '<h3 class="elementor-icon-box-title">Tytuł</h3><p class="elementor-icon-box-description">Opis</p>',
    );
    expect(String(node.content.html_pl)).not.toContain("<a");
  });

  it("icon-list i icon-list-menu: pozycje <li> na listę rich-text", () => {
    for (const kind of ["icon-list", "icon-list-menu"]) {
      const { node } = parseOne(
        kind,
        "<ul><li><span>Analizy & raporty</span></li><li>Warsztaty</li></ul>",
      );
      expect(node.type, kind).toBe("rich-text");
      const doc = JSON.stringify(node.content.doc);
      expect(doc, kind).toContain("Analizy");
      expect(doc, kind).toContain("Warsztaty");
    }
  });

  it("divider nie ma treści, spacer czyta wysokość ze stylu", () => {
    expect(parseOne("divider", "<hr/>").node.type).toBe("divider");
    expect(parseOne("divider", "<hr/>").node.content).toEqual({});
    const spacer = parseOne(
      "spacer",
      '<div class="elementor-spacer" style="height: 120px"></div>',
    ).node;
    expect(spacer.type).toBe("spacer");
    expect(spacer.content.height).toBe(120);
  });

  it("spacer bez wysokości w stylu dostaje domyślne 48px", () => {
    expect(parseOne("spacer", "<div></div>").node.content.height).toBe(48);
    // Styl jest, ale bez liczby w pikselach - też domyślka.
    expect(parseOne("spacer", '<div style="height: auto"></div>').node.content.height).toBe(48);
  });

  it("video i html: src z iframe, rodzaj youtube vs iframe", () => {
    const yt = parseOne("video", '<iframe src="https://www.youtube.com/embed/abc"></iframe>').node;
    expect(yt.type).toBe("video");
    expect(yt.content.kind).toBe("youtube");
    const raw = parseOne("html", '<div data-src="https://example.org/player.html"></div>').node;
    expect(raw.content.src).toBe("https://example.org/player.html");
    expect(raw.content.kind).toBe("iframe");
  });

  it("nieznany rodzaj widgetu: fallback rich-text + ostrzeżenie z nazwą", () => {
    const parsed = __internals.parseWidget(widgetOpen("countdown"), "<p>15 dni</p>");
    expect(parsed.mapped).toBe(false);
    expect(parsed.warning).toBe("Nieznany widget Elementor: countdown");
    expect(parsed.node.type).toBe("rich-text");
    expect(JSON.stringify(parsed.node.content.doc)).toContain("15 dni");
  });

  it("kontener bez rozpoznanej rodziny: ostrzeżenie o kontenerze", () => {
    const parsed = __internals.parseWidget(
      '<div class="elementor-widget elementor-widget-container">',
      "<p>x</p>",
    );
    expect(parsed.mapped).toBe(false);
    expect(parsed.warning).toBe("Nierozpoznany kontener widgetu");
  });
});

describe("widgetKind", () => {
  it("wymaga klasy elementor-widget i zwraca rodzinę bez prefiksu", () => {
    expect(__internals.widgetKind('<div class="elementor-widget elementor-widget-heading">')).toBe(
      "heading",
    );
    expect(__internals.widgetKind('<div class="elementor-widget-heading">')).toBeNull();
    expect(__internals.widgetKind("<div>")).toBeNull();
    expect(__internals.widgetKind('<div class="elementor-widget">')).toBeNull();
  });
});

describe("extractOutermost", () => {
  it("zwraca tylko NAJBARDZIEJ ZEWNĘTRZNE dopasowania (bez dubli zagnieżdżeń)", () => {
    const html =
      '<div class="cel"><div class="cel"><p>środek</p></div></div><div class="cel">drugi</div>';
    const ranges = __internals.extractOutermost(html, "div", (open) =>
      open.includes('class="cel"'),
    );
    expect(ranges).toHaveLength(2);
    expect(ranges[0].inner).toBe('<div class="cel"><p>środek</p></div>');
    expect(ranges[1].inner).toBe("drugi");
  });

  it("ignoruje niedomknięty element i elementy niedopasowane", () => {
    expect(
      __internals.extractOutermost('<div class="cel"><p>bez końca</p>', "div", (open) =>
        open.includes("cel"),
      ),
    ).toHaveLength(0);
    expect(
      __internals.extractOutermost("<div>inny</div>", "div", (open) => open.includes("cel")),
    ).toHaveLength(0);
  });

  it("nadmiarowy tag zamykający nie psuje kolejnych dopasowań", () => {
    const ranges = __internals.extractOutermost(
      '</div><section class="cel">a</section>',
      "section",
      (open) => open.includes("cel"),
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0].open).toBe('<section class="cel">');
  });
});
