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
import { buildLlmsTxt } from "@/lib/seo/llms";
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
    expect(txt).toContain("## Zasady cytowania / Citation policy");
  });

  it("emits every resource as a markdown bullet with a label", () => {
    for (const resource of llmsTxtResourceLines(ORIGIN, localizedPath)) {
      expect(txt).toContain(`- ${resource.label}: ${resource.url}`);
    }
  });

  it("never advertises robots.txt or llms.txt itself as a resource", () => {
    // llms.txt opisuje ZASOBY, nie sam siebie; robots.txt nie jest zasobem
    // treściowym dla modelu (jest polityką dla crawlera).
    const resourceBlock = txt.split("## Zasoby maszynowe")[1] ?? "";
    const citationSplit = resourceBlock.split("## Zasady cytowania")[0] ?? "";
    expect(citationSplit).not.toContain("/llms.txt");
    expect(citationSplit).not.toContain("/robots.txt");
  });
});
