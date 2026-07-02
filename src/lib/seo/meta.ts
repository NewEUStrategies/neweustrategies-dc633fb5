// Pure, framework-free SEO builders. Given the current request URL and the
// resolved content, they produce the meta/link descriptors for TanStack head()
// and the JSON-LD graph. Kept side-effect free so they are fully unit-testable
// without SSR or a DOM.
import {
  DEFAULT_LANG,
  SUPPORTED_LANGS,
  localizedPath,
  stripLangPrefix,
  type AppLang,
} from "@/lib/i18n/localePath";

// The language type and the supported list live in the locale-path core (the
// single source of truth for the language <-> URL mapping); re-exported here so
// existing SEO imports keep working.
export type Lang = AppLang;
export { SUPPORTED_LANGS };

export const SITE_NAME = "New European Strategies";
export const OG_LOCALE: Record<Lang, string> = { pl: "pl_PL", en: "en_US" };

/**
 * Brand-default social-share image (served from `public/`). Used as the
 * `og:image` / `twitter:image` fallback whenever a page has no cover image of
 * its own - notably the homepage and listing pages - so every shared link gets a
 * rich card instead of a bare-text preview. A relative path: callers that have a
 * request origin (buildContentHead) resolve it to an absolute URL, which is what
 * scrapers require. Replace with a purpose-built 1200x630 card when available.
 */
export const SITE_DEFAULT_OG_IMAGE = "/og-default.jpg";

/**
 * Brand-default page title per language. Single source of truth shared by the
 * global <head> fallback (buildRootHead) and the homepage's own head(), so the
 * front page and any route without its own head() stay byte-identical.
 */
export const SITE_DEFAULT_TITLE: Record<Lang, string> = {
  pl: "New European Strategies - Strategiczne myślenie, nowe perspektywy",
  en: "New European Strategies - Strategic thinking, new perspectives",
};

/** Brand-default meta description per language (see SITE_DEFAULT_TITLE). */
export const SITE_DEFAULT_DESCRIPTION: Record<Lang, string> = {
  pl: "Think-tank o europejskim bezpieczeństwie, geopolityce i grze mocarstw. Analizy, raporty, wywiady i policy papers.",
  en: "A think-tank on European security, geopolitics and great-power rivalry. Analyses, reports, interviews and policy papers.",
};

/** Split a (possibly empty) absolute URL into origin + pathname, dropping the
 * `lang` query param so canonical/hreflang are built from a clean base. */
export function splitUrl(url: string): { origin: string; path: string } {
  if (!url) return { origin: "", path: "/" };
  try {
    const u = new URL(url);
    return { origin: u.origin, path: u.pathname || "/" };
  } catch {
    return { origin: "", path: url.startsWith("/") ? url : `/${url}` };
  }
}

/** Join origin + path into an absolute URL, tolerating a missing origin (falls
 * back to the relative path so links remain valid during pure client renders). */
export function absoluteUrl(origin: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return origin ? `${origin}${p}` : p;
}

/** hreflang cluster: x-default + one self-addressable URL per language. Each
 * URL uses the language PATH prefix the router and CDN actually serve (PL at
 * the bare path, EN under "/en"), so the alternates point at real, shareable
 * renders. `path` may already be prefixed (it comes from the raw request URL),
 * so it is normalized to the canonical path first. */
export function hreflangLinks(
  origin: string,
  path: string,
): Array<{ rel: string; hrefLang: string; href: string }> {
  const canonical = stripLangPrefix(path).pathname;
  return [
    {
      rel: "alternate",
      hrefLang: "x-default",
      href: absoluteUrl(origin, localizedPath(canonical, DEFAULT_LANG)),
    },
    ...SUPPORTED_LANGS.map((l) => ({
      rel: "alternate",
      hrefLang: l,
      href: absoluteUrl(origin, localizedPath(canonical, l)),
    })),
  ];
}

export interface ContentHeadInput {
  url: string;
  lang: Lang;
  type: "article" | "website";
  title: string;
  description: string;
  image?: string | null;
  publishedAt?: string | null;
  modifiedAt?: string | null;
  section?: string | null;
  tags?: readonly string[];
  noindex?: boolean;
  /** Full <title> text (e.g. with the brand suffix). Falls back to `title`;
   *  og:title / twitter:title always use the clean `title` headline. */
  documentTitle?: string;
  /** Explicit robots meta content; wins over the legacy `noindex` flag. */
  robots?: string | null;
  /** Canonical override (absolute URL). When set, the hreflang cluster is
   *  suppressed - a page pointing its canonical elsewhere must not claim
   *  language alternates of itself. */
  canonicalOverride?: string | null;
  /** og:image dimensions/alt - emitted only when known (generated cards). */
  imageWidth?: number;
  imageHeight?: number;
  imageAlt?: string | null;
  /** Optional "@site" handle for twitter:site. */
  twitterSite?: string | null;
}

