// Tag archive: /tag/$slug - shares TaxonomyPage from category route.
import { createFileRoute, notFound } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { PublicNotFound } from "@/components/molecules/PublicNotFound";
import { taxonomyArchiveQueryOptions } from "@/lib/queries/archives";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import { archiveLayoutQueryOptions } from "@/lib/archive-layout-settings";
import { TaxonomyPage } from "./category.$slug";
import "@/lib/i18n-archive-layout";

export const Route = createFileRoute("/tag/$slug")({
  loader: async ({ params, context }) => {
    const [data] = await Promise.all([
      context.queryClient.ensureQueryData(taxonomyArchiveQueryOptions("tag", params.slug)),
      context.queryClient.ensureQueryData(archiveLayoutQueryOptions("tag")),
    ]);
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData, params }) => {
    const tax = loaderData?.taxonomy;
    const url = getRequestUrl() || `/tag/${params.slug}`;
    const lang = activeLang(url);
    const name = tax
      ? lang === "en"
        ? tax.name_en || tax.name_pl
        : tax.name_pl || tax.name_en
      : "Tag";
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: lang === "en" ? `#${name} - tag` : `#${name} - tag`,
      description: lang === "en" ? `Posts tagged ${name}.` : `Wpisy oznaczone tagiem ${name}.`,
    });
  },
  component: () => <TaxonomyPage kind="tag" />,
  pendingComponent: () => <ArchiveSkeleton />,
  notFoundComponent: PublicNotFound,
  errorComponent: (props) => <RouteErrorFallback {...props} />,
});
