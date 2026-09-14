import { describe, expect, it } from "vitest";
import {
  facebookDebuggerUrl,
  googleResultUrl,
  linkedinInspectorUrl,
  livePageUrl,
} from "@/lib/seo/liveValidatorLinks";
import { SITE_CANONICAL_ORIGIN } from "@/lib/seo/meta";

describe("liveValidatorLinks", () => {
  it("strona główna to sam origin marki", () => {
    expect(livePageUrl("")).toBe(SITE_CANONICAL_ORIGIN);
  });

  it("składa rzeczywisty adres z prefiksu językowego i ścieżki", () => {
    expect(livePageUrl("en/blog/post")).toBe(`${SITE_CANONICAL_ORIGIN}/en/blog/post`);
  });

  it("pomija zaślepkę nierozwiązanej ścieżki nadrzędnej", () => {
    expect(livePageUrl("…/moj-wpis")).toBe(`${SITE_CANONICAL_ORIGIN}/moj-wpis`);
  });

  it("wynik Google pyta o dokładnie ten adres", () => {
    const url = livePageUrl("en");
    expect(googleResultUrl(url)).toBe(
      `https://www.google.com/search?q=${encodeURIComponent(`site:${url}`)}`,
    );
  });

  it("walidatory Facebooka i LinkedIna dostają zakodowany adres", () => {
    const url = livePageUrl("blog/moj-wpis");
    expect(facebookDebuggerUrl(url)).toContain(encodeURIComponent(url));
    expect(linkedinInspectorUrl(url)).toBe(
      `https://www.linkedin.com/post-inspector/inspect/${encodeURIComponent(url)}`,
    );
  });
});
