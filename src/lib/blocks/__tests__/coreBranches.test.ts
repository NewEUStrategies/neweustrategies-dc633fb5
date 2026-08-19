import { describe, it, expect } from "vitest";
import { transformBlock, getTransformTargets } from "@/lib/blocks/transforms";
import {
  blocksToPlainText,
  serializeBlocksForClipboard,
  parseBlocksFromClipboard,
  plainTextToBlocks,
} from "@/lib/blocks/clipboard";
import { isBlocksDoc, safeParseBlocks } from "@/lib/blocks/schema";
import { blockRange, toggleInSelection } from "@/lib/blocks/selection";
import { flattenBlockTree, blockSnippet } from "@/lib/blocks/tree";
import { validateFootnotes } from "@/lib/blocks/footnoteValidation";
import { collectFootnoteOrigins, updateFootnoteAtOrigin } from "@/lib/blocks/footnoteOrigins";
import { isTextEntryBlockType } from "@/lib/blocks/focus";
import type { Block, BlockType, BlocksDoc, Json } from "@/lib/blocks/types";

// Dopełnienie GAŁĘZI w rdzeniu silnika bloków. Każdy blok tej suity celuje w
// ramię, które testy funkcjonalne pomijały, bo trafiały w happy path: pole
// nieobecne, pole PUSTE (fałszywe, ale prawidłowe), wartość poza zakresem,
// typ inny niż oczekiwany. To te ramiona decydują, czy dokument przeżyje
// rollback deploya albo wklejkę z obcego edytora.

const mk = (type: BlockType, data: Record<string, unknown> = {}): Block => ({
  id: `b_${type}`,
  type,
  data: data as Record<string, Json>,
});
const docOf = (blocks: Block[]): BlocksDoc => ({ version: 1, blocks });

describe("transformBlock - tekst źródłowy każdego typu", () => {
  it.each([
    ["paragraph", { html: "<p>a<br>b</p>" }, "a\nb"],
    ["html", { html: "<div>x</div>" }, "x"],
    ["heading", { text: "<b>T</b>" }, "T"],
    ["quote", { text: "Q" }, "Q"],
    ["pullquote", { text: "P" }, "P"],
    ["callout", { text: "C" }, "C"],
    ["verse", { text: "V" }, "V"],
    ["preformatted", { text: "  wcięcie  " }, "  wcięcie  "],
  ] as const)("%s oddaje treść źródłową do bloku kodu", (type, data, expected) => {
    const out = transformBlock(mk(type, data), "code");
    expect(out?.[0].data.code).toBe(expected);
  });

  it("code oddaje treść źródłową (cel inny niż własny typ)", () => {
    const out = transformBlock(mk("code", { code: "const a=1" }), "quote");
    expect(out?.[0].data.text).toBe("const a=1");
  });

  it("lista scala pozycje w wiersze", () => {
    const out = transformBlock(mk("list", { items: ["A", "B"] }), "code");
    expect(out?.[0].data.code).toBe("A\nB");
  });

  it("lista z items NIE-tablicą daje pustą treść", () => {
    const out = transformBlock(mk("list", { items: "A,B" }), "code");
    expect(out?.[0].data.code).toBe("");
  });

  it("details scala summary i body", () => {
    const out = transformBlock(mk("details", { summary: "S", body: "B" }), "code");
    expect(out?.[0].data.code).toBe("S\nB");
  });

  it("details BEZ summary nie zostawia pustego wiersza", () => {
    const out = transformBlock(mk("details", { body: "B" }), "code");
    expect(out?.[0].data.code).toBe("B");
  });

  it("details BEZ obu pól daje pustą treść", () => {
    expect(transformBlock(mk("details", {}), "code")?.[0].data.code).toBe("");
  });

  it.each(["paragraph", "heading", "quote", "code", "preformatted"] as const)(
    "%s z polem NIEOBECNYM daje pustą treść, nie 'undefined'",
    (type) => {
      const out = transformBlock(mk(type, {}), "list");
      expect(out?.[0].data.items).toEqual([""]);
    },
  );

  it("typ POZA rodziną tekstową daje pustą treść źródłową", () => {
    const out = transformBlock(mk("image", { url: "/a.png" }), "code");
    expect(out?.[0].data.code).toBe("");
  });

  it("zwija trzy i więcej złamań wiersza do dwóch", () => {
    const out = transformBlock(mk("paragraph", { html: "a<br><br><br><br>b" }), "code");
    expect(out?.[0].data.code).toBe("a\n\nb");
  });

  it.each([
    ["&nbsp;", " "],
    ["&amp;", "&"],
    ["&lt;", "<"],
    ["&gt;", ">"],
    ["&quot;", '"'],
  ])("rozwija encję %s", (entity, expected) => {
    const out = transformBlock(mk("quote", { text: `a${entity}b` }), "code");
    expect(out?.[0].data.code).toBe(`a${expected}b`);
  });
});

