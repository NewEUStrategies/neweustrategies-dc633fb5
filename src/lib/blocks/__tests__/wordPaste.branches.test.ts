import { describe, it, expect } from "vitest";
import { looksLikeRichPaste, parseWordHtml, parseWordInlineHtml } from "@/lib/blocks/wordPaste";
import type { Block } from "@/lib/blocks/types";

// Import ze schowka to jedyna droga, którą redaktor wnosi do CMS-a treść
// przygotowaną w Wordzie - i jedyna, w której nie widzi, co się zgubiło:
// wkleja, patrzy na tekst i zapisuje. Zła gałąź `??` nie rzuca wyjątku, tylko
// gubi przypis, podpis pod grafiką albo scala dwie listy w jedną. Dlatego
// tabela chodzi po OBU ramionach każdego warunku, na fixture'ach w kształcie,
// jaki realnie produkują Word, Google Docs i LibreOffice.

const types = (blocks: Block[]): string[] => blocks.map((b) => b.type);
const firstOf = (blocks: Block[], type: string): Block | undefined =>
  blocks.find((b) => b.type === type);

describe("looksLikeRichPaste", () => {
  it.each([
    ["pusty string", "", false],
    ["same spacje", "   \n ", false],
    ["goły tekst", "zwykły tekst bez znaczników", false],
    ["znacznik nie z listy", "<article>x</article>", false],
    ["akapit", "<p>x</p>", true],
    ["nagłówek", "<H2>x</H2>", true],
    ["tabela", "<table><tr><td>x</td></tr></table>", true],
    ["obraz", '<img src="/a.png">', true],
    ["pogrubienie", "<strong>x</strong>", true],
    ["złamanie wiersza", "a<br>b", true],
  ])("%s -> %s", (_l, html, expected) => {
    expect(looksLikeRichPaste(html)).toBe(expected);
  });
});

describe("parseWordHtml - wejście puste i zdegenerowane", () => {
  it.each([
    ["pusty string", ""],
    ["same spacje", "   "],
    ["sam komentarz", "<!-- komentarz -->"],
    ["sam znacznik style", "<style>p{color:red}</style>"],
    ["sam script", "<script>alert(1)</script>"],
  ])("%s daje pustą listę bloków", (_l, html) => {
    expect(parseWordHtml(html)).toEqual([]);
  });

  it("goły tekst bez elementów daje jeden akapit", () => {
    const blocks = parseWordHtml("goły tekst ze schowka");
    expect(types(blocks)).toEqual(["paragraph"]);
    expect(blocks[0].data.html).toBe("goły tekst ze schowka");
  });

  it("usuwa komentarze warunkowe Worda razem z zawartością markera listy", () => {
    const blocks = parseWordHtml("<p><!--[if !supportLists]-->1.<!--[endif]-->Treść</p>");
    expect(types(blocks)).toEqual(["paragraph"]);
    expect(String(blocks[0].data.html)).not.toContain("supportLists");
  });

  it("usuwa techniczne elementy o:* Worda", () => {
    const blocks = parseWordHtml("<p>Treść<o:p></o:p></p>");
    expect(blocks[0].data.html).toBe("Treść");
  });

  it.each([
    "div[style*='mso-element:footnote-separator']",
    "div[style*='mso-element:endnote-separator']",
  ])("usuwa kontener techniczny (%s)", (selector) => {
    const style = selector.replace(/^div\[style\*='/, "").replace(/'\]$/, "");
    const blocks = parseWordHtml(`<div style="${style}"><p>separator</p></div><p>treść</p>`);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].data.html).toBe("treść");
  });

  it("usuwa odnośnik komentarza recenzenta", () => {
    const blocks = parseWordHtml('<p>Tekst<span class="MsoCommentReference">[1]</span></p>');
    expect(blocks[0].data.html).toBe("Tekst");
  });
});

describe("parseWordHtml - formatowanie inline", () => {
  it.each([
    ["<b>x</b>", "<strong>x</strong>"],
    ["<strong>x</strong>", "<strong>x</strong>"],
    ["<i>x</i>", "<em>x</em>"],
    ["<em>x</em>", "<em>x</em>"],
    ["<u>x</u>", "<u>x</u>"],
    ["<s>x</s>", "<s>x</s>"],
    ["<strike>x</strike>", "<s>x</s>"],
    ["<del>x</del>", "<s>x</s>"],
    ["<sup>x</sup>", "<sup>x</sup>"],
    ["<sub>x</sub>", "<sub>x</sub>"],
    ["<code>x</code>", "<code>x</code>"],
    ["<mark>x</mark>", "<mark>x</mark>"],
  ])("%s normalizuje się na %s", (input, expected) => {
    expect(parseWordHtml(`<p>${input}</p>`)[0].data.html).toBe(expected);
  });

  it("<br> zostaje złamaniem wiersza", () => {
    expect(parseWordHtml("<p>a<br>b</p>")[0].data.html).toBe("a<br>b");
  });

  it("znacznik nieznany jest rozwijany, treść zostaje", () => {
    expect(parseWordHtml("<p><span class=x>tekst</span></p>")[0].data.html).toBe("tekst");
  });

  it("znacznik inline z PUSTĄ treścią nie zostawia pary znaczników", () => {
    // Białe znaki zostają (nie gubimy odstępu między słowami), ale zwijają się
    // do jednej spacji - i bez znaczników <strong></strong>.
    expect(parseWordHtml("<p>a<strong>  </strong>b</p>")[0].data.html).toBe("a b");
  });

  it("escapuje znaki specjalne w tekście", () => {
    expect(parseWordHtml('<p>A &amp; B &lt;C&gt; "D"</p>')[0].data.html).toBe(
      "A &amp; B &lt;C&gt; &quot;D&quot;",
    );
  });

  it("zamienia twardą spację na zwykłą i zwija wielokrotne białe znaki", () => {
    expect(parseWordHtml("<p>a\u00A0\u00A0b   c</p>")[0].data.html).toBe("a b c");
  });

  it.each([
    ["font-weight:bold", "strong"],
    ["font-weight:700", "strong"],
    ["font-style:italic", "em"],
    ["text-decoration:underline", "u"],
    ["text-decoration:line-through", "s"],
    ["vertical-align:super", "sup"],
    ["vertical-align:sub", "sub"],
  ])("styl %s daje znacznik <%s>", (style, tag) => {
    expect(parseWordHtml(`<p><span style="${style}">x</span></p>`)[0].data.html).toBe(
      `<${tag}>x</${tag}>`,
    );
  });

  it("styl bez znanej dekoracji nie dodaje znacznika", () => {
    expect(parseWordHtml('<p><span style="color:red">x</span></p>')[0].data.html).toBe("x");
  });

  it.each([
    ['<b style="font-weight:normal">x</b>', "x"],
    ['<b style="font-weight:400">x</b>', "x"],
    ['<i style="font-style:normal">x</i>', "x"],
    ['<u style="text-decoration:none">x</u>', "x"],
    ['<s style="text-decoration:none">x</s>', "x"],
  ])("styl kasujący dekorację (%s) nie pogrubia dokumentu", (input, expected) => {
    expect(parseWordHtml(`<p>${input}</p>`)[0].data.html).toBe(expected);
  });

  it("styl kasujący dekorację NIE dotyczy znacznika innego rodzaju", () => {
    // `text-decoration:none` nie ma prawa zdjąć <sup>.
    expect(parseWordHtml('<p><sup style="text-decoration:none">1</sup></p>')[0].data.html).toBe(
      "<sup>1</sup>",
    );
  });

  it.each([
    "https://x.test/a",
    "http://x.test/a",
    "mailto:a@x.test",
    "tel:+48123",
    "/lokalny",
    "#kotwica",
  ])("link o dozwolonym schemacie (%s) przeżywa", (href) => {
    expect(parseWordHtml(`<p><a href="${href}">L</a></p>`)[0].data.html).toBe(
      `<a href="${href}">L</a>`,
    );
  });

  it.each(["javascript:alert(1)", "file:///C:/tmp/a.doc", "data:text/html,x", "ftp://x.test"])(
    "link o schemacie NIEDOZWOLONYM (%s) traci href, ale zachowuje tekst",
    (href) => {
      const html = String(parseWordHtml(`<p><a href="${href}">L</a></p>`)[0].data.html);
      expect(html).toBe("L");
    },
  );

  it("link BEZ href traci znacznik, zachowuje tekst", () => {
    expect(parseWordHtml("<p><a>L</a></p>")[0].data.html).toBe("L");
  });

  it("pomija punktor Worda w osobnym span mso-list:Ignore", () => {
    const blocks = parseWordHtml('<p><span style="mso-list:Ignore">1.</span>Treść</p>');
    expect(blocks[0].data.html).toBe("Treść");
  });
});