export interface HeadDescriptor {
  meta: Array<Record<string, string>>;
  links: Array<Record<string, string>>;
}

/** Build the <head> meta + links for a content page (article or listing). */
export function buildContentHead(input: ContentHeadInput): HeadDescriptor {
  const { origin, path } = splitUrl(input.url);
  const canonical = input.canonicalOverride || absoluteUrl(origin, path);
  const altLang: Lang = input.lang === "pl" ? "en" : "pl";
  // Always emit a social image: the page's own cover when present, else the
  // brand default (resolved to an absolute URL via the request origin). This is
  // why every share - including the homepage, which has no cover - gets a rich
  // "summary_large_image" card rather than a bare-text preview.
  const image = input.image || absoluteUrl(origin, SITE_DEFAULT_OG_IMAGE);

  const meta: Array<Record<string, string>> = [
    { title: input.documentTitle || input.title },
    { name: "description", content: input.description },
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:type", content: input.type },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: OG_LOCALE[input.lang] },
    { property: "og:locale:alternate", content: OG_LOCALE[altLang] },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: input.description },
    { httpEquiv: "content-language", content: input.lang },
  ];

  if (input.twitterSite?.trim()) {
    meta.push({ name: "twitter:site", content: input.twitterSite.trim() });
  }
  if (canonical) meta.push({ property: "og:url", content: canonical });
  meta.push({ property: "og:image", content: image });
  if (input.imageWidth)
    meta.push({ property: "og:image:width", content: String(input.imageWidth) });
  if (input.imageHeight)
    meta.push({ property: "og:image:height", content: String(input.imageHeight) });
  if (input.imageAlt?.trim())
    meta.push({ property: "og:image:alt", content: input.imageAlt.trim() });
  meta.push({ name: "twitter:image", content: image });
  // Explicit robots content (index directives with snippet/preview hints for
  // zero-click surfaces) wins; the legacy boolean stays for older callers.
  if (input.robots?.trim()) meta.push({ name: "robots", content: input.robots.trim() });
  else if (input.noindex) meta.push({ name: "robots", content: "noindex, nofollow" });

  if (input.type === "article") {
    if (input.publishedAt)
      meta.push({ property: "article:published_time", content: input.publishedAt });
    if (input.modifiedAt)
      meta.push({ property: "article:modified_time", content: input.modifiedAt });
    if (input.section) meta.push({ property: "article:section", content: input.section });
    for (const tag of input.tags ?? []) meta.push({ property: "article:tag", content: tag });
  }

  const links: Array<Record<string, string>> = [];
  if (canonical) links.push({ rel: "canonical", href: canonical });
  // A canonical pointing elsewhere must not also claim hreflang alternates of
  // this URL - crawlers treat that as a contradictory language cluster.
  if (!input.canonicalOverride) {
    for (const alt of hreflangLinks(origin, path)) links.push(alt);
  }

  return { meta, links };
}

/**
 * `<link rel="alternate" type="application/rss+xml">` feed-discovery links for
 * the root head. Both language feeds are advertised on every page so readers
 * and crawlers find them regardless of entry URL.
 */
export function feedDiscoveryLinks(origin: string): Array<Record<string, string>> {
  return SUPPORTED_LANGS.map((l) => ({
    rel: "alternate",
    type: "application/rss+xml",
    title: l === "pl" ? `${SITE_NAME} - RSS` : `${SITE_NAME} - RSS (English)`,
    href: absoluteUrl(origin, localizedPath("/rss.xml", l)),
  }));
}

/**
 * Default document <head> meta for the app root - the brand fallback rendered
 * by any route that does not supply its own head() (error pages, parts of the
 * admin, fallbacks) and in the first social-share preview before a content
 * head() resolves. Language-aware (PL/EN) and branded to New European
 * Strategies; pure so it is unit-testable without SSR or a DOM.
 *
 * Returns only the meta descriptors - the root route owns its links (stylesheet
 * + Vite-fingerprinted font preloads), which cannot live in this asset-free
 * module. Emits no `twitter:site` handle on purpose: the organization has no
 * canonical @handle, and a stale one is worse for the brand than none.
 */
export function buildRootHead(lang: Lang): Array<Record<string, string>> {
  const title = SITE_DEFAULT_TITLE[lang];
  const description = SITE_DEFAULT_DESCRIPTION[lang];
  return [
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { title },
    { name: "description", content: description },
    { name: "author", content: SITE_NAME },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: OG_LOCALE[lang] },
    // Brand-default share image. buildRootHead is origin-less (it backs error /
    // fallback documents), so this stays a root-relative path; the content
    // surfaces that matter for sharing go through buildContentHead, which emits
    // an absolute URL.
    { property: "og:image", content: SITE_DEFAULT_OG_IMAGE },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:image", content: SITE_DEFAULT_OG_IMAGE },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
}

