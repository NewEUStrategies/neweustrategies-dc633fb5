// Strona serii/dossier (A8): /series/$slug - uporządkowane części cyklu.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";
import { seriesPageQueryOptions } from "@/lib/queries/series";
import { PostListCard } from "@/components/molecules/PostListCard";
import { PublicNotFound } from "@/components/molecules/PublicNotFound";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";

const COPY = {
  pl: { kicker: "Dossier", parts: "części", partLabel: "Część" },
  en: { kicker: "Dossier", parts: "parts", partLabel: "Part" },
} as const;

export const Route = createFileRoute("/series/$slug")({
  head: ({ params }) => {
    const url = getRequestUrl() || `/series/${params.slug}`;
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: lang === "en" ? "Dossier" : "Dossier",
      description: lang === "en" ? "A sequential series of analyses." : "Sekwencyjny cykl analiz.",
    });
  },
  component: SeriesPage,
  pendingComponent: () => <ArchiveSkeleton />,
});

function SeriesPage() {
  const { slug } = Route.useParams();
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const c = COPY[lang];
  const { data, isLoading } = useQuery(seriesPageQueryOptions(slug));

  if (isLoading) return <ArchiveSkeleton />;
  if (!data) return <PublicNotFound />;

  const name = lang === "en" ? data.series.name_en || data.series.name_pl : data.series.name_pl;
  const description =
    lang === "en"
      ? data.series.description_en || data.series.description_pl
      : data.series.description_pl || data.series.description_en;

  return (
    <div className="flex-1 bg-background text-foreground">
      <div className="container mx-auto max-w-5xl px-4 py-10 lg:py-14">
        <header className="mb-8">
          <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
            <Layers className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
            {c.kicker} · {data.parts.length} {c.parts}
          </p>
          <h1 className="font-display text-3xl lg:text-4xl">{name}</h1>
          {description && <p className="mt-3 text-muted-foreground max-w-2xl">{description}</p>}
        </header>
        <ol className="grid gap-6 sm:grid-cols-2">
          {data.parts.map((part) => (
            <li key={part.post_id} className="relative">
              <span
                aria-hidden="true"
                className="absolute -top-2 -left-2 z-10 inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-brand px-2 text-xs font-semibold text-brand-foreground shadow"
              >
                {part.part_number}
              </span>
              <PostListCard
                post={{
                  title_pl: part.title_pl,
                  title_en: part.title_en,
                  excerpt_pl: null,
                  excerpt_en: null,
                  cover_image_url: part.cover_image_url,
                  published_at: part.published_at,
                }}
                href={part.href}
                lang={lang}
                titleClassName="text-base"
              />
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
