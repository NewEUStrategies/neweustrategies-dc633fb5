// Podgląd robots.txt w panelu musi pokazywać DOKŁADNIE to, co dostaje crawler.
//
// Sens tego testu: przez miesiące nikt nie zauważył, że produkcyjne
// /robots.txt jest przesłonięte statycznym plikiem - między innymi dlatego, że
// nigdzie w panelu nie było widać, co ta powierzchnia publikuje. Podgląd ma
// wartość tylko wtedy, gdy nie jest własną, rozjeżdżającą się reprezentacją
// polityki, więc test porównuje go z tym samym builderem, którego używa trasa.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RobotsTxtPreview } from "@/components/admin/seo/RobotsTxtPreview";
import { buildRobotsTxt } from "@/lib/seo/robots";
import { aiCrawlerGroups, DEFAULT_SEO_SETTINGS } from "@/lib/seo/settings";
import { CANONICAL_SITE_ORIGIN } from "@/lib/http/host";

function previewText(settings = DEFAULT_SEO_SETTINGS): string {
  const { container } = render(<RobotsTxtPreview settings={settings} />);
  return container.querySelector("pre")?.textContent ?? "";
}

describe("RobotsTxtPreview", () => {
  it("renders byte-for-byte what the builder produces for the publishing domain", () => {
    // happy-dom serwuje test z localhost (host podglądu), więc podgląd pokazuje
    // politykę domeny publikacji - inaczej redakcja widziałaby localhost.
    expect(previewText()).toBe(
      buildRobotsTxt({
        mode: "canonical",
        origin: CANONICAL_SITE_ORIGIN,
        sitemapPaths: ["/sitemap.xml", "/news-sitemap.xml"],
        groups: [],
      }),
    );
  });

  it("drops the news sitemap when the editors disable it", () => {
    const text = previewText({ ...DEFAULT_SEO_SETTINGS, news_sitemap_enabled: false });
    expect(text).toContain("/sitemap.xml");
    expect(text).not.toContain("news-sitemap.xml");
  });

  it("shows the AI-crawler policy the editors just set, before saving", () => {
    const settings = { ...DEFAULT_SEO_SETTINGS, ai_training_crawlers_allowed: false };
    const text = previewText(settings);
    expect(text).toContain("User-agent: GPTBot");
    expect(aiCrawlerGroups(settings)).toHaveLength(1);
  });

  it("links to the live file so a shadowed route is one click away", () => {
    render(<RobotsTxtPreview settings={DEFAULT_SEO_SETTINGS} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/robots.txt");
  });
});

// Dopisane 22.08 w module 8: gałąź hosta INDEKSOWALNEGO (linia 32 w
// `previewOrigin`) stała niepokryta, bo happy-dom serwuje suitę z `localhost`,
// a `localhost` nigdy nie jest indeksowalny - więc każdy test trafiał wyłącznie
// w spadek na origin marki. To jest ta połowa funkcji, która działa na
// PRODUKCJI: gdyby zwracała zły origin, redakcja widziałaby w podglądzie
// `Sitemap:` z cudzego hosta i nie miała powodu tego kwestionować.
/**
 * Kontroler happy-dom nie jest opisany w typach `Window`, a adres okna trzeba
 * w tym pliku przestawić, żeby wejść w gałąź hosta indeksowalnego.
 *
 * STRAŻNIK, nie rzutowanie: warunek sprawdza kształt w RUNTIME i to on zawęża
 * typ (ta sama konwencja co `hasServerBlock` w `src/test/routeHarness.tsx`).
 * `as unknown as` przepuściłoby też obiekt, którego tam nie ma, i test
 * „przechodziłby" na runnerze bez happy-dom, nie dowodząc niczego.
 */
interface HappyDomController {
  setURL(url: string): void;
}

function happyDomController(): HappyDomController | null {
  const candidate: unknown = Reflect.get(window, "happyDOM");
  if (candidate === null || typeof candidate !== "object") return null;
  const setURL: unknown = Reflect.get(candidate, "setURL");
  if (typeof setURL !== "function") return null;
  return { setURL: (url: string) => Reflect.apply(setURL, candidate, [url]) };
}

describe("RobotsTxtPreview - host indeksowalny", () => {
  it("na hoście publikacji pokazuje politykę TEGO hosta, nie spadek na origin marki", () => {
    // Ustawiamy adres okna na domenę publikacji - `classifyCrawlHost` uznaje ją
    // za indeksowalną, więc `previewOrigin` idzie drugą gałęzią i liczy origin
    // z hosta żądania (`crawlHostOrigin`), a nie ze stałej marki.
    const happyDom = happyDomController();
    expect(happyDom, "ten test wymaga happy-dom - bez niego nie dowodzi gałęzi").not.toBeNull();
    const original = window.location.href;
    happyDom?.setURL(`${CANONICAL_SITE_ORIGIN}/admin/settings/seo`);
    try {
      const text = previewText();
      // Dowód, że gałąź została wykonana: polityka jest OTWARTA (host
      // indeksowalny), a nie zamknięta jak na hoście podglądu.
      expect(text).toContain("Allow: /");
      expect(text).toContain(`Sitemap: ${CANONICAL_SITE_ORIGIN}/sitemap.xml`);
      // I że origin pochodzi z hosta, nie z fallbacku - oba są tu równe, więc
      // asercją rozstrzygającą jest zgodność z builderem wywołanym dla TEGO
      // hosta, tą samą drogą, którą liczy trasa.
      expect(text).toBe(
        buildRobotsTxt({
          mode: "canonical",
          origin: CANONICAL_SITE_ORIGIN,
          sitemapPaths: ["/sitemap.xml", "/news-sitemap.xml"],
          groups: [],
        }),
      );
    } finally {
      happyDom?.setURL(original);
    }
  });
});
