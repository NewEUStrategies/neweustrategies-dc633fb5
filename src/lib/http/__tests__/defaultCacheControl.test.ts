import { describe, expect, it } from "vitest";

import { liveCacheControl, planDefaultCacheControl } from "@/lib/http/defaultCacheControl";
import { PUBLIC_CONTENT_S_MAXAGE } from "@/lib/http/cachePolicy";

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
