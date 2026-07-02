// Site-level JSON-LD builders for the GEO/AEO layer: Organization (knowledge
// panel / brand entity), WebSite + SearchAction (sitelinks search box) and a
// localized BreadcrumbList. Pure and framework-free - route head() functions
// serialize the returned graphs into <script type="application/ld+json">.
//
// Emission strategy follows Google's guidance: Organization + WebSite on the
// homepage (one strong entity signal instead of noise on every URL),
// BreadcrumbList on every content page from SSR loader data (the previous
// body-level emission only appeared after hydration, so crawlers never saw it).
import { SITE_NAME, SITE_DEFAULT_DESCRIPTION, absoluteUrl, type Lang } from "@/lib/seo/meta";
import { localizedPath } from "@/lib/i18n/localePath";
import type { BreadcrumbItem } from "@/lib/breadcrumbs";

export interface OrganizationJsonLdInput {
  origin: string;
  lang: Lang;
  /** Social/profile URLs for entity disambiguation (sameAs). */
  sameAs?: readonly string[];
  /** Publisher logo (absolute URL preferred). */
  logoUrl?: string | null;
  description?: string | null;
}

/**
 * NewsMediaOrganization node - the brand entity AI assistants and Google's
 * knowledge graph resolve the site to. `@id` gives other nodes a stable
 * reference target.
 */
export function organizationJsonLd(input: OrganizationJsonLdInput): Record<string, unknown> {
  const sameAs = (input.sameAs ?? []).filter(Boolean);
  return {
    "@context": "https://schema.org",
    "@type": "NewsMediaOrganization",
    "@id": `${input.origin}/#organization`,
    name: SITE_NAME,
    url: input.origin,
    description: input.description?.trim() || SITE_DEFAULT_DESCRIPTION[input.lang],
    ...(input.logoUrl ? { logo: { "@type": "ImageObject", url: input.logoUrl } } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

/**
 * WebSite node with a SearchAction wired to the site search route - the markup
 * behind Google's sitelinks search box and a machine-readable entry point for
 * answer engines.
 */
export function webSiteJsonLd(origin: string, lang: Lang): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${origin}/#website`,
    name: SITE_NAME,
    url: origin,
    inLanguage: lang,
    publisher: { "@id": `${origin}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${origin}${localizedPath("/search", lang)}?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * BreadcrumbList from the already-localized breadcrumb items. Hrefs are
 * canonical unprefixed paths - they are localized per the render language so
 * the EN page's breadcrumbs point at "/en/..." URLs. The last item (current
 * page) carries no `item` URL, per Google's recommendation.
 */
export function breadcrumbListJsonLd(
  items: readonly BreadcrumbItem[],
  origin: string,
  lang: Lang,
): Record<string, unknown> {
  const home: BreadcrumbItem = { label: lang === "en" ? "Home" : "Start", href: "/" };
  const all = [home, ...items];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: all.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      ...(item.href && i < all.length - 1
        ? { item: absoluteUrl(origin, localizedPath(item.href, lang)) }
        : {}),
    })),
  };
}