describe("transformBlock - cele transformacji", () => {
  it("transformacja na TEN SAM typ jest niedostępna", () => {
    expect(transformBlock(mk("paragraph", { html: "x" }), "paragraph")).toBeNull();
  });

  it("cel poza obsługiwanymi zwraca null", () => {
    expect(transformBlock(mk("paragraph", { html: "x" }), "gallery")).toBeNull();
  });

  it("lista -> akapity: każda pozycja osobnym blokiem", () => {
    const out = transformBlock(mk("list", { items: ["A", "B"] }), "paragraph");
    expect(out).toHaveLength(2);
    expect(out?.map((b) => b.data.html)).toEqual(["A", "B"]);
  });

  it("lista PUSTA -> jeden pusty akapit (nie zero bloków)", () => {
    const out = transformBlock(mk("list", { items: [] }), "paragraph");
    expect(out).toHaveLength(1);
    expect(out?.[0].data.html).toBe("");
  });

  it("lista z samych PUSTYCH pozycji -> jeden pusty akapit", () => {
    const out = transformBlock(mk("list", { items: ["", "  "] }), "paragraph");
    expect(out).toHaveLength(1);
    expect(out?.[0].data.html).toBe("");
  });

  it("lista z items NIE-tablicą -> jeden pusty akapit", () => {
    const out = transformBlock(mk("list", { items: 7 }), "paragraph");
    expect(out?.[0].data.html).toBe("");
  });

  it("akapit -> akapit inline zachowuje formatowanie", () => {
    const out = transformBlock(mk("paragraph", { html: "<p>a <b>b</b></p>" }), "heading");
    expect(out?.[0].data.text).toBe("a <b>b</b>");
  });

  it("cytat -> akapit zdejmuje znaczniki i zamienia nowe linie na <br>", () => {
    // `sourceText` cytatu przechodzi przez `strip()`, więc znacznik nie ma szans
    // dotrzeć do escapowania - do akapitu wchodzi czysty tekst z <br>.
    const out = transformBlock(mk("quote", { text: "a <b>\nc" }), "paragraph");
    expect(out?.[0].data.html).toBe("a <br>c");
  });

  it("cytat -> akapit ESCAPUJE znaki, które przeżyły zdejmowanie znaczników", () => {
    const out = transformBlock(mk("quote", { text: "a & b" }), "paragraph");
    expect(out?.[0].data.html).toBe("a &amp; b");
  });

  it("nagłówek -> nagłówek zachowuje poziom", () => {
    const out = transformBlock(mk("heading", { level: 4, text: "T" }), "paragraph");
    expect(out?.[0].data.html).toBe("T");
  });

  it("nagłówek BEZ poziomu w innym typie dostaje poziom 2", () => {
    const out = transformBlock(mk("quote", { text: "T" }), "heading");
    expect(out?.[0].data.level).toBe(2);
    expect(out?.[0].data.anchor).toBe("");
  });

  it("lista docelowa BEZ treści dostaje jedną pustą pozycję", () => {
    const out = transformBlock(mk("paragraph", { html: "" }), "list");
    expect(out?.[0].data.items).toEqual([""]);
    expect(out?.[0].data.ordered).toBe(false);
  });

  it("lista docelowa pomija puste wiersze", () => {
    const out = transformBlock(mk("paragraph", { html: "a<br><br>b" }), "list");
    expect(out?.[0].data.items).toEqual(["a", "b"]);
  });

  it.each(["quote", "pullquote"] as const)("cel %s przepisuje cite ze źródła", (to) => {
    const out = transformBlock(mk("paragraph", { html: "x", cite: "Autor" }), to);
    expect(out?.[0].data.cite).toBe("Autor");
  });

  it.each(["quote", "pullquote"] as const)("cel %s BEZ cite dostaje pusty cite", (to) => {
    const out = transformBlock(mk("paragraph", { html: "x" }), to);
    expect(out?.[0].data.cite).toBe("");
  });

  it.each(["preformatted", "verse"] as const)("cel %s przenosi sam tekst", (to) => {
    const out = transformBlock(mk("paragraph", { html: "x" }), to);
    expect(out?.[0].type).toBe(to);
    expect(out?.[0].data.text).toBe("x");
  });

  it("cel callout dostaje domyślny wariant info", () => {
    const out = transformBlock(mk("paragraph", { html: "x" }), "callout");
    expect(out?.[0].data.variant).toBe("info");
  });

  it("cel details bierze pierwszy wiersz na summary, resztę na body", () => {
    const out = transformBlock(mk("paragraph", { html: "T<br>a<br>b" }), "details");
    expect(out?.[0].data.summary).toBe("T");
    expect(out?.[0].data.body).toBe("a\nb");
  });

  it("cel details BEZ treści dostaje puste summary, nie undefined", () => {
    const out = transformBlock(mk("paragraph", { html: "" }), "details");
    expect(out?.[0].data.summary).toBe("");
    expect(out?.[0].data.body).toBe("");
  });

  it("cel html owija treść inline w akapit", () => {
    const out = transformBlock(mk("paragraph", { html: "<p>a <b>b</b></p>" }), "html");
    expect(out?.[0].data.html).toBe("<p>a <b>b</b></p>");
  });

  it("cel html z cytatu owija oczyszczony tekst w akapit", () => {
    const out = transformBlock(mk("quote", { text: "a <b>\nc" }), "html");
    expect(out?.[0].data.html).toBe("<p>a <br>c</p>");
  });

  it("cel html ESCAPUJE ampersand z treści cytatu", () => {
    const out = transformBlock(mk("quote", { text: "a & b" }), "html");
    expect(out?.[0].data.html).toBe("<p>a &amp; b</p>");
  });

  it("każda transformacja daje blok z NOWYM id", () => {
    const source = mk("paragraph", { html: "x" });
    const out = transformBlock(source, "quote");
    expect(out?.[0].id).not.toBe(source.id);
  });
});

