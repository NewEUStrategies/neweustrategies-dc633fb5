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
import { homeLabel } from "@/lib/i18n/commonLabels";

/**
 * Serialize a JSON-LD graph for embedding inside a <script> element. Plain
 * JSON.stringify is NOT safe there: user-authored content containing
 * "</script>" (or an HTML comment / CDATA opener) terminates the script
 * element early and everything after it parses as live HTML - stored XSS.
 * Escaping <, >, & as \uXXXX keeps the payload identical after JSON.parse
 * (crawlers see the same graph) while making element breakout impossible.
 * U+2028/U+2029 are escaped for legacy JS-parser compatibility.
 */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export interface ContactPointInput {
  email?: string | null;
  telephone?: string | null;
  contactType?: string;
  areaServed?: string;
  availableLanguage?: readonly string[];
}

export interface OrganizationJsonLdInput {
  origin: string;
  lang: Lang;
  /** Social/profile URLs for entity disambiguation (sameAs). */
  sameAs?: readonly string[];
  /** Publisher logo (absolute URL preferred). */
  logoUrl?: string | null;
  description?: string | null;
  /** Optional customer/editorial contact point rendered in the footer. */
  contactPoint?: ContactPointInput | null;
}

/**
 * NewsMediaOrganization node - the brand entity AI assistants and Google's
 * knowledge graph resolve the site to. `@id` gives other nodes a stable
 * reference target.
 */