describe("parseWordHtml - przypisy Worda / GDocs / LibreOffice", () => {
  const wordFootnote = [
    '<p>Teza<a href="#_ftn1" id="_ftnref1"><sup>1</sup></a>.</p>',
    '<div id="ftn1"><p><a href="#_ftnref1">[1]</a> Źródło, <i>Tytuł</i>, 2024.</p></div>',
  ].join("");

  it("zamienia odnośnik Worda na shortcode [fn] i usuwa sekcję definicji", () => {
    const blocks = parseWordHtml(wordFootnote);
    expect(blocks).toHaveLength(1);
    const html = String(blocks[0].data.html);
    expect(html).toContain("[fn]");
    // Kursywa tytułu MUSI przetrwać (bibliografia jest sformatowana), po
    // normalizacji na kanoniczny <em>.
    expect(html).toContain("<em>Tytuł</em>");
    expect(html).not.toContain("_ftn");
  });

  it.each([
    ["Word", "_ftn1", "_ftnref1", "#_ftn1"],
    ["Google Docs", "ftnt1", "ftnt_ref1", "#ftnt1"],
    ["LibreOffice", "sdfootnote1", "sdfootnote1anc", "#sdfootnote1"],
    ["przypis końcowy", "_edn1", "_ednref1", "#_edn1"],
  ])("rozpoznaje format %s", (_l, defId, refId, href) => {
    const blocks = parseWordHtml(
      `<p>T<a href="${href}" id="${refId}">1</a></p><div id="${defId}"><p>Definicja</p></div>`,
    );
    expect(String(blocks[0].data.html)).toContain("[fn]Definicja[/fn]");
  });

  it("definicja przypisu jako <p id> (nie div) też jest zbierana", () => {
    const blocks = parseWordHtml(
      '<p>T<a href="#_ftn1">1</a></p><p id="_ftn1">Definicja z akapitu</p>',
    );
    expect(String(blocks[0].data.html)).toContain("Definicja z akapitu");
  });

  it("definicja przypisu jako <li id> też jest zbierana", () => {
    const blocks = parseWordHtml(
      '<p>T<a href="#ftnt1">1</a></p><ol><li id="ftnt1">Z listy</li></ol>',
    );
    expect(String(blocks[0].data.html)).toContain("Z listy");
  });

  it("odnośnik BEZ znanej definicji jest USUWANY, a nie zostawiony jako link", () => {
    const blocks = parseWordHtml('<p>Teza<a href="#_ftn9">9</a>.</p>');
    expect(String(blocks[0].data.html)).toBe("Teza.");
  });

  it("odnośnik bez numeru w href jest usuwany razem z treścią markera", () => {
    // `footnoteKey` nie znajduje cyfry, więc nie ma czym rozwiązać przypisu -
    // odnośnik idzie do kosza jak każdy nierozwiązany marker.
    const blocks = parseWordHtml('<p>Teza<a href="#_ftn">x</a>.</p>');
    expect(String(blocks[0].data.html)).toBe("Teza.");
  });

  it("id definicji, który nie pasuje do wzorca, NIE jest przypisem", () => {
    const blocks = parseWordHtml('<div id="sekcja-1"><p>zwykła treść</p></div>');
    expect(String(blocks[0].data.html)).toBe("zwykła treść");
  });

  it("definicja z PUSTĄ treścią nie tworzy przypisu, ale i tak wypada z treści", () => {
    const blocks = parseWordHtml(
      '<p>T<a href="#_ftn1">1</a></p><div id="_ftn1"><p>&nbsp;</p></div>',
    );
    expect(String(blocks[0].data.html)).toBe("T");
  });

  it("usuwa link powrotny z treści przypisu", () => {
    const blocks = parseWordHtml(
      '<p>T<a href="#_ftn1">1</a></p><div id="_ftn1"><p><a href="#_ftnref1">powrót</a>Treść</p></div>',
    );
    expect(String(blocks[0].data.html)).toContain("[fn]Treść[/fn]");
  });

  it("usuwa znacznik numeru LibreOffice (.sdfootnotesym) z treści przypisu", () => {
    const blocks = parseWordHtml(
      '<p>T<a href="#sdfootnote1sym">1</a></p><div id="sdfootnote1"><p><span class="sdfootnotesym">1</span>Treść LO</p></div>',
    );
    expect(String(blocks[0].data.html)).toContain("[fn]Treść LO[/fn]");
  });

  it("usuwa znacznik MsoFootnoteReference z treści przypisu", () => {
    const blocks = parseWordHtml(
      '<p>T<a href="#_ftn1">1</a></p><div id="_ftn1"><p><span class="MsoFootnoteReference">1</span>Treść</p></div>',
    );
    expect(String(blocks[0].data.html)).toContain("[fn]Treść[/fn]");
  });

  it.each(["[1] ", "(1) ", "1. ", "1) ", "1: ", "* ", "\u2020 "])(
    "zdejmuje wiodący marker %j z treści przypisu",
    (marker) => {
      const blocks = parseWordHtml(
        `<p>T<a href="#_ftn1">1</a></p><div id="_ftn1"><p>${marker}Treść</p></div>`,
      );
      expect(String(blocks[0].data.html)).toContain("[fn]Treść[/fn]");
    },
  );

  it("zdejmuje marker opakowany w <sup>", () => {
    const blocks = parseWordHtml(
      '<p>T<a href="#_ftn1">1</a></p><div id="_ftn1"><p><sup>1</sup> Treść</p></div>',
    );
    expect(String(blocks[0].data.html)).toContain("[fn]Treść[/fn]");
  });

  it("treść przypisu NIE MOŻE rozbić shortcode'u - nawiasy [fn] są neutralizowane", () => {
    const blocks = parseWordHtml(
      '<p>T<a href="#_ftn1">1</a></p><div id="_ftn1"><p>Autor pisze [fn] i [/fn] wprost</p></div>',
    );
    const html = String(blocks[0].data.html);
    expect(html).toContain("(fn)");
    expect(html).toContain("(/fn)");
    // Dokładnie jedna para prawdziwego shortcode'u.
    expect(html.match(/\[fn\]/g)).toHaveLength(1);
    expect(html.match(/\[\/fn\]/g)).toHaveLength(1);
  });

  it("usuwa poziomą linię poprzedzającą sekcję przypisów", () => {
    const blocks = parseWordHtml(
      '<p>T<a href="#_ftn1">1</a></p><hr><div id="_ftn1"><p>Treść</p></div>',
    );
    expect(types(blocks)).toEqual(["paragraph"]);
  });

  it("NIE usuwa linii, po której stoi jeszcze treść", () => {
    const blocks = parseWordHtml(
      '<p>T<a href="#_ftn1">1</a></p><div id="_ftn1"><p>Treść</p></div><hr><p>ogon</p>',
    );
    expect(types(blocks)).toEqual(["paragraph", "separator", "paragraph"]);
  });

  it("definicja przypisu z wielu akapitów scala się w jedną treść", () => {
    const blocks = parseWordHtml(
      '<p>T<a href="#_ftn1">1</a></p><div id="_ftn1"><p>Część A</p><p>Część B</p></div>',
    );
    expect(String(blocks[0].data.html)).toContain("[fn]Część A Część B[/fn]");
  });

  it("definicja bez elementów blokowych czyta treść bezpośrednio", () => {
    const blocks = parseWordHtml('<p>T<a href="#_ftn1">1</a></p><div id="_ftn1">Naga treść</div>');
    expect(String(blocks[0].data.html)).toContain("[fn]Naga treść[/fn]");
  });
});