describe("getTransformTargets", () => {
  it("blok poza rodziną tekstową nie ma celów", () => {
    expect(getTransformTargets(mk("image"))).toEqual([]);
  });

  it("blok tekstowy nie proponuje siebie", () => {
    const targets = getTransformTargets(mk("paragraph"));
    expect(targets).not.toContain("paragraph");
    expect(targets).toContain("heading");
  });

  it("każdy cel jest realnie wykonalny (kontrakt menu)", () => {
    const source = mk("paragraph", { html: "treść" });
    for (const to of getTransformTargets(source)) {
      expect(transformBlock(source, to), `cel ${to} zwrócił null`).not.toBeNull();
    }
  });
});

describe("blocksToPlainText", () => {
  it.each([
    ["paragraph", { html: "<p>a</p>" }, "a"],
    ["html", { html: "<i>a</i>" }, "a"],
    ["heading", { text: "T" }, "T"],
    ["code", { code: "kod" }, "kod"],
    ["separator", {}, "---"],
  ] as const)("%s serializuje się jako %s", (type, data, expected) => {
    expect(blocksToPlainText([mk(type, data)])).toBe(expected);
  });

  it("lista nieuporządkowana używa myślnika", () => {
    expect(blocksToPlainText([mk("list", { items: ["A", "B"] })])).toBe("- A\n- B");
  });

  it("lista uporządkowana numeruje od 1", () => {
    expect(blocksToPlainText([mk("list", { ordered: true, items: ["A", "B"] })])).toBe(
      "1. A\n2. B",
    );
  });

  it("lista z items NIE-tablicą daje pusty wynik", () => {
    expect(blocksToPlainText([mk("list", { items: "A" })])).toBe("");
  });

  it("cytat BEZ cite nie dokleja myślnika", () => {
    expect(blocksToPlainText([mk("quote", { text: "Q" })])).toBe('"Q"');
  });

  it("cytat z cite dokleja źródło", () => {
    expect(blocksToPlainText([mk("quote", { text: "Q", cite: "A" })])).toBe('"Q" - A');
  });

  it("obraz woli caption", () => {
    expect(blocksToPlainText([mk("image", { caption: "C", alt: "A", url: "/u" })])).toBe("C");
  });

  it("obraz bez caption bierze alt", () => {
    expect(blocksToPlainText([mk("image", { alt: "A", url: "/u" })])).toBe("A");
  });

  it("obraz bez caption i alt bierze url", () => {
    expect(blocksToPlainText([mk("image", { url: "/u" })])).toBe("/u");
  });

  it("obraz bez żadnego pola daje pusty wpis (odfiltrowany)", () => {
    expect(blocksToPlainText([mk("image", {})])).toBe("");
  });

  it("typ nieobsłużony zgaduje po text", () => {
    expect(blocksToPlainText([mk("callout", { text: "C" })])).toBe("C");
  });

  it("typ nieobsłużony zgaduje po title, gdy nie ma text", () => {
    expect(blocksToPlainText([mk("faq", { title: "T" })])).toBe("T");
  });

  it("typ nieobsłużony zgaduje po html, gdy nie ma text ani title", () => {
    expect(blocksToPlainText([mk("faq", { html: "<b>H</b>" })])).toBe("H");
  });

  it("typ nieobsłużony bez żadnego pola daje pusty wpis", () => {
    expect(blocksToPlainText([mk("faq", {})])).toBe("");
  });

  it("puste wpisy są odfiltrowane, a bloki rozdzielone pustą linią", () => {
    const text = blocksToPlainText([
      mk("heading", { text: "T" }),
      mk("paragraph", { html: "" }),
      mk("paragraph", { html: "<p>a</p>" }),
    ]);
    expect(text).toBe("T\n\na");
  });

  it("pusta lista bloków daje pusty string", () => {
    expect(blocksToPlainText([])).toBe("");
  });
});

