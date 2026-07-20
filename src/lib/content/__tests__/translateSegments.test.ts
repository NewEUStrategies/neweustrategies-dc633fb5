import { describe, it, expect } from "vitest";
import { buildSegments, MAX_TOTAL_CHARS } from "../translateSegments";
import type { Block } from "@/lib/blocks/types";

const baseInput = {
  title_pl: "Tytuł analizy",
  excerpt_pl: "Zajawka",
  takeaways_pl: ["Punkt pierwszy", "", "Punkt trzeci"],
  seo_title_pl: null,
  seo_description_pl: "Opis SEO",
  content_pl: null,
  blocks_pl: null as Block[] | null,
};

describe("buildSegments", () => {
  it("zbiera metadane i odkłada tłumaczenia w te same miejsca", () => {
    const seg = buildSegments(baseInput);
    expect(seg.texts).toEqual(["Tytuł analizy", "Zajawka", "Punkt pierwszy", "Punkt trzeci", "Opis SEO"]);
    const out = seg.apply(["Title", "Excerpt", "Point one", "Point three", "SEO desc"]);
    expect(out.title_en).toBe("Title");
    expect(out.excerpt_en).toBe("Excerpt");
    expect(out.takeaways_en).toEqual(["Point one", "Point three"]);
    expect(out.seo_title_en).toBeNull();
    expect(out.seo_description_en).toBe("SEO desc");
  });

  it("tłumaczy pola tekstowe bloków, nie ruszając konfiguracji", () => {
    const blocks: Block[] = [
      { id: "b1", type: "paragraph", data: { html: "<p>Akapit <strong>ważny</strong></p>" } },
      { id: "b2", type: "heading", data: { level: 2, text: "Nagłówek", anchor: "kotwica" } },
      { id: "b3", type: "list", data: { ordered: false, items: ["Jeden", "Dwa"] } },
      { id: "b4", type: "image", data: { url: "https://x/img.jpg", alt: "Opis obrazka", caption: "Podpis" } },
      { id: "b5", type: "chart", data: { config: { series: [1, 2, 3] } } },
    ];
    const seg = buildSegments({ ...baseInput, excerpt_pl: null, takeaways_pl: [], seo_description_pl: null, blocks_pl: blocks });
    expect(seg.texts).toEqual([
      "Tytuł analizy",
      "<p>Akapit <strong>ważny</strong></p>",
      "Nagłówek",
      "Jeden",
      "Dwa",
      "Podpis",
      "Opis obrazka",
    ]);
    const out = seg.apply([
      "Analysis title",
      "<p>Paragraph <strong>important</strong></p>",
      "Heading",
      "One",
      "Two",
      "Caption",
      "Image alt",
    ]);
    const blocksEn = out.blocks_en ?? [];
    expect(blocksEn[0].data.html).toBe("<p>Paragraph <strong>important</strong></p>");
    expect(blocksEn[1].data.text).toBe("Heading");
    expect(blocksEn[1].data.anchor).toBe("kotwica");
    expect(blocksEn[2].data.items).toEqual(["One", "Two"]);
    expect(blocksEn[3].data.url).toBe("https://x/img.jpg");
    expect(blocksEn[3].data.alt).toBe("Image alt");
    expect(blocksEn[4].data).toEqual({ config: { series: [1, 2, 3] } });
    // Oryginał PL nietknięty (deep copy).
    expect(blocks[0].data.html).toBe("<p>Akapit <strong>ważny</strong></p>");
  });

  it("kolumny: tłumaczy bloki zagnieżdżone po obu stronach", () => {
    const blocks: Block[] = [
      {
        id: "c1",
        type: "columns",
        data: {
          left: [{ id: "l1", type: "paragraph", data: { html: "Lewa" } }],
          right: [{ id: "r1", type: "heading", data: { level: 3, text: "Prawa" } }],
        },
      },
    ];
    const seg = buildSegments({ ...baseInput, excerpt_pl: null, takeaways_pl: [], seo_description_pl: null, blocks_pl: blocks });
    expect(seg.texts).toEqual(["Tytuł analizy", "Lewa", "Prawa"]);
  });

  it("apply odrzuca niezgodną liczbę segmentów", () => {
    const seg = buildSegments(baseInput);
    expect(() => seg.apply(["tylko jeden"])).toThrow(/mismatch/);
  });

  it("przekroczenie budżetu znaków rzuca czytelny błąd", () => {
    const huge = "x".repeat(MAX_TOTAL_CHARS + 1);
    expect(() => buildSegments({ ...baseInput, content_pl: huge })).toThrow(/limit/);
  });
});
