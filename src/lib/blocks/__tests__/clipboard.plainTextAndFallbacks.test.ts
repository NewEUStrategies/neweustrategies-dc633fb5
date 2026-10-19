import { describe, expect, it } from "vitest";
import {
  blocksToPlainText,
  parseBlocksFromClipboard,
  serializeBlocksForClipboard,
} from "@/lib/blocks/clipboard";
import type { Block, Json } from "@/lib/blocks/types";

// Schowek bloków ma dwie strony, których sąsiednie testy (`clipboard.test.ts`,
// `coreBranches.test.ts`) nie dowodzą na danych w REALNYM kształcie:
//
//   1. `text/plain` dla zwykłych edytorów. Bloki z palety mają puste pola
//      domyślne (`image` -> `caption: ""`). Odczyt przez `??` przepuszczał
//      pusty napis, więc obraz z opisem alternatywnym kopiował się jako NIC,
//      a wartość nie-tekstowa z uszkodzonego dokumentu jako „[object Object]"
//      (naprawione 2026-10-18). Tu dowodzimy, że do schowka trafia pierwsza
//      NIEPUSTA wartość tekstowa i nic z tego, co czytelnik uznałby za śmieć.
//   2. Kolejność prób przy wklejaniu: uszkodzony albo pusty sentinel NIE może
//      zatrzymać wklejki - warstwa Gutenberga przejmuje treść, a z sentinela
//      przechodzą wyłącznie bloki o poprawnym kształcie, ze świeżymi id.
//
// Moduł jest czysty - żadnych atrap; base64 i markup Gutenberga są prawdziwe.

const blok = (type: string, data: Record<string, Json>, id = "b_1"): Block =>
  ({ id, type, data }) as Block;

/** Sentinel w formacie modułu dla dowolnego ładunku JSON. */
const sentinel = (payload: unknown): string =>
  `<!-- nes:blocks b64:${btoa(unescape(encodeURIComponent(JSON.stringify(payload))))} -->`;

const GUTENBERG = "<!-- wp:paragraph --><p>Z warstwy Gutenberga</p><!-- /wp:paragraph -->";

describe("blocksToPlainText - pierwsza NIEPUSTA wartość tekstowa", () => {
  it("obraz z palety (pusty podpis) kopiuje się opisem alternatywnym", () => {
    const img = blok("image", { url: "/media/pkb.png", alt: "Wykres PKB", caption: "", href: "" });
    expect(blocksToPlainText([img])).toBe("Wykres PKB");
  });

  it("obraz z pustym podpisem i alt kopiuje się adresem", () => {
    const img = blok("image", { url: "/media/pkb.png", alt: "  ", caption: "", href: "" });
    expect(blocksToPlainText([img])).toBe("/media/pkb.png");
  });

  it("blok spoza listy typów bierze tytuł, gdy tekst jest pusty", () => {
    expect(blocksToPlainText([blok("callout", { text: "", title: "Uwaga redakcji" })])).toBe(
      "Uwaga redakcji",
    );
  });

  it("wartość nie-tekstowa NIE trafia do schowka jako [object Object]", () => {
    const text = blocksToPlainText([
      blok("heading", { text: { zepsute: true } }, "b_h"),
      blok("paragraph", { html: ["a"] }, "b_p"),
      blok("quote", { text: "Cytat", cite: { autor: "x" } }, "b_q"),
      blok("code", { code: 12 }, "b_c"),
    ]);
    expect(text).not.toContain("[object Object]");
    expect(text).toBe('"Cytat"\n\n12');
  });

  it("pozycje listy: liczby są tekstem, puste i nie-tekstowe pozycje znikają z numeracji", () => {
    const lista = blok("list", {
      ordered: true,
      items: ["Wstęp", "", { x: 1 }, 2026, "<b>Koniec</b>"],
    });
    expect(blocksToPlainText([lista])).toBe("1. Wstęp\n2. 2026\n3. Koniec");
  });

  it("źródło cytatu złożone z samych znaczników nie zostawia wiszącego myślnika", () => {
    expect(blocksToPlainText([blok("quote", { text: "Q", cite: "<br>" })])).toBe('"Q"');
  });

  it("kod z samych białych znaków nie daje pustego akapitu między blokami", () => {
    const text = blocksToPlainText([
      blok("paragraph", { html: "<p>a</p>" }, "b_1"),
      blok("code", { code: "   " }, "b_2"),
      blok("paragraph", { html: "<p>b</p>" }, "b_3"),
    ]);
    expect(text).toBe("a\n\nb");
  });

  it("serializacja do schowka niesie ten sam tekst co blocksToPlainText", () => {
    const blocks = [blok("image", { url: "/u.png", alt: "Opis", caption: "" })];
    expect(serializeBlocksForClipboard(blocks).text).toBe("Opis");
  });
});

describe("parseBlocksFromClipboard - kolejność warstw przy uszkodzonym sentinelu", () => {
  it("sentinel z niepoprawnym JSON-em oddaje pałeczkę warstwie Gutenberga", () => {
    const html = `<!-- nes:blocks b64:${btoa("{nie-json")} -->\n${GUTENBERG}`;
    const blocks = parseBlocksFromClipboard(html);
    expect(blocks?.map((b) => b.type)).toEqual(["paragraph"]);
    expect(String(blocks?.[0].data.html)).toContain("Z warstwy Gutenberga");
  });

  it("sentinel bez listy bloków oddaje pałeczkę warstwie Gutenberga", () => {
    const blocks = parseBlocksFromClipboard(`${sentinel({ version: 1 })}\n${GUTENBERG}`);
    expect(blocks?.map((b) => b.type)).toEqual(["paragraph"]);
  });

  it("sentinel z samymi niepoprawnymi blokami oddaje pałeczkę warstwie Gutenberga", () => {
    const payload = { version: 1, blocks: [null, { type: 7, data: {} }, { type: "x" }] };
    const blocks = parseBlocksFromClipboard(`${sentinel(payload)}\n${GUTENBERG}`);
    expect(blocks?.map((b) => b.type)).toEqual(["paragraph"]);
  });

  it("z sentinela przechodzą tylko bloki o poprawnym kształcie, każdy ze świeżym id", () => {
    const payload = {
      version: 1,
      blocks: [
        { id: "b_ok", type: "heading", data: { level: 2, text: "T", anchor: "" } },
        { id: "b_bad", type: "paragraph" },
      ],
    };
    const blocks = parseBlocksFromClipboard(sentinel(payload));
    expect(blocks).toHaveLength(1);
    expect(blocks?.[0]).toMatchObject({ type: "heading", data: { text: "T" } });
    expect(blocks?.[0].id).not.toBe("b_ok");
  });
});
