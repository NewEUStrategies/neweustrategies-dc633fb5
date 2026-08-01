import { describe, expect, it } from "vitest";

import { buildRedirectIndex, matchRedirectForPath, type RedirectRule } from "@/lib/seo/redirects";

function rule(source: string, target: string, status = 301): RedirectRule {
  return { id: source, source_path: source, target_path: target, status_code: status };
}

const index = buildRedirectIndex([
  rule("/about-us", "/o-nas"),
  rule("/about-us/*", "/o-nas"),
  rule("/kategoria/*", "/category/*"),
  rule("/en/legacy-only", "/blog"),
  rule("/gone", "/", 410),
]);

describe("matchRedirectForPath", () => {
  it("matches the canonical (PL) path unchanged", () => {
    expect(matchRedirectForPath(index, "/about-us")?.target).toBe("/o-nas");
  });

  it("re-applies the language prefix to the destination", () => {
    const hit = matchRedirectForPath(index, "/en/about-us");
    expect(hit?.target).toBe("/en/o-nas");
    expect(hit?.statusCode).toBe(301);
  });

  it("keeps the language prefix on wildcard rules", () => {
    expect(matchRedirectForPath(index, "/en/about-us/martyna-luszczek")?.target).toBe("/en/o-nas");
    expect(matchRedirectForPath(index, "/en/kategoria/region/afryka")?.target).toBe(
      "/en/category/region/afryka",
    );
  });

  it("preserves the query string across the prefix rewrite", () => {
    expect(matchRedirectForPath(index, "/en/about-us", "?ref=nl")?.target).toBe("/en/o-nas?ref=nl");
  });

  it("prefers an explicit language-specific rule over the canonical one", () => {
    expect(matchRedirectForPath(index, "/en/legacy-only")?.target).toBe("/blog");
  });

  it("propagates 410 Gone without prefixing", () => {
    const hit = matchRedirectForPath(index, "/en/gone");
    expect(hit?.gone).toBe(true);
    expect(hit?.statusCode).toBe(410);
  });

  it("returns null when nothing matches", () => {
    expect(matchRedirectForPath(index, "/en/still-here")).toBeNull();
  });
});
