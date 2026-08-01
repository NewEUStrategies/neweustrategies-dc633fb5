import { describe, expect, it } from "vitest";

import { normalizeLangCode, resolveAuthEmailLang } from "./auth-lang";

describe("normalizeLangCode", () => {
  it("accepts supported codes in any casing/region form", () => {
    expect(normalizeLangCode("en")).toBe("en");
    expect(normalizeLangCode("EN")).toBe("en");
    expect(normalizeLangCode("en-GB")).toBe("en");
    expect(normalizeLangCode("pl_PL")).toBe("pl");
    expect(normalizeLangCode("  pl ")).toBe("pl");
  });

  it("rejects unsupported or non-string values", () => {
    expect(normalizeLangCode("de")).toBeNull();
    expect(normalizeLangCode("")).toBeNull();
    expect(normalizeLangCode(42)).toBeNull();
    expect(normalizeLangCode(null)).toBeNull();
  });
});

describe("resolveAuthEmailLang", () => {
  it("uses an explicit lang param first", () => {
    const r = resolveAuthEmailLang({
      redirectTo: "https://neweuropeanstrategies.com/konto?lang=en",
      actionUrl: "https://x.supabase.co/auth/v1/verify?redirect_to=%2Fpl%2Fkonto",
      userMetadata: { locale: "pl" },
      acceptLanguage: "pl-PL",
    });
    expect(r).toMatchObject({ lang: "en", source: "param", usedFallback: false });
  });

  it("normalises regional param values", () => {
    const r = resolveAuthEmailLang({ redirectTo: "/konto?lang=EN-gb" });
    expect(r.lang).toBe("en");
    expect(r.source).toBe("param");
  });

  it("falls back to the path prefix when the param is unknown", () => {
    const r = resolveAuthEmailLang({
      redirectTo: "https://neweuropeanstrategies.com/en/account?lang=de",
    });
    expect(r.lang).toBe("en");
    expect(r.source).toBe("path");
    expect(r.unknownParam).toBe(true);
  });

  it("reads the language from an encoded redirect inside the action url", () => {
    const r = resolveAuthEmailLang({
      redirectTo: null,
      actionUrl:
        "https://x.supabase.co/auth/v1/verify?token=abc&redirect_to=https%3A%2F%2Fneweuropeanstrategies.com%2Fen%2Fkonto",
    });
    expect(r.lang).toBe("en");
    expect(r.source).toBe("path");
  });

  it("falls back to user metadata when the url carries no language", () => {
    const r = resolveAuthEmailLang({
      redirectTo: "https://neweuropeanstrategies.com/konto",
      userMetadata: { preferred_language: "en-US" },
    });
    expect(r).toMatchObject({ lang: "en", source: "metadata", usedFallback: false });
  });

  it("falls back to Accept-Language honouring q-values", () => {
    const r = resolveAuthEmailLang({
      redirectTo: "/konto",
      acceptLanguage: "de-DE,de;q=0.9,en;q=0.8,pl;q=0.7",
    });
    expect(r).toMatchObject({ lang: "en", source: "header" });
  });

  it("defaults to PL when nothing is known", () => {
    const r = resolveAuthEmailLang({});
    expect(r).toMatchObject({
      lang: "pl",
      source: "default",
      usedFallback: true,
      rawValue: null,
    });
  });

  it("defaults to PL for a fully unknown language everywhere", () => {
    const r = resolveAuthEmailLang({
      redirectTo: "https://neweuropeanstrategies.com/konto?lang=fr",
      userMetadata: { locale: "fr-FR" },
      acceptLanguage: "fr-FR,fr;q=0.9",
    });
    expect(r).toMatchObject({ lang: "pl", source: "default", unknownParam: true });
  });

  it("never throws on malformed urls", () => {
    expect(() => resolveAuthEmailLang({ redirectTo: "%%%?lang=%E0%A4%A" })).not.toThrow();
    expect(resolveAuthEmailLang({ redirectTo: "%%%" }).lang).toBe("pl");
  });

  it("does not treat /pl-like words as a path prefix", () => {
    const r = resolveAuthEmailLang({ redirectTo: "https://neweuropeanstrategies.com/plany" });
    expect(r.source).toBe("default");
    expect(r.lang).toBe("pl");
  });
});
