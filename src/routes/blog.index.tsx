// Public blog archive. URL: /blog
// URL search state: ?page=N (SSR-paginated jak archiwa taksonomii).
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTransition } from "react";
import { useTranslation } from "react-i18next";
import { FooterSlideup } from "@/components/ads/FooterSlideup";
import { useInFeedAds } from "@/components/ads/useInFeedAds";
import { PaginatedPostGrid } from "@/components/archive/PaginatedPostGrid";
import {
  blogArchiveQueryOptions,
  resolvePostsPerPage,
  type BlogArchiveResult,
} from "@/lib/queries/public";
import { parsePageSearch } from "@/lib/routing/pageSearch";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { withBudget } from "@/lib/asyncBudget";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import {
  buildContentHead,
  imagePreloadLink,
  imagePreloadLinkHeaderValue,
  splitUrl,
  SITE_CANONICAL_ORIGIN,
} from "@/lib/seo/meta";
import { breadcrumbListJsonLd, safeJsonLd } from "@/lib/seo/jsonld";
import { archiveFirstCardPreload } from "@/lib/seo/archivePreload";
import { appendLinkHeader, setCacheControlHeader } from "@/lib/http/responseHeaders";
import { contentCacheControl } from "@/lib/http/cachePolicy";

const BLOG_LOADER_BUDGET_MS = 4_000;
const NO_STORE = contentCacheControl({ preview: true });

export const Route = createFileRoute("/blog/")({
  // Defensywny parser `?page` współdzielony ze stroną główną w trybie
  // "najnowsze wpisy" (parsePageSearch) - jeden kontrakt URL-a paginacji.
  validateSearch: parsePageSearch,
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  // SSR ładuje DOKŁADNIE żądaną stronę archiwum (`?page=N`), jak trasy
  // taksonomii - każda strona wyników ma własny, indeksowalny URL. Dawne
  // "load more" rosnącym limitem nie zostawiało crawlerom żadnej ścieżki do
  // wpisów spoza pierwszej strony. Rozmiar strony honoruje ustawienie
  // czytania (posts_per_page) - ustawienia są już ciepłe z root loadera,
  // więc to odczyt z cache, nie dodatkowy fetch.
  loader: async ({ context, deps }) => {
    await withBudget(
      context.queryClient.ensureQueryData(siteSettingsQueryOptions).catch(() => undefined),
      BLOG_LOADER_BUDGET_MS,
    );
    const settings =
      context.queryClient.getQueryData<Record<string, unknown>>(
        siteSettingsQueryOptions.queryKey,
      ) ?? Object.freeze({});
    if (!context.queryClient.getQueryData(siteSettingsQueryOptions.queryKey)) {
      // updatedAt: 0 - seed od razu przeterminowany, klient dociąga po mount.
      context.queryClient.setQueryData(siteSettingsQueryOptions.queryKey, settings, {
        updatedAt: 0,
      });
    }
    const pageSize = resolvePostsPerPage(settings);
    const listOptions = blogArchiveQueryOptions({ page: deps.page, pageSize });
    await withBudget(
      context.queryClient.ensureQueryData(listOptions).catch(() => undefined),
      BLOG_LOADER_BUDGET_MS,
    );
    const data = context.queryClient.getQueryData<BlogArchiveResult>(listOptions.queryKey);
    if (!data) {
      // Render zdegradowany (blip backendu / budżet): pusta powłoka, która
      // samoleczy się na kliencie i NIGDY nie trafia do wspólnego cache.
      context.queryClient.setQueryData(
        listOptions.queryKey,
        { posts: [], total: 0, page: deps.page, pageSize } satisfies BlogArchiveResult,
        { updatedAt: 0 },
      );
      setCacheControlHeader(NO_STORE);
      return { page: deps.page, total: 0, coverPreload: null };
    }
    setCacheControlHeader(contentCacheControl());
    // Preload LCP pierwszej karty siatki (PaginatedPostGrid oznacza ją
    // priority) - deskryptor dla head() + nagłówek HTTP `Link` utrwalany
    // przez NES Edge Cache na HIT/STALE.
    const coverPreload = archiveFirstCardPreload(data.posts, false);
    if (coverPreload) appendLinkHeader(imagePreloadLinkHeaderValue(coverPreload));
    return { page: data.page, total: data.total, coverPreload };
  },

  head: ({ loaderData }) => {
    const page = loaderData?.page ?? 1;
    const total = loaderData?.total ?? 0;
    const requestedUrl = getRequestUrl() || "/blog";
    // Kanoniczny URL bez parametrów paginacji - konsolidacja rankingu na
    // stronie pierwszej (ten sam model co archiwa kategorii/tagów).
    const request = new URL(requestedUrl, SITE_CANONICAL_ORIGIN);
    request.searchParams.delete("page");
    const url =
      request.origin === SITE_CANONICAL_ORIGIN && !requestedUrl.startsWith("http")
        ? request.pathname
        : request.toString();
    const lang = activeLang(url);
    const title =
      page > 1
        ? lang === "en"
          ? `Blog (page ${page}) - New European Strategies`
          : `Blog (strona ${page}) - New European Strategies`
        : "Blog - New European Strategies";
    const description =
      lang === "en"
        ? "Analyses, interviews and reports - the New European Strategies blog."
        : "Analizy, wywiady i raporty - blog New European Strategies.";
    const head = buildContentHead({
      url,
      lang,
      type: "website",
      title,
      description,
      // Strony paginacji są noindex,follow - crawler podąża za linkami do
      // wpisów, ale indeks buduje wyłącznie strona pierwsza.
      robots: page > 1 ? "noindex, follow" : null,
    });
    const { origin } = splitUrl(url);
    const originAbs = origin || SITE_CANONICAL_ORIGIN;
    const breadcrumbs = breadcrumbListJsonLd([{ label: "Blog" }], originAbs, lang);
    // CollectionPage - semantyka archiwum spójna z archiwami taksonomii.
    const collection = {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: title,
      description,
      inLanguage: lang,
      url: `${originAbs}${url.startsWith("/") ? url : `/${url}`}`,
      ...(total > 0 ? { numberOfItems: total } : {}),
      isPartOf: { "@id": `${originAbs}/#website` },
      breadcrumb: { "@id": `${originAbs}${url}#breadcrumbs` },
    };
    return {
      ...head,
      links: loaderData?.coverPreload
        ? [...head.links, imagePreloadLink(loaderData.coverPreload)]
        : head.links,
      scripts: [
        {
          type: "application/ld+json",
          children: safeJsonLd({ ...breadcrumbs, "@id": `${originAbs}${url}#breadcrumbs` }),
        },
        { type: "application/ld+json", children: safeJsonLd(collection) },
      ],
    };
  },
  component: BlogIndex,
  pendingComponent: () => <ArchiveSkeleton />,
  errorComponent: (props) => (
    <RouteErrorFallback
      {...props}
      title={activeLang() === "en" ? "Failed to load the list" : "Nie udało się załadować listy"}
    />
  ),
});

