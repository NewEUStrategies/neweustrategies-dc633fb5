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
    const blocks = parseWordHtml(`<p style="font-size:40px"><span style="font-weight:bold">X</span></p>`);
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
