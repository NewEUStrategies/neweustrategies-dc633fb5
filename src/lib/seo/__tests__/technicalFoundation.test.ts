// Reguły fundamentów technicznych - zero sieci, same czyste funkcje.
//
// Dwa zgłoszenia zewnętrznego skanera („brak mapy strony", „html bez lang")
// dotyczyły powierzchni, które w serwisie ISTNIEJĄ. Te przypadki pilnują, żeby
// panel odpowiadał na nie stanem faktycznym: indeks mapy jest poprawną mapą,
// a pusty `lang=""` liczy się jako brak atrybutu.
import { describe, expect, it } from "vitest";
import {
  checkHtmlLang,
  checkLlms,
  checkRobots,
  checkSitemapFiles,
  worstFoundationState,
} from "../technicalFoundation";
import { validateSitemapDocument } from "../sitemapValidation";

// NAPRAWA 2026-10-10: reguła mapy strony ocenia KAŻDY plik (indeks + pliki
// sekcji), nie liczbę `<sitemap>` w indeksie. Poprzednia wersja raportowała
// „OK - 6 plików sekcji", gdy Search Console miał błędy w dwóch z nich.
describe("checkSitemapFiles", () => {
  const ORIGIN = "https://neweuropeanstrategies.com";
  const NS = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
  const file = (url: string, body: string, status = 200) =>
    validateSitemapDocument({ url, status, body, now: Date.parse("2026-10-10T12:00:00Z") });
  const index = file(
    `${ORIGIN}/sitemap.xml`,
    `<sitemapindex ${NS}><sitemap><loc>${ORIGIN}/sitemaps/core.xml</loc></sitemap><sitemap><loc>${ORIGIN}/news-sitemap.xml</loc></sitemap></sitemapindex>`,
  );
  const core = file(
    `${ORIGIN}/sitemaps/core.xml`,
    `<urlset ${NS}><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/blog</loc></url></urlset>`,
  );

  it("indeks i każdy plik poprawne -> OK z liczbą plików i adresów", () => {
    const news = file(
      `${ORIGIN}/news-sitemap.xml`,
      `<urlset ${NS}><url><loc>${ORIGIN}/a</loc></url></urlset>`,
    );
    const check = checkSitemapFiles([index, core, news]);
    expect(check.state).toBe("ok");
    expect(check.detailKey).toBe("foundationSitemapIndexValid");
    expect(check.detailParams).toEqual({ files: 2, urls: 3 });
  });

  it("jeden pusty plik sekcji (pusty urlset jak news-sitemap) -> błąd CAŁEJ mapy", () => {
    const emptyNews = file(
      `${ORIGIN}/news-sitemap.xml`,
      `<urlset ${NS} xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n</urlset>`,
    );
    const check = checkSitemapFiles([index, core, emptyNews]);
    expect(check.state).toBe("fail");
    expect(check.detailKey).toBe("foundationSitemapFilesFailed");
    expect(check.detailParams).toEqual({ failed: 1, total: 3 });
  });

  it("plik sekcji bez odpowiedzi (status 0) też jest błędem mapy", () => {
    const check = checkSitemapFiles([index, file(`${ORIGIN}/sitemaps/core.xml`, "", 0)]);
    expect(check.state).toBe("fail");
  });

  it("płaski <urlset> zamiast indeksu jest poprawny", () => {
    const check = checkSitemapFiles([core]);
    expect(check.state).toBe("ok");
    expect(check.detailKey).toBe("foundationSitemapUrlsetValid");
    expect(check.detailParams).toEqual({ urls: 2 });
  });

  it("indeks niedostępny -> błąd HTTP; brak raportów -> brak danych", () => {
    const check = checkSitemapFiles([file(`${ORIGIN}/sitemap.xml`, "", 404)]);
    expect(check).toEqual(
      expect.objectContaining({ state: "fail", detailKey: "foundationHttp", detailValue: 404 }),
    );
    expect(checkSitemapFiles([]).state).toBe("unknown");
  });
});

describe("checkRobots", () => {
  it("wymaga deklaracji Sitemap:", () => {
    expect(checkRobots({ status: 200, body: "User-agent: *\nAllow: /" }).state).toBe("warn");
    const ok = checkRobots({
      status: 200,
      body: "User-agent: *\nSitemap: https://x/sitemap.xml\nSitemap: https://x/news-sitemap.xml",
    });
    expect(ok.state).toBe("ok");
    expect(ok.detailValue).toBe(2);
  });
});

describe("checkLlms", () => {
  it("404 to informacja o wyłączeniu, nie awaria", () => {
    expect(checkLlms({ status: 404, body: "" }).state).toBe("warn");
    expect(checkLlms({ status: 200, body: "# llms" }).state).toBe("ok");
    expect(checkLlms({ status: 500, body: "" }).state).toBe("fail");
  });
});

describe("checkHtmlLang", () => {
  it("czyta zadeklarowany język", () => {
    const check = checkHtmlLang({ status: 200, body: '<!DOCTYPE html><html lang="pl"><head>' });
    expect(check.state).toBe("ok");
    expect(check.detailValue).toBe("pl");
  });

  it("pusty lang liczy się jako brak", () => {
    expect(checkHtmlLang({ status: 200, body: '<html lang="">' }).detailKey).toBe(
      "foundationLangMissing",
    );
    expect(checkHtmlLang({ status: 200, body: "<html>" }).state).toBe("fail");
  });
});

describe("worstFoundationState", () => {
  it("błąd wygrywa z ostrzeżeniem, a ostrzeżenie z OK", () => {
    expect(
      worstFoundationState([
        { id: "a", state: "ok", detailKey: "x" },
        { id: "b", state: "warn", detailKey: "x" },
        { id: "c", state: "fail", detailKey: "x" },
      ]),
    ).toBe("fail");
    expect(worstFoundationState([{ id: "a", state: "ok", detailKey: "x" }])).toBe("ok");
  });
});
