// TEST KONTRAKTU TREŚCI llms.txt - brakujące ogniwo audytu.
//
// robots.txt i sitemapa miały testy kontraktu, llms.txt nie: builder był
// przetestowany (llms.test.ts sprawdza STRUKTURĘ), ale nikt nie pilnował, CO
// ten plik ogłasza. Skutek był przewidywalny - nowe powierzchnie maszynowe
// (feed podcastu, tracker, relacje live) nie trafiały do sekcji "Zasoby
// maszynowe", więc modele i wyszukiwarki AI ich nie widziały, mimo że trasy
// istniały.
//
// Ten test jest DWUKIERUNKOWY, i to jest w nim istotne:
//   1. każdy wpis rejestru ma realny plik trasy (rejestr nie kłamie),
//   2. każda trasa wyglądająca na powierzchnię maszynową JEST w rejestrze albo
//      jawnie oznaczona jako feed per-element (nie da się dodać feedu po cichu),
//   3. llms.txt faktycznie publikuje wszystkie zadeklarowane adresy.
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { localizedPath } from "@/lib/i18n/localePath";
import { buildLlmsTxt, LLMS_TXT_USAGE_TERMS_LABEL } from "@/lib/seo/llms";
import {
  MACHINE_SURFACES,
  PER_ITEM_FEED_ROUTE_FILES,
  llmsTxtResourceLines,
} from "@/lib/seo/machineSurfaces";

const ROUTES_DIR = join(process.cwd(), "src/routes");
const ORIGIN = "https://nes.example";

/** Pliki tras, które wyglądają na powierzchnię maszynową (feed/mapa/manifest). */
function machineRouteFiles(): string[] {
  return readdirSync(ROUTES_DIR).filter((file) => {
    if (file.startsWith("-") || file.startsWith("admin.")) return false;
    if (!/\.tsx?$/.test(file)) return false;
    return /(rss|feed|sitemap|sitemaps|llms|robots)/i.test(file);
  });
}

describe("machine-readable surface registry", () => {
  it("points every entry at a route file that exists", () => {
    for (const surface of MACHINE_SURFACES) {
      expect(
        existsSync(join(ROUTES_DIR, surface.routeFile)),
        `${surface.path} -> brak pliku trasy ${surface.routeFile}`,
      ).toBe(true);
    }
  });

  it("registers every machine-readable route (no silent new feeds)", () => {
    const known = new Set([
      ...MACHINE_SURFACES.map((s) => s.routeFile),
      ...PER_ITEM_FEED_ROUTE_FILES,
    ]);
    const unregistered = machineRouteFiles().filter((file) => !known.has(file));
    expect(
      unregistered,
      "Nowa powierzchnia maszynowa musi trafić do MACHINE_SURFACES (globalna) " +
        "albo do PER_ITEM_FEED_ROUTE_FILES (feed per element).",
    ).toEqual([]);
  });

  it("uses absolute, origin-prefixed paths", () => {
    for (const surface of MACHINE_SURFACES) {
      expect(surface.path.startsWith("/"), surface.path).toBe(true);
      expect(surface.path).not.toContain("://");
    }
  });
});