describe("parseWordHtml - przypisy ręczne (indeks górny + lista na końcu)", () => {
  it("zamienia <sup>1</sup> na przypis, gdy na końcu stoi <ol> z definicjami", () => {
    const blocks = parseWordHtml("<p>Teza<sup>1</sup>.</p><ol><li>Pierwsze źródło</li></ol>");
    expect(blocks).toHaveLength(1);
    expect(String(blocks[0].data.html)).toContain("[fn]Pierwsze źródło[/fn]");
  });

  it("czyta atrybut start listy definicji", () => {
    const blocks = parseWordHtml(
      '<p>Teza<sup>3</sup>.</p><ol start="3"><li>Trzecie źródło</li></ol>',
    );
    expect(String(blocks[0].data.html)).toContain("[fn]Trzecie źródło[/fn]");
  });

  it("atrybut start nieliczbowy traktuje jak 1", () => {
    const blocks = parseWordHtml('<p>T<sup>1</sup>.</p><ol start="abc"><li>Źródło</li></ol>');
    expect(String(blocks[0].data.html)).toContain("[fn]Źródło[/fn]");
  });

  it("NIE zjada listy, której numery nie pasują do indeksów w treści", () => {
    const blocks = parseWordHtml('<p>Teza<sup>1</sup>.</p><ol start="7"><li>Nie ten</li></ol>');
    expect(types(blocks)).toEqual(["paragraph", "list"]);
  });

  it("NIE zjada listy, gdy tylko CZĘŚĆ pozycji odpowiada indeksom", () => {
    const blocks = parseWordHtml(
      "<p>Teza<sup>1</sup>.</p><ol><li>Pasuje</li><li>Nie ma indeksu 2</li></ol>",
    );
    expect(types(blocks)).toEqual(["paragraph", "list"]);
  });

  it("pusta lista <ol> nie jest brana za sekcję przypisów", () => {
    const blocks = parseWordHtml("<p>T<sup>1</sup>.</p><ol></ol>");
    expect(String(blocks[0].data.html)).toContain("<sup>1</sup>");
  });

  it("ostatni element inny niż <ol> przechodzi na ścieżkę akapitową", () => {
    const blocks = parseWordHtml("<p>Teza<sup>1</sup>.</p><p>1. Źródło akapitem</p>");
    expect(blocks).toHaveLength(1);
    expect(String(blocks[0].data.html)).toContain("[fn]Źródło akapitem[/fn]");
  });

  it("pomija PUSTE elementy na końcu, szukając sekcji definicji", () => {
    const blocks = parseWordHtml("<p>T<sup>1</sup>.</p><p>&nbsp;</p><ol><li>Źródło</li></ol>");
    expect(String(blocks[0].data.html)).toContain("[fn]Źródło[/fn]");
  });

  it("zbiera definicje akapitowe od końca, w kolejności numerów", () => {
    const blocks = parseWordHtml(
      "<p>A<sup>1</sup> B<sup>2</sup></p><p>1. Pierwsze</p><p>2. Drugie</p>",
    );
    expect(blocks).toHaveLength(1);
    const html = String(blocks[0].data.html);
    expect(html).toContain("[fn]Pierwsze[/fn]");
    expect(html).toContain("[fn]Drugie[/fn]");
  });

  it("przerywa zbieranie na poziomej linii", () => {
    const blocks = parseWordHtml("<p>T<sup>1</sup></p><hr><p>1. Źródło</p>");
    expect(blocks).toHaveLength(1);
    expect(String(blocks[0].data.html)).toContain("[fn]Źródło[/fn]");
  });

  it("przerywa zbieranie na elemencie, który nie jest blokiem tekstowym", () => {
    const blocks = parseWordHtml("<p>T<sup>1</sup></p><table><tr><td>1. Nie to</td></tr></table>");
    expect(types(blocks)).toEqual(["paragraph", "table"]);
  });

  it("przerywa zbieranie na akapicie bez wzorca numeru", () => {
    const blocks = parseWordHtml("<p>T<sup>1</sup></p><p>Zwykłe zdanie na końcu.</p>");
    expect(types(blocks)).toEqual(["paragraph", "paragraph"]);
  });

  it("przerywa zbieranie na numerze, którego nie ma w indeksach górnych", () => {
    const blocks = parseWordHtml("<p>T<sup>1</sup></p><p>5. Nieużywany numer</p>");
    expect(types(blocks)).toEqual(["paragraph", "paragraph"]);
  });

  it("nie rusza dokumentu BEZ żadnego indeksu górnego", () => {
    const blocks = parseWordHtml("<p>Zwykły tekst</p><p>1. To jest lista, nie przypis</p>");
    expect(types(blocks)).toEqual(["paragraph", "paragraph"]);
  });

  it.each(["<sup>abc</sup>", "<sup>1234</sup>", "<sup></sup>", "<sup>1a</sup>"])(
    "indeks górny %s nie jest numerem przypisu",
    (sup) => {
      const blocks = parseWordHtml(`<p>T${sup}</p><p>1. Źródło</p>`);
      expect(types(blocks)).toEqual(["paragraph", "paragraph"]);
    },
  );

  it.each(["<sup>1,2</sup>", "<sup>1; 2</sup>", "<sup>[1,2]</sup>"])(
    "indeks górny %s daje DWA przypisy",
    (sup) => {
      const blocks = parseWordHtml(`<p>T${sup}</p><p>1. Pierwsze</p><p>2. Drugie</p>`);
      const html = String(blocks[0].data.html);
      expect(html.match(/\[fn\]/g)).toHaveLength(2);
    },
  );

  it("indeks górny z numerem BEZ definicji zostaje indeksem, nie znika", () => {
    const blocks = parseWordHtml("<p>A<sup>1</sup> B<sup>2</sup></p><p>1. Tylko pierwsze</p>");
    const html = String(blocks[0].data.html);
    expect(html).toContain("[fn]Tylko pierwsze[/fn]");
    expect(html).toContain("<sup>2</sup>");
  });

  it("usuwa linię oddzielającą ręczną sekcję przypisów", () => {
    const blocks = parseWordHtml("<p>T<sup>1</sup></p><hr><p>1. Źródło</p>");
    expect(types(blocks)).toEqual(["paragraph"]);
  });

  it("usuwa linię także przed listą definicji", () => {
    const blocks = parseWordHtml("<p>T<sup>1</sup></p><hr><ol><li>Źródło</li></ol>");
    expect(types(blocks)).toEqual(["paragraph"]);
  });
});

