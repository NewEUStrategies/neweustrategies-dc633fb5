// Publiczny profil organizacji: /organization/$slug
//
// PO CO OSOBNA TRASA, SKORO `/category/<slug>` JUŻ COŚ RENDERUJE. Organizacja
// (`categories.kind = 'organization'`) miała dotąd wyłącznie archiwum kategorii:
// tytuł „NATO - kategoria" i lista wpisów. To opisuje TEMAT, nie INSTYTUCJĘ -
// nie ma logo, branży, adresu ani ludzi, a wyszukiwarka nie ma z czego zbudować
// wizytówki organizacji. Ta trasa jest kanonicznym adresem takiego bytu; stara
// trasa DZIAŁA DALEJ (zastane linki nie mogą paść), ale wskazuje tutaj
// znacznikiem `canonical`, a sitemapa emituje już tylko ten adres.
//
// Stan adresu (?page/?sort) jest DOKŁADNIE taki sam jak w archiwum taksonomii -
// lista publikacji to ten sam pivot i ta sama paginacja, więc nie wolno jej
// dawać drugiej, niezgodnej gramatyki URL-a.
import { createFileRoute, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useTransition } from "react";
import { useTranslation } from "react-i18next";

import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DegradedDataNotice } from "@/components/molecules/DegradedDataNotice";
import { PublicNotFound } from "@/components/molecules/PublicNotFound";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { OrganizationPeople } from "@/components/organizations/OrganizationPeople";
import { OrganizationPosts } from "@/components/organizations/OrganizationPosts";
import { OrganizationProfile } from "@/components/organizations/OrganizationProfile";
import { contentCacheControl } from "@/lib/http/cachePolicy";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { ensureI18n as ensureOrganizationsI18n } from "@/lib/i18n-organizations";
import { currentLang } from "@/lib/i18n/localeRuntime";
import { taxonomyArchiveQueryOptions, type ArchiveSort } from "@/lib/queries/archives";
import {
  ORGANIZATION_PAGE_SIZE,
  organizationCompanyNames,
  organizationDescription,
  organizationName,
  organizationQueryOptions,
  type OrganizationData,
} from "@/lib/queries/organization";
import { activeLang } from "@/lib/seo/head";
import { breadcrumbListJsonLd, safeJsonLd } from "@/lib/seo/jsonld";
import { buildContentHead, SITE_CANONICAL_ORIGIN, splitUrl } from "@/lib/seo/meta";
import { getRequestUrl } from "@/lib/seo/request";
import { loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";

const NO_STORE = contentCacheControl({ preview: true });

const VALID_SORT: ReadonlyArray<ArchiveSort> = ["newest", "oldest", "popular"];

/**
 * Fallback zapytania TOŻSAMOŚCIOWEGO. `null` jest tu wyłącznie wartością zasiewu
 * - o nieistnieniu organizacji rozstrzyga wynik zapytania, nigdy fallback
 * (rozróżnia je flaga `degraded`). Sfabrykowany 404 przy blipie backendu
 * wyrzuciłby indeksowaną stronę z wyników wyszukiwania.
 */
const ORGANIZATION_UNKNOWN: OrganizationData | null = null;

function parseSearch(search: Record<string, unknown>): { page?: number; sort?: ArchiveSort } {
  const raw = Number(search.page);
  const page = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : undefined;
  // Wartości domyślne zostają NIEJAWNE, inaczej router przepisywałby adres tam
  // i z powrotem między `?sort=newest` a postacią kanoniczną.
  const sortRaw = search.sort != null ? String(search.sort) : undefined;
  const sort: ArchiveSort | undefined =
    sortRaw && VALID_SORT.includes(sortRaw as ArchiveSort) ? (sortRaw as ArchiveSort) : undefined;
  const out: { page?: number; sort?: ArchiveSort } = {};
  if (page !== undefined) out.page = page;
  if (sort !== undefined) out.sort = sort;
  return out;
}

export const Route = createFileRoute("/organization/$slug")({
  validateSearch: parseSearch,
  loaderDeps: ({ search }) => ({ page: search.page ?? 1, sort: search.sort ?? "newest" }),
  loader: async ({ params, context, deps }) => {
    const lang = currentLang();
    // Lista publikacji nie zależy od tożsamości (pivot rezolwuje się po slugu),
    // więc jedzie RÓWNOLEGLE, a nie kolejną falą na ścieżce TTFB.
    // Obsługa odrzucenia wisi na promisie OD RAZU, a nie dopiero po
    // rozstrzygnięciu tożsamości. Gdyby archiwum padło, zanim `loadResilient`
    // skończy, między jednym a drugim byłby moment bez handlera - a nieobsłużone
    // odrzucenie w SSR ubija workera i zamienia żądanie w 500, choć intencją
    // jest degradacja do pustej listy.
    const postsPromise = context.queryClient
      .ensureQueryData(
        taxonomyArchiveQueryOptions("category", params.slug, {
          page: deps.page,
          pageSize: ORGANIZATION_PAGE_SIZE,
          sort: deps.sort,
        }),
      )
      .then(
        (data) => data,
        () => null,
      );
    const identity = await loadResilient(
      context.queryClient,
      organizationQueryOptions(params.slug, lang),
      ORGANIZATION_UNKNOWN,
    );
    if (identity.degraded) {
      setCacheControlHeader(resilientCacheControl(true));
      return { org: null, degraded: true, total: 0, page: deps.page, lang };
    }
    if (!identity.data) {
      setCacheControlHeader(NO_STORE);
      throw notFound();
    }
    // Publikacje są WTÓRNE wobec tożsamości: gdy nie dojadą, profil i tak ma się
    // wyrenderować, a lista dociągnie się po hydratacji.
    //
    // POLITYKA CACHE IDZIE PRZEZ `resilientCacheControl`, a nie przez własny
    // warunek. Różnica nie jest stylistyczna: brak listy publikacji to render
    // NIEPEŁNY, a wspólny nagłówek utrwaliłby go na brzegu na czas świeżości
    // PLUS okno `stale-while-revalidate` - czyli czytelnik dostawałby profil
    // bez dorobku długo po tym, jak archiwum wróciło do zdrowia.
    const archive = await postsPromise;
    setCacheControlHeader(resilientCacheControl(archive === null));
    return {
      org: identity.data,
      degraded: false,
      total: archive?.total ?? 0,
      page: deps.page,
      lang,
    };
  },
  head: ({ loaderData, params }) => {
    const org = loaderData?.org ?? null;
    const total = loaderData?.total ?? 0;
    const page = loaderData?.page ?? 1;
    // Kanoniczny adres BEZ parametrów listy - ranking konsoliduje się na
    // bazowym adresie profilu (ten sam wzorzec co archiwa taksonomii).
    const requestedUrl = getRequestUrl() || `/organization/${params.slug}`;
    const request = new URL(requestedUrl, SITE_CANONICAL_ORIGIN);
    request.searchParams.delete("page");
    request.searchParams.delete("sort");
    const url =
      request.origin === SITE_CANONICAL_ORIGIN && !requestedUrl.startsWith("http")
        ? request.pathname
        : request.toString();
    const lang = activeLang(url);
    const isEn = lang === "en";
    const name = org ? organizationName(org.term, lang) : isEn ? "Organization" : "Organizacja";
    const descRaw = org ? organizationDescription(org.term, lang) : null;
    const description =
      (descRaw ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160) ||
      (isEn
        ? `${name} - organization profile at New European Strategies.`
        : `${name} - profil organizacji w New European Strategies.`);
    const baseTitle = isEn ? `${name} - organization` : `${name} - organizacja`;
    const title = page > 1 ? `${baseTitle} (${isEn ? "page" : "strona"} ${page})` : baseTitle;

    const head = buildContentHead({
      url,
      lang,
      type: "website",
      title,
      description,
      image: org?.brand?.logoUrl ?? org?.term.logo_url ?? null,
      // Strony listy są noindex - indeksujemy jedną wizytówkę organizacji.
      robots: page > 1 ? "noindex, follow" : null,
    });

    // `url` bywa ABSOLUTNY (w SSR `getRequestUrl()` zwraca pełny adres), więc
    // sklejanie go z originem dawało `https://host/https://host/...` w danych
    // strukturalnych. Bierzemy sam pathname - `splitUrl` zwraca go w obu
    // postaciach wejścia.
    const { origin, path } = splitUrl(url);
    const originAbs = origin || SITE_CANONICAL_ORIGIN;
    const absUrl = `${originAbs}${path}`;
    const crumbsLabel = isEn ? "Organizations" : "Organizacje";
    const breadcrumbs = breadcrumbListJsonLd(
      [{ label: crumbsLabel, href: "/search" }, { label: name }],
      originAbs,
      lang,
    );
    // Adres WWW z kartoteki wchodzi jako `sameAs` - to jedyny zewnętrzny
    // identyfikator organizacji, jaki serwis o niej trzyma.
    const sameAs = org?.brand?.website ? [org.brand.website] : [];
    const logo = org?.brand?.logoUrl ?? org?.term.logo_url ?? null;
    const organizationLd: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name,
      url: absUrl,
      ...(logo ? { logo } : {}),
      ...(descRaw ? { description } : {}),
      ...(sameAs.length > 0 ? { sameAs } : {}),
      // Zero to nie „nie wiem" - deklarację dorobku wypisujemy dopiero, gdy jest.
      ...(total > 0 ? { subjectOf: { "@type": "CollectionPage", url: absUrl } } : {}),
    };

    return {
      ...head,
      scripts: [
        {
          type: "application/ld+json",
          children: safeJsonLd({ ...breadcrumbs, "@id": `${absUrl}#breadcrumbs` }),
        },
        { type: "application/ld+json", children: safeJsonLd(organizationLd) },
      ],
    };
  },
  component: OrganizationProfilePage,
  pendingComponent: () => <ArchiveSkeleton />,
  notFoundComponent: PublicNotFound,
  errorComponent: (props) => (
    <RouteErrorFallback
      {...props}
      title={
        activeLang() === "en"
          ? "Failed to load the organization profile"
          : "Nie udało się załadować profilu organizacji"
      }
    />
  ),
});

