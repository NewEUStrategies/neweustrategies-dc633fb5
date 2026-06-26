import { describe, it, expect } from "vitest";
import {
  splitUrl,
  absoluteUrl,
  hreflangLinks,
  buildContentHead,
  buildArticleJsonLd,
  SITE_NAME,
} from "@/lib/seo/meta";

const find = (meta: Array<Record<string, string>>, key: string, val: string) =>
  meta.find((m) => m[key] === val);

describe("splitUrl", () => {
  it("extracts origin + path and drops query/hash", () => {
    expect(splitUrl("https://nes.eu/a/b?lang=en#x")).toEqual({
      origin: "https://nes.eu",
      path: "/a/b",
    });
  });
  it("degrades gracefully without an origin", () => {
    expect(splitUrl("")).toEqual({ origin: "", path: "/" });
    expect(splitUrl("/foo")).toEqual({ origin: "", path: "/foo" });
  });
});

describe("absoluteUrl", () => {
  it("joins origin + path", () => {
    expect(absoluteUrl("https://nes.eu", "/a")).toBe("https://nes.eu/a");
    expect(absoluteUrl("https://nes.eu", "a")).toBe("https://nes.eu/a");
  });
  it("falls back to a relative path when origin is unknown", () => {
    expect(absoluteUrl("", "/a")).toBe("/a");
  });
});

describe("hreflangLinks", () => {
  it("emits x-default + one self-addressable url per language", () => {
    const links = hreflangLinks("https://nes.eu", "/a");
    expect(links).toEqual([
      { rel: "alternate", hrefLang: "x-default", href: "https://nes.eu/a" },
      { rel: "alternate", hrefLang: "pl", href: "https://nes.eu/a?lang=pl" },
      { rel: "alternate", hrefLang: "en", href: "https://nes.eu/a?lang=en" },
    ]);
  });
});

describe("buildContentHead", () => {
  const base = {
    url: "https://nes.eu/analizy/post?lang=en",
    lang: "en" as const,
    type: "article" as const,
    title: "Title",
    description: "Desc",
    image: "https://nes.eu/c.jpg",
    publishedAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-02-01T00:00:00Z",
    section: "Geopolitics",
    tags: ["nato", "eu"],
  };

  it("builds an absolute, query-free canonical", () => {
    const { links } = buildContentHead(base);
    expect(links.find((l) => l.rel === "canonical")?.href).toBe("https://nes.eu/analizy/post");
  });

  it("sets og:url, locales and twitter card", () => {
    const { meta } = buildContentHead(base);
    expect(find(meta, "property", "og:url")?.content).toBe("https://nes.eu/analizy/post");
    expect(find(meta, "property", "og:locale")?.content).toBe("en_US");
    expect(find(meta, "property", "og:locale:alternate")?.content).toBe("pl_PL");
    expect(find(meta, "name", "twitter:card")?.content).toBe("summary_large_image");
    expect(find(meta, "property", "og:site_name")?.content).toBe(SITE_NAME);
  });

  it("emits article meta and one entry per tag", () => {
    const { meta } = buildContentHead(base);
    expect(find(meta, "property", "article:published_time")?.content).toBe(base.publishedAt);
    expect(find(meta, "property", "article:modified_time")?.content).toBe(base.modifiedAt);
    expect(find(meta, "property", "article:section")?.content).toBe("Geopolitics");
    expect(meta.filter((m) => m.property === "article:tag")).toHaveLength(2);
  });

  it("uses summary card without an image and can mark noindex", () => {
    const { meta } = buildContentHead({ ...base, image: null, noindex: true });
    expect(find(meta, "name", "twitter:card")?.content).toBe("summary");
    expect(find(meta, "name", "robots")?.content).toBe("noindex, nofollow");
    expect(find(meta, "property", "og:image")).toBeUndefined();
  });

  it("omits article meta for website type", () => {
    const { meta } = buildContentHead({ ...base, type: "website" });
    expect(find(meta, "property", "article:published_time")).toBeUndefined();
  });
});

describe("buildArticleJsonLd", () => {
  const base = {
    url: "https://nes.eu/analizy/post?lang=pl",
    lang: "pl" as const,
    isArticle: true,
    title: "Tytuł",
    description: "Opis",
    image: "https://nes.eu/c.jpg",
    publishedAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-02-01T00:00:00Z",
  };

  it("emits NewsArticle with publisher, dates, language and canonical id", () => {
    const ld = buildArticleJsonLd(base);
    expect(ld["@type"]).toBe("NewsArticle");
    expect(ld.inLanguage).toBe("pl");
    expect(ld.url).toBe("https://nes.eu/analizy/post");
    expect((ld.mainEntityOfPage as Record<string, string>)["@id"]).toBe(
      "https://nes.eu/analizy/post",
    );
    expect((ld.publisher as Record<string, string>).name).toBe(SITE_NAME);
    expect(ld.datePublished).toBe(base.publishedAt);
    expect(ld.dateModified).toBe(base.modifiedAt);
  });

  it("uses a Person author when provided, else the organization", () => {
    expect(
      buildArticleJsonLd({ ...base, authorName: "Jan Kowalski" }).author as Record<string, string>,
    ).toEqual({
      "@type": "Person",
      name: "Jan Kowalski",
    });
    expect((buildArticleJsonLd(base).author as Record<string, string>).name).toBe(SITE_NAME);
  });

  it("adds Google paywall markup for gated content", () => {
    const ld = buildArticleJsonLd({ ...base, gated: true });
    expect(ld.isAccessibleForFree).toBe(false);
    expect((ld.hasPart as Record<string, unknown>).cssSelector).toBe(".article-body");
  });

  it("emits WebPage (not NewsArticle) for pages", () => {
    expect(buildArticleJsonLd({ ...base, isArticle: false })["@type"]).toBe("WebPage");
    expect(buildArticleJsonLd({ ...base, isArticle: false }).author).toBeUndefined();
  });
});