describe("parseWordHtml - indeksy górne w Unicode (kopia z PDF)", () => {
  it("zamienia znak \u00B9 na <sup>1</sup> i domyka przypis", () => {
    const blocks = parseWordHtml("<p>Teza\u00B9.</p><p>1. Źródło z PDF</p>");
    expect(blocks).toHaveLength(1);
    expect(String(blocks[0].data.html)).toContain("[fn]Źródło z PDF[/fn]");
  });

  it.each([
    ["\u2070", "0"],
    ["\u00B9", "1"],
    ["\u00B2", "2"],
    ["\u00B3", "3"],
    ["\u2074", "4"],
    ["\u2075", "5"],
    ["\u2076", "6"],
    ["\u2077", "7"],
    ["\u2078", "8"],
    ["\u2079", "9"],
  ])("znak %j mapuje się na cyfrę %s", (char, digit) => {
    const html = String(parseWordHtml(`<p>T${char}</p>`)[0].data.html);
    expect(html).toBe(`T<sup>${digit}</sup>`);
  });

  it("ciąg znaków \u00B9\u00B2 daje jeden <sup>12</sup>", () => {
    expect(parseWordHtml("<p>T\u00B9\u00B2</p>")[0].data.html).toBe("T<sup>12</sup>");
  });

  it("zachowuje tekst PO indeksie górnym", () => {
    expect(parseWordHtml("<p>A\u00B9 dalej</p>")[0].data.html).toBe("A<sup>1</sup> dalej");
  });

  it("NIE rusza znaków, które już siedzą w <sup>", () => {
    expect(parseWordHtml("<p>A<sup>\u00B9</sup></p>")[0].data.html).toBe("A<sup>\u00B9</sup>");
  });

  it("tekst bez znaków indeksu przechodzi bez zmian", () => {
    expect(parseWordHtml("<p>zwykły 1 2 3</p>")[0].data.html).toBe("zwykły 1 2 3");
  });
});

describe("parseWordHtml - nagłówki", () => {
  it.each([
    ["h1", 2],
    ["h2", 2],
    ["h3", 3],
    ["h4", 4],
    ["h5", 5],
    ["h6", 5],
  ])("znacznik %s daje nagłówek poziomu %i (klamp 2-5)", (tag, level) => {
    const blocks = parseWordHtml(`<${tag}>Tytuł</${tag}>`);
    expect(blocks[0].type).toBe("heading");
    expect(blocks[0].data.level).toBe(level);
  });

  it("nagłówek PUSTY nie daje bloku", () => {
    expect(parseWordHtml("<h2>  </h2>")).toEqual([]);
  });

  it("nagłówek z grafiką oddaje nagłówek i obraz", () => {
    const blocks = parseWordHtml('<h2>Tytuł<img src="https://x.test/a.png"></h2>');
    expect(types(blocks)).toEqual(["heading", "image"]);
  });

  it.each([
    ["MsoTitle", 2],
    ["MsoHeading1", 2],
    ["MsoHeading3", 3],
    ["Heading_20_2", 2],
    ["MsoHeading9", 5],
  ])("klasa %s daje nagłówek poziomu %i", (cls, level) => {
    const blocks = parseWordHtml(`<p class="${cls}">Tytuł</p>`);
    expect(blocks[0].type).toBe("heading");
    expect(blocks[0].data.level).toBe(level);
  });

  it("klasa MsoSubtitle NIE jest tytułem", () => {
    expect(parseWordHtml('<p class="MsoSubtitle">Podtytuł</p>')[0].type).toBe("paragraph");
  });

  it.each([
    ["mso-outline-level:1", 2],
    ["mso-outline-level:3", 3],
    ["mso-outline-level:6", 5],
  ])("styl %s daje nagłówek poziomu %i", (style, level) => {
    const blocks = parseWordHtml(`<p style="${style}">Tytuł</p>`);
    expect(blocks[0].type).toBe("heading");
    expect(blocks[0].data.level).toBe(level);
  });

  it("mso-outline-level POZA zakresem 1-6 nie tworzy nagłówka", () => {
    expect(parseWordHtml('<p style="mso-outline-level:9">Tekst</p>')[0].type).toBe("paragraph");
  });

  it('styl mso-style-name:"heading 2" daje nagłówek', () => {
    const blocks = parseWordHtml("<p style='mso-style-name:\"heading 2\"'>Tytuł</p>");
    expect(blocks[0].type).toBe("heading");
    expect(blocks[0].data.level).toBe(2);
  });

  it("akapit bez stylu nagłówkowego zostaje akapitem", () => {
    expect(parseWordHtml("<p>Zwykły</p>")[0].type).toBe("paragraph");
  });

  it("punkt listy NIE jest nagłówkiem, nawet ze stylem nagłówka", () => {
    const blocks = parseWordHtml(
      '<p class="MsoListParagraph MsoHeading2" style="mso-list:l0 level1">Punkt</p>',
    );
    expect(blocks[0].type).toBe("list");
  });

  it("nagłówek stylowany z PUSTĄ treścią nie daje bloku", () => {
    expect(parseWordHtml('<p class="MsoHeading2">  </p>')).toEqual([]);
  });

  it("nagłówek stylowany z grafiką oddaje nagłówek i obraz", () => {
    const blocks = parseWordHtml('<p class="MsoHeading2">T<img src="https://x.test/a.png"></p>');
    expect(types(blocks)).toEqual(["heading", "image"]);
  });
});

