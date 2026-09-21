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
    expect(seg.texts).toEqual([
      "Tytuł analizy",
      "Zajawka",
      "Punkt pierwszy",
      "Punkt trzeci",
      "Opis SEO",
    ]);
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
      {
        id: "b4",
        type: "image",
        data: { url: "https://x/img.jpg", alt: "Opis obrazka", caption: "Podpis" },
      },
      { id: "b5", type: "chart", data: { config: { series: [1, 2, 3] } } },
    ];
    const seg = buildSegments({
      ...baseInput,
      excerpt_pl: null,
      takeaways_pl: [],
      seo_description_pl: null,
      blocks_pl: blocks,
    });
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
    const seg = buildSegments({
      ...baseInput,
      excerpt_pl: null,
      takeaways_pl: [],
      seo_description_pl: null,
      blocks_pl: blocks,
    });
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

// Wejście z SAMYMI blokami - metadane wyzerowane, żeby lista segmentów była
// dokładnie tym, co zebrał collectBlockTexts (bez szumu tytułu i zajawki).
const blocksOnly = (blocks: Block[]) => ({
  ...baseInput,
  title_pl: "",
  excerpt_pl: null,
  takeaways_pl: [],
  seo_description_pl: null,
  blocks_pl: blocks,
});

describe("buildSegments - pełna mapa tłumaczonych typów bloków", () => {
  it("zbiera teksty html, cytatów, callout, verse, preformatted, cover, FAQ i przycisku", () => {
    const blocks: Block[] = [
      { id: "b1", type: "html", data: { html: "<b>Surowy HTML</b>" } },
      { id: "b2", type: "quote", data: { text: "Cytat", cite: "Autor cytatu" } },
      { id: "b3", type: "pullquote", data: { text: "Wyimek", cite: "Źródło wyimka" } },
      { id: "b4", type: "callout", data: { text: "Uwaga redakcji", variant: "info" } },
      { id: "b5", type: "verse", data: { text: "Strofa wiersza" } },
      { id: "b6", type: "preformatted", data: { text: "kod = 1" } },
      {
        id: "b7",
        type: "cover",
        data: {
          url: "https://example.com/tlo.jpg",
          caption: "Podpis okładki",
          alt: "Alt okładki",
        },
      },
      { id: "b8", type: "faq", data: { items: [{ q: "Pytanie", a: "Odpowiedź" }] } },
      { id: "b9", type: "button", data: { label: "Kliknij", url: "https://example.com/cel" } },
    ];

    const seg = buildSegments(blocksOnly(blocks));

    expect(seg.texts).toEqual([
      "<b>Surowy HTML</b>",
      "Cytat",
      "Autor cytatu",
      "Wyimek",
      "Źródło wyimka",
      "Uwaga redakcji",
      "Strofa wiersza",
      "kod = 1",
      "Podpis okładki",
      "Alt okładki",
      "Pytanie",
      "Odpowiedź",
      "Kliknij",
    ]);

    const out = seg.apply([
      "<b>Raw HTML</b>",
      "Quote",
      "Quote author",
      "Pull quote",
      "Pull quote source",
      "Editorial note",
      "Verse stanza",
      "code = 1",
      "Cover caption",
      "Cover alt",
      "Question",
      "Answer",
      "Click",
    ]);

    const en = out.blocks_en ?? [];
    expect(en[0].data.html).toBe("<b>Raw HTML</b>");
    expect(en[1].data).toEqual({ text: "Quote", cite: "Quote author" });
    expect(en[2].data).toEqual({ text: "Pull quote", cite: "Pull quote source" });
    // Pola konfiguracyjne (variant) przechodzą bez tłumaczenia.
    expect(en[3].data).toEqual({ text: "Editorial note", variant: "info" });
    expect(en[4].data.text).toBe("Verse stanza");
    expect(en[5].data.text).toBe("code = 1");
    expect(en[6].data).toEqual({
      url: "https://example.com/tlo.jpg",
      caption: "Cover caption",
      alt: "Cover alt",
    });
    expect(en[7].data.items).toEqual([{ q: "Question", a: "Answer" }]);
    // Przycisk: tłumaczymy etykietę, ale adres docelowy zostaje nietknięty.
    expect(en[8].data).toEqual({ label: "Click", url: "https://example.com/cel" });
    // Oryginał PL nietknięty (deep copy w buildSegments).
    expect(blocks[8].data.label).toBe("Kliknij");
  });

  it("puste pole tekstowe bloku nie tworzy segmentu", () => {
    const seg = buildSegments(
      blocksOnly([{ id: "q1", type: "quote", data: { text: "Sam cytat", cite: "   " } }]),
    );

    expect(seg.texts).toEqual(["Sam cytat"]);
    const out = seg.apply(["Just a quote"]);
    expect((out.blocks_en ?? [])[0].data.cite).toBe("   ");
  });
});

describe("buildSegments - wejście patologiczne w blokach", () => {
  it("lista: nietablicowe `items` i puste pozycje są pomijane bez wyjątku", () => {
    const seg = buildSegments(
      blocksOnly([
        { id: "l1", type: "list", data: { ordered: false, items: "to nie tablica" } },
        { id: "l2", type: "list", data: { ordered: true, items: ["", "   ", "Jedyna pozycja"] } },
      ]),
    );

    expect(seg.texts).toEqual(["Jedyna pozycja"]);
    const out = seg.apply(["The only item"]);
    const en = out.blocks_en ?? [];
    // Uszkodzone `items` przechodzi 1:1 - segmentacja niczego nie naprawia.
    expect(en[0].data.items).toBe("to nie tablica");
    // Puste pozycje zostają na swoich indeksach, przetłumaczona wraca w swoje miejsce.
    expect(en[1].data.items).toEqual(["", "   ", "The only item"]);
  });

  it("FAQ: pomija nietablicowe `items`, pozycje nieobiektowe i niepełne pary pytanie/odpowiedź", () => {
    const seg = buildSegments(
      blocksOnly([
        { id: "f1", type: "faq", data: { items: "to nie tablica" } },
        {
          id: "f2",
          type: "faq",
          data: {
            items: [
              null,
              "napis zamiast pary",
              { q: "Samo pytanie" },
              { a: "Sama odpowiedź" },
              { q: "   ", a: "" },
            ],
          },
        },
      ]),
    );

    expect(seg.texts).toEqual(["Samo pytanie", "Sama odpowiedź"]);
    const out = seg.apply(["Question only", "Answer only"]);
    expect((out.blocks_en ?? [])[1].data.items).toEqual([
      null,
      "napis zamiast pary",
      { q: "Question only" },
      { a: "Answer only" },
      { q: "   ", a: "" },
    ]);
  });

  it("kolumny: dziecko bez pól `type`/`data` jest pomijane bez wyjątku", () => {
    const seg = buildSegments(
      blocksOnly([
        {
          id: "c1",
          type: "columns",
          data: {
            left: [
              "napis zamiast bloku",
              null,
              { type: "paragraph" },
              { data: { html: "blok bez type" } },
            ],
            right: [],
          },
        },
      ]),
    );

    expect(seg.texts).toEqual([]);
    expect(seg.apply([]).blocks_en).toHaveLength(1);
  });
});
