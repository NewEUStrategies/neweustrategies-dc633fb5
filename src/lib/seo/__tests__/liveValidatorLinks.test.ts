import { describe, expect, it } from "vitest";
import {
  facebookDebuggerUrl,
  googleResultUrl,
  linkedinInspectorUrl,
  livePageUrl,
} from "@/lib/seo/liveValidatorLinks";
import { SITE_CANONICAL_ORIGIN } from "@/lib/seo/meta";

/** Origin tenanta z własną domeną - adres musi iść za nim, nie za marką. */
const TENANT_ORIGIN = "https://analizy.example.org";

describe("liveValidatorLinks", () => {
  it("strona główna to sam origin marki", () => {
    expect(livePageUrl("", SITE_CANONICAL_ORIGIN)).toBe(SITE_CANONICAL_ORIGIN);
  });

  it("składa rzeczywisty adres z prefiksu językowego i ścieżki", () => {
    expect(livePageUrl("en/blog/post", SITE_CANONICAL_ORIGIN)).toBe(
      `${SITE_CANONICAL_ORIGIN}/en/blog/post`,
    );
  });

  it("pomija zaślepkę nierozwiązanej ścieżki nadrzędnej", () => {
    expect(livePageUrl("…/moj-wpis", SITE_CANONICAL_ORIGIN)).toBe(
      `${SITE_CANONICAL_ORIGIN}/moj-wpis`,
    );
  });

  it("adres idzie za originem TENANTA - walidatory nie trafiają na stronę marki", () => {
    expect(livePageUrl("", TENANT_ORIGIN)).toBe(TENANT_ORIGIN);
    expect(livePageUrl("en/blog/post", TENANT_ORIGIN)).toBe(`${TENANT_ORIGIN}/en/blog/post`);
    expect(livePageUrl("blog/post", TENANT_ORIGIN)).not.toContain("neweuropeanstrategies");
  });

  it("końcowy ukośnik originu nie podwaja się w adresie", () => {
    expect(livePageUrl("en", `${TENANT_ORIGIN}/`)).toBe(`${TENANT_ORIGIN}/en`);
    expect(livePageUrl("", `${TENANT_ORIGIN}//`)).toBe(TENANT_ORIGIN);
  });

  it("origin jest OBOWIĄZKOWY - brak domyślnej domeny marki", () => {
    // Domyślny `SITE_CANONICAL_ORIGIN` chował błąd wielonajemcowości: wywołanie
    // bez originu po cichu kierowało walidatory każdego tenanta na markę.
    // @ts-expect-error - wywołanie bez originu ma być błędem kompilacji.
    expect(() => livePageUrl("en")).toThrow();
  });

  it("wynik Google pyta o dokładnie ten adres", () => {
    const url = livePageUrl("en", SITE_CANONICAL_ORIGIN);
    expect(googleResultUrl(url)).toBe(
      `https://www.google.com/search?q=${encodeURIComponent(`site:${url}`)}`,
    );
  });

  it("walidatory Facebooka i LinkedIna dostają zakodowany adres", () => {
    const url = livePageUrl("blog/moj-wpis", SITE_CANONICAL_ORIGIN);
    expect(facebookDebuggerUrl(url)).toContain(encodeURIComponent(url));
    expect(linkedinInspectorUrl(url)).toBe(
      `https://www.linkedin.com/post-inspector/inspect/${encodeURIComponent(url)}`,
    );
  });
});