function BlogIndex() {
  // Rozmiar strony z ustawień czytania (ten sam odczyt co loader - klucz
  // zapytania musi się zgadzać, inaczej hydracja robiłaby drugi fetch).
  const { data: settingsMap } = useSuspenseQuery(siteSettingsQueryOptions);
  const pageSize = resolvePostsPerPage(settingsMap);
  const { page = 1 } = Route.useSearch();
  const {
    data: { posts, total },
  } = useSuspenseQuery(blogArchiveQueryOptions({ page, pageSize }));
  const navigate = useNavigate();
  const router = useRouter();
  // Zmiana strony biegnie w transition - obecna siatka zostaje na ekranie
  // (bez pustego fallbacku), a isPending steruje stanem kontrolek paginacji.
  const [isPending, startTransition] = useTransition();
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  // /blog to archiwum wpisów - dotąd pytał o typ "home", przez co placementy
  // zadeklarowane dla "Archiwa" nigdy się tu nie emitowały (a "home" mylnie tak).
  const inFeed = useInFeedAds("archive");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // SEO: realne adresy stron wyników (linkowa paginacja). publicHref przechodzi
  // przez rewrite routera, więc niesie właściwy prefiks języka (/en/blog?...).
  const searchFor = (nextPage: number) => ({ page: nextPage > 1 ? nextPage : undefined });
  const hrefFor = (nextPage: number) =>
    router.buildLocation({ to: "/blog", search: searchFor(nextPage) }).publicHref;
  const onPageChange = (nextPage: number) =>
    startTransition(() => {
      void navigate({ to: "/blog", search: searchFor(nextPage) });
    });

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="flex-1 max-w-[1200px] w-full mx-auto px-4 lg:px-8 py-10">
        <Breadcrumbs items={[{ label: "Blog" }]} />
        <h1 className="font-display text-4xl lg:text-5xl mb-8">Blog</h1>
        <PaginatedPostGrid
          posts={posts}
          page={page}
          totalPages={totalPages}
          lang={lang}
          emptyText={t("blog.empty", {
            defaultValue: lang === "en" ? "No published posts yet." : "Brak opublikowanych wpisów.",
          })}
          isPending={isPending}
          onPageChange={onPageChange}
          hrefFor={hrefFor}
          renderAfterCard={inFeed}
        />
      </div>
      <FooterSlideup pageType="archive" />
    </div>
  );
}