export interface ImagePreloadInput {
  /** Absolute or storage URL of the LCP image (used as the fallback `href`). */
  href: string;
  /** Responsive candidate set - must byte-match the rendered `<img srcSet>`. */
  imageSrcSet?: string;
  /** `sizes` the image renders at - must match the `<img sizes>` exactly, or
   *  the browser preloads a different candidate than it paints (double fetch). */
  imageSizes?: string;
}

/**
 * Build a `<link rel="preload" as="image">` descriptor for the above-the-fold
 * LCP image, so the browser starts the fetch from the document <head> instead
 * of waiting until the `<img>` is parsed in the body. When a `srcSet` is given,
 * `imageSrcSet` + `imageSizes` are emitted so the preloaded candidate is exactly
 * the one the responsive `<img>` selects; otherwise a plain `href` preload is
 * emitted (matching a non-responsive `<img src>`). Pure - no framework deps.
 */
export function imagePreloadLink(input: ImagePreloadInput): Record<string, string> {
  const link: Record<string, string> = {
    rel: "preload",
    as: "image",
    href: input.href,
    fetchPriority: "high",
  };
  if (input.imageSrcSet) {
    link.imageSrcSet = input.imageSrcSet;
    link.imageSizes = input.imageSizes ?? "100vw";
  }
  return link;
}

export interface ArticleJsonLdInput {
  url: string;
  lang: Lang;
  isArticle: boolean;
  title: string;
  description: string;
  image?: string | null;
  publishedAt?: string | null;
  modifiedAt?: string | null;
  authorName?: string | null;
  /** Paywalled (members/paid). Adds Google's "isAccessibleForFree" markup. */
  gated?: boolean;
  /** CSS selector of the gated body region (for the paywall hasPart node). */
  paywallSelector?: string;
  /** Primary category name (articleSection). */
  section?: string | null;
  /** Tag names (keywords). */
  tags?: readonly string[];
  /** Key takeaways - mapped to schema.org `abstract` (answer-engine summary). */
  takeaways?: readonly string[];
  /** Publisher logo URL (required for Google News rich results). */
  publisherLogoUrl?: string | null;
  /** Emit SpeakableSpecification (voice assistants / AI answer engines). */
  speakable?: boolean;
}

/** Build the JSON-LD graph for an article/page. Emits NewsArticle for posts
 * (with publisher, author, dates, language, mainEntityOfPage), the
 * Google-recommended paywall markup for gated content, and the AEO layer:
 * articleSection, keywords, abstract (key takeaways) and speakable regions. */
export function buildArticleJsonLd(input: ArticleJsonLdInput): Record<string, unknown> {
  const { origin, path } = splitUrl(input.url);
  const canonical = absoluteUrl(origin, path);
  const publisher: Record<string, unknown> = {
    "@type": "Organization",
    name: SITE_NAME,
    ...(origin ? { url: origin } : {}),
    ...(input.publisherLogoUrl
      ? { logo: { "@type": "ImageObject", url: input.publisherLogoUrl } }
      : {}),
  };

  const graph: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": input.isArticle ? "NewsArticle" : "WebPage",
    headline: input.title,
    name: input.title,
    description: input.description,
    inLanguage: input.lang,
    ...(canonical
      ? { url: canonical, mainEntityOfPage: { "@type": "WebPage", "@id": canonical } }
      : {}),
    ...(input.image ? { image: [input.image] } : {}),
    ...(input.publishedAt ? { datePublished: input.publishedAt } : {}),
    ...(input.modifiedAt ? { dateModified: input.modifiedAt } : {}),
    publisher,
  };

  if (input.isArticle) {
    graph.author = input.authorName ? { "@type": "Person", name: input.authorName } : publisher;
    if (input.section) graph.articleSection = input.section;
    if (input.tags?.length) graph.keywords = input.tags.join(", ");
  }

  // Key takeaways double as the machine-readable abstract - the exact shape
  // answer engines lift into AI overviews and zero-click answer boxes.
  const abstract = (input.takeaways ?? []).map((t) => t.trim()).filter(Boolean);
  if (abstract.length) graph.abstract = abstract.join(" ");

  if (input.speakable) {
    graph.speakable = {
      "@type": "SpeakableSpecification",
      cssSelector: ["h1", ".key-takeaways", ".article-body > p:first-of-type"],
    };
  }

  if (input.gated) {
    graph.isAccessibleForFree = false;
    graph.hasPart = {
      "@type": "WebPageElement",
      isAccessibleForFree: false,
      cssSelector: input.paywallSelector ?? ".article-body",
    };
  }

  return graph;
}