describe("schowek - round-trip i degradacja", () => {
  it("round-trip przez sentinel odtwarza bloki bezstratnie", () => {
    const blocks = [
      mk("heading", { level: 3, text: "T", anchor: "" }),
      mk("paragraph", { html: "a" }),
    ];
    const payload = serializeBlocksForClipboard(blocks);
    const back = parseBlocksFromClipboard(payload.html, payload.text);
    expect(back?.map((b) => b.type)).toEqual(["heading", "paragraph"]);
    expect(back?.[0].data.text).toBe("T");
  });

  it("round-trip nadaje NOWE id (wklejka nie może zdublować identyfikatora)", () => {
    const blocks = [mk("paragraph", { html: "a" })];
    const payload = serializeBlocksForClipboard(blocks);
    const back = parseBlocksFromClipboard(payload.html);
    expect(back?.[0].id).not.toBe(blocks[0].id);
  });

  it.each([
    ["null HTML i brak tekstu", null, undefined],
    ["undefined HTML", undefined, undefined],
    ["pusty HTML", "", null],
    ["HTML bez bloków", "<p>zwykły</p>", null],
  ])("%s daje null (wołający idzie ścieżką Worda)", (_l, html, text) => {
    expect(parseBlocksFromClipboard(html, text)).toBeNull();
  });

  it("USZKODZONY sentinel spada na warstwę Gutenberga w tym samym HTML-u", () => {
    const html =
      "<!-- nes:blocks b64:to-nie-jest-base64 -->\n" +
      "<!-- wp:paragraph --><p>ratunek</p><!-- /wp:paragraph -->";
    const back = parseBlocksFromClipboard(html);
    expect(back?.map((b) => b.type)).toEqual(["paragraph"]);
  });

  it("sentinel z JSON-em BEZ tablicy blocks jest ignorowany", () => {
    const b64 = Buffer.from(JSON.stringify({ version: 1, blocks: "nie tablica" })).toString(
      "base64",
    );
    const html = `<!-- nes:blocks b64:${b64} -->\n<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->`;
    expect(parseBlocksFromClipboard(html)?.[0].type).toBe("paragraph");
  });

  it("sentinel z PUSTĄ tablicą blocks jest ignorowany", () => {
    const b64 = Buffer.from(JSON.stringify({ version: 1, blocks: [] })).toString("base64");
    expect(parseBlocksFromClipboard(`<!-- nes:blocks b64:${b64} -->`)).toBeNull();
  });

  it("sentinel odfiltrowuje wpisy o niepoprawnym kształcie", () => {
    const b64 = Buffer.from(
      JSON.stringify({
        version: 1,
        blocks: [
          null,
          { type: 7, data: {} },
          { type: "paragraph" },
          { type: "paragraph", data: { html: "ok" } },
        ],
      }),
    ).toString("base64");
    const back = parseBlocksFromClipboard(`<!-- nes:blocks b64:${b64} -->`);
    expect(back).toHaveLength(1);
    expect(back?.[0].data.html).toBe("ok");
  });

  it("markup Gutenberga w SAMYM tekście (kopia z widoku kodu WP) jest odczytywany", () => {
    const text = "<!-- wp:paragraph --><p>z tekstu</p><!-- /wp:paragraph -->";
    expect(parseBlocksFromClipboard("", text)?.[0].data.html).toBe("z tekstu");
  });

  it("markup Gutenberga w tekście, gdy HTML nic nie niesie", () => {
    const text = "<!-- wp:separator --><hr/><!-- /wp:separator -->";
    expect(parseBlocksFromClipboard("<p>bez bloków</p>", text)?.[0].type).toBe("separator");
  });

  it("HTML z markerem wp:, który nie daje bloków, nie blokuje ścieżki tekstowej", () => {
    // Marker jest, ale token nie produkuje bloków; tekst niesie poprawny blok.
    const html = "<!-- wp:image --><figure></figure><!-- /wp:image -->";
    const text = "<!-- wp:separator --><hr/><!-- /wp:separator -->";
    const back = parseBlocksFromClipboard(html, text);
    expect(back).not.toBeNull();
  });
});

describe("plainTextToBlocks", () => {
  it("pusty tekst daje zero bloków", () => {
    expect(plainTextToBlocks("")).toEqual([]);
  });

  it("same białe znaki dają zero bloków", () => {
    expect(plainTextToBlocks("  \n\n  ")).toEqual([]);
  });

  it("pusta linia rozdziela akapity", () => {
    const blocks = plainTextToBlocks("a\n\nb");
    expect(blocks).toHaveLength(2);
  });

  it("pojedyncze złamanie wiersza zostaje <br> w jednym akapicie", () => {
    expect(plainTextToBlocks("a\nb")[0].data.html).toBe("a<br>b");
  });

  it("normalizuje końce wiersza CRLF", () => {
    expect(plainTextToBlocks("a\r\n\r\nb")).toHaveLength(2);
  });

  it("escapuje znaki, które inaczej wstrzyknęłyby markup", () => {
    expect(plainTextToBlocks("a & <script>")[0].data.html).toBe("a &amp; &lt;script&gt;");
  });
});

describe("safeParseBlocks - degradacja dokumentu", () => {
  it("dokument POPRAWNY przechodzi bez zmian", () => {
    const d = docOf([mk("paragraph", { html: "a" })]);
    expect(safeParseBlocks(d).blocks).toHaveLength(1);
  });

  it("zachowuje bloki poprawne, odrzuca WYŁĄCZNIE niepoprawne", () => {
    const raw = {
      version: 1,
      blocks: [
        { id: "b_1", type: "paragraph", data: { html: "ok" } },
        { id: "b_2", type: "nieznany-typ", data: {} },
        { id: "b_3", type: "heading", data: { text: "T" }, nadmiarowy: 1 },
        { id: "b_4", type: "separator", data: {} },
      ],
    };
    const out = safeParseBlocks(raw);
    expect(out.blocks.map((b) => b.id)).toEqual(["b_1", "b_4"]);
  });

  it("dokument, w którym ŻADEN blok nie waliduje, daje pusty dokument", () => {
    const out = safeParseBlocks({ version: 1, blocks: [{ type: "nieznany" }] });
    expect(out).toEqual({ version: 1, blocks: [] });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["liczba", 7],
    ["string", "tekst"],
    ["obiekt bez blocks", { version: 1 }],
    ["blocks nie-tablica", { version: 1, blocks: "x" }],
    ["zła wersja", { version: 2, blocks: [] }],
  ])("%s degraduje do pustego dokumentu", (_l, input) => {
    expect(safeParseBlocks(input)).toEqual({ version: 1, blocks: [] });
  });

  it("gubi meta przy degradacji (dokument nie udaje, że przeszedł walidację)", () => {
    const out = safeParseBlocks({
      version: 1,
      blocks: [{ id: "b_1", type: "paragraph", data: { html: "a" } }, { type: "zły" }],
      meta: { migratedFrom: "html" },
    });
    expect(out.meta).toBeUndefined();
  });
});

