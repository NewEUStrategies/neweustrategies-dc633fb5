// ORKIESTRATOR KONWERSJI HTML -> BuilderDocument (`src/lib/wp-import/convert.ts`).
//
// PRZEDMIOT DOWODU: trójstopniowa kaskada Elementor -> Gutenberg -> plain HTML
// i jej CICHE przejścia. Gdy maper Elementora zwraca `null` (a robi to na trzy
// różne sposoby - patrz `elementor.test.ts`), konwersja spada niżej BEZ żadnego
// ostrzeżenia: pole `source` w wyniku jest jedynym śladem, że strona wyglądająca
// na Elementorową została zaimportowana jako coś innego. Ten plik pilnuje, że
// `source`, `coverage` i `warnings` mówią prawdę o tym, która gałąź wygrała.
//
// DRUGI PRZEDMIOT DOWODU: `extractMediaUrls` używa TRZECH regexpów zadeklarowanych
// na poziomie MODUŁU z flagą /g i ręcznym zerowaniem `lastIndex`. To stan
// współdzielony między wywołaniami - jedna zapomniana linijka `lastIndex = 0`
// i drugi import w tym samym procesie gubi część mediów. Dlatego test woła
// funkcję DWA razy na tym samym wejściu i porównuje wyniki.
//
// CZEGO TU NIE MA. Wnętrza `htmlToBlocks`, `parseGutenberg` i
// `stripFoxizShortcodes` (silnik bloków - własne testy) oraz mapowania widgetów
// Elementora (`elementor.test.ts`). Gałąź `isGutenberg && blocks.length === 0`
// jest nieosiągalna: `parseGutenberg` zwraca zero bloków wyłącznie dla wejścia
// pustego/samych spacji, a takie wejście nie zawiera znacznika `<!-- wp:`.
// Nieosiągalna bez rzutowania jest też obrona `html ?? ""` w sygnaturze
// `convertHtmlToBuilder(html: string)` - typ nie dopuszcza null/undefined,
// a wołacze same podają `?? ""`.
//
// RODO: URL-e wyłącznie na example.com / example.org.
import { describe, expect, it } from "vitest";
import { convertHtmlToBuilder, extractMediaUrls } from "@/lib/wp-import/convert";

const ELEMENTOR_HTML = `<section class="elementor-section elementor-top-section"><div class="elementor-column elementor-col-50"><div class="elementor-widget elementor-widget-heading"><h2>Nagłówek importu</h2></div></div></section>`;

describe("convertHtmlToBuilder - gałąź Elementora", () => {
  it("mapuje Elementora i raportuje source=elementor z pokryciem widgetów", () => {
    const res = convertHtmlToBuilder(ELEMENTOR_HTML);
    expect(res.source).toBe("elementor");
    expect(res.coverage).toEqual({
      elementorMapped: 1,
      gutenbergMapped: 0,
      fallback: 0,
      total: 1,
    });
    expect(res.warnings).toEqual([]);
    expect(res.cleanedHtml).toBe(ELEMENTOR_HTML);
    const col = res.doc.sections[0].children[0];
    expect(col.kind === "column" ? col.children[0].type : null).toBe("heading");
  });

  it("przepuszcza ostrzeżenia mapera Elementora do wyniku konwersji", () => {
    const withUnknown = ELEMENTOR_HTML.replace(
      "</div></div></section>",
      '</div><div class="elementor-widget elementor-widget-toggle"><p>x</p></div></div></section>',
    );
    const res = convertHtmlToBuilder(withUnknown);
    expect(res.source).toBe("elementor");
    expect(res.warnings).toEqual(["Nieznany widget Elementor: toggle"]);
    expect(res.coverage.fallback).toBe(1);
  });
});

describe("convertHtmlToBuilder - CICHE zejście z gałęzi Elementora", () => {
  it("znacznik Elementora bez widgetów spada do Gutenberga BEZ ostrzeżenia", () => {
    // `isElementorHtml` mówi „tak" (atrybut data-elementor-type), maper zwraca
    // null - i nikt o tym nie informuje. Tylko `source` to pokazuje.
    const html =
      '<div data-elementor-type="wp-page"><!-- wp:paragraph --><p>Treść bloku.</p><!-- /wp:paragraph --></div>';
    const res = convertHtmlToBuilder(html);
    expect(res.source).toBe("gutenberg");
    expect(res.warnings).toEqual([]);
  });

  it("znacznik Elementora bez widgetów i bez Gutenberga spada do fallbacku HTML", () => {
    const html = '<div data-elementor-type="wp-page"><p>Zwykły akapit.</p></div>';
    const res = convertHtmlToBuilder(html);
    expect(res.source).toBe("html");
    expect(res.warnings).toEqual([
      "Treść nie została rozpoznana jako Elementor ani Gutenberg - użyto fallbacku HTML.",
    ]);
  });
});