describe("parseWordHtml - cytaty", () => {
  it("blockquote daje cytat", () => {
    const blocks = parseWordHtml("<blockquote>Treść cytatu</blockquote>");
    expect(blocks[0].type).toBe("quote");
    expect(blocks[0].data.text).toBe("Treść cytatu");
    expect(blocks[0].data.cite).toBe("");
  });

  it("blockquote z <cite> rozdziela treść i źródło", () => {
    const blocks = parseWordHtml("<blockquote>Treść<cite>Autor</cite></blockquote>");
    expect(blocks[0].data.text).toBe("Treść");
    expect(blocks[0].data.cite).toBe("Autor");
  });

  it("blockquote z <footer> też czyta źródło", () => {
    const blocks = parseWordHtml("<blockquote>Treść<footer>Autor</footer></blockquote>");
    expect(blocks[0].data.cite).toBe("Autor");
  });

  it("blockquote PUSTY nie daje bloku", () => {
    expect(parseWordHtml("<blockquote>  </blockquote>")).toEqual([]);
  });

  it.each(["MsoQuote", "MsoIntenseQuote", "Quotations", "BlockText"])(
    "akapit z klasą %s daje cytat",
    (cls) => {
      expect(parseWordHtml(`<p class="${cls}">Cytat</p>`)[0].type).toBe("quote");
    },
  );

  it.each(['mso-style-name:"quote"', 'mso-style-name:"intense quote"'])(
    "akapit ze stylem %s daje cytat",
    (style) => {
      expect(parseWordHtml(`<p style='${style}'>Cytat</p>`)[0].type).toBe("quote");
    },
  );

  it("akapit cytatu PUSTY nie daje bloku", () => {
    expect(parseWordHtml('<p class="MsoQuote">  </p>')).toEqual([]);
  });

  it("punkt listy o klasie cytatu jest listą, nie cytatem", () => {
    const blocks = parseWordHtml('<p class="MsoQuote MsoListParagraph">Punkt</p>');
    expect(blocks[0].type).toBe("list");
  });
});

describe("parseWordHtml - listy", () => {
  it("<ul> daje listę nieuporządkowaną", () => {
    const blocks = parseWordHtml("<ul><li>A</li><li>B</li></ul>");
    expect(blocks[0].data).toMatchObject({ ordered: false, items: ["A", "B"] });
  });

  it("<ol> daje listę uporządkowaną", () => {
    expect(parseWordHtml("<ol><li>A</li></ol>")[0].data.ordered).toBe(true);
  });

  it("<ol start> większy od 1 zapisuje numer startowy", () => {
    expect(parseWordHtml('<ol start="5"><li>A</li></ol>')[0].data.start).toBe(5);
  });

  it("<ol start=1> NIE zapisuje numeru startowego (to domyślna wartość)", () => {
    expect(parseWordHtml('<ol start="1"><li>A</li></ol>')[0].data.start).toBeUndefined();
  });

  it("<ol start> nieliczbowy traktuje jak 1", () => {
    expect(parseWordHtml('<ol start="x"><li>A</li></ol>')[0].data.start).toBeUndefined();
  });

  it("lista zagnieżdżona zapisuje poziomy", () => {
    const blocks = parseWordHtml("<ul><li>A<ul><li>A1</li></ul></li><li>B</li></ul>");
    expect(blocks[0].data.items).toEqual(["A", "A1", "B"]);
    expect(blocks[0].data.levels).toEqual([1, 2, 1]);
  });

  it("lista BEZ zagnieżdżeń nie zapisuje poziomów (byłyby same jedynki)", () => {
    expect(parseWordHtml("<ul><li>A</li></ul>")[0].data.levels).toBeUndefined();
  });

  it("lista MIESZANA (ul z zagnieżdżonym ol) zapisuje rodzaj per pozycja", () => {
    const blocks = parseWordHtml("<ul><li>A<ol><li>A1</li></ol></li></ul>");
    expect(blocks[0].data.itemsOrdered).toEqual([false, true]);
  });

  it("lista zagnieżdżona JEDNORODNA nie zapisuje itemsOrdered", () => {
    const blocks = parseWordHtml("<ul><li>A<ul><li>A1</li></ul></li></ul>");
    expect(blocks[0].data.itemsOrdered).toBeUndefined();
  });

  it("treść zagnieżdżonej podlisty nie dubluje się w tekście rodzica", () => {
    const blocks = parseWordHtml("<ul><li>A<ul><li>A1</li></ul></li></ul>");
    expect(blocks[0].data.items).toEqual(["A", "A1"]);
  });

  it("pozycje PUSTE są odrzucane", () => {
    const blocks = parseWordHtml("<ul><li>A</li><li>  </li><li>B</li></ul>");
    expect(blocks[0].data.items).toEqual(["A", "B"]);
  });

  it("lista złożona z samych pustych pozycji nie daje bloku", () => {
    expect(parseWordHtml("<ul><li> </li></ul>")).toEqual([]);
  });

  it("element nie-LI w liście jest pomijany", () => {
    const blocks = parseWordHtml("<ul><li>A</li><div>obcy</div></ul>");
    expect(blocks[0].data.items).toEqual(["A"]);
  });

  it("lista zachowuje formatowanie inline pozycji", () => {
    expect(parseWordHtml("<ul><li><b>A</b></li></ul>")[0].data.items).toEqual([
      "<strong>A</strong>",
    ]);
  });
});