describe("isBlocksDoc", () => {
  it.each([
    ["poprawny dokument", { version: 1, blocks: [] }, true],
    ["z meta", { version: 1, blocks: [], meta: { a: 1 } }, true],
    ["zła wersja", { version: 2, blocks: [] }, false],
    ["brak blocks", { version: 1 }, false],
    ["klucz nadmiarowy", { version: 1, blocks: [], obcy: 1 }, false],
    ["null", null, false],
    ["tablica", [], false],
  ])("%s -> %s", (_l, value, expected) => {
    expect(isBlocksDoc(value)).toBe(expected);
  });

  it("odrzuca blok z id dłuższym niż limit", () => {
    expect(
      isBlocksDoc({ version: 1, blocks: [{ id: "x".repeat(65), type: "paragraph", data: {} }] }),
    ).toBe(false);
  });

  it("odrzuca dokument z liczbą bloków powyżej limitu", () => {
    const blocks = Array.from({ length: 501 }, (_v, i) => ({
      id: `b_${i}`,
      type: "separator" as const,
      data: {},
    }));
    expect(isBlocksDoc({ version: 1, blocks })).toBe(false);
  });

  it.each([
    ["margines poza zakresem", { align: "left", marginTop: 401 }],
    ["margines ujemny", { marginTop: -1 }],
    ["margines niecałkowity", { marginTop: 1.5 }],
    ["nieznane wyrównanie", { align: "srodek" }],
    ["nieznany klucz stylu", { obcy: 1 }],
  ])("odrzuca styl bloku: %s", (_l, style) => {
    expect(
      isBlocksDoc({ version: 1, blocks: [{ id: "b", type: "paragraph", data: {}, style }] }),
    ).toBe(false);
  });

  it.each(["left", "center", "right", "wide", "full"])("przyjmuje wyrównanie %s", (align) => {
    expect(
      isBlocksDoc({
        version: 1,
        blocks: [{ id: "b", type: "paragraph", data: {}, style: { align } }],
      }),
    ).toBe(true);
  });
});

