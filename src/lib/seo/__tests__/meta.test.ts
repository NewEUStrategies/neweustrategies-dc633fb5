import { afterEach, describe, it, expect } from "vitest";
import { clearSocialDefaults, rememberSocialDefaults } from "@/lib/seo/socialDefaults";
import {
  defaultSocialImage,
  splitUrl,
  absoluteUrl,
  hreflangLinks,
  buildContentHead,
  buildRootHead,
  buildArticleJsonLd,
  feedAlternateLink,
  feedDiscoveryLinks,
  imagePreloadLink,
  imagePreloadLinkHeaderValue,
  SITE_NAME,
  SITE_DEFAULT_TITLE,
  SITE_DEFAULT_DESCRIPTION,
  SITE_DEFAULT_OG_IMAGE,
  SITE_CANONICAL_ORIGIN,
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
      // URL fields legitimately carry the canonical brand origin (a
      // a hosting-layer alias until the custom domain ships). The generator's
      // BRANDING must not leak into any textual field: title, descriptions,
      // author, site name, card copy.
      const urlFields = new Set(["og:image", "twitter:image", "og:url"]);
      const textual = meta.filter(
        (m) => !urlFields.has(m.property ?? "") && !urlFields.has(m.name ?? ""),
      );
      expect(JSON.stringify(textual)).not.toMatch(/lovable/i);
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
    // default image is resolved against the canonical brand origin - social
    // scrapers ignore relative og:image paths; the card is large-image.
    const expectedImage = `${SITE_CANONICAL_ORIGIN}${SITE_DEFAULT_OG_IMAGE}`;
    expect(find(en, "name", "twitter:card")?.content).toBe("summary_large_image");
    expect(find(en, "property", "og:image")?.content).toBe(expectedImage);
    expect(find(en, "name", "twitter:image")?.content).toBe(expectedImage);
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

describe("imagePreloadLinkHeaderValue", () => {
  it("buduje wartość nagłówka Link z imagesrcset/imagesizes w cudzysłowach", () => {
    const value = imagePreloadLinkHeaderValue({
      href: "https://cdn/img.jpg",
      imageSrcSet: "https://cdn/img.jpg?width=320 320w, https://cdn/img.jpg?width=640 640w",
      imageSizes: "(max-width: 768px) 100vw, 672px",
    });
    expect(value).toBe(
      '<https://cdn/img.jpg>; rel="preload"; as="image"; fetchpriority=high; ' +
        'imagesrcset="https://cdn/img.jpg?width=320 320w, https://cdn/img.jpg?width=640 640w"; ' +
        'imagesizes="(max-width: 768px) 100vw, 672px"',
    );
  });

  it("bez srcSet emituje sam preload href (parytet z plain <img src>)", () => {
    expect(imagePreloadLinkHeaderValue({ href: "https://cdn/img.jpg", imageSrcSet: "" })).toBe(
      '<https://cdn/img.jpg>; rel="preload"; as="image"; fetchpriority=high',
    );
  });

  it("nie pozwala wartościom rozerwać nagłówka (CR/LF, cudzysłowy, nawiasy)", () => {
    const value = imagePreloadLinkHeaderValue({
      href: "https://cdn/img.jpg?x=1\r\nSet-Cookie: pwned <a>",
      imageSrcSet: 'srcset "z cudzysłowem"\r\n 320w',
      imageSizes: "100vw",
    });
    expect(value).not.toMatch(/[\r\n]/);
    // href: znaki sterujące, spacje i nawiasy kątowe twardo usunięte.
    expect(value.startsWith("<https://cdn/img.jpg?x=1Set-Cookie:pwneda>;")).toBe(true);
    // Parametry: cudzysłowy escapowane, żadnego przedwczesnego zamknięcia;
    // nie-ASCII ("ł") zakodowane procentowo - patrz test ByteString niżej.
    expect(value).toContain('imagesrcset="srcset \\"z cudzys%C5%82owem\\" 320w"');
  });

  it("koduje nie-ASCII procentowo - wartość jest zawsze bezpiecznym ByteStringiem", () => {
    // Redakcyjny URL "okładka.jpg": bez kodowania Headers.set rzuca TypeError
    // na Node (ByteString), a workerd emituje zniekształcone surowe UTF-8 -
    // jedna taka wartość zatruwała cały akumulator Link żądania.
    const value = imagePreloadLinkHeaderValue({ href: "https://ext.example/okładka.jpg" });
    expect(value).toContain("<https://ext.example/ok%C5%82adka.jpg>");
    // Cała wartość mieści się w ASCII 0x20-0x7E - nic nie wysadzi Headers.set.
    expect(
      [...value].every((ch) => {
        const c = ch.charCodeAt(0);
        return c >= 0x20 && c <= 0x7e;
      }),
    ).toBe(true);
    // new Headers() to najsurowszy (spec-zgodny) walidator - nie może rzucić.
    expect(() => new Headers({ link: value })).not.toThrow();
  });

  it("nie re-enkoduje istniejących %-sekwencji w href", () => {
    const value = imagePreloadLinkHeaderValue({ href: "https://cdn/a%20b.jpg" });
    expect(value).toContain("<https://cdn/a%20b.jpg>");
  });
});

describe("feed discovery", () => {
  it("advertises one site feed per language on every page", () => {
    const links = feedDiscoveryLinks("https://nes.example");
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.rel).toBe("alternate");
      expect(link.type).toBe("application/rss+xml");
      expect(link.href.startsWith("https://nes.example/")).toBe(true);
    }
    expect(links.map((l) => l.href)).toEqual([
      "https://nes.example/rss.xml",
      "https://nes.example/en/rss.xml",
    ]);
  });

  it("localizes a section feed to the document language", () => {
    // Autodiscovery to jedyny sposob, w jaki czytnik RSS / Apple Podcasts
    // znajduje kanal bez znajomosci naszej konwencji URL.
    expect(
      feedAlternateLink({
        origin: "https://nes.example",
        feedPath: "/podcast/rss.xml",
        title: "Podcast NES - RSS",
        lang: "pl",
      }),
    ).toEqual({
      rel: "alternate",
      type: "application/rss+xml",
      title: "Podcast NES - RSS",
      href: "https://nes.example/podcast/rss.xml",
    });

    expect(
      feedAlternateLink({
        origin: "https://nes.example",
        feedPath: "/tracker/rss.xml",
        title: "EU policy tracker - RSS",
        lang: "en",
      }).href,
    ).toBe("https://nes.example/en/tracker/rss.xml");
  });

  it("never emits a relative feed href (scrapers ignore relative alternates)", () => {
    const link = feedAlternateLink({
      origin: "https://nes.example",
      feedPath: "/live/rss.xml",
      title: "Live - RSS",
      lang: "pl",
    });
    expect(link.href).toMatch(/^https:\/\//);
  });
});

