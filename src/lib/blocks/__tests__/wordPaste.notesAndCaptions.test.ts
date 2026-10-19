import { describe, expect, it } from "vitest";
import { parseWordHtml } from "@/lib/blocks/wordPaste";

// Przypisy ręczne i podpisy z wklejki - przypadki brzegowe, które realnie
// produkują Word i edytory web, a których `wordPaste.branches.test.ts` nie
// obejmuje. Kontrakt: indeks górny, który NIE jest numerem przypisu (liczebnik
// porządkowy „21st"), zostaje formatowaniem; separator `<hr>` przed listą
// definicji nie zostaje w treści; `<figcaption>` stojący wprost za grafiką
// staje się jej podpisem; element z `src`, który nie jest grafiką VML Worda,
// nie udaje obrazu. Separator `<hr>` zatrzymuje zbieranie definicji
// (naprawione 2026-10-18). Parser działa na DOM-ie happy-dom, bez atrap.

describe("parseWordHtml - przypisy ręczne", () => {
  it("indeks górny bez numeru zostaje formatowaniem, a numer staje się przypisem", () => {
    const blocks = parseWordHtml(
      "<p>Raport<sup>1</sup> z 21<sup>st</sup> roku</p><p>1. Źródło A</p>",
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].data.html).toBe("Raport[fn]Źródło A[/fn] z 21<sup>st</sup> roku");
  });

  it("separator <hr> przed akapitami definicji znika razem z nimi", () => {
    const blocks = parseWordHtml("<p>Teza<sup>1</sup></p><hr><p>1. Źródło</p>");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph"]);
    expect(blocks[0].data.html).toBe("Teza[fn]Źródło[/fn]");
  });

  // NAPRAWIONE 2026-10-18: `<hr>` nie ma tekstu, więc pętla pomijała go jako
  // pusty element ZANIM sprawdziła, czy to separator - granica treści/przypisów
  // nie działała i akapit treści nad separatorem mógł zostać zjedzony jako
  // definicja. Kontrakt: zbieranie definicji kończy się na separatorze.
  it("<hr> zatrzymuje zbieranie definicji - treść NAD separatorem zostaje treścią", () => {
    const blocks = parseWordHtml(
      "<p>A<sup>1</sup> B<sup>2</sup></p><p>1. Wniosek redakcji</p><hr><p>2. Drugie</p>",
    );
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
    expect(blocks[0].data.html).toBe("A<sup>1</sup> B[fn]Drugie[/fn]");
    expect(blocks[1].data.html).toBe("1. Wniosek redakcji");
  });

  // Recenzja 2026-10-19: separator na SAMYM KOŃCU wklejki (za definicjami)
  // nie jest granicą treści/przypisów - przed poprawką wyżej był pomijany jako
  // pusty, a po niej zatrzymywał zbieranie od razu i przypis przepadał.
  it("<hr> zamykający wklejkę za definicjami nie blokuje zebrania przypisu", () => {
    const blocks = parseWordHtml("<p>Teza<sup>1</sup></p><p>1. Źródło</p><hr>");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph"]);
    expect(blocks[0].data.html).toBe("Teza[fn]Źródło[/fn]");
  });
});

describe("parseWordHtml - podpisy i grafiki", () => {
  it("<figcaption> stojący wprost za <img> jest podpisem obrazu i nie dubluje się jako akapit", () => {
    const blocks = parseWordHtml(
      '<img src="https://x.test/a.png" alt="Wykres"><figcaption>Źródło: GUS</figcaption><p>dalej</p>',
    );
    expect(blocks.map((b) => b.type)).toEqual(["image", "paragraph"]);
    expect(blocks[0].data).toMatchObject({ url: "https://x.test/a.png", caption: "Źródło: GUS" });
    expect(blocks[1].data.html).toBe("dalej");
  });

  it("element z src, który nie jest grafiką VML (np. <embed>), nie tworzy obrazu", () => {
    const blocks = parseWordHtml('<p>Tekst <embed src="https://x.test/film.swf"> dalej</p>');
    expect(blocks.map((b) => b.type)).toEqual(["paragraph"]);
    expect(String(blocks[0].data.html).replace(/\s+/g, " ")).toBe("Tekst dalej");
  });
});
