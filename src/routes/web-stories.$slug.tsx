import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { webStoryBySlugQueryOptions, latestWebStoriesQueryOptions } from "@/lib/queries/webStories";
import { StoryViewer } from "@/components/web-stories/StoryViewer";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { storyTitle, storyDescription } from "@/lib/web-stories/types";
import { safeJsonLd } from "@/lib/seo/jsonld";

export const Route = createFileRoute("/web-stories/$slug")({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(webStoryBySlugQueryOptions(params.slug));
    if (!data) throw notFound();
    return { story: data };
  },
  head: ({ loaderData }) => {
    const s = loaderData?.story;
    if (!s) return { meta: [{ title: "Web Story" }] };
    const title = s.title_pl || s.title_en || "Web Story";
    const description = (s.description_pl || s.description_en || "").slice(0, 300) || undefined;
    // JSON-LD CreativeWork: pozwala wyszukiwarkom rozpoznać web story jako
    // samodzielną treść (nazwa, okładka, data publikacji).
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      name: title,
      ...(description ? { description } : {}),
      ...(s.cover_url ? { image: s.cover_url } : {}),
      ...(s.published_at ? { datePublished: s.published_at } : {}),
    };
    return {
      meta: [
        { title: `${title} · Web Story` },
        ...(description ? [{ name: "description", content: description }] : []),
        { property: "og:title", content: title },
        { property: "og:type", content: "article" },
        ...(description ? [{ property: "og:description", content: description }] : []),
        ...(s.cover_url ? [{ property: "og:image", content: s.cover_url }] : []),
      ],
      // Równoległy dokument <amp-story> (kwalifikacja do prezentacji Web
      // Stories w Google); URL względny rozwiązuje się do bieżącego hosta.
      links: s.cover_url ? [{ rel: "amphtml", href: `/web-stories/${s.slug}/amp` }] : [],
      scripts: [{ type: "application/ld+json", children: safeJsonLd(jsonLd) }],
    };
  },
  errorComponent: ({ error }) => (
    <div className="container mx-auto p-8 text-sm">{error.message}</div>
  ),
  notFoundComponent: () => (
    <div className="container mx-auto p-8 text-sm text-muted-foreground">
      Nie znaleziono historii.
    </div>
  ),
  component: WebStorySinglePage,
});

function WebStorySinglePage() {
  const { slug } = Route.useParams();
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = (i18n.language ?? "pl").startsWith("pl") ? "pl" : "en";
  const [open, setOpen] = useState(true);

  const { data: story } = useQuery(webStoryBySlugQueryOptions(slug));
  const { data: more } = useQuery(latestWebStoriesQueryOptions(8));

  if (!story) return null;
  const title = storyTitle(story, lang);
  const desc = storyDescription(story, lang);

  return (
    <article className="container mx-auto px-4 py-10 max-w-4xl space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-3xl lg:text-4xl">{title}</h1>
        {desc && <p className="text-muted-foreground">{desc}</p>}
      </header>

      <button
        onClick={() => setOpen(true)}
        className="relative aspect-[9/16] sm:aspect-video w-full overflow-hidden rounded-xl border border-border bg-black"
      >
        {story.cover_url && (
          <OptimizedImage
            src={story.cover_url}
            alt={title}
            priority
            responsive
            sizes="(max-width: 896px) 100vw, 896px"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-black/30" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="px-5 py-2 rounded-full bg-white text-black font-medium text-sm">
            {lang === "en" ? "Play story" : "Odtwórz historię"}
          </span>
        </div>
      </button>

      {open && story.pages.length > 0 && (
        <StoryViewer pages={story.pages} lang={lang} onClose={() => setOpen(false)} />
      )}

      {more && more.filter((m) => m.slug !== story.slug).length > 0 && (
        <section className="pt-6 border-t border-border">
          <h2 className="font-display text-xl mb-3">
            {lang === "en" ? "More stories" : "Więcej historii"}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {more
              .filter((m) => m.slug !== story.slug)
              .slice(0, 8)
              .map((m) => (
                <Link
                  key={m.id}
                  to="/web-stories/$slug"
                  params={{ slug: m.slug }}
                  className="relative aspect-[9/16] overflow-hidden rounded-xl border border-border bg-card"
                >
                  {m.cover_url && (
                    <img
                      src={m.cover_url}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                      loading="lazy"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                  <div className="absolute bottom-2 left-2 right-2 text-white text-xs line-clamp-2">
                    {storyTitle(m, lang)}
                  </div>
                </Link>
              ))}
          </div>
        </section>
      )}
    </article>
  );
}
