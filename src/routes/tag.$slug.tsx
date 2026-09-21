// Tag archive: /tag/$slug - shares TaxonomyPage (components/archive/TaxonomyPage).
// URL search state: ?page=N&sort=newest|oldest|popular
import { createFileRoute } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { PublicNotFound } from "@/components/molecules/PublicNotFound";
import {
  taxonomyArchiveQueryOptions,
  type ArchiveSort,
  type TaxonomyArchiveResult,
} from "@/lib/queries/archives";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { localizedPath } from "@/lib/i18n/localePath";
import {
  buildContentHead,
  imagePreloadLink,
  imagePreloadLinkHeaderValue,
  splitUrl,
  SITE_CANONICAL_ORIGIN,
} from "@/lib/seo/meta";
import {
  archiveLayoutQueryOptions,
  DEFAULT_ARCHIVE_LAYOUT,
  type ArchiveLayoutSettings,
} from "@/lib/archive-layout-settings";
import { breadcrumbListJsonLd, safeJsonLd } from "@/lib/seo/jsonld";
import { archiveFirstCardPreload } from "@/lib/seo/archivePreload";
import { appendLinkHeader, setCacheControlHeader } from "@/lib/http/responseHeaders";
import { chromeDegradedCacheControl } from "@/lib/http/cachePolicy";
import { loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { notFoundIfClean } from "@/lib/ssr/notFoundIfClean";
import { TaxonomyPage } from "@/components/archive/TaxonomyPage";

/** Wspólny termin ŻĄDANIA obu faz - identyczny kontrakt co w category.$slug. */
const TAG_ARCHIVE_SSR_BUDGET_MS = 1_400;

/**
 * Krótki termin KONFIGURACJI: `posts_per_page` wchodzi do klucza listy, więc
 * layout musi rozstrzygnąć się PRZED treścią - ale nie kosztem jej budżetu.
 * Jak w `category.$slug`: budżet obowiązuje wyłącznie w SSR.
 */
const TAG_ARCHIVE_LAYOUT_BUDGET_MS = 300;

/** Fallback konfiguracji archiwum tagu - domyślki z kodu. */
const TAG_LAYOUT_FALLBACK: ArchiveLayoutSettings = {
  id: "",
  archive_type: "tag",
  ...DEFAULT_ARCHIVE_LAYOUT,
};

/** Fallback TOŻSAMOŚCIOWY - o 404 decyduje `degraded`, nie ten literał. */
const NO_ARCHIVE: TaxonomyArchiveResult | null = null;

const VALID_SORT: ReadonlyArray<ArchiveSort> = ["newest", "oldest", "popular"];

function parseSearch(search: Record<string, unknown>): { page?: number; sort?: ArchiveSort } {
  const raw = Number(search.page);
  const page = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : undefined;
  // Keep defaults implicit; otherwise the router loops between `?sort=newest`
  // and the canonical form (see category.$slug.tsx for the same fix).
  const sortRaw = search.sort != null ? String(search.sort) : undefined;
  const sort: ArchiveSort | undefined =
    sortRaw && VALID_SORT.includes(sortRaw as ArchiveSort) ? (sortRaw as ArchiveSort) : undefined;
  const out: { page?: number; sort?: ArchiveSort } = {};
  if (page !== undefined) out.page = page;
  if (sort !== undefined) out.sort = sort;
  return out;
}

export const Route = createFileRoute("/tag/$slug")({
  validateSearch: parseSearch,
  loaderDeps: ({ search }) => ({ page: search.page ?? 1, sort: search.sort ?? "newest" }),
  loader: async ({ params, context, deps }) => {
    const deadlineAt = Date.now() + TAG_ARCHIVE_SSR_BUDGET_MS;
    // KONFIGURACJA NIE BLOKUJE TREŚCI - krótki termin, potem domyślki z kodu.
    const settings = await loadResilient(
      context.queryClient,
      archiveLayoutQueryOptions("tag"),
      TAG_LAYOUT_FALLBACK,
      { budgetMs: TAG_ARCHIVE_LAYOUT_BUDGET_MS, deadlineAt, label: "archive-layout:tag" },
    );
    const archive = await loadResilient(
      context.queryClient,
      taxonomyArchiveQueryOptions("tag", params.slug, {
        page: deps.page,
        pageSize: settings.data.posts_per_page,
        sort: deps.sort,
      }),
      NO_ARCHIVE,
      { deadlineAt, label: `archive:tag:${params.slug}` },
    );
    // Rozdział degradacji IDENTYCZNY co w `category.$slug` (tam pełny opis):
    // do ładunku loadera idzie tylko degradacja TREŚCI, bo na niej komponent
    // podmienia całą stronę na komunikat - zwis konfiguracji ma dać listę
    // wpisów na domyślkach, a nie zgasić żywe archiwum tagu.
    //
    // BRAMKA NAGŁÓWKA, której ta trasa NIE MIAŁA W OGÓLE: bez niej render
    // niepełny (albo 404) brał domyślną politykę treści z middleware i mógł
    // utrwalić się na brzegu na 15 minut świeżości plus dobę okna stale.
    // Trzy stany dokumentu, trzy polityki - pełne uzasadnienie w
    // `category.$slug.tsx`: brak treści/404 -> `no-store`; treść prawdziwa na
    // domyślnym layoucie -> krótka świeżość z rewalidacją (dokument kompletny,
    // więc dzielimy go 30 s zamiast renderować od zera każdemu czytelnikowi
    // zimnej konfiguracji); render czysty -> polityka treści.
    setCacheControlHeader(
      archive.degraded || archive.data === null
        ? resilientCacheControl(true)
        : settings.degraded
          ? chromeDegradedCacheControl()
          : resilientCacheControl(false),
    );
    const data = notFoundIfClean(archive);
    if (data === null) {
      return {
        taxonomy: null,
        posts: [],
        total: 0,
        page: deps.page,
        pageSize: settings.data.posts_per_page,
        sort: deps.sort,
        coverPreload: null,
        // „Nie wiemy, czy ten tag istnieje" - `notFoundIfClean` oddaje `null`
        // wyłącznie przy zdegradowanym odczycie treści.
        degraded: true,
        layoutDegraded: settings.degraded,
      };
    }
    // Preload LCP pierwszej okładki (jak w category.$slug): deskryptor dla
    // head() + nagłówek HTTP `Link` utrwalany przez NES Edge Cache.
    const coverPreload = archiveFirstCardPreload(data.posts, settings.data.show_featured_top);
    if (coverPreload) appendLinkHeader(imagePreloadLinkHeaderValue(coverPreload));
    // Treść prawdziwa = strona renderuje się normalnie, także na domyślkach
    // layoutu (`layoutDegraded`).
    return { ...data, coverPreload, degraded: false, layoutDegraded: settings.degraded };
  },
  head: ({ loaderData, params }) => {
    const tax = loaderData?.taxonomy;
    const total = loaderData?.total ?? 0;
    const page = loaderData?.page ?? 1;
    const requestedUrl = getRequestUrl() || `/tag/${params.slug}`;
    const request = new URL(requestedUrl, SITE_CANONICAL_ORIGIN);
    request.searchParams.delete("page");
    request.searchParams.delete("sort");
    const url =
      request.origin === SITE_CANONICAL_ORIGIN && !requestedUrl.startsWith("http")
        ? request.pathname
        : request.toString();
    const lang = activeLang(url);
    const name = tax
      ? lang === "en"
        ? tax.name_en || tax.name_pl
        : tax.name_pl || tax.name_en
      : "Tag";
    const description =
      lang === "en"
        ? `Posts tagged ${name} (${total}).`
        : `Wpisy oznaczone tagiem ${name} (${total}).`;
    const title =
      page > 1
        ? lang === "en"
          ? `#${name} - tag (page ${page})`
          : `#${name} - tag (strona ${page})`
        : `#${name} - tag`;
    const head = buildContentHead({
      url,
      lang,
      type: "website",
      title,
      description,
      robots: page > 1 ? "noindex, follow" : null,
    });
    const { origin } = splitUrl(url);
    const originAbs = origin || SITE_CANONICAL_ORIGIN;
    const crumbsLabel = lang === "en" ? "Tags" : "Tagi";
    const breadcrumbs = breadcrumbListJsonLd(
      [{ label: crumbsLabel, href: "/blog" }, { label: `#${name}` }],
      originAbs,
      lang,
      // Ostatni okruszek MUSI mieć `item` (Search Console: brakujące pole item).
      splitUrl(url).path,
    );
    const collection = {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: title,
      description,
      inLanguage: lang,
      url: `${originAbs}${url.startsWith("/") ? url : `/${url}`}`,
      isPartOf: { "@id": `${originAbs}/#website` },
      breadcrumb: { "@id": `${originAbs}${url}#breadcrumbs` },
    };
    // Autodiscovery feedu tematycznego - czytniki RSS i agregatory widzą
    // kanal kategorii/tagu bez znajomosci konwencji URL.
    const feedLinks = [
      ...head.links,
      ...(loaderData?.coverPreload ? [imagePreloadLink(loaderData.coverPreload)] : []),
      {
        rel: "alternate",
        type: "application/rss+xml",
        title: `${name} - RSS`,
        href: `${originAbs}${localizedPath(`/tag/${params.slug}/rss.xml`, lang)}`,
      },
    ];
    return {
      ...head,
      links: feedLinks,
      scripts: [
        {
          type: "application/ld+json",
          children: safeJsonLd({ ...breadcrumbs, "@id": `${originAbs}${url}#breadcrumbs` }),
        },
        { type: "application/ld+json", children: safeJsonLd(collection) },
      ],
    };
  },
  component: TagArchivePage,
  pendingComponent: () => <ArchiveSkeleton />,
  notFoundComponent: PublicNotFound,
  errorComponent: (props) => <RouteErrorFallback {...props} />,
});

function TagArchivePage() {
  const { slug } = Route.useParams();
  const { page = 1, sort = "newest" } = Route.useSearch();
  const { degraded } = Route.useLoaderData();
  return <TaxonomyPage kind="tag" slug={slug} page={page} sort={sort} initialDegraded={degraded} />;
}
