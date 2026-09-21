// Category archive: /category/$slug
// Uses global archive_layout_settings + one of 6 registered layouts.
// URL search state: ?page=N&sort=newest|oldest|popular
import { createFileRoute } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import {
  taxonomyArchiveQueryOptions,
  type ArchiveSort,
  type TaxonomyArchiveResult,
} from "@/lib/queries/archives";
import { TaxonomyPage } from "@/components/archive/TaxonomyPage";
import { PublicNotFound } from "@/components/molecules/PublicNotFound";

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
import { DegradedDataNotice } from "@/components/molecules/DegradedDataNotice";

/**
 * Wspólny termin ŻĄDANIA dla obu faz loadera. Dwa gołe `ensureQueryData`
 * biegły tu wcześniej SZEREGOWO i BEZ budżetu: watchdog SSR (5 s) anulował
 * zapytanie, `ensureQueryData` odrzucało, a loader oddawał HTTP 500 na
 * archiwum, które w indeksie jest żywe. Termin jest ABSOLUTNY, więc druga faza
 * dostaje resztę budżetu, a nie własne pełne okno.
 */
const ARCHIVE_SSR_BUDGET_MS = 1_400;

/**
 * Krótki termin KONFIGURACJI. `posts_per_page` wchodzi do KLUCZA listy
 * (`lib/queries/archives.ts:328`), więc listy fizycznie nie da się odpalić
 * równolegle z layoutem - ale layout nie ma prawa zjeść budżetu TREŚCI.
 * Po tych 300 ms wchodzą domyślki z kodu (`DEFAULT_ARCHIVE_LAYOUT`), a
 * `loadResilient` zasiewa je pod kluczem komponentu, więc `useSuspenseQuery`
 * w `TaxonomyPage` liczy TEN SAM klucz listy, co loader. Budżet liczy się
 * WYŁĄCZNIE w SSR (`lib/ssr/resilientLoad.ts`) - przy nawigacji po stronie
 * klienta loader czeka na konfigurację, bo nie ma tam TTFB do obrony.
 */
const ARCHIVE_LAYOUT_BUDGET_MS = 300;

/** Fallback konfiguracji archiwum - domyślki z kodu, nie zgadywanie z bazy. */
const CATEGORY_LAYOUT_FALLBACK: ArchiveLayoutSettings = {
  id: "",
  archive_type: "category",
  ...DEFAULT_ARCHIVE_LAYOUT,
};

/**
 * Fallback TOŻSAMOŚCIOWY. `null` jest tu WYŁĄCZNIE wartością zasiewu - o tym,
 * czy kategoria istnieje, decyduje flaga `degraded`, nigdy ten literał
 * (patrz `lib/ssr/notFoundIfClean.ts`).
 */
const NO_ARCHIVE: TaxonomyArchiveResult | null = null;

const VALID_SORT: ReadonlyArray<ArchiveSort> = ["newest", "oldest", "popular"];

function parseSearch(search: Record<string, unknown>): { page?: number; sort?: ArchiveSort } {
  const raw = Number(search.page);
  const page = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : undefined;
  // Only serialize sort when explicitly present and valid; the defaults must
  // stay implicit or the router keeps redirecting the URL back and forth
  // between `?sort=newest` and the canonical form.
  const sortRaw = search.sort != null ? String(search.sort) : undefined;
  const sort: ArchiveSort | undefined =
    sortRaw && VALID_SORT.includes(sortRaw as ArchiveSort) ? (sortRaw as ArchiveSort) : undefined;
  const out: { page?: number; sort?: ArchiveSort } = {};
  if (page !== undefined) out.page = page;
  if (sort !== undefined) out.sort = sort;
  return out;
}

