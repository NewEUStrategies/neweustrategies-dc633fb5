import { describe, it, expect } from "vitest";
import { htmlToBlocks, builderToBlocks, migratePostContent } from "@/lib/blocks/migrate";
import { isBlocksDoc } from "@/lib/blocks/schema";
import type { Block } from "@/lib/blocks/types";

// Migracja treści legacy jest ścieżką JEDNORAZOWĄ na wpis - uruchamia się przy
// przejściu z content_pl/en na BlocksDoc i nikt nie oglądnie jej wyniku ręcznie
// dla każdego z tysięcy wpisów. Zgubiona gałąź `??` nie rzuca wyjątku, tylko
// cicho gubi obraz, podpis albo cały akapit. Dlatego tabela obchodzi OBA ramiona
// każdego warunku, ze szczególnym naciskiem na atrybut nieobecny (`null` z
// `attr`) i na treść pustą-ale-prawidłową.

const typesOf = (blocks: Block[]): string[] => blocks.map((b) => b.type);

describe("htmlToBlocks - wejście puste i brzegowe", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["pusty string", ""],
    ["same spacje", "   \n\t  "],
  ])("zwraca dokument bez bloków dla %s", (_label, input) => {
    const doc = htmlToBlocks(input);
    expect(doc.blocks).toEqual([]);
    expect(doc.version).toBe(1);
    // Wejście puste NIE dostaje znacznika migracji - to nie była migracja.
    expect(doc.meta).toBeUndefined();
  });

  it("oznacza dokument źródłem migracji, gdy cokolwiek zmigrował", () => {
    expect(htmlToBlocks("<p>x</p>").meta).toEqual({ migratedFrom: "html" });
  });
});

describe("htmlToBlocks - akapity", () => {
  it("pomija akapit, którego treść po zdjęciu znaczników jest pusta", () => {
    const doc = htmlToBlocks("<p></p><p>   </p><p><span> </span></p><p>realny</p>");
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].data.html).toBe("realny");
  });

  it("zachowuje treść PRZED pierwszym znacznikiem blokowym", () => {
    const doc = htmlToBlocks("wstęp <b>pogrubiony</b><h2>Nagłówek</h2>");
    expect(typesOf(doc.blocks)).toEqual(["paragraph", "heading"]);
    expect(doc.blocks[0].data.html).toBe("wstęp <b>pogrubiony</b>");
  });

  it("zachowuje treść PO ostatnim znaczniku blokowym", () => {
    const doc = htmlToBlocks("<h2>Nagłówek</h2>ogon tekstu");
    expect(typesOf(doc.blocks)).toEqual(["heading", "paragraph"]);
    expect(doc.blocks[1].data.html).toBe("ogon tekstu");
  });

  it("pomija BIAŁY ogon po ostatnim znaczniku (nie tworzy pustego akapitu)", () => {
    const doc = htmlToBlocks("<h2>Nagłówek</h2>\n   \n");
    expect(typesOf(doc.blocks)).toEqual(["heading"]);
  });

  it("tekst bez żadnego znacznika blokowego trafia w całości do jednego akapitu", () => {
    const doc = htmlToBlocks("goły tekst");
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].data.html).toBe("goły tekst");
  });

  it("dokument ze znacznikami, ale bez treści mapowalnej, nie zostaje pusty", () => {
    // `<p></p>` nie daje bloku, a mimo to dokument nie może wyjść bez treści -
    // pusty dokument renderer traktuje jak „brak wpisu" i nie pokazuje nic.
    const doc = htmlToBlocks("<p></p>");
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].type).toBe("paragraph");
    expect(doc.blocks[0].data.html).toBe("<p></p>");
  });
});

