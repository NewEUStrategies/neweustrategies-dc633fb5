import { describe, it, expect } from "vitest";
import { renderEmailHtml, type RenderEmailCtx } from "../renderEmailHtml";
import { postRefsForLang, type EmailPostRow } from "../emailDocResolve";
import {
  createDefaultEmailDoc,
  type EmailDoc,
  type EmailButtonBlock,
  type EmailHeadingBlock,
  type EmailImageBlock,
  type EmailPostListBlock,
} from "../emailDoc";

const emptyCtx: RenderEmailCtx = { postsByBlock: {} };

function docWith(blocks: EmailDoc["blocks"]): EmailDoc {
  return { version: 1, blocks, style: createDefaultEmailDoc().style };
}

describe("renderEmailHtml", () => {
  it("renders heading text for the requested language", () => {
    const heading: EmailHeadingBlock = {
      id: "h",
      type: "heading",
      text: { pl: "Witaj", en: "Hello" },
      level: 1,
      align: "left",
    };
    const pl = renderEmailHtml(docWith([heading]), "pl", emptyCtx);
    const en = renderEmailHtml(docWith([heading]), "en", emptyCtx);
    expect(pl).toContain("Witaj");
    expect(en).toContain("Hello");
  });

  it("returns empty string when no block has content in the language", () => {
    const heading: EmailHeadingBlock = {
      id: "h",
      type: "heading",
      text: { pl: "Tylko PL", en: "" },
      level: 1,
      align: "left",
    };
    expect(renderEmailHtml(docWith([heading]), "en", emptyCtx)).toBe("");
  });

  it("escapes HTML in heading text (no injection)", () => {
    const heading: EmailHeadingBlock = {
      id: "h",
      type: "heading",
      text: { pl: "<script>alert(1)</script>", en: "" },
      level: 2,
      align: "left",
    };
    const html = renderEmailHtml(docWith([heading]), "pl", emptyCtx);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops button with unsafe (non-http) url", () => {
    const button: EmailButtonBlock = {
      id: "b",
      type: "button",
      label: { pl: "Klik", en: "Click" },
      url: "javascript:alert(1)",
      align: "center",
    };
    expect(renderEmailHtml(docWith([button]), "pl", emptyCtx)).toBe("");
  });

  it("renders button with a valid https url", () => {
    const button: EmailButtonBlock = {
      id: "b",
      type: "button",
      label: { pl: "Klik", en: "Click" },
      url: "https://example.com/x",
      align: "center",
    };
    const html = renderEmailHtml(docWith([button]), "pl", emptyCtx);
    expect(html).toContain("https://example.com/x");
    expect(html).toContain("Klik");
  });

  it("drops image with no url and renders one with a url", () => {
    const noUrl: EmailImageBlock = { id: "i", type: "image", url: null, alt: "", href: null };
    expect(renderEmailHtml(docWith([noUrl]), "pl", emptyCtx)).toBe("");
    const withUrl: EmailImageBlock = {
      id: "i2",
      type: "image",
      url: "https://cdn.example.com/a.png",
      alt: "Opis",
      href: null,
    };
    const html = renderEmailHtml(docWith([withUrl]), "pl", emptyCtx);
    expect(html).toContain("https://cdn.example.com/a.png");
    expect(html).toContain('alt="Opis"');
  });

  it("skips a post-list block with no resolved posts, renders when present", () => {
    const block: EmailPostListBlock = {
      id: "pl1",
      type: "post-list",
      heading: { pl: "Najnowsze", en: "Latest" },
      mode: "latest",
      count: 3,
      categorySlug: null,
      postIds: [],
      layout: "list",
      showExcerpt: true,
    };
    expect(renderEmailHtml(docWith([block]), "pl", emptyCtx)).toBe("");

    const ctx: RenderEmailCtx = {
      postsByBlock: {
        pl1: [
          {
            id: "p1",
            title: "Analiza NATO",
            excerpt: "Krótki opis",
            href: "https://nes.eu/post/nato",
            coverUrl: null,
          },
        ],
      },
    };
    const html = renderEmailHtml(docWith([block]), "pl", ctx);
    expect(html).toContain("Analiza NATO");
    expect(html).toContain("https://nes.eu/post/nato");
    expect(html).toContain("Czytaj więcej");
  });
});

describe("postRefsForLang", () => {
  const rows: Record<string, EmailPostRow[]> = {
    b1: [
      {
        id: "p1",
        slug: "nato-2026",
        title_pl: "Analiza NATO",
        title_en: "NATO analysis",
        excerpt_pl: "<p>Opis PL</p>",
        excerpt_en: "Desc EN",
        cover_image_url: "https://cdn/x.png",
      },
    ],
  };

  it("builds language-addressed hrefs and strips excerpt HTML", () => {
    const pl = postRefsForLang(rows, "https://nes.eu/", "pl");
    expect(pl.b1[0].href).toBe("https://nes.eu/post/nato-2026");
    expect(pl.b1[0].title).toBe("Analiza NATO");
    expect(pl.b1[0].excerpt).toBe("Opis PL");

    const en = postRefsForLang(rows, "https://nes.eu", "en");
    expect(en.b1[0].href).toBe("https://nes.eu/en/post/nato-2026");
    expect(en.b1[0].title).toBe("NATO analysis");
  });

  it("falls back across languages when one side is empty", () => {
    const onlyPl: Record<string, EmailPostRow[]> = {
      b1: [
        {
          id: "p2",
          slug: "s",
          title_pl: "Tylko PL",
          title_en: null,
          excerpt_pl: null,
          excerpt_en: null,
          cover_image_url: null,
        },
      ],
    };
    const en = postRefsForLang(onlyPl, "https://nes.eu", "en");
    expect(en.b1[0].title).toBe("Tylko PL");
  });
});