function OrganizationProfilePage() {
  // Rejestracja słownika w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureOrganizationsI18n();
  const { slug } = Route.useParams();
  const { page = 1, sort = "newest" } = Route.useSearch();
  const { degraded, lang } = Route.useLoaderData();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { data } = useSuspenseQuery(organizationQueryOptions(slug, lang));
  // Lista jest WTÓRNA: `useQuery`, nie `useSuspenseQuery` - jej awaria ma zostać
  // pustą sekcją z automatycznym ponowieniem, a nie wywróconym profilem.
  const archiveQ = useQuery(
    taxonomyArchiveQueryOptions("category", slug, {
      page,
      pageSize: ORGANIZATION_PAGE_SIZE,
      sort,
    }),
  );

  // Kolejność jest istotna: przy degradacji NIE WIEMY, czy organizacja istnieje,
  // więc nigdy nie pokazujemy „nie znaleziono".
  if (degraded) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-10">
        <DegradedDataNotice title={t("organization.loadFailed")} />
      </div>
    );
  }
  if (!data) return <PublicNotFound />;

  const archive = archiveQ.data ?? null;
  const posts = archive?.posts ?? [];
  const total = archive?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / ORGANIZATION_PAGE_SIZE));
  const name = organizationName(data.term, lang);

  // Wartości domyślne zostają NIEjawne także przy nawigacji imperatywnej.
  const searchFor = (nextPage: number) => ({
    page: nextPage > 1 ? nextPage : undefined,
    sort: sort !== "newest" ? sort : undefined,
  });
  const hrefFor = (nextPage: number) =>
    router.buildLocation({
      to: "/organization/$slug",
      params: { slug },
      search: searchFor(nextPage),
    }).publicHref;
  const onPageChange = (nextPage: number) =>
    startTransition(() => {
      void navigate({ to: "/organization/$slug", params: { slug }, search: searchFor(nextPage) });
    });

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1200px] px-4 pt-6 lg:px-8">
        <Breadcrumbs items={[{ label: name }]} />
      </div>
      <OrganizationProfile data={data} lang={lang} total={total}>
        <OrganizationPeople
          companyNames={organizationCompanyNames(data.term, data.brand)}
          heading={t("organization.peopleHeading")}
          verifiedLabel={t("organization.verified")}
        />
        <OrganizationPosts
          posts={posts}
          page={page}
          totalPages={totalPages}
          lang={lang}
          heading={t("organization.postsHeading")}
          emptyText={t("organization.postsEmpty")}
          isPending={isPending || archiveQ.isPending}
          onPageChange={onPageChange}
          hrefFor={hrefFor}
        />
      </OrganizationProfile>
    </div>
  );
}