describe("htmlToBlocks - nagłówki", () => {
  it.each([
    ["h1", 2],
    ["h2", 2],
    ["h3", 3],
    ["h4", 4],
    ["h5", 4],
    ["h6", 4],
  ])("%s spłaszcza się na poziom %i", (tag, level) => {
    const doc = htmlToBlocks(`<${tag}>Tytuł</${tag}>`);
    expect(doc.blocks[0].type).toBe("heading");
    expect(doc.blocks[0].data.level).toBe(level);
  });

  it("czyta kotwicę z atrybutu id", () => {
    expect(htmlToBlocks('<h3 id="sekcja">T</h3>').blocks[0].data.anchor).toBe("sekcja");
  });

  it("bez atrybutu id kotwica jest pustym stringiem, nie undefined", () => {
    const anchor = htmlToBlocks("<h3>T</h3>").blocks[0].data.anchor;
    expect(anchor).toBe("");
  });

  it("rozwija encje w tekście nagłówka", () => {
    expect(htmlToBlocks("<h2>A &amp; B &#39;C&#39;</h2>").blocks[0].data.text).toBe("A & B 'C'");
  });

  it("nagłówek z pustą treścią nadal daje blok (poziom bez tekstu jest prawidłowy)", () => {
    const doc = htmlToBlocks("<h2></h2>");
    expect(doc.blocks[0].type).toBe("heading");
    expect(doc.blocks[0].data.text).toBe("");
  });
});

describe("htmlToBlocks - listy", () => {
  it("ul daje listę nieuporządkowaną", () => {
    const doc = htmlToBlocks("<ul><li>A</li><li>B</li></ul>");
    expect(doc.blocks[0].data.ordered).toBe(false);
    expect(doc.blocks[0].data.items).toEqual(["A", "B"]);
  });

  it("ol daje listę uporządkowaną", () => {
    expect(htmlToBlocks("<ol><li>A</li></ol>").blocks[0].data.ordered).toBe(true);
  });

  it("lista BEZ pozycji nie daje bloku", () => {
    const doc = htmlToBlocks("<ul></ul>");
    expect(typesOf(doc.blocks)).not.toContain("list");
  });

  it("rozwija encje i zdejmuje znaczniki wewnątrz pozycji", () => {
    const doc = htmlToBlocks("<ul><li><b>A</b>&nbsp;i&amp;B</li></ul>");
    expect(doc.blocks[0].data.items).toEqual(["A i&B"]);
  });
});

describe("htmlToBlocks - cytat, kod, separator", () => {
  it("blockquote daje cytat z pustym cite", () => {
    const doc = htmlToBlocks("<blockquote>Treść &quot;w cudzysłowie&quot;</blockquote>");
    expect(doc.blocks[0].type).toBe("quote");
    expect(doc.blocks[0].data.text).toBe('Treść "w cudzysłowie"');
    expect(doc.blocks[0].data.cite).toBe("");
  });

  it("blockquote PUSTY nadal daje blok cytatu", () => {
    expect(htmlToBlocks("<blockquote></blockquote>").blocks[0].type).toBe("quote");
  });

  it("pre z code i klasą language-* czyta język", () => {
    const doc = htmlToBlocks('<pre><code class="language-ts">const a = 1</code></pre>');
    expect(doc.blocks[0].data.lang).toBe("ts");
    // `language` to alias zgodnościowy - MUSI zgadzać się z `lang`.
    expect(doc.blocks[0].data.language).toBe("ts");
    expect(doc.blocks[0].data.code).toBe("const a = 1");
  });

  it("pre z code BEZ klasy daje pusty język", () => {
    const doc = htmlToBlocks("<pre><code>x</code></pre>");
    expect(doc.blocks[0].data.lang).toBe("");
    expect(doc.blocks[0].data.code).toBe("x");
  });

  it("pre z klasą inną niż language-* zostawia klasę dosłownie", () => {
    const doc = htmlToBlocks('<pre><code class="hljs">x</code></pre>');
    expect(doc.blocks[0].data.lang).toBe("hljs");
  });

  it("pre BEZ code bierze całą treść jako kod", () => {
    const doc = htmlToBlocks("<pre>surowy kod</pre>");
    expect(doc.blocks[0].type).toBe("code");
    expect(doc.blocks[0].data.code).toBe("surowy kod");
    expect(doc.blocks[0].data.lang).toBe("");
  });

  it.each(["<hr>", "<hr/>", "<hr />"])("%s daje separator", (html) => {
    const doc = htmlToBlocks(html);
    expect(doc.blocks[0].type).toBe("separator");
    expect(doc.blocks[0].data).toEqual({});
  });
});