describe("parseWordHtml - listy Worda (akapity ze stylem mso-list)", () => {
  it.each([
    [
      "punktor \u00B7",
      '<p class="MsoListParagraph"><span style="mso-list:Ignore">\u00B7</span>A</p>',
      false,
    ],
    ["numer 1.", '<p class="MsoListParagraph"><span style="mso-list:Ignore">1.</span>A</p>', true],
    ["litera a)", '<p class="MsoListParagraph"><span style="mso-list:Ignore">a)</span>A</p>', true],
    [
      "rzymska iv.",
      '<p class="MsoListParagraph"><span style="mso-list:Ignore">iv.</span>A</p>',
      true,
    ],
  ])("%s -> ordered=%s", (_l, html, ordered) => {
    const blocks = parseWordHtml(html);
    expect(blocks[0].type).toBe("list");
    expect(blocks[0].data.ordered).toBe(ordered);
    expect(blocks[0].data.items).toEqual(["A"]);
  });

  it("rozpoznaje punkt po stylu mso-list, bez klasy", () => {
    const blocks = parseWordHtml('<p style="mso-list:l0 level1 lfo1">A</p>');
    expect(blocks[0].type).toBe("list");
  });

  it("bierze numer startowy z pierwszego punktu", () => {
    const blocks = parseWordHtml(
      '<p class="MsoListParagraph"><span style="mso-list:Ignore">7.</span>A</p>',
    );
    expect(blocks[0].data.start).toBe(7);
  });

  it("numer startowy 0 jest odrzucany (lista numeruje się od 1)", () => {
    const blocks = parseWordHtml(
      '<p class="MsoListParagraph"><span style="mso-list:Ignore">0.</span>A</p>',
    );
    expect(blocks[0].data.start).toBeUndefined();
  });

  it("punktor BEZ osobnego span jest zdejmowany z początku tekstu", () => {
    const blocks = parseWordHtml('<p class="MsoListParagraph">\u00B7 A</p>');
    expect(blocks[0].data.items).toEqual(["A"]);
  });

  it.each([
    ["mso-list:l0 level3", 3],
    ["mso-list:l0 level9", 6],
    ["margin-left:36.0pt", 2],
    ["margin-left:72pt", 3],
    ["margin-left:0.5in", 2],
    ["margin-left:1.27cm", 2],
  ])("styl %s daje poziom %i", (style, level) => {
    const blocks = parseWordHtml(
      `<p class="MsoListParagraph" style="${style}">A</p><p class="MsoListParagraph">B</p>`,
    );
    const levels = blocks[0].data.levels;
    expect(Array.isArray(levels) ? levels[0] : 1).toBe(level);
  });

  it("punkt BEZ jawnego poziomu i wcięcia jest na poziomie 1", () => {
    const blocks = parseWordHtml('<p class="MsoListParagraph">A</p>');
    expect(blocks[0].data.levels).toBeUndefined();
  });

  it("kolejne punkty Worda scalają się w JEDNĄ listę", () => {
    const blocks = parseWordHtml(
      '<p class="MsoListParagraph">A</p><p class="MsoListParagraph">B</p>',
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].data.items).toEqual(["A", "B"]);
  });

  it("zwykły akapit MIĘDZY punktami rozdziela listę na dwie", () => {
    const blocks = parseWordHtml(
      '<p class="MsoListParagraph">A</p><p>przerwa</p><p class="MsoListParagraph">B</p>',
    );
    expect(types(blocks)).toEqual(["list", "paragraph", "list"]);
  });

  it("grafika w punkcie listy domyka listę i emituje obraz", () => {
    const blocks = parseWordHtml(
      '<p class="MsoListParagraph">A<img src="https://x.test/a.png"></p>',
    );
    expect(types(blocks)).toEqual(["list", "image"]);
  });

  it("lista Worda kończąca dokument jest domykana (flush na końcu)", () => {
    const blocks = parseWordHtml('<p>wstęp</p><p class="MsoListParagraph">A</p>');
    expect(types(blocks)).toEqual(["paragraph", "list"]);
  });
});

describe("parseWordHtml - obrazy i podpisy", () => {
  it.each([
    ["https://x.test/a.png", "https://x.test/a.png"],
    ["http://x.test/a.png", "http://x.test/a.png"],
    ["//x.test/a.png", "https://x.test/a.png"],
    ["data:image/png;base64,AAA", "data:image/png;base64,AAA"],
  ])("źródło %s jest osadzalne -> %s", (src, expected) => {
    const blocks = parseWordHtml(`<p><img src="${src}"></p>`);
    expect(blocks[0].type).toBe("image");
    expect(blocks[0].data.url).toBe(expected);
  });

  it.each(["file:///C:/tmp/image001.png", "/lokalny.png", "cid:część1", ""])(
    "źródło %j NIE jest osadzalne - obraz jest pomijany",
    (src) => {
      const blocks = parseWordHtml(`<p>Tekst<img src="${src}"></p>`);
      expect(types(blocks)).not.toContain("image");
    },
  );

  it("czyta data-src, gdy nie ma src", () => {
    const blocks = parseWordHtml('<p><img data-src="https://x.test/a.png"></p>');
    expect(blocks[0].data.url).toBe("https://x.test/a.png");
  });

  it("obraz BEZ alt bierze alt z podpisu", () => {
    const blocks = parseWordHtml(
      '<img src="https://x.test/a.png"><p class="MsoCaption">Podpis</p>',
    );
    expect(blocks[0].data.alt).toBe("Podpis");
    expect(blocks[0].data.caption).toBe("Podpis");
  });

  it("obraz z alt zachowuje własny alt", () => {
    const blocks = parseWordHtml(
      '<img src="https://x.test/a.png" alt="Własny"><p class="MsoCaption">Podpis</p>',
    );
    expect(blocks[0].data.alt).toBe("Własny");
    expect(blocks[0].data.caption).toBe("Podpis");
  });

  it("obraz BEZ podpisu ma pusty podpis", () => {
    expect(parseWordHtml('<img src="https://x.test/a.png">')[0].data.caption).toBe("");
  });

  it.each(["MsoCaption", "caption", "image-caption", "caption-text"])(
    "klasa %s jest rozpoznawana jako podpis",
    (cls) => {
      const blocks = parseWordHtml(`<img src="https://x.test/a.png"><p class="${cls}">P</p>`);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].data.caption).toBe("P");
    },
  );

  it("styl mso-style-name:caption jest rozpoznawany jako podpis", () => {
    const blocks = parseWordHtml(
      '<img src="https://x.test/a.png"><p style="mso-style-name:caption">P</p>',
    );
    expect(blocks[0].data.caption).toBe("P");
  });

  it("<figure> z <figcaption> daje obraz z podpisem", () => {
    const blocks = parseWordHtml(
      '<figure><img src="https://x.test/a.png"><figcaption>Podpis</figcaption></figure>',
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].data.caption).toBe("Podpis");
  });

  it("<figure> BEZ figcaption daje obraz bez podpisu", () => {
    const blocks = parseWordHtml('<figure><img src="https://x.test/a.png"></figure>');
    expect(blocks[0].data.caption).toBe("");
  });

  it("akapit z SAMĄ grafiką konsumuje podpis stojący po nim", () => {
    const blocks = parseWordHtml(
      '<p><img src="https://x.test/a.png"></p><p class="MsoCaption">Podpis</p>',
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].data.caption).toBe("Podpis");
  });

  it("akapit z grafiką ORAZ tekstem NIE konsumuje podpisu", () => {
    const blocks = parseWordHtml(
      '<p>Tekst<img src="https://x.test/a.png"></p><p class="MsoCaption">Podpis</p>',
    );
    expect(types(blocks)).toEqual(["paragraph", "image", "paragraph"]);
    expect(firstOf(blocks, "image")?.data.caption).toBe("");
  });

  it("wiele grafik: podpis dostaje TYLKO pierwsza", () => {
    const blocks = parseWordHtml(
      '<p><img src="https://x.test/a.png"><img src="https://x.test/b.png"></p><p class="MsoCaption">P</p>',
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].data.caption).toBe("P");
    expect(blocks[1].data.caption).toBe("");
  });

  it("obraz VML Worda (v:imagedata) jest odczytywany", () => {
    const blocks = parseWordHtml(
      '<p><v:shape><v:imagedata src="https://x.test/vml.png"/></v:shape></p>',
    );
    expect(types(blocks)).toEqual(["image"]);
  });

  it("obraz VML o nieosadzalnym źródle jest pomijany", () => {
    const blocks = parseWordHtml(
      '<p>T<v:shape><v:imagedata src="file:///C:/a.png"/></v:shape></p>',
    );
    expect(types(blocks)).toEqual(["paragraph"]);
  });

  it("obraz jest USUWANY z tekstu, żeby nie dublować się w akapicie", () => {
    const blocks = parseWordHtml('<p>Tekst<img src="https://x.test/a.png" alt="A"></p>');
    expect(String(firstOf(blocks, "paragraph")?.data.html)).not.toContain("img");
  });
});