// ---------------------------------------------------------------------------
// ETAP 4: ramiona `??` / `||` / `if` builderów <head>, których nie dotykał
// żaden test. Uzupełnienia, nie duplikaty: headContract.test.ts pilnuje
// kontraktu kompletnego <head> i klastra hreflang (w tym canonicalOverride),
// socialDefaults.test.ts i socialPreviewSources.test.ts - karty per host,
// siteIdentity.test.ts - redakcyjnych nadpisań tytułu/opisu, a e2e/seo.spec.ts
// dowodzi tych samych pól BAJTAMI na żywym SSR. Tutaj są wyłącznie wejścia
// NIEPEŁNE: undefined / null / "" / 0 / spacje / brak originu.
// ---------------------------------------------------------------------------

describe("splitUrl - wejścia zdegradowane", () => {
  it.each([
    { url: "foo/bar", expected: { origin: "", path: "/foo/bar" } },
    // FAKT PRZYPIĘTY: w ścieżce awaryjnej (wejście nie parsuje się jako URL)
    // query NIE jest odsiewane - odsiewa je tylko `new URL()` wyżej.
    { url: "analizy/post?lang=en", expected: { origin: "", path: "/analizy/post?lang=en" } },
  ])("nie-URL '$url' dostaje wiodący ukośnik", ({ url, expected }) => {
    expect(splitUrl(url)).toEqual(expected);
  });

  it("adres o schemacie nieprzezroczystym degraduje ścieżkę do '/'", () => {
    // FAKT PRZYPIĘTY: `new URL("x:")` PARSUJE się, a jego `pathname` jest pusty
    // - to jedyne wejście domykające ramię `|| "/"`. `origin` jest wtedy
    // ŁAŃCUCHEM "null" (tak stanowi WHATWG URL), więc canonical byłby bezsensem
    // - ale takie wejście nie powstaje w SSR: `url` pochodzi z żądania HTTP,
    // więc zawsze ma schemat http(s).
    expect(splitUrl("x:")).toEqual({ origin: "null", path: "/" });
  });
});

