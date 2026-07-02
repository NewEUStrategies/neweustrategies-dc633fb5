import { describe, expect, it } from "vitest";
import { buildLlmsTxt } from "@/lib/seo/llms";

describe("buildLlmsTxt", () => {
  const txt = buildLlmsTxt({
    siteName: "New European Strategies",
    origin: "https://nes.example",
    descriptionPl: "Think-tank o bezpieczeństwie.",
    descriptionEn: "A security think-tank.",
    sections: [
      {
        name: "Geopolityka / Geopolitics",
        url: "https://nes.example/category/geo",
        description: "Analizy",
      },
    ],
    latestPl: [
      {
        title: "Wpis PL",
        url: "https://nes.example/blog/wpis",
        description: "Zajawka",
        publishedAt: "2026-07-01T10:00:00Z",
      },
    ],
    latestEn: [{ title: "EN post", url: "https://nes.example/en/blog/post" }],
    contactEmail: "office@nes.example",
  });

  it("follows the llms.txt structure (H1 + blockquote + sections)", () => {
    expect(txt.startsWith("# New European Strategies\n")).toBe(true);
    expect(txt).toContain("> Think-tank o bezpieczeństwie.");
    expect(txt).toContain("## Sekcje / Sections");
    expect(txt).toContain(
      "- [Geopolityka / Geopolitics](https://nes.example/category/geo): Analizy",
    );
  });
  it("lists articles per language with dates", () => {
    expect(txt).toContain("- [Wpis PL](https://nes.example/blog/wpis): Zajawka (2026-07-01)");
    expect(txt).toContain("## Latest articles (EN)");
    expect(txt).toContain("- [EN post](https://nes.example/en/blog/post)");
  });
  it("advertises the machine-readable surfaces and contact", () => {
    expect(txt).toContain("https://nes.example/sitemap.xml");
    expect(txt).toContain("https://nes.example/news-sitemap.xml");
    expect(txt).toContain("https://nes.example/en/rss.xml");
    expect(txt).toContain("Kontakt / Contact: office@nes.example");
  });
});
