import { describe, expect, it } from "vitest";
import type { BlocksDoc } from "@/lib/blocks/types";
import type { BuilderDocument } from "@/lib/builder/types";
import { bodyStartText } from "@/lib/text/bodyStartText";

const blocks: BlocksDoc = {
  version: 1,
  blocks: [
    { id: "i", type: "image", data: { url: "https://x.test/a.jpg", alt: "Okładka" } },
    { id: "h", type: "heading", data: { level: 2, text: "Wstęp" } },
    {
      id: "p1",
      type: "paragraph",
      data: { html: "Pierwsze <strong>zdanie</strong> z przypisem[fn]Źródło: GUS[/fn]." },
    },
    { id: "hidden", type: "paragraph", data: { html: "Ukryty blok" }, style: { hidden: true } },
    { id: "sc", type: "paragraph", data: { html: "[infogram id=”abcdefgh12”]" } },
    { id: "l", type: "list", data: { items: ["Punkt <em>A</em>", "Punkt B"] } },
  ],
};

describe("bodyStartText", () => {
  it("bloki: tekst pierwszych bloków bez obrazów, ukrytych bloków, przypisów i shortcode'ów", () => {
    expect(bodyStartText({ editor: "blocks", blocksDoc: blocks, lang: "pl" })).toBe(
      "Wstęp Pierwsze zdanie z przypisem. Punkt A Punkt B",
    );
  });

  it("legacy HTML: tekst bez znaczników, encji i znacznika <!--TOC-->", () => {
    expect(
      bodyStartText({
        editor: "richtext",
        html: "<!--TOC--><p>Rząd &bdquo;ogłosił&rdquo; plan.</p><p>Dalej.</p>",
        lang: "pl",
      }),
    ).toBe("Rząd „ogłosił” plan. Dalej.");
  });

  it("builder: widgety text / heading / rich-text w kolejności dokumentu, inne pominięte", () => {
    const doc = {
      version: 1,
      sections: [
        {
          id: "s",
          kind: "section",
          columns: [
            {
              id: "c",
              kind: "column",
              widgets: [
                { id: "w0", kind: "widget", type: "post-list", content: { title_pl: "Karty" } },
                { id: "w1", kind: "widget", type: "heading", content: { text_pl: "Tytuł sekcji" } },
                {
                  id: "w2",
                  kind: "widget",
                  type: "text",
                  content: { html_pl: "<p>Akapit PL</p>", html_en: "<p>EN paragraph</p>" },
                },
                {
                  id: "w3",
                  kind: "widget",
                  type: "rich-text",
                  content: { doc: { pl: blocks } },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as BuilderDocument;
    expect(bodyStartText({ editor: "builder", builderDoc: doc, lang: "pl" })).toBe(
      "Tytuł sekcji Akapit PL Wstęp Pierwsze zdanie z przypisem. Punkt A Punkt B",
    );
    expect(bodyStartText({ editor: "builder", builderDoc: doc, lang: "en" })).toMatch(
      /^Tytuł sekcji EN paragraph/,
    );
  });

  it("przycina do limitu znaków", () => {
    const long: BlocksDoc = {
      version: 1,
      blocks: Array.from({ length: 50 }, (_, i) => ({
        id: `p${i}`,
        type: "paragraph" as const,
        data: { html: "Zdanie testowe numer kolejny." },
      })),
    };
    expect(bodyStartText({ editor: "blocks", blocksDoc: long, lang: "pl" }, 100)).toHaveLength(100);
  });
});