export const Route = createFileRoute("/category/$slug")({
  validateSearch: parseSearch,
  loaderDeps: ({ search }) => ({ page: search.page ?? 1, sort: search.sort ?? "newest" }),
  loader: async ({ params, context, deps }) => {
    const deadlineAt = Date.now() + ARCHIVE_SSR_BUDGET_MS;
    // KONFIGURACJA NIE BLOKUJE TREŚCI. Krótki własny termin, potem domyślki.
    const settings = await loadResilient(
      context.queryClient,
      archiveLayoutQueryOptions("category"),
      CATEGORY_LAYOUT_FALLBACK,
      { budgetMs: ARCHIVE_LAYOUT_BUDGET_MS, deadlineAt, label: "archive-layout:category" },
    );
    const archive = await loadResilient(
      context.queryClient,
      taxonomyArchiveQueryOptions("category", params.slug, {
        page: deps.page,
        pageSize: settings.data.posts_per_page,
        sort: deps.sort,
      }),
      NO_ARCHIVE,
      { deadlineAt, label: `archive:category:${params.slug}` },
    );
    // DWIE RÓŻNE DEGRADACJE, DWIE RÓŻNE DECYZJE - i tylko JEDNA z nich zabiera
    // czytelnikowi treść.
    //
    // ŁADUNEK LOADERA: flaga `degraded` podmienia w komponencie CAŁĄ stronę na
    // `DegradedDataNotice`, więc wolno jej nieść WYŁĄCZNIE degradację TREŚCI
    // (`archive`). Gdyby brała też konfigurację, 300 ms zwisu
    // `archive_layout_settings` kasowałoby żywe archiwum z kompletną listą
    // wpisów - a `CATEGORY_LAYOUT_FALLBACK` powstał dokładnie po to, żeby tę
    // listę narysować na domyślkach z kodu. Degradację samej PREZENTACJI niesie
    // osobne `layoutDegraded`: jest diagnozą renderu, nie wyrokiem na treść.
    //
    // NAGŁÓWEK: TRZY stany dokumentu, trzy różne polityki - bo „zdegradowany"
    // nie znaczy tu jednego.
    //
    //   1. TREŚCI NIE ZNAMY (blip odczytu) albo taksonomii NIE MA (404):
    //      `no-store`. Obie sytuacje są przejściowe - slug bywa publikowany
    //      minutę po tym, jak crawler go odwiedził - a pusta powłoka nie ma
    //      prawa obsłużyć ani jednego kolejnego czytelnika.
    //   2. TREŚĆ PRAWDZIWA, PREZENTACJA Z DOMYŚLEK: dokument jest KOMPLETNY -
    //      te same wpisy, ten sam `head()`, tylko wariant layoutu z kodu
    //      zamiast z `archive_layout_settings`. Dla czytelnika jest poprawny,
    //      więc wolno go dzielić, ale KRÓTKO I Z REWALIDACJĄ
    //      (`chromeDegradedCacheControl()`: s-maxage 30 s, stale 300 s) - ta
    //      sama klasa co dostrumieniowany chrome w `__root.tsx` /
    //      `lib/ssr/chromeWarmup.tsx`. `no-store` kazałby KAŻDEMU czytelnikowi
    //      zimnej konfiguracji zapłacić pełny render (audyt CWV F02), a
    //      polityka treści zamroziłaby domyślny layout na 15 minut świeżości
    //      plus dobę okna stale.
    //   3. RENDER CZYSTY: dotychczasowa polityka treści - bajt w bajt.
    //
    // Polityka 2. nie przebije ostrzejszej decyzji innego loadera tego samego
    // żądania: `narrowestCacheControl` (lib/http/cachePolicy.ts) wybiera
    // MNIEJSZE `s-maxage`, a `private`/`no-store` wygrywa bezwarunkowo.
    setCacheControlHeader(
      archive.degraded || archive.data === null
        ? resilientCacheControl(true)
        : settings.degraded
          ? chromeDegradedCacheControl()
          : resilientCacheControl(false),
    );
    // 404 WYŁĄCZNIE z czystego odczytu - blip nie ma prawa wypisać archiwum
    // z indeksu.
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
        // Tu `null` znaczy „nie wiemy, czy ta kategoria istnieje" - odczyt
        // treści był zdegradowany (`notFoundIfClean` oddaje `null` wyłącznie
        // wtedy), więc strona ma powiedzieć to wprost zamiast udawać 404.
        degraded: true,
        layoutDegraded: settings.degraded,
      };
    }
    // Preload LCP pierwszej okładki (karta wyróżniona albo pierwsza karta
    // siatki) - deskryptor dla head() + nagłówek HTTP `Link` (utrwalany przez
    // NES Edge Cache na HIT/STALE; droga do 103 Early Hints).
    const coverPreload = archiveFirstCardPreload(data.posts, settings.data.show_featured_top);
    if (coverPreload) appendLinkHeader(imagePreloadLinkHeaderValue(coverPreload));
    // TREŚĆ jest prawdziwa, więc strona renderuje się normalnie - nawet gdy
    // layout przyjechał z fallbacku (`layoutDegraded`), bo domyślki z kodu są
    // pełnoprawną prezentacją, a nie brakiem danych.
    return { ...data, coverPreload, degraded: false, layoutDegraded: settings.degraded };
  },
  head: ({ loaderData, params }) => {
    const tax = loaderData?.taxonomy;
    const total = loaderData?.total ?? 0;
    const page = loaderData?.page ?? 1;
    const requestedUrl = getRequestUrl() || `/category/${params.slug}`;
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
      : lang === "en"
        ? "Category"
        : "Kategoria";
    const desc = tax
      ? lang === "en"
        ? tax.description_en || tax.description_pl
        : tax.description_pl || tax.description_en
      : null;
    const cleanedDesc =
      (desc ?? "")
        .replace(/<[^>]+>/g, " ")
        .trim()
        .slice(0, 160) ||
      (lang === "en"
        ? `Posts in the ${name} category (${total}).`
        : `Wpisy w kategorii ${name} (${total}).`);
    const title =
      page > 1
        ? lang === "en"
          ? `${name} - category (page ${page})`
          : `${name} - kategoria (strona ${page})`
        : lang === "en"
          ? `${name} - category`
          : `${name} - kategoria`;
    const head = buildContentHead({
      url,
      lang,
      type: "website",
      title,
      description: cleanedDesc,
      // Paginated pages are noindex to consolidate ranking on page 1.
      robots: page > 1 ? "noindex, follow" : null,
    });
    const { origin } = splitUrl(url);
    const originAbs = origin || SITE_CANONICAL_ORIGIN;
    const crumbsLabel = lang === "en" ? "Categories" : "Kategorie";
    const breadcrumbs = breadcrumbListJsonLd(
      [{ label: crumbsLabel, href: "/blog" }, { label: name }],
      originAbs,
      lang,
    );
    // CollectionPage node for archive semantics.
    const collection = {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: title,
      description: cleanedDesc,
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
        href: `${originAbs}${localizedPath(`/category/${params.slug}/rss.xml`, lang)}`,
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
  component: CategoryArchivePage,
  pendingComponent: () => <ArchiveSkeleton />,
  notFoundComponent: PublicNotFound,
  errorComponent: (props) => <RouteErrorFallback {...props} />,
});

function CategoryArchivePage() {
  const { slug } = Route.useParams();
  const { page = 1, sort = "newest" } = Route.useSearch();
  const { degraded } = Route.useLoaderData();
  // Render ZDEGRADOWANY mówi prawdę zamiast udawać 404. `TaxonomyPage` na
  // zasianym `null` pokazałby `PublicNotFound`, czyli miękkie 404 na żywej
  // kategorii - a nagłówek jest już `no-store`, więc ten HTML nie zamarza
  // na brzegu (wzór: events.$slug.tsx, podcasts.$show.tsx).
  //
  // Ta gałąź należy się WYŁĄCZNIE brakowi TREŚCI. Archiwum z wpisami, któremu
  // zdegradował się tylko layout, idzie normalną ścieżką niżej: wpisy są
  // prawdziwe, a rysuje je domyślny wariant z `DEFAULT_ARCHIVE_LAYOUT`.
  if (degraded) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <DegradedDataNotice variant="page" />
      </div>
    );
  }
  return <TaxonomyPage kind="category" slug={slug} page={page} sort={sort} />;
}
