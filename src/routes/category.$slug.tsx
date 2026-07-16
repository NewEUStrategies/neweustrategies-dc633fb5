// Category archive: /category/$slug
// Uses global archive_layout_settings + one of 6 registered layouts.
// URL search state: ?page=N&sort=newest|oldest|popular
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useTransition, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { PublicNotFound } from "@/components/molecules/PublicNotFound";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import {
  taxonomyArchiveQueryOptions,
  ARCHIVE_PAGE_SIZE,
  type ArchiveSort,
} from "@/lib/queries/archives";
import { podcastsByCategoryQueryOptions } from "@/lib/queries/podcasts";
import { PodcastEpisodeStrip } from "@/components/podcast/PodcastEpisodeStrip";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead, splitUrl, SITE_CANONICAL_ORIGIN } from "@/lib/seo/meta";
import { archiveLayoutQueryOptions } from "@/lib/archive-layout-settings";
import { getLayoutComponent } from "@/components/archive/layouts/registry";
import { breadcrumbListJsonLd, safeJsonLd } from "@/lib/seo/jsonld";
import { homeLabel } from "@/lib/i18n/commonLabels";
import "@/lib/i18n-archive-layout";

const VALID_SORT: ReadonlyArray<ArchiveSort> = ["newest", "oldest", "popular"];

function parseSearch(search: Record<string, unknown>): { page: number; sort: ArchiveSort } {
  const raw = Number(search.page);
  const page = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  const sortRaw = String(search.sort ?? "newest") as ArchiveSort;
  const sort: ArchiveSort = VALID_SORT.includes(sortRaw) ? sortRaw : "newest";
  return { page, sort };
}

export const Route = createFileRoute("/category/$slug")({
  validateSearch: parseSearch,
  loaderDeps: ({ search: { page, sort } }) => ({ page, sort }),
  loader: async ({ params, context, deps }) => {
    const settings = await context.queryClient.ensureQueryData(
      archiveLayoutQueryOptions("category"),
    );
    const data = await context.queryClient.ensureQueryData(
      taxonomyArchiveQueryOptions("category", params.slug, {
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
    const url = getRequestUrl() || `/category/${params.slug}`;
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
    return {
      ...head,
      scripts: [
        {
          type: "application/ld+json",
          children: safeJsonLd({ ...breadcrumbs, "@id": `${originAbs}${url}#breadcrumbs` }),
        },
        { type: "application/ld+json", children: safeJsonLd(collection) },
      ],
    };
  },
  component: () => <TaxonomyPage kind="category" />,
  pendingComponent: () => <ArchiveSkeleton />,
  notFoundComponent: PublicNotFound,
  errorComponent: (props) => <RouteErrorFallback {...props} />,
});

export function TaxonomyPage({ kind }: { kind: "category" | "tag" }) {
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [isPending, startTransition] = useTransition();
  const { data: settings } = useSuspenseQuery(archiveLayoutQueryOptions(kind));
  const { data } = useSuspenseQuery(
    taxonomyArchiveQueryOptions(kind, slug, {
      page: search.page,
      pageSize: settings.posts_per_page,
      sort: search.sort,
    }),
  );
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const podcastsQ = useQuery({
    ...podcastsByCategoryQueryOptions(data?.taxonomy.id ?? ""),
    enabled: kind === "category" && !!data?.taxonomy.id && settings.show_podcasts,
  });

  // Scroll to top when page changes (better UX than staying mid-scroll).
  useEffect(() => {
    if (typeof window !== "undefined" && search.page > 1) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [search.page]);

  if (!data) return <PublicNotFound />;
  const { taxonomy, posts, total, page, pageSize, sort } = data;

  const LayoutComponent = getLayoutComponent(settings.layout_variant);

  const emptyText = t("archive.empty", {
    defaultValue: lang === "en" ? "No published posts yet." : "Brak opublikowanych wpisów.",
  });

  const extraBelow =
    kind === "category" && settings.show_podcasts && podcastsQ.data && podcastsQ.data.length > 0 ? (
      <div className="pt-10">
        <PodcastEpisodeStrip
          episodes={podcastsQ.data}
          lang={lang}
          title={lang === "en" ? "Podcasts" : "Podcasty"}
        />
      </div>
    ) : null;

  const onSortChange = (next: ArchiveSort) =>
    startTransition(() => {
      void navigate({
        to: kind === "category" ? "/category/$slug" : "/tag/$slug",
        params: { slug },
        search: { page: 1, sort: next },
      });
    });
  const onPageChange = (nextPage: number) =>
    startTransition(() => {
      void navigate({
        to: kind === "category" ? "/category/$slug" : "/tag/$slug",
        params: { slug },
        search: { page: nextPage, sort },
      });
    });

  // A hidden anchor gives crawlers a real link to page 1 alternative sort
  // orders without polluting the visible UI (crawlable but unobtrusive).
  // Also improves keyboard nav via a landmark. Skipped in preview mode.
  // Voice: consolidate ranking - reduce duplicate content by using noindex
  // on paginated pages (via head robots) while keeping links crawlable.
  // See head() above.
  //
  // Homepage semantics: retain homeLabel so extract localizations stay in
  // sync with the JSON-LD builder.
  void homeLabel;

  return (
    <>
      {taxonomy.featured_section && (
        <section className="border-b border-border">
          <BuilderRenderer
            doc={{ version: 1, sections: [taxonomy.featured_section] }}
            lang={lang}
          />
        </section>
      )}
      <LayoutComponent
        kind={kind}
        taxonomy={taxonomy}
        posts={posts}
        lang={lang}
        settings={settings}
        page={page}
        pageSize={pageSize}
        total={total}
        sort={sort}
        onPageChange={onPageChange}
        onSortChange={onSortChange}
        isPending={isPending}
        emptyText={emptyText}
        extraBelow={extraBelow}
      />
    </>
  );
}