describe("htmlToBlocks - obrazy i osadzenia", () => {
  it("samodzielny img z src i alt daje obraz", () => {
    const doc = htmlToBlocks('<img src="/a.jpg" alt="opis">');
    expect(doc.blocks[0].type).toBe("image");
    expect(doc.blocks[0].data).toEqual({ url: "/a.jpg", alt: "opis", caption: "", href: "" });
  });

  it("img BEZ alt dostaje pusty alt (nie undefined - renderer wstawiłby 'undefined')", () => {
    expect(htmlToBlocks('<img src="/a.jpg">').blocks[0].data.alt).toBe("");
  });

  it("img BEZ src jest POMIJANY, nie renderowany jako pusty obraz", () => {
    const doc = htmlToBlocks('<img alt="brak zdjęcia">');
    expect(typesOf(doc.blocks)).not.toContain("image");
  });

  it("iframe w formie SAMODOMYKAJĄCEJ daje osadzenie", () => {
    const doc = htmlToBlocks('<iframe src="https://www.youtube.com/embed/x" />');
    expect(doc.blocks[0].type).toBe("embed");
    expect(doc.blocks[0].data).toEqual({
      url: "https://www.youtube.com/embed/x",
      provider: "iframe",
      html: "",
    });
  });

  it("samodomykający iframe BEZ src jest pomijany", () => {
    expect(typesOf(htmlToBlocks('<iframe title="brak" />').blocks)).not.toContain("embed");
  });

  // DEFEKT PRODUKCYJNY (zgłoszony, nie obejściony) - UTRATA TREŚCI.
  // `BLOCK_RE` wymienia `img|iframe` w OBU alternatywach: parzystej
  // (`<tag …>…</tag>`) i samodomykającej. Alternatywa parzysta jest pierwsza,
  // więc dla `<iframe …></iframe>` dopasowuje się ONA - i trafia do `mapBlock`,
  // które ramienia dla `iframe`/`img` NIE MA i zwraca `null`. Osadzenie znika.
  // Waga: `<iframe>` NIE JEST elementem void, więc `<iframe …></iframe>` to
  // JEDYNA poprawna forma w HTML - czyli KAŻDE osadzenie w migrowanej treści
  // WordPressa jest gubione, a nie tylko przypadek brzegowy. Gdy w dokumencie
  // jest cokolwiek innego, fallback „pusty dokument -> jeden akapit" też nie
  // ratuje treści: iframe wypada bez śladu (patrz test niżej).
  // Naprawa to ramię `img`/`iframe` w `mapBlock` (albo zdjęcie ich z
  // alternatywy parzystej) - zmiana zachowania produkcyjnego, więc poza
  // zakresem zadania pokryciowego. Test STOI jako dowód.
  it.fails("POWINNO dawać osadzenie dla iframe w formie parzystej", () => {
    const doc = htmlToBlocks('<iframe src="https://www.youtube.com/embed/x"></iframe>');
    expect(doc.blocks[0].type).toBe("embed");
  });

  it.fails("POWINNO zachować iframe obok innej treści (dziś wypada bez śladu)", () => {
    const doc = htmlToBlocks('<p>a</p><iframe src="https://x.test/e"></iframe>');
    expect(typesOf(doc.blocks)).toEqual(["paragraph", "embed"]);
  });

  it.fails("POWINNO dawać obraz dla img w formie parzystej", () => {
    const doc = htmlToBlocks('<img src="/a.jpg"></img>');
    expect(doc.blocks[0].type).toBe("image");
  });

  // Dokumentacja STANU FAKTYCZNEGO tych samych wejść - żeby regresja w drugą
  // stronę (np. zmiana na cichy pusty dokument) też była widoczna.
  it("dziś iframe w formie parzystej ląduje jako surowy akapit", () => {
    const doc = htmlToBlocks('<iframe src="https://x.test/e"></iframe>');
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].type).toBe("paragraph");
    expect(String(doc.blocks[0].data.html)).toContain("<iframe");
  });

  it("dziś iframe obok akapitu jest GUBIONY (utrata treści)", () => {
    const doc = htmlToBlocks('<p>a</p><iframe src="https://x.test/e"></iframe>');
    expect(typesOf(doc.blocks)).toEqual(["paragraph"]);
    expect(doc.blocks[0].data.html).toBe("a");
  });

  it("figure z img i figcaption daje obraz z podpisem", () => {
    const doc = htmlToBlocks(
      '<figure><img src="/b.png" alt="a"><figcaption>Podpis &amp; źródło</figcaption></figure>',
    );
    expect(doc.blocks[0].data).toEqual({
      url: "/b.png",
      alt: "a",
      caption: "Podpis & źródło",
      href: "",
    });
  });

  it("figure z img BEZ figcaption daje pusty podpis", () => {
    const doc = htmlToBlocks('<figure><img src="/b.png"></figure>');
    expect(doc.blocks[0].data.caption).toBe("");
  });

  it("figure z img BEZ src jest pomijany", () => {
    const doc = htmlToBlocks('<figure><img alt="x"></figure>');
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].type).toBe("paragraph");
  });

  it("figure BEZ obrazu zostaje zachowany jako surowy HTML (nie gubi treści)", () => {
    const doc = htmlToBlocks("<figure><table><tr><td>x</td></tr></table></figure>");
    expect(doc.blocks[0].type).toBe("html");
    expect(String(doc.blocks[0].data.html)).toContain("<figure>");
    expect(String(doc.blocks[0].data.html)).toContain("<td>x</td>");
  });
});