export function organizationJsonLd(input: OrganizationJsonLdInput): Record<string, unknown> {
  const sameAs = (input.sameAs ?? []).filter(Boolean);
  const cp = input.contactPoint;
  const contactPoint =
    cp && (cp.email || cp.telephone)
      ? {
          "@type": "ContactPoint",
          contactType: cp.contactType ?? "customer support",
          ...(cp.email ? { email: cp.email } : {}),
          ...(cp.telephone ? { telephone: cp.telephone } : {}),
          ...(cp.areaServed ? { areaServed: cp.areaServed } : {}),
          ...(cp.availableLanguage?.length ? { availableLanguage: [...cp.availableLanguage] } : {}),
        }
      : null;
  return {
    "@context": "https://schema.org",
    "@type": "NewsMediaOrganization",
    "@id": `${input.origin}/#organization`,
    name: SITE_NAME,
    url: input.origin,
    description: input.description?.trim() || SITE_DEFAULT_DESCRIPTION[input.lang],
    ...(input.logoUrl ? { logo: { "@type": "ImageObject", url: input.logoUrl } } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(contactPoint ? { contactPoint: [contactPoint] } : {}),
  };
}

export interface SiteNavigationItem {
  name: string;
  href: string;
}

/**
 * SiteNavigationElement graph - ujawnia crawlerom kluczowe linki stopki
 * (Editorial / Topics / Community / Institute / Legal). ItemList z ListItem
 * o typie SiteNavigationElement jest wzorcem rekomendowanym w schema.org do
 * opisania nawigacji globalnej strony.
 */
export function siteNavigationJsonLd(
  origin: string,
  items: readonly SiteNavigationItem[],
  lang: Lang,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${origin}/#footer-navigation`,
    name: lang === "en" ? "Footer navigation" : "Nawigacja stopki",
    inLanguage: lang,
    itemListElement: items.map((item, i) => ({
      "@type": "SiteNavigationElement",
      position: i + 1,
      name: item.name,
      url: item.href.startsWith("http")
        ? item.href
        : `${origin}${item.href.startsWith("/") ? item.href : `/${item.href}`}`,
    })),
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
  const home: BreadcrumbItem = { label: homeLabel(lang), href: "/" };
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

/** Jedno pytanie sesji Q&A w postaci nadającej się do markupu schema.org. */
export interface QaJsonLdQuestion {
  id: string;
  body: string;
  answer: string | null;
  authorName?: string | null;
  createdAt?: string | null;
  answeredAt?: string | null;
  upvotes?: number | null;
}

export interface QaSessionJsonLdInput {
  origin: string;
  lang: Lang;
  /** Kanoniczna ścieżka sesji, np. "/qa/moja-sesja" (bez prefiksu języka). */
  path: string;
  name: string;
  description?: string | null;
  questions: readonly QaJsonLdQuestion[];
  datePublished?: string | null;
  dateModified?: string | null;
}

/** Odpowiedź (Answer) jako węzeł schema.org - używana przez QAPage i FAQPage. */
function answerNode(q: QaJsonLdQuestion): Record<string, unknown> {
  return {
    "@type": "Answer",
    text: (q.answer ?? "").trim(),
    ...(q.answeredAt ? { dateCreated: q.answeredAt } : {}),
  };
}

/**
 * QAPage - właściwy typ dla sesji Q&A z wieloma pytaniami społeczności
 * (Google wymaga QAPage tam, gdzie pytania zadają użytkownicy; FAQPage jest
 * zarezerwowany dla treści redakcyjnych). Emitujemy wyłącznie pytania
 * z opublikowaną odpowiedzią - pytanie bez `acceptedAnswer`/`suggestedAnswer`
 * jest nieważne w rich results i psuje walidację całej strony.
 */
export function qaPageJsonLd(input: QaSessionJsonLdInput): Record<string, unknown> | null {
  const answered = input.questions.filter((q) => (q.answer ?? "").trim().length > 0);
  if (answered.length === 0) return null;
  const url = absoluteUrl(input.origin, localizedPath(input.path, input.lang));
  const [main, ...rest] = answered;
  const question = (q: QaJsonLdQuestion, accepted: boolean): Record<string, unknown> => ({
    "@type": "Question",
    "@id": `${url}#q-${q.id}`,
    name: q.body.trim().slice(0, 300),
    text: q.body.trim(),
    answerCount: 1,
    ...(typeof q.upvotes === "number" ? { upvoteCount: q.upvotes } : {}),
    ...(q.createdAt ? { dateCreated: q.createdAt } : {}),
    ...(q.authorName?.trim() ? { author: { "@type": "Person", name: q.authorName.trim() } } : {}),
    ...(accepted ? { acceptedAnswer: answerNode(q) } : { suggestedAnswer: answerNode(q) }),
  });
  return {
    "@context": "https://schema.org",
    "@type": "QAPage",
    "@id": `${url}#qapage`,
    url,
    inLanguage: input.lang,
    name: input.name,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.datePublished ? { datePublished: input.datePublished } : {}),
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
    isPartOf: { "@id": `${input.origin}/#website` },
    publisher: { "@id": `${input.origin}/#organization` },
    mainEntity: question(main, true),
    ...(rest.length ? { hasPart: rest.map((q) => question(q, true)) } : {}),
  };
}

export interface FaqJsonLdInput {
  origin: string;
  lang: Lang;
  path: string;
  items: ReadonlyArray<{ question: string; answer: string }>;
}

/**
 * FAQPage - dla redakcyjnych par pytanie/odpowiedź (np. podsumowanie sesji
 * przygotowane przez zespół). Zwraca null, gdy nie ma kompletnej pary.
 */
export function faqPageJsonLd(input: FaqJsonLdInput): Record<string, unknown> | null {
  const items = input.items
    .map((i) => ({ question: i.question.trim(), answer: i.answer.trim() }))
    .filter((i) => i.question.length > 0 && i.answer.length > 0);
  if (items.length === 0) return null;
  const url = absoluteUrl(input.origin, localizedPath(input.path, input.lang));
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${url}#faq`,
    url,
    inLanguage: input.lang,
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.question.slice(0, 300),
      acceptedAnswer: { "@type": "Answer", text: i.answer },
    })),
  };
}

export interface QaListJsonLdInput {
  origin: string;
  lang: Lang;
  path: string;
  name: string;
  description?: string | null;
  sessions: ReadonlyArray<{ slug: string; title: string }>;
}

/**
 * CollectionPage + ItemList dla listy sesji Q&A - crawler dostaje z SSR
 * komplet adresów sesji zamiast listy renderowanej dopiero po hydracji.
 */
export function qaCollectionJsonLd(input: QaListJsonLdInput): Record<string, unknown> {
  const url = absoluteUrl(input.origin, localizedPath(input.path, input.lang));
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#collection`,
    url,
    name: input.name,
    inLanguage: input.lang,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    isPartOf: { "@id": `${input.origin}/#website` },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: input.sessions.map((s, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: s.title,
        url: absoluteUrl(input.origin, localizedPath(`/qa/${s.slug}`, input.lang)),
      })),
    },
  };
}
