import { describe, it, expect } from "vitest";
import {
  DEFAULT_LANG,
  PREFIXED_LANGS,
  SUPPORTED_LANGS,
  addLangPrefix,
  isAppLang,
  isLocalizablePath,
  localizedPath,
  normalizeLang,
  stripLangPrefix,
} from "./localePath";

describe("language constants", () => {
  it("treats PL as the default (unprefixed) language and EN as prefixed", () => {
    expect(DEFAULT_LANG).toBe("pl");
    expect(SUPPORTED_LANGS).toEqual(["pl", "en"]);
    expect(PREFIXED_LANGS).toEqual(["en"]);
  });
});

describe("isAppLang / normalizeLang", () => {
  it("narrows only supported codes", () => {
    expect(isAppLang("pl")).toBe(true);
    expect(isAppLang("en")).toBe(true);
    expect(isAppLang("de")).toBe(false);
    expect(isAppLang(null)).toBe(false);
  });
  it("normalizes region tags and casing, rejecting the unknown", () => {
    expect(normalizeLang("en-US")).toBe("en");
    expect(normalizeLang("PL")).toBe("pl");
    expect(normalizeLang("fr")).toBeNull();
    expect(normalizeLang(undefined)).toBeNull();
  });
});

describe("isLocalizablePath", () => {
  it("treats public content paths as localizable", () => {
    expect(isLocalizablePath("/")).toBe(true);
    expect(isLocalizablePath("/post/foo")).toBe(true);
    expect(isLocalizablePath("/blog")).toBe(true);
    expect(isLocalizablePath("/analizy/raport")).toBe(true);
  });
  it("excludes app/system surfaces", () => {
    expect(isLocalizablePath("/admin")).toBe(false);
    expect(isLocalizablePath("/admin/posts")).toBe(false);
    expect(isLocalizablePath("/api/public/vitals")).toBe(false);
    expect(isLocalizablePath("/profile/billing")).toBe(false);
    expect(isLocalizablePath("/checkout/pro")).toBe(false);
    expect(isLocalizablePath("/login")).toBe(false);
    expect(isLocalizablePath("/sitemap.xml")).toBe(false);
    expect(isLocalizablePath("/robots.txt")).toBe(false);
  });
  it("does not treat a lookalike content path as a system path", () => {
    // "/administracja" is content, not "/admin".
    expect(isLocalizablePath("/administracja")).toBe(true);
    expect(isLocalizablePath("/logink")).toBe(true);
  });
});

describe("stripLangPrefix", () => {
  it("extracts a leading language segment", () => {
    expect(stripLangPrefix("/en/post/foo")).toEqual({ lang: "en", pathname: "/post/foo" });
    expect(stripLangPrefix("/en")).toEqual({ lang: "en", pathname: "/" });
    expect(stripLangPrefix("/en/")).toEqual({ lang: "en", pathname: "/" });
  });
  it("leaves an unprefixed (default-language) path untouched", () => {
    expect(stripLangPrefix("/post/foo")).toEqual({ lang: null, pathname: "/post/foo" });
    expect(stripLangPrefix("/")).toEqual({ lang: null, pathname: "/" });
  });
  it("does not mistake a lookalike segment for a language prefix", () => {
    // "/english" must not be read as language "en" + "/glish".
    expect(stripLangPrefix("/english")).toEqual({ lang: null, pathname: "/english" });
  });
});

describe("addLangPrefix", () => {
  it("prefixes a non-default language on localizable paths", () => {
    expect(addLangPrefix("/post/foo", "en")).toBe("/en/post/foo");
    expect(addLangPrefix("/", "en")).toBe("/en");
  });
  it("never prefixes the default language", () => {
    expect(addLangPrefix("/post/foo", "pl")).toBe("/post/foo");
    expect(addLangPrefix("/", "pl")).toBe("/");
  });
  it("never prefixes non-localizable surfaces", () => {
    expect(addLangPrefix("/admin/posts", "en")).toBe("/admin/posts");
    expect(addLangPrefix("/sitemap.xml", "en")).toBe("/sitemap.xml");
  });
  it("never double-prefixes", () => {
    expect(addLangPrefix("/en/post/foo", "en")).toBe("/en/post/foo");
  });
});

describe("localizedPath", () => {
  it("re-homes a path to the requested language regardless of current prefix", () => {
    expect(localizedPath("/en/post/foo", "pl")).toBe("/post/foo");
    expect(localizedPath("/post/foo", "en")).toBe("/en/post/foo");
    expect(localizedPath("/en", "pl")).toBe("/");
    expect(localizedPath("/", "en")).toBe("/en");
  });
  it("is idempotent for the same language", () => {
    expect(localizedPath("/en/post/foo", "en")).toBe("/en/post/foo");
    expect(localizedPath("/post/foo", "pl")).toBe("/post/foo");
  });
});