describe("htmlToBlocks - rozwijanie div", () => {
  it("div z jednym akapitem oddaje ten akapit bez opakowania", () => {
    const doc = htmlToBlocks('<div class="wrap"><p>treść</p></div>');
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].type).toBe("paragraph");
    expect(doc.blocks[0].data.html).toBe("treść");
  });

  it("div z wieloma blokami oddaje je wszystkie po kolei", () => {
    const doc = htmlToBlocks("<div><h2>T</h2><p>a</p><hr></div>");
    expect(typesOf(doc.blocks)).toEqual(["heading", "paragraph", "separator"]);
  });

  it("div z samą treścią inline zachowuje ją jako akapit (nie gubi linku)", () => {
    const doc = htmlToBlocks('<div><a href="/x">link</a></div>');
    expect(doc.blocks).toHaveLength(1);
    expect(String(doc.blocks[0].data.html)).toContain('href="/x"');
  });

  it("div PUSTY nie produkuje bloku", () => {
    const doc = htmlToBlocks("<div>   </div>");
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].data.html).toBe("<div>   </div>");
  });

  it("div zagnieżdżony w divie oddaje blok z wnętrza", () => {
    const doc = htmlToBlocks("<div><div><h2>T</h2></div></div>");
    expect(typesOf(doc.blocks)).toContain("heading");
    expect(doc.blocks.find((b) => b.type === "heading")?.data.text).toBe("T");
  });

  // DEFEKT PRODUKCYJNY (zgłoszony, nie obejściony) - WYCIEK SUROWEGO ZNACZNIKA.
  // `([\s\S]*?)<\/\1>` jest NIEZACHŁANNE, więc dla dwóch zagnieżdżonych
  // `<div>` dopasowanie kończy się na WEWNĘTRZNYM `</div>`. Połówki opakowania
  // zewnętrznego zostają poza dopasowaniem i lecą przez `pushParagraph` jako
  // TREŚĆ: dokument dostaje akapity o zawartości `<div>` i `</div>`, które
  // czytelnik widzi na stronie (albo które sanitizer wycina, zostawiając pusty
  // akapit). Zagnieżdżone `<div>` to standardowy kształt HTML-a z Gutenberga
  // (`wp-block-group` > `wp-block-group__inner-container`) i z Elementora,
  // czyli reguła, nie wyjątek. Naprawa wymaga liczenia zagnieżdżeń zamiast
  // niezachłannego dopasowania - zmiana zachowania produkcyjnego, poza zakresem
  // zadania pokryciowego. Test STOI jako dowód.
  it.fails("POWINNO rozwijać zagnieżdżone div BEZ wycieku znacznika do treści", () => {
    const doc = htmlToBlocks("<div><div><h2>T</h2></div></div>");
    expect(typesOf(doc.blocks)).toEqual(["heading"]);
  });

  it("dziś zagnieżdżony div wycieka połówkami opakowania do akapitów", () => {
    const doc = htmlToBlocks("<div><div><h2>T</h2></div></div>");
    expect(typesOf(doc.blocks)).toEqual(["paragraph", "heading", "paragraph"]);
    expect(doc.blocks[0].data.html).toBe("<div>");
    expect(doc.blocks[2].data.html).toBe("</div>");
  });

  it("każdy blok wynikowy przechodzi walidację schematu", () => {
    const doc = htmlToBlocks(
      '<div><h2 id="a">T</h2><p>x</p><ul><li>i</li></ul><hr><img src="/i.png"></div>',
    );
    expect(isBlocksDoc(doc)).toBe(true);
  });
});