describe("parseWordHtml - tabele", () => {
  it("prosta tabela daje wiersze bez nagłówka", () => {
    const blocks = parseWordHtml("<table><tr><td>a</td><td>b</td></tr></table>");
    expect(blocks[0].type).toBe("table");
    expect(blocks[0].data.rows).toEqual([["a", "b"]]);
    expect(blocks[0].data.header).toBe(false);
  });

  it("wiersz z <th> jest nagłówkiem", () => {
    const blocks = parseWordHtml("<table><tr><th>a</th></tr><tr><td>b</td></tr></table>");
    expect(blocks[0].data.header).toBe(true);
  });

  it("wiersz z klasą MsoTableHeader jest nagłówkiem (Word nie emituje th)", () => {
    const blocks = parseWordHtml(
      '<table><tr><td class="MsoTableHeader">a</td></tr><tr><td>b</td></tr></table>',
    );
    expect(blocks[0].data.header).toBe(true);
  });

  it("wiersz pogrubiony stylem jest nagłówkiem", () => {
    const blocks = parseWordHtml(
      '<table><tr><td style="font-weight:bold">a</td></tr><tr><td>b</td></tr></table>',
    );
    expect(blocks[0].data.header).toBe(true);
  });

  it("wiersz z komórkami w całości w <b> jest nagłówkiem", () => {
    const blocks = parseWordHtml("<table><tr><td><b>a</b></td></tr><tr><td>b</td></tr></table>");
    expect(blocks[0].data.header).toBe(true);
  });

  it("wiersz z komórką pogrubioną CZĘŚCIOWO nie jest nagłówkiem", () => {
    const blocks = parseWordHtml(
      "<table><tr><td><b>a</b> reszta</td></tr><tr><td>b</td></tr></table>",
    );
    expect(blocks[0].data.header).toBe(false);
  });

  it("wiersz w całości PUSTY nie jest nagłówkiem", () => {
    const blocks = parseWordHtml("<table><tr><td> </td></tr><tr><td>b</td></tr></table>");
    expect(blocks[0].data.header).toBe(false);
  });

  it("zapisuje scalenia komórek, gdy jakieś są", () => {
    const blocks = parseWordHtml('<table><tr><td colspan="2" rowspan="3">a</td></tr></table>');
    expect(blocks[0].data.spans).toEqual([[[2, 3]]]);
  });

  it("NIE zapisuje scaleń, gdy wszystkie są 1x1", () => {
    expect(parseWordHtml("<table><tr><td>a</td></tr></table>")[0].data.spans).toBeUndefined();
  });

  it.each([
    ["0", 1],
    ["1", 1],
    ["abc", 1],
    ["", 1],
    ["999", 20],
    ["2.6", 3],
  ])("colspan %j normalizuje się na %i", (raw, expected) => {
    const blocks = parseWordHtml(`<table><tr><td colspan="${raw}">a</td><td>b</td></tr></table>`);
    const spans = blocks[0].data.spans as number[][][] | undefined;
    expect(spans ? spans[0][0][0] : 1).toBe(expected);
  });

  it.each([
    ['align="center"', "center"],
    ['align="right"', "right"],
    ['style="text-align:center"', "center"],
    ['style="text-align:right"', "right"],
    ['style="text-align:justify"', "left"],
  ])("wyrównanie %s zapisuje się jako %s", (attr, expected) => {
    const blocks = parseWordHtml(`<table><tr><td ${attr}>a</td></tr></table>`);
    expect((blocks[0].data.aligns as string[][])[0][0]).toBe(expected);
  });

  it.each(['align="left"', 'style="text-align:left"', 'align="middle"'])(
    "wyrównanie domyślne (%s) NIE jest zapisywane",
    (attr) => {
      const blocks = parseWordHtml(`<table><tr><td ${attr}>a</td></tr></table>`);
      expect(blocks[0].data.aligns).toBeUndefined();
    },
  );

  it("styl text-align ma pierwszeństwo nad atrybutem align", () => {
    const blocks = parseWordHtml(
      '<table><tr><td align="left" style="text-align:right">a</td></tr></table>',
    );
    expect((blocks[0].data.aligns as string[][])[0][0]).toBe("right");
  });

  it("wiersz BEZ komórek jest pomijany", () => {
    const blocks = parseWordHtml("<table><tr></tr><tr><td>a</td></tr></table>");
    expect(blocks[0].data.rows).toEqual([["a"]]);
  });

  it("tabela BEZ wierszy nie daje bloku", () => {
    expect(parseWordHtml("<table></table>")).toEqual([]);
  });

  it("tabela zagnieżdżona nie wnosi swoich wierszy do tabeli nadrzędnej", () => {
    const blocks = parseWordHtml(
      "<table><tr><td><table><tr><td>wewn</td></tr></table></td></tr></table>",
    );
    expect((blocks[0].data.rows as string[][]).length).toBe(1);
  });

  it("tabela domyka otwartą listę Worda", () => {
    const blocks = parseWordHtml(
      '<p class="MsoListParagraph">A</p><table><tr><td>a</td></tr></table>',
    );
    expect(types(blocks)).toEqual(["list", "table"]);
  });
});

