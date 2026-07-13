// Grupowanie digestu po rodzaju: sekcja trackera z nagłówkiem gdy digest jest
// mieszany; płaska lista gdy wszystkie pozycje są jednego rodzaju.
import { describe, it, expect } from "vitest";
import { buildDigestHtml, type DigestItem } from "@/lib/notifications/digestEmail";

function item(kind: string, title: string, href = "/x"): DigestItem {
  return {
    kind,
    title_pl: title,
    title_en: title,
    body_pl: null,
    body_en: null,
    href,
    created_at: "2026-07-14T10:00:00Z",
  };
}

const base = {
  displayName: "Jan",
  lang: "pl" as const,
  siteUrl: "https://nes.test",
  frequency: "daily" as const,
};

describe("buildDigestHtml - grupowanie", () => {
  it("mieszany digest pokazuje nagłówki sekcji z sekcją trackera na górze", () => {
    const html = buildDigestHtml({
      ...base,
      items: [
        item("content", "Nowy artykuł"),
        item("tracker", "AI Act - trilog", "/tracker/ai-act"),
      ],
    });
    expect(html).toContain("Tracker legislacyjny UE");
    expect(html).toContain("Nowe treści");
    // Sekcja trackera renderuje się przed sekcją treści (kolejność DIGEST_SECTIONS).
    expect(html.indexOf("Tracker legislacyjny UE")).toBeLessThan(html.indexOf("Nowe treści"));
    expect(html).toContain("AI Act - trilog");
    expect(html).toContain("/tracker/ai-act");
  });

  it("jednorodny digest (sam tracker) NIE dubluje nagłówka sekcji", () => {
    const html = buildDigestHtml({
      ...base,
      items: [item("tracker", "AI Act", "/tracker/ai-act"), item("tracker", "DMA", "/tracker/dma")],
    });
    expect(html).not.toContain("Tracker legislacyjny UE");
    expect(html).toContain("AI Act");
    expect(html).toContain("DMA");
  });

  it("rodzaj spoza katalogu trafia do sekcji 'Pozostałe' w mieszanym digestcie", () => {
    const html = buildDigestHtml({
      ...base,
      items: [item("tracker", "AI Act"), item("mystery", "Coś innego")],
    });
    expect(html).toContain("Pozostałe");
    expect(html).toContain("Coś innego");
  });

  it("angielskie nagłówki dla lang=en", () => {
    const html = buildDigestHtml({
      ...base,
      lang: "en",
      items: [item("content", "New post"), item("tracker", "AI Act")],
    });
    expect(html).toContain("EU legislative tracker");
    expect(html).toContain("New content");
  });
});