describe("builderToBlocks", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("zwraca pusty dokument dla %s", (_l, input) => {
    const doc = builderToBlocks(input);
    expect(doc.blocks).toEqual([]);
    expect(doc.meta).toBeUndefined();
  });

  it.each([
    ["liczba", 42],
    ["string", "tekst"],
    ["boolean", true],
    ["pusta tablica", []],
    ["tablica pustych obiektów", [{}, {}]],
    ["obiekt bez type", { data: { text: "x" } }],
    ["obiekt z type nie-stringiem", { type: 7, data: { text: "x" } }],
  ])("zwraca pusty dokument dla wejścia: %s", (_l, input) => {
    expect(builderToBlocks(input).blocks).toEqual([]);
  });

  it("czyta pola z `props`, gdy nie ma `data`", () => {
    const doc = builderToBlocks({ type: "heading", props: { text: "Z propsów", level: 3 } });
    expect(doc.blocks[0].type).toBe("heading");
    expect(doc.blocks[0].data.text).toBe("Z propsów");
    expect(doc.blocks[0].data.level).toBe(3);
  });

  it("nagłówek BEZ level dostaje domyślny poziom 2", () => {
    const doc = builderToBlocks({ type: "heading", data: { text: "T" } });
    expect(doc.blocks[0].data.level).toBe(2);
  });

  it("nagłówek z poziomem 6 spłaszcza się na 4 (tak samo jak w HTML)", () => {
    const doc = builderToBlocks({ type: "heading", data: { text: "T", level: 6 } });
    expect(doc.blocks[0].data.level).toBe(4);
  });

  it("nagłówek BEZ text jest pomijany", () => {
    expect(builderToBlocks({ type: "heading", data: { level: 2 } }).blocks).toEqual([]);
  });

  it.each(["text", "paragraph", "richtext", "my-richtext-widget"])(
    "typ %s z polem html daje akapit",
    (type) => {
      const doc = builderToBlocks({ type, data: { html: "<p>x</p>" } });
      expect(doc.blocks[0].type).toBe("paragraph");
    },
  );

  it.each(["text", "paragraph"])("typ %s z polem text (bez html) daje akapit w <p>", (type) => {
    const doc = builderToBlocks({ type, data: { text: "goły" } });
    expect(doc.blocks[0].data.html).toBe("<p>goły</p>");
  });

  // `"richtext".includes("text")` jest PRAWDĄ, więc richtext wpada także do
  // ramienia `text` - i pole `text` (bez `html`) daje akapit. To nie pomyłka
  // w teście: gdyby ktoś zawęził warunek do dokładnych nazw typów, richtexty
  // z Buildera niosące `text` przestałyby się migrować.
  it("richtext z polem text (bez html) daje akapit - includes('text') łapie richtext", () => {
    const doc = builderToBlocks({ type: "richtext", data: { text: "x" } });
    expect(doc.blocks[0].data.html).toBe("<p>x</p>");
  });

  it("html ma pierwszeństwo nad text, gdy węzeł niesie oba pola", () => {
    const doc = builderToBlocks({ type: "richtext", data: { html: "<b>h</b>", text: "t" } });
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].data.html).toBe("<b>h</b>");
  });

  it("akapit z PUSTYM html jest pomijany", () => {
    expect(builderToBlocks({ type: "text", data: { html: "   " } }).blocks).toEqual([]);
  });

  it("obraz przepisuje src/alt/caption/href", () => {
    const doc = builderToBlocks({
      type: "image",
      data: { src: "/a.png", alt: "a", caption: "c", href: "/h" },
    });
    expect(doc.blocks[0].data).toEqual({ url: "/a.png", alt: "a", caption: "c", href: "/h" });
  });

  it("obraz z polami nie-stringowymi dostaje puste stringi, nie liczby", () => {
    const doc = builderToBlocks({
      type: "image",
      data: { src: "/a.png", alt: 1, caption: null, href: false },
    });
    expect(doc.blocks[0].data).toEqual({ url: "/a.png", alt: "", caption: "", href: "" });
  });

  it("obraz BEZ src jest pomijany", () => {
    expect(builderToBlocks({ type: "image", data: { alt: "a" } }).blocks).toEqual([]);
  });

  it("cytat przepisuje text i cite", () => {
    const doc = builderToBlocks({ type: "quote", data: { text: "t", cite: "c" } });
    expect(doc.blocks[0].data).toEqual({ text: "t", cite: "c" });
  });

  it("cytat BEZ cite dostaje pusty cite", () => {
    expect(builderToBlocks({ type: "quote", data: { text: "t" } }).blocks[0].data.cite).toBe("");
  });

  it.each(["separator", "divider", "section-divider"])("typ %s daje separator", (type) => {
    const doc = builderToBlocks({ type });
    expect(doc.blocks[0].type).toBe("separator");
  });

  it.each(["video", "embed"])("typ %s z url daje osadzenie", (type) => {
    const doc = builderToBlocks({ type, data: { url: "https://x.test/v" } });
    expect(doc.blocks[0].data).toEqual({ url: "https://x.test/v", provider: "iframe", html: "" });
  });

  it("osadzenie BEZ url jest pomijane", () => {
    expect(builderToBlocks({ type: "video", data: {} }).blocks).toEqual([]);
  });

  it("typ html z polem html daje blok html", () => {
    const doc = builderToBlocks({ type: "html", data: { html: "<b>x</b>" } });
    expect(doc.blocks[0].type).toBe("html");
    expect(doc.blocks[0].data.html).toBe("<b>x</b>");
  });

  it("typ nierozpoznany nie daje bloku, ale nie przerywa obchodu drzewa", () => {
    const doc = builderToBlocks({
      type: "carousel-3000",
      children: [{ type: "heading", data: { text: "T" } }],
    });
    expect(typesOf(doc.blocks)).toEqual(["heading"]);
  });

  it.each(["children", "elements", "blocks", "columns"])(
    "obchodzi zagnieżdżenie pod kluczem %s",
    (key) => {
      const doc = builderToBlocks({ type: "section", [key]: [{ type: "divider" }] });
      expect(typesOf(doc.blocks)).toEqual(["separator"]);
    },
  );

  it("obchodzi WSZYSTKIE klucze zagnieżdżeń w jednym węźle, w zadeklarowanej kolejności", () => {
    const doc = builderToBlocks({
      type: "section",
      children: [{ type: "heading", data: { text: "c" } }],
      elements: [{ type: "divider" }],
      blocks: [{ type: "quote", data: { text: "b" } }],
      columns: [{ type: "html", data: { html: "<i/>" } }],
    });
    expect(typesOf(doc.blocks)).toEqual(["heading", "separator", "quote", "html"]);
  });

  it("ignoruje klucz zagnieżdżenia, który nie jest tablicą", () => {
    const doc = builderToBlocks({ type: "section", children: { type: "divider" } });
    expect(doc.blocks).toEqual([]);
  });

  it("tablica na wejściu jest korzeniem obchodu", () => {
    const doc = builderToBlocks([{ type: "divider" }, { type: "divider" }]);
    expect(typesOf(doc.blocks)).toEqual(["separator", "separator"]);
  });

  it("oznacza dokument źródłem builder", () => {
    expect(builderToBlocks({ type: "divider" }).meta).toEqual({ migratedFrom: "builder" });
  });
});

