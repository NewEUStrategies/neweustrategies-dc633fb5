// Skróty markdown w bloku akapitu: redaktor pisze `## `, dostaje nagłówek.
// Plik startował z 0% (0 z 12 funkcji), a jego jedyny konsument to
// `components/admin/blocks/edit/Paragraph.tsx` - czyli KAŻDE pisanie w edytorze
// bloków przechodzi przez ten detektor.
//
// UWAGA NA ZAKRES: to NIE jest parser markdown. Nie ma tu obrazków, tabel,
// zagnieżdżonych list ani HTML-a w markdownie - jest dziewięć wzorców
// jednoliniowych i pierwszy trafiony wygrywa. Testy pilnują dokładnie tego
// kontraktu, a nie wyobrażonego parsera importu.
import { describe, it, expect } from "vitest";
import { detectMarkdownShortcut, shortcutToBlock, htmlToPlain } from "../markdown";

describe("detectMarkdownShortcut - nagłówki", () => {
  it("`# ` daje nagłówek POZIOMU 2, nie 1", () => {
    // Celowe: h1 jest zarezerwowane dla tytułu wpisu, więc pojedynczy `#`
    // schodzi do h2 - tak samo jak `##`.
    expect(detectMarkdownShortcut("# Tytuł")).toEqual({
      kind: "heading",
      level: 2,
      text: "Tytuł",
    });
  });

  it("`## ` daje ten sam poziom 2", () => {
    expect(detectMarkdownShortcut("## Tytuł")).toEqual({
      kind: "heading",
      level: 2,
      text: "Tytuł",
    });
  });

  it("`### ` daje poziom 3, `#### ` poziom 4", () => {
    expect(detectMarkdownShortcut("### Trzy")).toEqual({ kind: "heading", level: 3, text: "Trzy" });
    expect(detectMarkdownShortcut("#### Cztery")).toEqual({
      kind: "heading",
      level: 4,
      text: "Cztery",
    });
  });

  it("PIĘĆ hashy nie jest już skrótem", () => {
    // Brak wzorca dla h5/h6 - tekst zostaje akapitem z widocznymi hashami.
    expect(detectMarkdownShortcut("##### Pięć")).toBeNull();
  });

  it("hash BEZ spacji nie jest skrótem", () => {
    expect(detectMarkdownShortcut("#BezSpacji")).toBeNull();
    expect(detectMarkdownShortcut("##BezSpacji")).toBeNull();
  });

  it("wiele spacji po hashu jest pochłaniane", () => {
    expect(detectMarkdownShortcut("##    Tytuł")).toEqual({
      kind: "heading",
      level: 2,
      text: "Tytuł",
    });
  });

  it("sam hash ze spacją NIE jest jeszcze skrótem", () => {
    // Interakcja dwóch reguł: normalizacja robi `trimEnd()`, więc „## " staje
    // się „##", a wzorzec wymaga `\s+` PO hashach. Skrót odpala się dopiero po
    // pierwszym znaku treści - czyli redaktor nie dostaje pustego nagłówka
    // w połowie pisania.
    expect(detectMarkdownShortcut("## ")).toBeNull();
    expect(detectMarkdownShortcut("## T")).toEqual({ kind: "heading", level: 2, text: "T" });
  });
});

describe("detectMarkdownShortcut - cytat, listy, separator, kod", () => {
  it("`> ` daje cytat", () => {
    expect(detectMarkdownShortcut("> Cytat")).toEqual({ kind: "quote", text: "Cytat" });
  });

  it("`- ` i `* ` dają listę nieuporządkowaną", () => {
    expect(detectMarkdownShortcut("- Punkt")).toEqual({
      kind: "list",
      ordered: false,
      first: "Punkt",
    });
    expect(detectMarkdownShortcut("* Punkt")).toEqual({
      kind: "list",
      ordered: false,
      first: "Punkt",
    });
  });

  it("`1. ` daje listę uporządkowaną", () => {
    expect(detectMarkdownShortcut("1. Pierwszy")).toEqual({
      kind: "list",
      ordered: true,
      first: "Pierwszy",
    });
  });

  it("inna cyfra niż 1 NIE jest skrótem listy", () => {
    // Wzorzec jest zawężony do `1.` - lista zaczyna się od jedynki albo wcale.
    expect(detectMarkdownShortcut("2. Drugi")).toBeNull();
    expect(detectMarkdownShortcut("10. Dziesiąty")).toBeNull();
  });

  it("trzy lub więcej myślników daje separator", () => {
    expect(detectMarkdownShortcut("---")).toEqual({ kind: "separator" });
    expect(detectMarkdownShortcut("-----")).toEqual({ kind: "separator" });
  });

  it("DWA myślniki to jeszcze nie separator", () => {
    expect(detectMarkdownShortcut("--")).toBeNull();
  });

  it("separator wygrywa dopiero, gdy po myślnikach nie ma treści", () => {
    // `- ` (myślnik + spacja + tekst) łapie wcześniejszy wzorzec listy.
    expect(detectMarkdownShortcut("--- treść")).toBeNull();
    expect(detectMarkdownShortcut("- treść")).toEqual({
      kind: "list",
      ordered: false,
      first: "treść",
    });
  });

  it("potrójny grawis daje blok kodu", () => {
    expect(detectMarkdownShortcut("```")).toEqual({ kind: "code" });
  });

  it("grawis z językiem NIE jest skrótem", () => {
    // Wzorzec wymaga samych grawisów - `” ```ts ” ` zostaje tekstem.
    expect(detectMarkdownShortcut("```ts")).toBeNull();
  });
});

