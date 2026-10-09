// Przypisy w stylu chicagowskim, bezpieczny adres źródła i parser źródeł.
import { describe, expect, it } from "vitest";
import {
  chicagoBibliographyHtml,
  chicagoBibliographyText,
  safeSourceUrl,
  type ChartSource,
} from "@/lib/charts/sources";
import { parseChartBand, parseChartConfig, parseChartSources } from "@/lib/charts/parse";

const RAPORT: ChartSource = {
  id: "s1",
  author: "Eurostat",
  title: "Labour market flash report 2026",
  container: "",
  publisher: "Publications Office of the EU",
  published: "2026-03-14",
  accessed: "2026-10-09",
  url: "https://ec.europa.eu/eurostat/web/products-flash",
  reliability: "A",
};

const ARTYKUL: ChartSource = {
  ...RAPORT,
  author: "Walton, Philip",
  title: "Web Vitals",
  container: "web.dev",
  publisher: "Google",
  url: "https://web.dev/articles/vitals",
};

describe("opis bibliograficzny - Chicago", () => {
  it("dzieło samodzielne: tytuł bez cudzysłowu, w HTML kursywą", () => {
    expect(chicagoBibliographyText(RAPORT, "pl")).toBe(
      "Eurostat. Labour market flash report 2026. Publications Office of the EU, 2026-03-14. Dostęp 2026-10-09. https://ec.europa.eu/eurostat/web/products-flash.",
    );
    expect(chicagoBibliographyHtml(RAPORT, "pl")).toContain(
      "<em>Labour market flash report 2026</em>",
    );
  });

  it("tekst w całości: tytuł w cudzysłowie zgodnym z językiem, w HTML jako <q>", () => {
    expect(chicagoBibliographyText(ARTYKUL, "pl")).toContain("„Web Vitals”. web.dev.");
    expect(chicagoBibliographyText(ARTYKUL, "en")).toContain("“Web Vitals”. web.dev.");
    expect(chicagoBibliographyText(ARTYKUL, "en")).toContain("Accessed 2026-10-09.");
    expect(chicagoBibliographyHtml(ARTYKUL, "pl")).toContain("<q>Web Vitals</q>");
  });

  it("brakujące pola znikają razem z separatorem - bez „. .”", () => {
    const krotki: ChartSource = {
      ...RAPORT,
      author: "",
      publisher: "",
      published: "",
      accessed: "",
      url: "",
    };
    expect(chicagoBibliographyText(krotki, "pl")).toBe("Labour market flash report 2026.");
  });

  it("HTML ucieka znaki i linkuje WYŁĄCZNIE http(s)", () => {
    const zly: ChartSource = {
      ...RAPORT,
      title: "<img src=x onerror=alert(1)>",
      url: "javascript:alert(1)",
    };
    const html = chicagoBibliographyHtml(zly, "pl");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("href=");
    expect(chicagoBibliographyHtml(RAPORT, "pl")).toContain(
      'href="https://ec.europa.eu/eurostat/web/products-flash"',
    );
  });

  it("safeSourceUrl przepuszcza tylko http(s)", () => {
    expect(safeSourceUrl("https://example.org/a")).toBe("https://example.org/a");
    expect(safeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(safeSourceUrl("nie adres")).toBeNull();
    expect(safeSourceUrl("")).toBeNull();
  });
});

describe("parser źródeł i odniesień", () => {
  it("wpis bez tytułu i adresu odpada, identyfikator jest uzupełniany i unikalny", () => {
    const out = parseChartSources([
      { title: "A" },
      { author: "Bez tytułu" },
      { id: "x", url: "https://example.org" },
      { id: "x", title: "Duplikat" },
      { title: "B", reliability: "Z" },
    ]);
    expect(out.map((s) => s.title || s.url)).toEqual(["A", "https://example.org", "Duplikat", "B"]);
    expect(new Set(out.map((s) => s.id)).size).toBe(out.length);
    expect(out[3].reliability).toBeNull();
  });

  it("pasmo z odwróconymi krawędziami jest prostowane, bez krawędzi - nie istnieje", () => {
    expect(parseChartBand({ min: 4, max: 2 })).toEqual({
      min: 2,
      max: 4,
      sourceId: null,
      demo: false,
    });
    expect(parseChartBand({ min: 2 })).toBeNull();
  });

  it("konfiguracja bez klucza palety dostaje paletę ról, a jawna kategorialna zostaje", () => {
    expect(parseChartConfig({}).palette).toBe("focus");
    expect(parseChartConfig({ palette: "categorical" }).palette).toBe("categorical");
    expect(parseChartConfig({ palette: "neon" }).palette).toBe("focus");
  });

  it("cel przyjmuje obiekt z bloku i liczbę z widgetu", () => {
    expect(parseChartConfig({ target: { value: 5 } }).target).toEqual({ value: 5 });
    expect(parseChartConfig({ target: "3,5" }).target).toEqual({ value: 3.5 });
    expect(parseChartConfig({ target: "" }).target).toBeNull();
  });
});