describe("migratePostContent", () => {
  it("HTML w obu językach idzie ścieżką html", () => {
    const r = migratePostContent({ content_pl: "<p>pl</p>", content_en: "<p>en</p>" });
    expect(r.source).toBe("html");
    expect(r.pl.blocks[0].data.html).toBe("pl");
    expect(r.en.blocks[0].data.html).toBe("en");
  });

  it("HTML tylko w PL - EN zostaje pustym dokumentem, nie kopią PL", () => {
    const r = migratePostContent({ content_pl: "<p>pl</p>", content_en: null });
    expect(r.source).toBe("html");
    expect(r.en.blocks).toEqual([]);
  });

  it("HTML tylko w EN uruchamia migrację (brak PL nie jest 'pusto')", () => {
    const r = migratePostContent({ content_en: "<p>en</p>" });
    expect(r.source).toBe("html");
    expect(r.en.blocks).toHaveLength(1);
  });

  it("komentarz wp: w PL przełącza na parser Gutenberga", () => {
    const r = migratePostContent({
      content_pl: "<!-- wp:paragraph --><p>pl</p><!-- /wp:paragraph -->",
    });
    expect(r.source).toBe("gutenberg");
  });

  it("komentarz wp: w SAMYM EN też przełącza na Gutenberga dla obu stron", () => {
    const r = migratePostContent({
      content_pl: "<p>zwykły html</p>",
      content_en: "<!-- wp:paragraph --><p>en</p><!-- /wp:paragraph -->",
    });
    expect(r.source).toBe("gutenberg");
  });

  it("komentarz HTML, który nie jest wp:, NIE przełącza na Gutenberga", () => {
    const r = migratePostContent({ content_pl: "<!-- zwykły komentarz --><p>x</p>" });
    expect(r.source).toBe("html");
  });

  it("bez treści, ale z builder_data - ścieżka builder dla obu języków", () => {
    const r = migratePostContent({ builder_data: { type: "divider" } });
    expect(r.source).toBe("builder");
    expect(r.pl).toBe(r.en);
  });

  it("builder_data równe null jest traktowane jak brak", () => {
    const r = migratePostContent({ content_pl: "  ", builder_data: null });
    expect(r.source).toBe("empty");
  });

  it.each([
    ["wszystko puste", {}],
    ["puste stringi", { content_pl: "", content_en: "" }],
    ["same spacje", { content_pl: "   ", content_en: "\n" }],
  ])("%s daje source=empty i puste dokumenty", (_l, input) => {
    const r = migratePostContent(input);
    expect(r.source).toBe("empty");
    expect(r.pl.blocks).toEqual([]);
    expect(r.en.blocks).toEqual([]);
  });

  it("builder_data równe 0 jest traktowane jako OBECNE (fałszywe, ale nie brak)", () => {
    const r = migratePostContent({ builder_data: 0 });
    expect(r.source).toBe("builder");
  });
});