describe("selection - zakres i przełączanie", () => {
  const ids = ["a", "b", "c", "d"];

  it("zakres w przód", () => {
    expect(blockRange(ids, "b", "d")).toEqual(["b", "c", "d"]);
  });

  it("zakres w TYŁ daje tę samą listę w kolejności dokumentu", () => {
    expect(blockRange(ids, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("zakres do siebie samego to jeden element", () => {
    expect(blockRange(ids, "b", "b")).toEqual(["b"]);
  });

  it("kotwica NIEZNANA - zostaje sam cel", () => {
    expect(blockRange(ids, "nie-ma", "c")).toEqual(["c"]);
  });

  it("cel NIEZNANY - zostaje sama kotwica", () => {
    expect(blockRange(ids, "c", "nie-ma")).toEqual(["c"]);
  });

  it("oba nieznane - pusty zakres", () => {
    expect(blockRange(ids, "x", "y")).toEqual([]);
  });

  it("pusta lista id daje pusty zakres", () => {
    expect(blockRange([], "a", "b")).toEqual([]);
  });

  it("przełączenie dodaje brakujący blok, zachowując kolejność dokumentu", () => {
    expect(toggleInSelection(ids, ["c"], "a")).toEqual(["a", "c"]);
  });

  it("przełączenie usuwa blok już zaznaczony", () => {
    expect(toggleInSelection(ids, ["a", "c"], "c")).toEqual(["a"]);
  });

  it("podwójne przełączenie wraca do stanu wyjściowego (idempotencja)", () => {
    const once = toggleInSelection(ids, ["a"], "c");
    expect(toggleInSelection(ids, once, "c")).toEqual(["a"]);
  });

  it("przełączenie id spoza listy nie wnosi go do zaznaczenia", () => {
    expect(toggleInSelection(ids, ["a"], "obcy")).toEqual(["a"]);
  });
});

describe("tree - spłaszczenie dokumentu", () => {
  it("skrót bloku bez treści jest pusty", () => {
    expect(blockSnippet(mk("separator"))).toBe("---");
    expect(blockSnippet(mk("paragraph", { html: "" }))).toBe("");
  });

  it("skrót DŁUGIEJ treści jest skracany z wielokropkiem", () => {
    const long = "x".repeat(120);
    const snippet = blockSnippet(mk("paragraph", { html: long }));
    expect(snippet.length).toBeLessThanOrEqual(48);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("skrót treści KRÓTKIEJ nie jest skracany", () => {
    expect(blockSnippet(mk("paragraph", { html: "krótko" }))).toBe("krótko");
  });

  it("skrót bierze tylko PIERWSZY wiersz", () => {
    expect(blockSnippet(mk("list", { items: ["A", "B"] }))).toBe("- A");
  });

  it("pusty dokument daje zero wierszy", () => {
    expect(flattenBlockTree([])).toEqual([]);
  });

  it("bloki top-level są na głębokości 0 i same są swoim korzeniem", () => {
    const rows = flattenBlockTree([mk("paragraph", { html: "a" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].depth).toBe(0);
    expect(rows[0].rootId).toBe(rows[0].id);
  });

  it.each(["children", "left", "right"])("dzieci pod kluczem %s są wcięte o poziom", (key) => {
    const parent = mk("group", {
      [key]: [{ id: "b_child", type: "paragraph", data: { html: "c" } }],
    });
    const rows = flattenBlockTree([parent]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1]);
    expect(rows[1].rootId).toBe(parent.id);
  });

  it("kolumny oddają dzieci lewej PRZED prawą", () => {
    const parent = mk("columns", {
      left: [{ id: "b_l", type: "paragraph", data: { html: "L" } }],
      right: [{ id: "b_r", type: "paragraph", data: { html: "R" } }],
    });
    expect(flattenBlockTree([parent]).map((r) => r.id)).toEqual([parent.id, "b_l", "b_r"]);
  });

  it("klucz dzieci nie-tablicowy jest ignorowany", () => {
    expect(flattenBlockTree([mk("group", { children: "nie tablica" })])).toHaveLength(1);
  });

  it("wpis dziecka bez id/type jest ignorowany", () => {
    const rows = flattenBlockTree([mk("group", { children: [{ foo: 1 }, null, "x"] })]);
    expect(rows).toHaveLength(1);
  });

  it("zagnieżdżenie DWUPOZIOMOWE zachowuje korzeń top-level", () => {
    const parent = mk("group", {
      children: [
        {
          id: "b_mid",
          type: "group",
          data: { children: [{ id: "b_deep", type: "paragraph", data: { html: "d" } }] },
        },
      ],
    });
    const rows = flattenBlockTree([parent]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2]);
    expect(rows.every((r) => r.rootId === parent.id)).toBe(true);
  });
});

describe("validateFootnotes - zasięg pól", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["dokument bez bloków", { version: 1 as const, blocks: [] }],
  ])("%s nie daje ostrzeżeń", (_l, input) => {
    expect(validateFootnotes(input)).toEqual([]);
  });

  it("dokument bez markerów nie daje ostrzeżeń", () => {
    expect(validateFootnotes(docOf([mk("paragraph", { html: "zwykły tekst" })]))).toEqual([]);
  });

  it.each([
    ["paragraph", "html"],
    ["html", "html"],
    ["spoiler", "html"],
    ["heading", "text"],
    ["quote", "text"],
  ] as const)("skanuje pole %s.%s", (type, field) => {
    const issues = validateFootnotes(docOf([mk(type, { [field]: "a [fn] bez zamknięcia" })]));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].blockType).toBe(type);
  });

  it("skanuje cite cytatu", () => {
    const issues = validateFootnotes(docOf([mk("quote", { text: "ok", cite: "[fn] otwarty" })]));
    expect(issues[0].path.at(-1)).toBe("cite");
  });

  it("skanuje pozycje listy z indeksem w ścieżce", () => {
    const issues = validateFootnotes(docOf([mk("list", { items: ["ok", "[fn] zły"] })]));
    expect(issues[0].path.slice(-2)).toEqual(["items", 1]);
  });

  it("lista z items NIE-tablicą nie jest skanowana", () => {
    expect(validateFootnotes(docOf([mk("list", { items: "[fn]" })]))).toEqual([]);
  });

  it("skanuje komórki tabeli ze współrzędnymi w ścieżce", () => {
    const issues = validateFootnotes(docOf([mk("table", { rows: [["ok"], ["[fn] zły"]] })]));
    expect(issues[0].path.slice(-3)).toEqual(["rows", 1, 0]);
  });

  it("tabela z rows NIE-tablicą nie jest skanowana", () => {
    expect(validateFootnotes(docOf([mk("table", { rows: "[fn]" })]))).toEqual([]);
  });

  it("wiersz tabeli nie-tablicowy jest pomijany", () => {
    expect(validateFootnotes(docOf([mk("table", { rows: ["[fn]"] })]))).toEqual([]);
  });

  it.each(["left", "right"])("wchodzi do kolumny %s", (side) => {
    const issues = validateFootnotes(
      docOf([
        mk("columns", { [side]: [{ id: "b_c", type: "paragraph", data: { html: "[fn] zły" } }] }),
      ]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toContain(side);
  });

  it("kolumna nie-tablicowa jest pomijana", () => {
    expect(validateFootnotes(docOf([mk("columns", { left: "[fn]" })]))).toEqual([]);
  });

  it.each(["group", "row", "stack", "grid"] as const)("wchodzi do dzieci kontenera %s", (type) => {
    const issues = validateFootnotes(
      docOf([
        mk(type, { children: [{ id: "b_c", type: "paragraph", data: { html: "[fn] zły" } }] }),
      ]),
    );
    expect(issues).toHaveLength(1);
  });

  it("kontener z children NIE-tablicą jest pomijany", () => {
    expect(validateFootnotes(docOf([mk("group", { children: "[fn]" })]))).toEqual([]);
  });

  it("ostrzeżenie z zagnieżdżenia wskazuje blok TOP-LEVEL, nie dziecko", () => {
    const issues = validateFootnotes(
      docOf([
        mk("paragraph", { html: "ok" }),
        mk("group", { children: [{ id: "b_c", type: "paragraph", data: { html: "[fn] zły" } }] }),
      ]),
    );
    expect(issues[0].blockIndex).toBe(1);
    expect(issues[0].blockType).toBe("group");
  });

  it("pole nie-stringowe jest pomijane", () => {
    expect(validateFootnotes(docOf([mk("paragraph", { html: 7 })]))).toEqual([]);
  });

  it("pole PUSTE jest pomijane", () => {
    expect(validateFootnotes(docOf([mk("paragraph", { html: "" })]))).toEqual([]);
  });

  it("poprawna para markerów nie daje ostrzeżenia", () => {
    expect(validateFootnotes(docOf([mk("paragraph", { html: "a [fn]źródło[/fn] b" })]))).toEqual(
      [],
    );
  });

  it("każde ostrzeżenie niesie wycinek treści (do pokazania w panelu)", () => {
    const issues = validateFootnotes(docOf([mk("paragraph", { html: "a [fn] b" })]));
    expect(issues[0].excerpt.length).toBeGreaterThan(0);
  });
});

describe("footnoteOrigins - adresowanie i mutacja", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["dokument bez bloków", { version: 1 as const, blocks: [] }],
  ])("%s nie ma przypisów", (_l, input) => {
    expect(collectFootnoteOrigins(input)).toEqual([]);
  });

  it("numeruje przypisy ciągle w kolejności dokumentu", () => {
    const d = docOf([
      mk("paragraph", { html: "a[fn]P1[/fn]b[fn]P2[/fn]" }),
      mk("heading", { text: "T[fn]P3[/fn]" }),
    ]);
    const entries = collectFootnoteOrigins(d);
    expect(entries.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(entries.map((e) => e.html)).toEqual(["P1", "P2", "P3"]);
  });

  it("kolejne wystąpienia w JEDNYM polu mają rosnący occurrence", () => {
    const entries = collectFootnoteOrigins(
      docOf([mk("paragraph", { html: "[fn]A[/fn][fn]B[/fn]" })]),
    );
    expect(entries.map((e) => e.origin.occurrence)).toEqual([0, 1]);
  });

  it("PUSTY marker nie zużywa numeru (zgodnie z silnikiem)", () => {
    const entries = collectFootnoteOrigins(
      docOf([mk("paragraph", { html: "[fn] [/fn]a[fn]realny[/fn]" })]),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(1);
    expect(entries[0].origin.occurrence).toBe(0);
  });

  it("pole bez markera nie jest skanowane", () => {
    expect(collectFootnoteOrigins(docOf([mk("paragraph", { html: "bez przypisów" })]))).toEqual([]);
  });

  it("pole nie-stringowe jest pomijane", () => {
    expect(collectFootnoteOrigins(docOf([mk("paragraph", { html: 7 })]))).toEqual([]);
  });

  it.each([
    ["quote.cite", mk("quote", { text: "t", cite: "[fn]C[/fn]" })],
    ["list.items", mk("list", { items: ["[fn]L[/fn]"] })],
    ["table.rows", mk("table", { rows: [["[fn]T[/fn]"]] })],
  ])("adresuje pole %s", (_l, blk) => {
    const entries = collectFootnoteOrigins(docOf([blk]));
    expect(entries).toHaveLength(1);
  });

  it("lista z items NIE-tablicą jest pomijana", () => {
    expect(collectFootnoteOrigins(docOf([mk("list", { items: "[fn]x[/fn]" })]))).toEqual([]);
  });

  it("tabela z rows NIE-tablicą jest pomijana", () => {
    expect(collectFootnoteOrigins(docOf([mk("table", { rows: "[fn]x[/fn]" })]))).toEqual([]);
  });

  it("wiersz tabeli nie-tablicowy jest pomijany", () => {
    expect(collectFootnoteOrigins(docOf([mk("table", { rows: ["[fn]x[/fn]"] })]))).toEqual([]);
  });

  it.each(["left", "right"])("wchodzi do kolumny %s", (side) => {
    const entries = collectFootnoteOrigins(
      docOf([
        mk("columns", { [side]: [{ id: "b_c", type: "paragraph", data: { html: "[fn]K[/fn]" } }] }),
      ]),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].origin.path).toContain(side);
  });

  it("kolumna nie-tablicowa jest pomijana", () => {
    expect(collectFootnoteOrigins(docOf([mk("columns", { left: "[fn]x[/fn]" })]))).toEqual([]);
  });

  it.each(["group", "row", "stack", "grid"] as const)("wchodzi do dzieci kontenera %s", (type) => {
    const entries = collectFootnoteOrigins(
      docOf([
        mk(type, { children: [{ id: "b_c", type: "paragraph", data: { html: "[fn]G[/fn]" } }] }),
      ]),
    );
    expect(entries).toHaveLength(1);
  });

  it("kontener z children NIE-tablicą jest pomijany", () => {
    expect(collectFootnoteOrigins(docOf([mk("group", { children: "[fn]x[/fn]" })]))).toEqual([]);
  });

  it("podmienia DOKŁADNIE wskazane wystąpienie, resztę zostawia", () => {
    const d = docOf([mk("paragraph", { html: "[fn]A[/fn] i [fn]B[/fn]" })]);
    const target = collectFootnoteOrigins(d)[1].origin;
    const out = updateFootnoteAtOrigin(d, target, "NOWE");
    expect(out.blocks[0].data.html).toBe("[fn]A[/fn] i [fn]NOWE[/fn]");
  });

  it("PUSTA nowa treść usuwa cały marker", () => {
    const d = docOf([mk("paragraph", { html: "a[fn]A[/fn]b" })]);
    const out = updateFootnoteAtOrigin(d, collectFootnoteOrigins(d)[0].origin, "   ");
    expect(out.blocks[0].data.html).toBe("ab");
  });

  it("nie liczy PUSTYCH markerów przy szukaniu wystąpienia", () => {
    const d = docOf([mk("paragraph", { html: "[fn][/fn][fn]A[/fn]" })]);
    const out = updateFootnoteAtOrigin(d, collectFootnoteOrigins(d)[0].origin, "B");
    expect(out.blocks[0].data.html).toBe("[fn][/fn][fn]B[/fn]");
  });

  it("ścieżka wskazująca pole NIE-stringowe zwraca dokument bez zmian", () => {
    const d = docOf([mk("paragraph", { html: "[fn]A[/fn]" })]);
    const out = updateFootnoteAtOrigin(d, { path: [0, "data"], occurrence: 0 }, "X");
    expect(out).toBe(d);
  });

  it("ścieżka POZA dokumentem zwraca dokument bez zmian", () => {
    const d = docOf([mk("paragraph", { html: "[fn]A[/fn]" })]);
    const out = updateFootnoteAtOrigin(d, { path: [9, "data", "html"], occurrence: 0 }, "X");
    expect(out).toBe(d);
  });

  it("occurrence poza zakresem zwraca dokument bez zmian (referencyjnie)", () => {
    const d = docOf([mk("paragraph", { html: "[fn]A[/fn]" })]);
    const out = updateFootnoteAtOrigin(d, { path: [0, "data", "html"], occurrence: 5 }, "X");
    expect(out).toBe(d);
  });

  it("podmiana na TĘ SAMĄ treść zwraca dokument referencyjnie (bez kopii)", () => {
    const d = docOf([mk("paragraph", { html: "[fn]A[/fn]" })]);
    expect(updateFootnoteAtOrigin(d, { path: [0, "data", "html"], occurrence: 0 }, "A")).toBe(d);
  });

  it("podmiana jest niezmienna - dokument źródłowy zostaje nietknięty", () => {
    const d = docOf([mk("paragraph", { html: "[fn]A[/fn]" })]);
    const out = updateFootnoteAtOrigin(d, { path: [0, "data", "html"], occurrence: 0 }, "B");
    expect(d.blocks[0].data.html).toBe("[fn]A[/fn]");
    expect(out).not.toBe(d);
  });

  it("podmiana w pozycji listy trafia w tę samą pozycję", () => {
    const d = docOf([mk("list", { items: ["a", "[fn]A[/fn]"] })]);
    const out = updateFootnoteAtOrigin(d, collectFootnoteOrigins(d)[0].origin, "B");
    expect(out.blocks[0].data.items).toEqual(["a", "[fn]B[/fn]"]);
  });

  it("podmiana w komórce tabeli trafia w tę samą komórkę", () => {
    const d = docOf([mk("table", { rows: [["a", "[fn]A[/fn]"]] })]);
    const out = updateFootnoteAtOrigin(d, collectFootnoteOrigins(d)[0].origin, "B");
    expect(out.blocks[0].data.rows).toEqual([["a", "[fn]B[/fn]"]]);
  });

  it("podmiana w zagnieżdżonym kontenerze trafia w dziecko", () => {
    const d = docOf([
      mk("group", { children: [{ id: "b_c", type: "paragraph", data: { html: "[fn]A[/fn]" } }] }),
    ]);
    const out = updateFootnoteAtOrigin(d, collectFootnoteOrigins(d)[0].origin, "B");
    const children = out.blocks[0].data.children as Array<{ data: { html: string } }>;
    expect(children[0].data.html).toBe("[fn]B[/fn]");
  });
});

describe("isTextEntryBlockType", () => {
  it.each([
    "paragraph",
    "heading",
    "list",
    "quote",
    "code",
    "preformatted",
    "verse",
    "pullquote",
    "callout",
    "details",
  ])("%s przyjmuje od razu pisanie", (type) => {
    expect(isTextEntryBlockType(type)).toBe(true);
  });

  it.each(["html", "image", "table", "separator", "", "gallery"])(
    "%s NIE przyjmuje od razu pisania",
    (type) => {
      expect(isTextEntryBlockType(type)).toBe(false);
    },
  );
});
