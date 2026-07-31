import { describe, it, expect } from "vitest";
import { looksLikeRichPaste, parseWordHtml, parseWordInlineHtml } from "@/lib/blocks/wordPaste";

const wordDoc = `
<html><body>
<h1>Tytuł dokumentu</h1>
<p class=MsoNormal style='font-size:14pt'>Zdanie z przypisem<a href="#_ftn1" name="_ftnref1" id="_ftnref1"><sup>[1]</sup></a> i <b>pogrubieniem</b>.</p>
<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'><span>&#183;</span>Pierwszy punkt</p>
<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'><span>&#183;</span>Drugi punkt</p>
<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
<hr>
<div id="ftn1"><p class=MsoFootnoteText>1. Źródło: raport 2026.</p></div>
</body></html>`;

describe("wordPaste", () => {
  it("rozpoznaje bogaty schowek", () => {
    expect(looksLikeRichPaste(wordDoc)).toBe(true);
    expect(looksLikeRichPaste("zwykły tekst")).toBe(false);
  });

  it("zachowuje strukturę dokumentu", () => {
    const blocks = parseWordHtml(wordDoc);
    const types = blocks.map((b) => b.type);
    expect(types).toContain("heading");
    expect(types).toContain("paragraph");
    expect(types).toContain("list");
    expect(types).toContain("table");
  });

  it("zamienia przypis Worda na shortcode [fn]", () => {
    const blocks = parseWordHtml(wordDoc);
    const p = blocks.find((b) => b.type === "paragraph");
    expect(String(p?.data.html)).toContain("[fn]Źródło: raport 2026.[/fn]");
    expect(String(p?.data.html)).toContain("<strong>pogrubieniem</strong>");
  });

  it("nie przenosi sekcji przypisów do treści", () => {
    const joined = parseWordHtml(wordDoc)
      .map((b) => JSON.stringify(b.data))
      .join(" ");
    expect(joined).not.toContain("MsoFootnoteText");
    expect(joined.match(/raport 2026/g)?.length).toBe(1);
  });

  it("czyści style i klasy, zostawiając formatowanie semantyczne", () => {
    const blocks = parseWordHtml(
      `<p style="font-size:40px"><span style="font-weight:bold">X</span></p>`,
    );
    expect(String(blocks[0].data.html)).toBe("<strong>X</strong>");
  });

  it("buduje listę numerowaną z akapitów Worda", () => {
    const blocks = parseWordHtml(
      `<p class=MsoListParagraph style='mso-list:l0'>1. Raz</p><p class=MsoListParagraph style='mso-list:l0'>2. Dwa</p>`,
    );
    expect(blocks[0].type).toBe("list");
    expect(blocks[0].data).toMatchObject({ ordered: true, items: ["Raz", "Dwa"] });
  });

  it("wariant inline łączy akapity znacznikiem <br>", () => {
    expect(parseWordInlineHtml("<p>A</p><p>B</p>")).toBe("A<br>B");
  });
});