describe("llms.txt content contract", () => {
  const txt = buildLlmsTxt({
    siteName: "New European Strategies",
    origin: ORIGIN,
    descriptionPl: "Think-tank.",
    descriptionEn: "A think-tank.",
    sections: [],
    latestPl: [],
    latestEn: [],
    resources: llmsTxtResourceLines(ORIGIN, localizedPath),
    usage: { aiInputAllowed: true, trainingAllowed: true },
  });

  it("advertises every registered machine-readable surface", () => {
    for (const surface of MACHINE_SURFACES) {
      if (!surface.inLlmsTxt) continue;
      if (surface.localized) {
        expect(txt, `${surface.path} (PL)`).toContain(
          `${ORIGIN}${localizedPath(surface.path, "pl")}`,
        );
        expect(txt, `${surface.path} (EN)`).toContain(
          `${ORIGIN}${localizedPath(surface.path, "en")}`,
        );
      } else {
        expect(txt, surface.path).toContain(`${ORIGIN}${surface.path}`);
      }
    }
  });

  it("names the sitemap index, news sitemap and all content feeds", () => {
    // Konkretne adresy, których brak był realnym findingiem audytu.
    expect(txt).toContain(`${ORIGIN}/sitemap.xml`);
    expect(txt).toContain(`${ORIGIN}/news-sitemap.xml`);
    expect(txt).toContain(`${ORIGIN}/rss.xml`);
    expect(txt).toContain(`${ORIGIN}/en/rss.xml`);
    expect(txt).toContain(`${ORIGIN}/podcast/rss.xml`);
    expect(txt).toContain(`${ORIGIN}/tracker/rss.xml`);
    expect(txt).toContain(`${ORIGIN}/live/rss.xml`);
  });

  it("keeps the llmstxt.org shape: H1, blockquote summary and resource section", () => {
    expect(txt.startsWith("# New European Strategies\n")).toBe(true);
    expect(txt).toContain("> Think-tank.");
    expect(txt).toContain("## Zasoby maszynowe / Machine-readable resources");
    // Warunki to zdania, nie lista odnośników - od 2026-10 stoją w treści
    // swobodnej NAD pierwszym `##` (llmstxt.org rezerwuje `##` na listy).
    expect(txt).toContain(LLMS_TXT_USAGE_TERMS_LABEL);
    expect(txt.indexOf(LLMS_TXT_USAGE_TERMS_LABEL)).toBeLessThan(txt.indexOf("\n## "));
    // Warunek wskazania źródła musi stać w pliku rozkazująco - to jedyny zapis,
    // który model widzi razem z treścią, którą właśnie zaciąga.
    expect(txt).toContain("MUSI wskazać");
    expect(txt).toContain("MUST name");
  });

  it("emits every resource as a markdown link with the label as its title", () => {
    // 2026-10: `- Etykieta: https://...` nie jest pozycją listy plików
    // llmstxt.org - parser referencyjny odrzucał przez to cały dokument.
    for (const resource of llmsTxtResourceLines(ORIGIN, localizedPath)) {
      expect(txt).toContain(`- [${resource.label}](${resource.url})\n`);
    }
  });

  it("never advertises robots.txt or llms.txt itself as a resource", () => {
    // llms.txt opisuje ZASOBY, nie sam siebie; robots.txt nie jest zasobem
    // treściowym dla modelu (jest polityką dla crawlera).
    const resourceBlock = (txt.split("## Zasoby maszynowe")[1] ?? "").split(/^## /m)[0] ?? "";
    expect(resourceBlock).not.toContain("/llms.txt");
    expect(resourceBlock).not.toContain("/robots.txt");
  });
});

describe("przełączniki redakcji w rejestrze - llms.txt nie ogłasza 404", () => {
  // Każdy kanał RSS odpowiada 404 przy wyłączonym `rss_enabled`, news-sitemapa
  // przy `news_sitemap_enabled: false`. Trasa llms.txt odcina je filtrem po
  // polu `setting` - wpis bez tego pola byłby ogłaszany także wtedy.
  it("każdy kanał RSS z rejestru niesie `rss_enabled`, news-sitemapa `news_sitemap_enabled`", () => {
    for (const surface of MACHINE_SURFACES) {
      if (/rss/i.test(surface.routeFile)) {
        expect(surface.setting, surface.path).toBe("rss_enabled");
      } else if (surface.path === "/news-sitemap.xml") {
        expect(surface.setting).toBe("news_sitemap_enabled");
      } else {
        expect(surface.setting, surface.path).toBeUndefined();
      }
    }
  });

  it("filtr `include` odcina warianty per język i adresy wspólne", () => {
    const lines = llmsTxtResourceLines(
      ORIGIN,
      localizedPath,
      (surface, lang) =>
        surface.setting !== "news_sitemap_enabled" &&
        !(surface.path === "/live/rss.xml" && lang === "en"),
    );
    const urls = lines.map((l) => l.url);
    expect(urls).not.toContain(`${ORIGIN}/news-sitemap.xml`);
    expect(urls).not.toContain(`${ORIGIN}/en/live/rss.xml`);
    expect(urls).toContain(`${ORIGIN}/live/rss.xml`);
    expect(urls).toContain(`${ORIGIN}/sitemap.xml`);
    expect(lines).toHaveLength(llmsTxtResourceLines(ORIGIN, localizedPath).length - 2);
  });
});
