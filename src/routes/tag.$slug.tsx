// Tag archive: /tag/$slug - shares TaxonomyPage from category route.
// URL search state: ?page=N&sort=newest|oldest|popular
import { createFileRoute, notFound } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { PublicNotFound } from "@/components/molecules/PublicNotFound";
import { taxonomyArchiveQueryOptions, type ArchiveSort } from "@/lib/queries/archives";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { localizedPath } from "@/lib/i18n/localePath";
import { buildContentHead, splitUrl, SITE_CANONICAL_ORIGIN } from "@/lib/seo/meta";
import { archiveLayoutQueryOptions } from "@/lib/archive-layout-settings";
import { breadcrumbListJsonLd, safeJsonLd } from "@/lib/seo/jsonld";
import { TaxonomyPage } from "./category.$slug";
import "@/lib/i18n-archive-layout";

const VALID_SORT: ReadonlyArray<ArchiveSort> = ["newest", "oldest", "popular"];

function parseSearch(search: Record<string, unknown>): { page?: number; sort?: ArchiveSort } {
  const raw = Number(search.page);
  const page = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : undefined;
  const sortRaw = String(search.sort ?? "newest") as ArchiveSort;
  const sort: ArchiveSort | undefined = VALID_SORT.includes(sortRaw) ? sortRaw : undefined;
  return { page, sort };
}

export const Route = createFileRoute("/tag/$slug")({
  validateSearch: parseSearch,
  loaderDeps: ({ search }) => ({ page: search.page ?? 1, sort: search.sort ?? "newest" }),
  loader: async ({ params, context, deps }) => {
    const settings = await context.queryClient.ensureQueryData(archiveLayoutQueryOptions("tag"));
    const data = await context.queryClient.ensureQueryData(
      taxonomyArchiveQueryOptions("tag", params.slug, {
        page: deps.page,
        pageSize: settings.posts_per_page,
        sort: deps.sort,
      }),
    );
    if (!data) throw notFound();
    return data;
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
  return <TaxonomyPage kind="tag" slug={slug} page={page} sort={sort} />;
}