describe("defaultSocialImage - wszystkie źródła karty", () => {
  afterEach(() => {
    clearSocialDefaults();
  });

  it("bez ustawienia i bez originu rozwija plik marki do domeny kanonicznej", () => {
    // Dokument błędu / render kliencki nie zna originu, a scrapery ignorują
    // względne og:image - dlatego pusty origin MUSI spaść na domenę kanoniczną.
    expect(defaultSocialImage("")).toBe(`${SITE_CANONICAL_ORIGIN}${SITE_DEFAULT_OG_IMAGE}`);
  });

  it("bez originu rozwija TAKŻE ustawioną ścieżkę względną do domeny kanonicznej", () => {
    // Store kluczuje po hoście, a "" mapuje się na klucz "no-host".
    rememberSocialDefaults("", { imageUrl: "/karta-redakcyjna.jpg", imageAlt: "" });
    expect(defaultSocialImage("")).toBe(`${SITE_CANONICAL_ORIGIN}/karta-redakcyjna.jpg`);
  });

  it("head treści bez originu i tak emituje absolutny og:image, a canonical zostaje względny", () => {
    const { meta, links } = buildContentHead({
      url: "/analizy/post",
      lang: "pl",
      type: "article",
      title: "Tytuł",
      description: "Opis",
      image: null,
    });
    expect(find(meta, "property", "og:image")?.content).toBe(
      `${SITE_CANONICAL_ORIGIN}${SITE_DEFAULT_OG_IMAGE}`,
    );
    expect(links.find((l) => l.rel === "canonical")?.href).toBe("/analizy/post");
    expect(find(meta, "property", "og:url")?.content).toBe("/analizy/post");
  });
});

describe("buildContentHead - pola opcjonalne, każde ramię osobno", () => {
  const base = {
    url: "https://nes.eu/analizy/post",
    lang: "pl" as const,
    type: "article" as const,
    title: "Tytuł",
    description: "Opis",
    image: "https://nes.eu/c.jpg",
  };

  it.each([
    { label: "podany handle", twitterSite: "@nes", expected: "@nes" },
    { label: "handle w spacjach jest przycinany", twitterSite: "  @nes  ", expected: "@nes" },
    { label: "same spacje = brak handle'a", twitterSite: "   ", expected: undefined },
    { label: "null = brak handle'a", twitterSite: null, expected: undefined },
    { label: "brak pola = brak handle'a", twitterSite: undefined, expected: undefined },
  ])("twitter:site - $label", ({ twitterSite, expected }) => {
    const { meta } = buildContentHead({ ...base, twitterSite });
    expect(find(meta, "name", "twitter:site")?.content).toBe(expected);
  });

  it.each([
    {
      label: "documentTitle nadpisuje <title>",
      documentTitle: "Tytuł - NES",
      expected: "Tytuł - NES",
    },
    // Sufiks marki jest sklejany wyżej (settings.ts / effectiveTitleSuffix,
    // pokryty w settings.test.ts); tu liczy się tylko ramię fallbacku.
    { label: "pusty documentTitle spada na czysty tytuł", documentTitle: "", expected: "Tytuł" },
    {
      label: "brak documentTitle spada na czysty tytuł",
      documentTitle: undefined,
      expected: "Tytuł",
    },
  ])("<title> - $label", ({ documentTitle, expected }) => {
    const { meta } = buildContentHead({ ...base, documentTitle });
    expect(meta[0]?.title).toBe(expected);
    // og:title / twitter:title zawsze noszą CZYSTY nagłówek, bez sufiksu.
    expect(find(meta, "property", "og:title")?.content).toBe("Tytuł");
    expect(find(meta, "name", "twitter:title")?.content).toBe("Tytuł");
  });

  it("emituje wymiary i alt karty dla wygenerowanego obrazka", () => {
    const { meta } = buildContentHead({
      ...base,
      imageWidth: 1200,
      imageHeight: 630,
      imageAlt: "  Karta OG wpisu  ",
    });
    expect(find(meta, "property", "og:image:width")?.content).toBe("1200");
    expect(find(meta, "property", "og:image:height")?.content).toBe("630");
    expect(find(meta, "property", "og:image:alt")?.content).toBe("Karta OG wpisu");
  });

  it.each([
    { label: "zero nie jest wymiarem, a same spacje nie są altem", w: 0, h: 0, alt: "   " },
    { label: "brak wartości", w: undefined, h: undefined, alt: null },
  ])("pomija metadane obrazka: $label", ({ w, h, alt }) => {
    const { meta } = buildContentHead({ ...base, imageWidth: w, imageHeight: h, imageAlt: alt });
    expect(meta.filter((m) => (m.property ?? "").startsWith("og:image:"))).toEqual([]);
    // Sam og:image zostaje - karta bez wymiarów jest poprawna, karta bez
    // obrazka nie.
    expect(find(meta, "property", "og:image")?.content).toBe(base.image);
  });

  it.each([
    {
      label: "jawny robots wygrywa z flagą noindex",
      robots: "index, follow, max-snippet:-1",
      noindex: true,
      expected: "index, follow, max-snippet:-1",
    },
    {
      label: "jawny robots jest przycinany",
      robots: "  noindex  ",
      noindex: false,
      expected: "noindex",
    },
    {
      label: "same spacje oddają pole starej fladze",
      robots: "   ",
      noindex: true,
      expected: "noindex, nofollow",
    },
    { label: "null + noindex", robots: null, noindex: true, expected: "noindex, nofollow" },
    { label: "brak obu = brak meta robots", robots: null, noindex: false, expected: undefined },
    {
      label: "brak obu pól = brak meta robots",
      robots: undefined,
      noindex: undefined,
      expected: undefined,
    },
  ])("robots - $label", ({ robots, noindex, expected }) => {
    const { meta } = buildContentHead({ ...base, robots, noindex });
    expect(find(meta, "name", "robots")?.content).toBe(expected);
  });
});

