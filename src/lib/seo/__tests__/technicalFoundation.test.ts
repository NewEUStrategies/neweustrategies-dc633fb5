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
  checkSitemap,
  worstFoundationState,
} from "../technicalFoundation";

describe("checkSitemap", () => {
  it("uznaje <sitemapindex> za poprawną mapę i liczy shardy", () => {
    const check = checkSitemap({
      status: 200,
      body: "<sitemapindex><sitemap><loc>a</loc></sitemap><sitemap><loc>b</loc></sitemap></sitemapindex>",
    });
    expect(check.state).toBe("ok");
    expect(check.detailKey).toBe("foundationSitemapIndex");
    expect(check.detailValue).toBe(2);
  });

  it("liczy adresy w płaskim <urlset>", () => {
    const check = checkSitemap({
      status: 200,
      body: "<urlset><url><loc>a</loc></url></urlset>",
    });
    expect(check.state).toBe("ok");
    expect(check.detailValue).toBe(1);
  });

  it("pusta mapa to ostrzeżenie, nie sukces", () => {
    expect(checkSitemap({ status: 200, body: "<urlset></urlset>" }).state).toBe("warn");
  });

  it("odpowiedź inna niż XML mapy to błąd", () => {
    expect(checkSitemap({ status: 200, body: "<html></html>" }).detailKey).toBe(
      "foundationSitemapMalformed",
    );
    expect(checkSitemap({ status: 404, body: "" }).state).toBe("fail");
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