describe("detectMarkdownShortcut - normalizacja wejścia", () => {
  it("twarda spacja (NBSP) jest traktowana jak zwykła", () => {
    // Edytor kontentowy wstawia `&nbsp;` po znaku - bez tej normalizacji skrót
    // przestawał działać w losowych momentach pisania.
    expect(detectMarkdownShortcut("## Tytuł")).toEqual({
      kind: "heading",
      level: 2,
      text: "Tytuł",
    });
  });

  it("białe znaki na KOŃCU są obcinane", () => {
    expect(detectMarkdownShortcut("---   ")).toEqual({ kind: "separator" });
    expect(detectMarkdownShortcut("```  ")).toEqual({ kind: "code" });
  });

  it("białe znaki na POCZĄTKU psują skrót (brak trimStart)", () => {
    // Wszystkie wzorce są zakotwiczone na `^`, a normalizacja robi tylko
    // `trimEnd()`. Zachowanie celowe: wcięty tekst zostaje akapitem.
    expect(detectMarkdownShortcut(" ## Tytuł")).toBeNull();
    expect(detectMarkdownShortcut("  - Punkt")).toBeNull();
  });

  it("puste wejście i zwykły tekst nie dają skrótu", () => {
    expect(detectMarkdownShortcut("")).toBeNull();
    expect(detectMarkdownShortcut("Zwykły akapit")).toBeNull();
    expect(detectMarkdownShortcut("   ")).toBeNull();
  });

  it("skrót musi być na POCZĄTKU linii, nie w środku", () => {
    expect(detectMarkdownShortcut("tekst ## nietytuł")).toBeNull();
  });
});

describe("shortcutToBlock", () => {
  it("nagłówek zachowuje poziom i tekst oraz dostaje pusty anchor", () => {
    const b = shortcutToBlock({ kind: "heading", level: 3, text: "Tytuł" });
    expect(b.type).toBe("heading");
    expect(b.data).toEqual({ level: 3, text: "Tytuł", anchor: "" });
  });

  it("cytat dostaje puste `cite`", () => {
    const b = shortcutToBlock({ kind: "quote", text: "Cytat" });
    expect(b.type).toBe("quote");
    expect(b.data).toEqual({ text: "Cytat", cite: "" });
  });

  it("lista przenosi pierwszy element i flagę uporządkowania", () => {
    expect(shortcutToBlock({ kind: "list", ordered: true, first: "A" }).data).toEqual({
      ordered: true,
      items: ["A"],
    });
    expect(shortcutToBlock({ kind: "list", ordered: false, first: "B" }).data).toEqual({
      ordered: false,
      items: ["B"],
    });
  });

  it("separator dostaje wariant `line`", () => {
    const b = shortcutToBlock({ kind: "separator" });
    expect(b.type).toBe("separator");
    expect(b.data).toEqual({ variant: "line" });
  });

  it("kod startuje pusty, z językiem `ts`", () => {
    const b = shortcutToBlock({ kind: "code" });
    expect(b.type).toBe("code");
    expect(b.data).toEqual({ lang: "ts", code: "" });
  });

  it("każdy blok dostaje WŁASNY, niepusty identyfikator", () => {
    // Dwa bloki o tym samym id rozjeżdżają selekcję i undo w edytorze.
    const a = shortcutToBlock({ kind: "separator" });
    const b = shortcutToBlock({ kind: "separator" });
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it("obsługuje KAŻDY rodzaj skrótu, jaki potrafi wykryć detektor", () => {
    // Zamknięcie pętli: gdyby detektor nauczył się nowego rodzaju, a konwerter
    // nie, `shortcutToBlock` zwróciłby `undefined` i edytor wstawiłby pustkę.
    const inputs = ["# A", "## B", "### C", "#### D", "> E", "- F", "* G", "1. H", "---", "```"];
    for (const raw of inputs) {
      const t = detectMarkdownShortcut(raw);
      expect(t).not.toBeNull();
      const block = shortcutToBlock(t!);
      expect(block).toBeDefined();
      expect(block.type).toBeTruthy();
      expect(block.data).toBeDefined();
    }
  });
});

describe("htmlToPlain", () => {
  it("wyciąga sam tekst z opakowania HTML", () => {
    expect(htmlToPlain("<p>Tekst</p>")).toBe("Tekst");
  });

  it("skleja tekst z wielu elementów", () => {
    expect(htmlToPlain("<p>A</p><p>B</p>")).toBe("AB");
  });

  it("zdejmuje znaczniki zagnieżdżone", () => {
    expect(htmlToPlain("<p><strong>Po</strong>grubione</p>")).toBe("Pogrubione");
  });

  it("czysty tekst przechodzi bez zmian", () => {
    expect(htmlToPlain("Zwykły tekst")).toBe("Zwykły tekst");
  });

  it("pusty HTML daje pusty łańcuch", () => {
    expect(htmlToPlain("")).toBe("");
    expect(htmlToPlain("<p></p>")).toBe("");
  });

  it("współpracuje z detektorem na treści z edytora", () => {
    // Realna ścieżka z Paragraph.tsx: HTML z contenteditable -> tekst -> skrót.
    expect(detectMarkdownShortcut(htmlToPlain("<p>## Tytuł</p>"))).toEqual({
      kind: "heading",
      level: 2,
      text: "Tytuł",
    });
  });
});
