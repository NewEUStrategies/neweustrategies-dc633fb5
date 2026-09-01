import { describe, expect, it } from "vitest";

import { liveCacheControl, planDefaultCacheControl } from "@/lib/http/defaultCacheControl";
import {
  cacheControlHeader,
  contentCacheControl,
  PUBLIC_CONTENT_S_MAXAGE,
} from "@/lib/http/cachePolicy";

const NO_STORE = cacheControlHeader({ cacheable: false });

function req(path: string, headers: Record<string, string> = {}, method = "GET") {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    method,
    url: `https://tenant-a.eu${path}`,
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
  };
}

function res(status = 200, headers: Record<string, string> = { "content-type": "text/html" }) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
  };
}

describe("planDefaultCacheControl", () => {
  it("nadaje publiczną politykę dokumentowi HTML bez własnego nagłówka", () => {
    const value = planDefaultCacheControl(req("/category/geopolityka"), res());
    expect(value).toContain("public");
    expect(value).toContain(`s-maxage=${PUBLIC_CONTENT_S_MAXAGE}`);
  });

  it("obejmuje trasy z prefiksem językowym (EN pod /en)", () => {
    expect(planDefaultCacheControl(req("/en/tag/nato"), res())).toContain("public");
  });

  it("nigdy nie nadpisuje nagłówka ustawionego przez trasę (w tym no-store)", () => {
    const withOwn = res(200, {
      "content-type": "text/html",
      "cache-control": "private, no-store",
    });
    expect(planDefaultCacheControl(req("/category/x"), withOwn)).toBeNull();
  });

  it("pomija odpowiedzi nie-200 i nie-HTML", () => {
    expect(planDefaultCacheControl(req("/category/x"), res(404))).toBeNull();
    expect(
      planDefaultCacheControl(
        req("/api-adjacent"),
        res(200, { "content-type": "application/json" }),
      ),
    ).toBeNull();
  });

  it("pomija metody inne niż GET oraz żądania z sesją", () => {
    expect(planDefaultCacheControl(req("/category/x", {}, "POST"), res())).toBeNull();
    expect(
      planDefaultCacheControl(req("/category/x", { authorization: "Bearer t" }), res()),
    ).toBeNull();
    expect(
      planDefaultCacheControl(req("/category/x", { cookie: "sb-access-token=abc" }), res()),
    ).toBeNull();
  });

  it("respektuje deny-listę powierzchni zalogowanych/transakcyjnych", () => {
    for (const path of ["/admin/posts", "/profile", "/checkout/plan", "/en/admin", "/preview/t"]) {
      expect(planDefaultCacheControl(req(path), res())).toBeNull();
    }
  });

  it("pomija ścieżki zasobów z rozszerzeniem (własne polityki feedów/sitemap)", () => {
    expect(planDefaultCacheControl(req("/rss.xml"), res())).toBeNull();
    expect(planDefaultCacheControl(req("/sitemap.xml"), res())).toBeNull();
  });

  it("nadaje relacjom live krótką świeżość zamiast pełnej polityki treści", () => {
    const value = planDefaultCacheControl(req("/live"), res());
    expect(value).toBe(liveCacheControl());
    expect(value).toContain("s-maxage=30");
    const en = planDefaultCacheControl(req("/en/live"), res());
    expect(en).toBe(liveCacheControl());
  });
});

// Trzeci argument: intencja cache'owa TRASY, przeniesiona poza nagłówkami
// zdarzenia h3 (patrz `lib/http/responseHeaders.ts` - `routeCacheDirectives`).
// Bez niej decyzja loadera nie docierała ani do polityki ZAPISU w NES Edge
// Cache (dokument zdegradowany zamarzał na brzegu na 24 h), ani - dla odpowiedzi
// non-ok - do klienta.
describe("planDefaultCacheControl - dyrektywa trasy", () => {
  it("opt-out renderu zdegradowanego wygrywa z polityką domyślną", () => {
    expect(planDefaultCacheControl(req("/blog"), res(), NO_STORE)).toBe(NO_STORE);
  });

  it("opt-out dociera także do 301/302/404, gdzie h3 nie scala nagłówków zdarzenia", () => {
    // ZMIERZONE na prawdziwym potoku: `setCacheControlHeader` w loaderze daje
    // na drucie `null` przy 302 i 404, bo `prepareResponse` scala nagłówki
    // zdarzenia tylko dla `val.ok`. Trwałe 301 wychodziło więc BEZ ŻADNEJ
    // dyrektywy cache - wbrew jawnej intencji czterech tras.
    const redirect = res(302, { location: "/blog" });
    expect(planDefaultCacheControl(req("/stary-adres"), redirect, NO_STORE)).toBe(NO_STORE);
    expect(planDefaultCacheControl(req("/nie-ma"), res(404), NO_STORE)).toBe(NO_STORE);
  });

  it("opt-out nie jest blokowany przez brak typu HTML ani przez rozszerzenie", () => {
    const json = res(200, { "content-type": "application/json" });
    expect(planDefaultCacheControl(req("/api-adjacent"), json, NO_STORE)).toBe(NO_STORE);
    expect(planDefaultCacheControl(req("/rss.xml"), res(), NO_STORE)).toBe(NO_STORE);
  });

  it("opt-out nie nadpisuje odpowiedzi, która JUŻ niesie no-store", () => {
    const own = res(200, { "content-type": "text/html", "cache-control": "no-store" });
    expect(planDefaultCacheControl(req("/blog"), own, NO_STORE)).toBeNull();
  });

  it("dyrektywa `public` NIE obchodzi bariery żądań sesyjnych", () => {
    const clean = contentCacheControl();
    expect(
      planDefaultCacheControl(req("/blog", { authorization: "Bearer t" }), res(), clean),
    ).toBeNull();
    expect(
      planDefaultCacheControl(req("/blog", { cookie: "sb-access-token=abc" }), res(), clean),
    ).toBeNull();
  });

  it("dyrektywa `public` NIE obchodzi deny-listy ani rozszerzeń", () => {
    const clean = contentCacheControl();
    expect(planDefaultCacheControl(req("/profile"), res(), clean)).toBeNull();
    expect(planDefaultCacheControl(req("/rss.xml"), res(), clean)).toBeNull();
  });

  it("czysta dyrektywa trasy wygrywa z domyślną polityką treści", () => {
    const own = cacheControlHeader({ cacheable: true, browserMaxAge: 5, sharedMaxAge: 10 });
    expect(planDefaultCacheControl(req("/blog"), res(), own)).toBe(own);
  });

  it("POWIERZCHNIA ŻYWA wyprzedza czystą dyrektywę trasy", () => {
    // Strona CMS opublikowana pod /live/<slug> jedzie przez `$.tsx`, który
    // deklaruje politykę TREŚCI (180 s świeżości w magazynie). Gdyby dyrektywa
    // wygrywała ze ścieżką, wpis zamarzałby na 180 s zamiast 30 s - dokładnie
    // ten defekt, który ta warstwa naprawia, tylko wejściem po ścieżce.
    expect(planDefaultCacheControl(req("/live/szczyt-ue"), res(), contentCacheControl())).toBe(
      liveCacheControl(),
    );
  });
});