describe("convertHtmlToBuilder - gałąź Gutenberga", () => {
  it("wymaga JEDNOCZEŚNIE znacznika <!-- wp: i niepustej listy bloków", () => {
    const res = convertHtmlToBuilder(
      "<!-- wp:paragraph --><p>Akapit z bloku.</p><!-- /wp:paragraph -->",
    );
    expect(res.source).toBe("gutenberg");
    expect(res.coverage.gutenbergMapped).toBeGreaterThan(0);
    expect(res.coverage.elementorMapped).toBe(0);
    expect(res.coverage.fallback).toBe(0);
    expect(res.coverage.total).toBe(res.coverage.gutenbergMapped);
    expect(res.warnings).toEqual([]);
    // Gutenberg pakuje się w JEDEN widget rich-text w kolumnie 12.
    const col = res.doc.sections[0].children[0];
    expect(col.kind === "column" ? col.span : null).toEqual({ desktop: 12 });
    expect(col.kind === "column" ? col.children[0].type : null).toBe("rich-text");
  });

  it("HTML bez znacznika <!-- wp: NIE idzie ścieżką Gutenberga", () => {
    const res = convertHtmlToBuilder("<p>Akapit bez bloków.</p>");
    expect(res.source).toBe("html");
    expect(res.coverage.gutenbergMapped).toBe(0);
  });
});

describe("convertHtmlToBuilder - fallback plain HTML", () => {
  it("liczy bloki fallbacku i dokłada ostrzeżenie o nierozpoznanej treści", () => {
    const res = convertHtmlToBuilder("<h2>Tytuł</h2><p>Tekst strony.</p>");
    expect(res.source).toBe("html");
    expect(res.coverage.fallback).toBeGreaterThan(0);
    expect(res.coverage.total).toBe(res.coverage.fallback);
    expect(res.warnings).toEqual([
      "Treść nie została rozpoznana jako Elementor ani Gutenberg - użyto fallbacku HTML.",
    ]);
  });

  it("puste wejście: pusty dokument, ZERO ostrzeżeń i zero mediów", () => {
    const res = convertHtmlToBuilder("");
    expect(res.source).toBe("html");
    expect(res.warnings).toEqual([]);
    expect(res.coverage).toEqual({
      elementorMapped: 0,
      gutenbergMapped: 0,
      fallback: 0,
      total: 0,
    });
    expect(res.mediaUrls).toEqual([]);
    expect(res.cleanedHtml).toBe("");
    expect(res.doc.sections).toHaveLength(1);
  });

  it("shortcode'y Foxiza są usuwane PRZED konwersją (cleanedHtml)", () => {
    const res = convertHtmlToBuilder("[foxiz_container]tekst[/foxiz_container]");
    expect(res.cleanedHtml).not.toContain("foxiz_container");
  });
});

describe("extractMediaUrls", () => {
  const HTML = [
    '<img src="https://example.com/foto.jpg?ver=2" alt="a" />',
    '<img data-src="https://example.com/lazy.png" srcset="https://example.com/male.png 480w, https://example.com/duze.png 1024w, /wp-content/relatywny.png 2x" />',
    '<a href="https://example.org/raport.pdf">raport</a>',
    '<video poster="https://example.com/plakat.jpg" data-lazy-src="https://example.com/film.mp4"></video>',
    '<div style="background:url(https://example.com/tlo.webp)"></div>',
    '<img src="/wp-content/uploads/lokalny.jpg" />',
    '<a href="https://example.org/strona.html">nie media</a>',
  ].join("");

  it("zbiera src, data-src, href, poster, srcset i url() ze stylu", () => {
    const urls = extractMediaUrls(HTML);
    expect(urls).toContain("https://example.com/foto.jpg?ver=2");
    expect(urls).toContain("https://example.com/lazy.png");
    expect(urls).toContain("https://example.com/male.png");
    expect(urls).toContain("https://example.com/duze.png");
    expect(urls).toContain("https://example.org/raport.pdf");
    expect(urls).toContain("https://example.com/plakat.jpg");
    expect(urls).toContain("https://example.com/film.mp4");
    expect(urls).toContain("https://example.com/tlo.webp");
  });

  it("odrzuca adresy relatywne i pliki nie-mediowe", () => {
    const urls = extractMediaUrls(HTML);
    expect(urls).not.toContain("/wp-content/relatywny.png");
    expect(urls).not.toContain("/wp-content/uploads/lokalny.jpg");
    expect(urls.some((u) => u.endsWith("strona.html"))).toBe(false);
  });

  it("nie dubluje tego samego adresu", () => {
    const urls = extractMediaUrls(
      '<img src="https://example.com/ten-sam.jpg" /><img src="https://example.com/ten-sam.jpg" />',
    );
    expect(urls).toEqual(["https://example.com/ten-sam.jpg"]);
  });

  it("DWA wywołania po kolei dają IDENTYCZNY wynik (regexpy modułowe mają stan)", () => {
    // MEDIA_URL_RE / SRCSET_RE / STYLE_URL_RE są modułowe i mają flagę /g.
    // Gdyby ktoś usunął zerowanie `lastIndex`, drugi import w tym samym procesie
    // pogubiłby media - i nikt by tego nie zauważył.
    const first = extractMediaUrls(HTML);
    const second = extractMediaUrls(HTML);
    const third = extractMediaUrls(HTML);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first.length).toBeGreaterThan(5);
  });

  it("puste wejście zwraca pustą listę bez ruszania regexpów", () => {
    expect(extractMediaUrls("")).toEqual([]);
  });

  it("pusty element srcset (przecinek na końcu) nie dodaje pustego adresu", () => {
    const urls = extractMediaUrls('<img srcset="https://example.com/a.png 1x, " />');
    expect(urls).toEqual(["https://example.com/a.png"]);
    expect(urls).not.toContain("");
  });
});