describe("buildRootHead - origin pusty vs kanoniczny", () => {
  it("origin '' rozwija kartę do domeny kanonicznej, nie do adresu względnego", () => {
    const meta = buildRootHead("pl", "");
    const expected = `${SITE_CANONICAL_ORIGIN}${SITE_DEFAULT_OG_IMAGE}`;
    expect(find(meta, "property", "og:image")?.content).toBe(expected);
    expect(find(meta, "name", "twitter:image")?.content).toBe(expected);
  });

  it("podany origin hostingu wygrywa nad domeną kanoniczną", () => {
    const meta = buildRootHead("pl", "https://preview.nes.eu");
    expect(find(meta, "property", "og:image")?.content).toBe(
      `https://preview.nes.eu${SITE_DEFAULT_OG_IMAGE}`,
    );
  });
});

describe("imagePreloadLinkHeaderValue - domyślne sizes", () => {
  it("srcSet bez jawnych sizes daje imagesizes=100vw (parytet z imagePreloadLink)", () => {
    // Rozbieżność sizes między preloadem a <img> to podwójne pobranie obrazka
    // LCP, więc domyślna wartość MUSI być ta sama w obu builderach.
    expect(
      imagePreloadLinkHeaderValue({
        href: "https://cdn/img.jpg",
        imageSrcSet: "https://cdn/img.jpg?width=320 320w",
      }),
    ).toBe(
      '<https://cdn/img.jpg>; rel="preload"; as="image"; fetchpriority=high; ' +
        'imagesrcset="https://cdn/img.jpg?width=320 320w"; imagesizes="100vw"',
    );
  });
});