describe("wordPaste - media, listy wielopoziomowe, tabele", () => {
  it("zamienia obrazek z podpisem na blok image", () => {
    const blocks = parseWordHtml(
      `<p><img src="https://x.test/a.png" alt="Wykres"></p><p class=MsoCaption>Rysunek 1. Wynik</p>`,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("image");
    expect(blocks[0].data).toMatchObject({
      url: "https://x.test/a.png",
      alt: "Wykres",
      caption: "Rysunek 1. Wynik",
    });
  });

  it("obsługuje <figure> oraz obrazek inline w akapicie z tekstem", () => {
    const fig = parseWordHtml(
      `<figure><img src="data:image/png;base64,AAA"><figcaption>Podpis</figcaption></figure>`,
    );
    expect(fig[0].data).toMatchObject({ url: "data:image/png;base64,AAA", caption: "Podpis" });

    const inline = parseWordHtml(`<p>Tekst <img src="https://x.test/b.jpg" alt="B"> dalej</p>`);
    expect(inline.map((b) => b.type)).toEqual(["paragraph", "image"]);
    expect(String(inline[0].data.html)).not.toContain("img");
  });

  it("pomija nieosadzalne źródła (file:///)", () => {
    expect(parseWordHtml(`<p><img src="file:///C:/tmp/i.png"></p>`)).toHaveLength(0);
  });

  it("zachowuje poziomy zagnieżdżenia list Worda i numer startowy", () => {
    const blocks = parseWordHtml(
      `<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'>3. Trzy</p>` +
        `<p class=MsoListParagraph style='mso-list:l0 level2 lfo1'>a) Podpunkt</p>` +
        `<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'>4. Cztery</p>`,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].data).toMatchObject({
      ordered: true,
      items: ["Trzy", "Podpunkt", "Cztery"],
      levels: [1, 2, 1],
      start: 3,
    });
  });

  it("spłaszcza zagnieżdżone <ul>/<ol> do modelu z poziomami", () => {
    const blocks = parseWordHtml(`<ul><li>A<ol><li>A1</li></ol></li><li>B</li></ul>`);
    expect(blocks[0].data).toMatchObject({
      ordered: false,
      items: ["A", "A1", "B"],
      levels: [1, 2, 1],
      itemsOrdered: [false, true, false],
    });
  });

  it("zachowuje scalone komórki, wyrównanie i nagłówek bez <th>", () => {
    const blocks = parseWordHtml(
      `<table><tr><td style="font-weight:bold">A</td><td style="font-weight:bold">B</td></tr>` +
        `<tr><td colspan="2" align="right">Razem</td></tr></table>`,
    );
    expect(blocks[0].type).toBe("table");
    expect(blocks[0].data).toMatchObject({
      header: true,
      rows: [
        ["A", "B"],
        ["Razem"],
      ],
      spans: [
        [
          [1, 1],
          [1, 1],
        ],
        [[2, 1]],
      ],
      aligns: [
        ["", ""],
        ["right"],
      ],
    });
  });

  it("nie miesza wierszy tabeli zagnieżdżonej z tabelą nadrzędną", () => {
    const blocks = parseWordHtml(
      `<table><tr><td><table><tr><td>wewn</td></tr></table></td></tr></table>`,
    );
    expect(blocks.filter((b) => b.type === "table")).toHaveLength(1);
    expect(blocks[0].data.rows).toEqual([["wewn"]]);
  });
});

