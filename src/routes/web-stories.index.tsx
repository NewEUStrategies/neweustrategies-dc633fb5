// Public web stories index. URL: /web-stories - the discovery page that
// previously did not exist (stories were reachable only via a builder widget
// or a known URL). Lists published stories as a 9:16 card grid.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { GalleryHorizontal } from "@/lib/lucide-shim";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { latestWebStoriesQueryOptions } from "@/lib/queries/webStories";
import { storyTitle, storyDescription } from "@/lib/web-stories/types";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";

const INDEX_LIMIT = 48;

export const Route = createFileRoute("/web-stories/")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(latestWebStoriesQueryOptions(INDEX_LIMIT)),
  head: () => {
    const url = getRequestUrl() || "/web-stories";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title:
        lang === "en"
          ? "Web Stories - New European Strategies"
          : "Web Stories - New European Strategies",
      description: lang === "en" ? "Browse our web stories." : "Przeglądaj nasze web stories.",
    });
  },
  component: WebStoriesIndex,
  errorComponent: (props) => (
    <RouteErrorFallback {...props} title="Nie udało się załadować listy" />
  ),
});

function WebStoriesIndex() {
  const { data: stories } = useSuspenseQuery(latestWebStoriesQueryOptions(INDEX_LIMIT));
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";

  return (
    <div className="container mx-auto px-4 py-10 max-w-4xl space-y-8">
      <header className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
          <GalleryHorizontal className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="font-display text-3xl">Web Stories</h1>
          <p className="text-sm text-muted-foreground">
            {lang === "en" ? "Latest stories" : "Najnowsze historie"}
          </p>
        </div>
      </header>

      {stories.length === 0 ? (
        <p className="text-sm text-muted-foreground py-16 text-center">
          {lang === "en" ? "No stories published yet." : "Brak opublikowanych historii."}
        </p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {stories.map((s) => {
            const title = storyTitle(s, lang);
            const desc = storyDescription(s, lang);
            return (
              <Link
                key={s.id}
                to="/web-stories/$slug"
                params={{ slug: s.slug }}
                className="group relative aspect-[9/16] overflow-hidden rounded-xl border border-border bg-card"
              >
                {s.cover_url ? (
                  <img
                    src={s.cover_url}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="absolute inset-0 bg-muted" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-4 space-y-1">
                  <h2 className="text-white font-medium leading-snug line-clamp-2">{title}</h2>
                  {desc && <p className="text-white/80 text-sm line-clamp-2">{desc}</p>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
