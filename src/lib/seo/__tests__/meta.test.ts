import { describe, it, expect } from "vitest";
import {
  splitUrl,
  absoluteUrl,
  hreflangLinks,
  buildContentHead,
  buildRootHead,
  buildArticleJsonLd,
  imagePreloadLink,
  SITE_NAME,
  SITE_DEFAULT_TITLE,
  SITE_DEFAULT_DESCRIPTION,
  SITE_DEFAULT_OG_IMAGE,
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
  it("emits x-default + one path-prefixed url per language", () => {
    const links = hreflangLinks("https://nes.eu", "/a");
    expect(links).toEqual([
      // x-default and PL (default) live at the bare path; EN under "/en".
      { rel: "alternate", hrefLang: "x-default", href: "https://nes.eu/a" },
      { rel: "alternate", hrefLang: "pl", href: "https://nes.eu/a" },
      { rel: "alternate", hrefLang: "en", href: "https://nes.eu/en/a" },
    ]);
  });

  it("normalizes an already-prefixed path to the same cluster", () => {
    expect(hreflangLinks("https://nes.eu", "/en/a")).toEqual(hreflangLinks("https://nes.eu", "/a"));
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

  it("uses the page image for og:image / twitter:image when present", () => {
    const { meta } = buildContentHead(base);
    expect(find(meta, "property", "og:image")?.content).toBe(base.image);
    expect(find(meta, "name", "twitter:image")?.content).toBe(base.image);
  });

  it("falls back to the brand default social image (absolute) and can mark noindex", () => {
    const { meta } = buildContentHead({ ...base, image: null, noindex: true });
    // No page image -> brand default, resolved to an absolute URL via the origin,
    // and a large-image card (we always ship a rich preview now).
    const expected = `https://nes.eu${SITE_DEFAULT_OG_IMAGE}`;
    expect(find(meta, "name", "twitter:card")?.content).toBe("summary_large_image");
    expect(find(meta, "name", "robots")?.content).toBe("noindex, nofollow");
    expect(find(meta, "property", "og:image")?.content).toBe(expected);
    expect(find(meta, "name", "twitter:image")?.content).toBe(expected);
  });

  it("omits article meta for website type", () => {
    const { meta } = buildContentHead({ ...base, type: "website" });
    expect(find(meta, "property", "article:published_time")).toBeUndefined();
  });
});

describe("buildRootHead", () => {
  it("brands the document defaults to New European Strategies, not the generator", () => {
    for (const lang of ["pl", "en"] as const) {
      const meta = buildRootHead(lang);
      const serialized = JSON.stringify(meta);
      expect(serialized).not.toMatch(/lovable/i);
      expect(find(meta, "name", "author")?.content).toBe(SITE_NAME);
      expect(find(meta, "property", "og:site_name")?.content).toBe(SITE_NAME);
    }
  });

  it("emits the localized brand title + description for each language", () => {
    const pl = buildRootHead("pl");
    expect(find(pl, "title", SITE_DEFAULT_TITLE.pl)?.title).toBe(SITE_DEFAULT_TITLE.pl);
    expect(find(pl, "name", "description")?.content).toBe(SITE_DEFAULT_DESCRIPTION.pl);
    expect(find(pl, "property", "og:title")?.content).toBe(SITE_DEFAULT_TITLE.pl);
    expect(find(pl, "property", "og:description")?.content).toBe(SITE_DEFAULT_DESCRIPTION.pl);

    const en = buildRootHead("en");
    expect(find(en, "title", SITE_DEFAULT_TITLE.en)?.title).toBe(SITE_DEFAULT_TITLE.en);
    expect(find(en, "name", "description")?.content).toBe(SITE_DEFAULT_DESCRIPTION.en);
  });

  it("keeps the document essentials and a language-correct og:locale", () => {
    const en = buildRootHead("en");
    expect(en.find((m) => m.charSet === "utf-8")).toBeDefined();
    expect(find(en, "name", "viewport")?.content).toBe("width=device-width, initial-scale=1");
    expect(find(en, "property", "og:type")?.content).toBe("website");
    expect(find(en, "property", "og:locale")?.content).toBe("en_US");
    expect(find(buildRootHead("pl"), "property", "og:locale")?.content).toBe("pl_PL");
  });

  it("mirrors og into the Twitter card without a stale @handle", () => {
    const en = buildRootHead("en");
    // buildRootHead is origin-less (error/fallback documents), so the brand
    // default image stays a root-relative path; the card is large-image.
    expect(find(en, "name", "twitter:card")?.content).toBe("summary_large_image");
    expect(find(en, "property", "og:image")?.content).toBe(SITE_DEFAULT_OG_IMAGE);
    expect(find(en, "name", "twitter:image")?.content).toBe(SITE_DEFAULT_OG_IMAGE);
    expect(find(en, "name", "twitter:title")?.content).toBe(SITE_DEFAULT_TITLE.en);
    expect(find(en, "name", "twitter:description")?.content).toBe(SITE_DEFAULT_DESCRIPTION.en);
    expect(en.find((m) => m.name === "twitter:site")).toBeUndefined();
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

describe("imagePreloadLink", () => {
  it("emits a high-priority responsive image preload matching the <img>", () => {
    const link = imagePreloadLink({
      href: "https://cdn/img.jpg",
      imageSrcSet: "https://cdn/img.jpg?width=320 320w, https://cdn/img.jpg?width=640 640w",
      imageSizes: "(max-width: 768px) 100vw, 672px",
    });
    expect(link).toEqual({
      rel: "preload",
      as: "image",
      href: "https://cdn/img.jpg",
      fetchPriority: "high",
      imageSrcSet: "https://cdn/img.jpg?width=320 320w, https://cdn/img.jpg?width=640 640w",
      imageSizes: "(max-width: 768px) 100vw, 672px",
    });
  });

  it("falls back to a plain href preload when there is no srcSet (non-responsive img)", () => {
    const link = imagePreloadLink({ href: "https://cdn/img.jpg", imageSrcSet: "" });
    expect(link).toEqual({
      rel: "preload",
      as: "image",
      href: "https://cdn/img.jpg",
      fetchPriority: "high",
    });
    expect(link.imageSrcSet).toBeUndefined();
    expect(link.imageSizes).toBeUndefined();
  });

  it("defaults imageSizes to 100vw when a srcSet is given without explicit sizes", () => {
    const link = imagePreloadLink({ href: "x", imageSrcSet: "x 320w" });
    expect(link.imageSizes).toBe("100vw");
  });
});