describe("parseWordHtml - nagłówki i przypisy górne", () => {
  it("rozpoznaje nagłówki stylowane przez Worda (bez tagów hN)", () => {
    const blocks = parseWordHtml(
      `<p class="MsoTitle">Tytuł</p>` +
        `<p class="MsoHeading2">Sekcja</p>` +
        `<p style="mso-outline-level:3">Podsekcja</p>` +
        `<p class="P Heading_20_5">Głęboko</p>` +
        `<p>Zwykły akapit</p>`,
    );
    expect(blocks.map((b) => [b.type, b.data.level ?? null])).toEqual([
      ["heading", 2],
      ["heading", 2],
      ["heading", 3],
      ["heading", 5],
      ["paragraph", null],
    ]);
  });

  it("zachowuje poziom H5 z prawdziwych tagów", () => {
    const blocks = parseWordHtml(`<h5>Piąty</h5>`);
    expect(blocks[0].data).toMatchObject({ level: 5, text: "Piąty" });
  });

  it("konwertuje ręczne przypisy górne z listą na końcu na [fn]…[/fn]", () => {
    const blocks = parseWordHtml(
      `<p>Teza<sup>1</sup> oraz druga<sup>2</sup>.</p>` +
        `<p>1. Pierwsze źródło</p>` +
        `<p>2. Drugie źródło</p>`,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].data.html).toBe(
      "Teza[fn]Pierwsze źródło[/fn] oraz druga[fn]Drugie źródło[/fn].",
    );
  });

  it("nie zjada zwykłej listy numerowanej bez indeksów górnych", () => {
    const blocks = parseWordHtml(`<p>Wstęp</p><p>1. Punkt</p><p>2. Punkt</p>`);
    expect(blocks).toHaveLength(3);
  });
}

  it("zachowuje formatowanie w treści przypisu Worda", () => {
    const blocks = parseWordHtml(
      `<p>Teza<a href="#_ftn1" id="_ftnref1"><sup>[1]</sup></a>.</p>` +
        `<div id="ftn1"><p class=MsoFootnoteText><a href="#_ftnref1"><sup>[1]</sup></a> ` +
        `M. Draghi, <i>The future</i>, <a href="https://ec.europa.eu">link</a>.</p></div>`,
    );
    const html = String(blocks[0].data.html);
    expect(html).toContain("<em>The future</em>");
    expect(html).toContain('<a href="https://ec.europa.eu">link</a>');
    expect(html).not.toContain("[1]");
  });

  it("obsługuje przypisy w indeksie unicode i listę ol na końcu", () => {
    const blocks = parseWordHtml(
      `<p>Zdanie pierwsze\u00B9 i drugie\u00B2.</p>` +
        `<ol><li>Pierwsze <i>źródło</i>.</li><li>Drugie źródło.</li></ol>`,
    );
    const html = String(blocks[0].data.html);
    expect(blocks).toHaveLength(1);
    expect(html).toContain("[fn]Pierwsze <em>źródło</em>.[/fn]");
    expect(html).toContain("[fn]Drugie źródło.[/fn]");
  });

  it("scala kilka odsyłaczy z jednego indeksu górnego", () => {
    const blocks = parseWordHtml(
      `<p>Teza<sup>1,2</sup>.</p><p>1. Pierwsze.</p><p>2. Drugie.</p>`,
    );
    const html = String(blocks[0].data.html);
    expect(html).toContain("[fn]Pierwsze.[/fn][fn]Drugie.[/fn]");
  });

  it("nie pogrubia dokumentu przez wrapper Google Docs", () => {
    const blocks = parseWordHtml(
      `<b style="font-weight:normal"><p>Zwykły <span style="font-weight:700">akcent</span></p></b>`,
    );
    const html = String(blocks[0].data.html);
    expect(html).toBe("Zwykły <strong>akcent</strong>");
  });

  it("rozpoznaje styl cytatu Worda i źródło cytatu HTML", () => {
    const [q1, q2] = parseWordHtml(
      `<p class=MsoIntenseQuote>Luka implementacyjna.</p>` +
        `<blockquote><p>Cytat</p><cite>Autor</cite></blockquote>`,
    );
    expect(q1.type).toBe("quote");
    expect(q1.data.text).toBe("Luka implementacyjna.");
    expect(q2.data.cite).toBe("Autor");
  });

  it("czyta punktor listy z ukrytego spanu mso-list:Ignore", () => {
    const [list] = parseWordHtml(
      `<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'>` +
        `<span style='mso-list:Ignore'>3.<span>&nbsp;</span></span>Trzeci punkt</p>`,
    );
    expect(list.type).toBe("list");
    expect(list.data.ordered).toBe(true);
    expect(list.data.start).toBe(3);
    expect(String(JSON.stringify(list.data.items))).toContain("Trzeci punkt");
  });

  it("nie pozwala rozbić shortcode przez treść przypisu", () => {
    const blocks = parseWordHtml(
      `<p>A<a href="#_ftn1" id="_ftnref1"><sup>[1]</sup></a></p>` +
        `<div id="ftn1"><p>Uwaga [/fn] koniec.</p></div>`,
    );
    expect(String(blocks[0].data.html)).toBe("A[fn]Uwaga (/fn) koniec.[/fn]");
  });
});
