// Pure, framework-free SEO builders. Given the current request URL and the
// resolved content, they produce the meta/link descriptors for TanStack head()
// and the JSON-LD graph. Kept side-effect free so they are fully unit-testable
// without SSR or a DOM.

export type Lang = "pl" | "en";

export const SITE_NAME = "New European Strategies";
export const SUPPORTED_LANGS: readonly Lang[] = ["pl", "en"];
export const OG_LOCALE: Record<Lang, string> = { pl: "pl_PL", en: "en_US" };

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

/** hreflang cluster: x-default + one self-addressable URL per language. The
 * `?lang=` variants are honoured by i18n so each genuinely serves its language. */
export function hreflangLinks(
  origin: string,
  path: string,
): Array<{ rel: string; hreflang: string; href: string }> {
  const base = absoluteUrl(origin, path);
  return [
    { rel: "alternate", hreflang: "x-default", href: base },
    ...SUPPORTED_LANGS.map((l) => ({
      rel: "alternate",
      hreflang: l,
      href: `${base}?lang=${l}`,
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
}

export interface HeadDescriptor {
  meta: Array<Record<string, string>>;
  links: Array<Record<string, string>>;
}

/** Build the <head> meta + links for a content page (article or listing). */
export function buildContentHead(input: ContentHeadInput): HeadDescriptor {
  const { origin, path } = splitUrl(input.url);
  const canonical = absoluteUrl(origin, path);
  const altLang: Lang = input.lang === "pl" ? "en" : "pl";

  const meta: Array<Record<string, string>> = [
    { title: input.title },
    { name: "description", content: input.description },
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:type", content: input.type },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: OG_LOCALE[input.lang] },
    { property: "og:locale:alternate", content: OG_LOCALE[altLang] },
    { name: "twitter:card", content: input.image ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: input.description },
    { httpEquiv: "content-language", content: input.lang },
  ];

  if (canonical) meta.push({ property: "og:url", content: canonical });
  if (input.image) {
    meta.push({ property: "og:image", content: input.image });
    meta.push({ name: "twitter:image", content: input.image });
  }
  if (input.noindex) meta.push({ name: "robots", content: "noindex, nofollow" });

  if (input.type === "article") {
    if (input.publishedAt) meta.push({ property: "article:published_time", content: input.publishedAt });
    if (input.modifiedAt) meta.push({ property: "article:modified_time", content: input.modifiedAt });
    if (input.section) meta.push({ property: "article:section", content: input.section });
    for (const tag of input.tags ?? []) meta.push({ property: "article:tag", content: tag });
  }

  const links: Array<Record<string, string>> = [];
  if (canonical) links.push({ rel: "canonical", href: canonical });
  for (const alt of hreflangLinks(origin, path)) links.push(alt);

  return { meta, links };
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
}

/** Build the JSON-LD graph for an article/page. Emits NewsArticle for posts
 * (with publisher, author, dates, language, mainEntityOfPage) and the
 * Google-recommended paywall markup for gated content. */
export function buildArticleJsonLd(input: ArticleJsonLdInput): Record<string, unknown> {
  const { origin, path } = splitUrl(input.url);
  const canonical = absoluteUrl(origin, path);
  const publisher: Record<string, unknown> = {
    "@type": "Organization",
    name: SITE_NAME,
    ...(origin ? { url: origin } : {}),
  };

  const graph: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": input.isArticle ? "NewsArticle" : "WebPage",
    headline: input.title,
    name: input.title,
    description: input.description,
    inLanguage: input.lang,
    ...(canonical ? { url: canonical, mainEntityOfPage: { "@type": "WebPage", "@id": canonical } } : {}),
    ...(input.image ? { image: [input.image] } : {}),
    ...(input.publishedAt ? { datePublished: input.publishedAt } : {}),
    ...(input.modifiedAt ? { dateModified: input.modifiedAt } : {}),
    publisher,
  };

  if (input.isArticle) {
    graph.author = input.authorName
      ? { "@type": "Person", name: input.authorName }
      : publisher;
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