describe("buildArticleJsonLd - ramiona pól opcjonalnych", () => {
  const base = {
    url: "https://nes.eu/analizy/post",
    lang: "pl" as const,
    isArticle: true,
    title: "Tytuł",
    description: "Opis",
  };

  it("bez originu (render kliencki) publisher nie dostaje url, a canonical zostaje względny", () => {
    const ld = buildArticleJsonLd({ ...base, url: "/analizy/post" });
    const publisher = ld.publisher as Record<string, unknown>;
    expect(ld.url).toBe("/analizy/post");
    expect(publisher.name).toBe(SITE_NAME);
    expect(publisher).not.toHaveProperty("url");
  });

  it("logo wydawcy trafia do publisher.logo jako ImageObject (wymóg Google News)", () => {
    const ld = buildArticleJsonLd({ ...base, publisherLogoUrl: "https://nes.eu/logo.png" });
    expect((ld.publisher as Record<string, unknown>).logo).toEqual({
      "@type": "ImageObject",
      url: "https://nes.eu/logo.png",
    });
  });

  it("encja bez obrazka i bez dat nie emituje pustych kluczy", () => {
    // Pusty `image: []` albo `datePublished: null` to błąd walidacji rich
    // results - brak klucza jest poprawny, pusty klucz nie.
    const ld = buildArticleJsonLd({ ...base, image: null, publishedAt: null, modifiedAt: null });
    expect("image" in ld).toBe(false);
    expect("datePublished" in ld).toBe(false);
    expect("dateModified" in ld).toBe(false);
    expect(ld.headline).toBe("Tytuł");
  });

  it("sekcja i tagi: articleSection + keywords po przecinku", () => {
    const ld = buildArticleJsonLd({ ...base, section: "Geopolityka", tags: ["nato", "ue"] });
    expect(ld.articleSection).toBe("Geopolityka");
    expect(ld.keywords).toBe("nato, ue");
  });

  it.each([
    { label: "pusta lista tagów i null w sekcji", section: null, tags: [] },
    { label: "brak obu pól", section: undefined, tags: undefined },
  ])("bez sekcji i tagów nie ma kluczy: $label", ({ section, tags }) => {
    const ld = buildArticleJsonLd({ ...base, section, tags });
    expect("articleSection" in ld).toBe(false);
    expect("keywords" in ld).toBe(false);
  });

  it("ujawnienie komercyjne: sponsor + nadpisany @type dla treści reklamodawcy", () => {
    const ld = buildArticleJsonLd({
      ...base,
      sponsorName: "ACME",
      articleTypeOverride: "AdvertiserContentArticle",
    });
    expect(ld["@type"]).toBe("AdvertiserContentArticle");
    expect(ld.sponsor).toEqual({ "@type": "Organization", name: "ACME" });
  });

  it("STRONA (nie artykuł) nie dostaje autora, sekcji, tagów ani sponsora", () => {
    // FAKT PRZYPIĘTY: nadpisanie @type dotyczy tylko artykułów - strona zostaje
    // WebPage nawet z articleTypeOverride, a warstwa ujawnienia komercyjnego
    // (sponsor) NIE jest wtedy emitowana wcale.
    const ld = buildArticleJsonLd({
      ...base,
      isArticle: false,
      section: "Geopolityka",
      tags: ["nato"],
      sponsorName: "ACME",
      articleTypeOverride: "AdvertiserContentArticle",
    });
    expect(ld["@type"]).toBe("WebPage");
    expect("author" in ld).toBe(false);
    expect("articleSection" in ld).toBe(false);
    expect("keywords" in ld).toBe(false);
    expect("sponsor" in ld).toBe(false);
  });

  it.each([
    {
      label: "tezy są przycinane i sklejane spacją",
      takeaways: ["  Europa zwiększa wydatki.  ", "Budżet UE stoi.", ""],
      expected: "Europa zwiększa wydatki. Budżet UE stoi.",
    },
    { label: "same puste tezy nie tworzą abstract", takeaways: ["   ", ""], expected: undefined },
    { label: "pusta lista", takeaways: [], expected: undefined },
    { label: "brak pola", takeaways: undefined, expected: undefined },
  ])("abstract z key takeaways - $label", ({ takeaways, expected }) => {
    expect(buildArticleJsonLd({ ...base, takeaways }).abstract).toBe(expected);
  });

  it.each([
    { label: "włączony", speakable: true, expected: true },
    { label: "wyłączony", speakable: false, expected: false },
    { label: "brak pola", speakable: undefined, expected: false },
  ])("speakable - $label", ({ speakable, expected }) => {
    const ld = buildArticleJsonLd({ ...base, speakable });
    expect("speakable" in ld).toBe(expected);
    if (expected) {
      expect(ld.speakable).toEqual({
        "@type": "SpeakableSpecification",
        cssSelector: ["h1", ".key-takeaways", ".article-body > p:first-of-type"],
      });
    }
  });
});