describe("parseWordHtml - kod, separator, kontenery", () => {
  it("<pre> daje blok kodu", () => {
    const blocks = parseWordHtml("<pre>const a = 1</pre>");
    expect(blocks[0].type).toBe("code");
    expect(blocks[0].data.code).toBe("const a = 1");
  });

  it("<pre> PUSTY nie daje bloku", () => {
    expect(parseWordHtml("<pre>   </pre>")).toEqual([]);
  });

  it("<hr> daje separator", () => {
    expect(parseWordHtml("<hr>")[0].data.variant).toBe("line");
  });

  it.each(["div", "section", "article"])("kontener %s ze strukturą jest rozwijany", (tag) => {
    const blocks = parseWordHtml(`<${tag}><h2>T</h2><p>a</p></${tag}>`);
    expect(types(blocks)).toEqual(["heading", "paragraph"]);
  });

  it("kontener z samą treścią inline daje jeden akapit (typowe dla Google Docs)", () => {
    const blocks = parseWordHtml("<div>tekst <b>pogrubiony</b></div>");
    expect(types(blocks)).toEqual(["paragraph"]);
    expect(blocks[0].data.html).toBe("tekst <strong>pogrubiony</strong>");
  });

  it("kontener PUSTY nie daje bloku", () => {
    expect(parseWordHtml("<div></div>")).toEqual([]);
  });

  it("kontener z samą grafiką konsumuje podpis stojący po nim", () => {
    const blocks = parseWordHtml(
      '<div><img src="https://x.test/a.png"></div><p class="MsoCaption">P</p>',
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].data.caption).toBe("P");
  });

  // DEFEKT PRODUKCYJNY (zgłoszony, nie obejściony) - UTRATA PODPISU.
  // W gałęzi kontenera (`DIV`/`SECTION`/`ARTICLE`/`BODY`) `takeCaption(i)` jest
  // wołane ZAWSZE, gdy w kontenerze była grafika, a `i += skip` KONSUMUJE
  // następny element - również wtedy, gdy kontener miał też tekst i podpis nie
  // został obrazowi przypisany (`isBlank(html) ? caption : ""`). Skutek: akapit
  // podpisu jest zjedzony i NIE trafia nigdzie - ani do obrazu, ani do treści.
  // Gałąź akapitu (`P`) tego nie robi: tam `takeCaption` woła się wyłącznie
  // wtedy, gdy akapit nie ma własnego tekstu, więc podpis albo idzie do obrazu,
  // albo zostaje osobnym akapitem. Naprawa to warunek `i += skip` zgodny z
  // gałęzią `P` - zmiana zachowania produkcyjnego, poza zakresem zadania
  // pokryciowego. Test STOI jako dowód.
  it.fails("POWINNO zachować podpis, gdy kontener niesie tekst i grafikę", () => {
    const blocks = parseWordHtml(
      '<div>tekst<img src="https://x.test/a.png"></div><p class="MsoCaption">P</p>',
    );
    expect(types(blocks)).toEqual(["paragraph", "image", "paragraph"]);
  });

  it("dziś podpis po kontenerze z tekstem i grafiką jest GUBIONY", () => {
    const blocks = parseWordHtml(
      '<div>tekst<img src="https://x.test/a.png"></div><p class="MsoCaption">P</p>',
    );
    expect(types(blocks)).toEqual(["paragraph", "image"]);
    expect(firstOf(blocks, "image")?.data.caption).toBe("");
    expect(String(firstOf(blocks, "paragraph")?.data.html)).toBe("tekst");
  });

  it("kontener domyka otwartą listę Worda", () => {
    const blocks = parseWordHtml('<p class="MsoListParagraph">A</p><div><p>b</p></div>');
    expect(types(blocks)).toEqual(["list", "paragraph"]);
  });

  it("luźny element inline na poziomie bloku daje akapit", () => {
    const blocks = parseWordHtml("<span>luźny</span>");
    expect(types(blocks)).toEqual(["paragraph"]);
  });

  it("luźny element inline PUSTY nie daje bloku", () => {
    expect(parseWordHtml("<span>  </span>")).toEqual([]);
  });

  it("luźny element inline z samą grafiką daje obraz", () => {
    const blocks = parseWordHtml('<span><img src="https://x.test/a.png"></span>');
    expect(types(blocks)).toEqual(["image"]);
  });

  it("luźny element inline domyka otwartą listę Worda", () => {
    const blocks = parseWordHtml('<p class="MsoListParagraph">A</p><span>luźny</span>');
    expect(types(blocks)).toEqual(["list", "paragraph"]);
  });

  it("akapit złożony z samych <br> nie daje bloku", () => {
    expect(parseWordHtml("<p><br><br></p>")).toEqual([]);
  });
});

describe("parseWordInlineHtml", () => {
  it("pusty string daje pusty wynik", () => {
    expect(parseWordInlineHtml("")).toBe("");
  });

  it("fragment BEZ struktury blokowej serializuje się wprost", () => {
    expect(parseWordInlineHtml("tekst <b>pogrubiony</b>")).toBe(
      "tekst <strong>pogrubiony</strong>",
    );
  });

  it.each(["p", "div", "h2", "li", "blockquote"])("blok %s jest serializowany", (tag) => {
    expect(parseWordInlineHtml(`<${tag}>x</${tag}>`)).toBe("x");
  });

  it("wiele bloków rozdziela <br>", () => {
    expect(parseWordInlineHtml("<p>a</p><p>b</p>")).toBe("a<br>b");
  });

  it("pomija bloki PUSTE przy składaniu", () => {
    expect(parseWordInlineHtml("<p>a</p><p>&nbsp;</p><p>b</p>")).toBe("a<br>b");
  });

  it("blok niebędący blokiem tekstowym nie wchodzi do wyniku", () => {
    expect(parseWordInlineHtml("<table><tr><td>a</td></tr></table>")).toBe("a");
  });

  it("zachowuje przypisy jako shortcode", () => {
    const out = parseWordInlineHtml(
      '<p>T<a href="#_ftn1">1</a></p><div id="_ftn1"><p>Źródło</p></div>',
    );
    expect(out).toContain("[fn]Źródło[/fn]");
  });

  it("zachowuje przypisy ręczne z indeksu górnego", () => {
    const out = parseWordInlineHtml("<p>T<sup>1</sup></p><p>1. Źródło</p>");
    expect(out).toContain("[fn]Źródło[/fn]");
  });
});
