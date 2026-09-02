import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { webStoryBySlugQueryOptions, latestWebStoriesQueryOptions } from "@/lib/queries/webStories";
import { StoryViewer } from "@/components/web-stories/StoryViewer";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { storyTitle, storyDescription } from "@/lib/web-stories/types";
import { safeJsonLd } from "@/lib/seo/jsonld";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import {
  SITE_NAME,
  buildContentHead,
  imagePreloadLink,
  imagePreloadLinkHeaderValue,
  type ImagePreloadInput,
} from "@/lib/seo/meta";
import { buildImageSrcSet } from "@/lib/cropSizes";
import { appendLinkHeader } from "@/lib/http/responseHeaders";

// `sizes` okładki - JEDNA stała dla renderowanego <img> i preloadu LCP, żeby
// przeglądarka preładowała dokładnie ten wariant responsywny, który maluje
// (rozjazd = podwójne pobranie).
const COVER_IMAGE_SIZES = "(max-width: 896px) 100vw, 896px";

export const Route = createFileRoute("/web-stories/$slug")({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(webStoryBySlugQueryOptions(params.slug));
    if (!data) throw notFound();
    // Preload LCP okładki - te same kandydaty (buildImageSrcSet) i sizes co
    // renderowany OptimizedImage `responsive`. Wartość idzie też jako nagłówek
    // HTTP `Link`, więc fetch startuje przed parsowaniem HTML.
    const coverPreload: ImagePreloadInput | null = data.cover_url
      ? {
          href: data.cover_url,
          imageSrcSet: buildImageSrcSet(data.cover_url),
          imageSizes: COVER_IMAGE_SIZES,
        }
      : null;
    if (coverPreload) appendLinkHeader(imagePreloadLinkHeaderValue(coverPreload));
    return { story: data, coverPreload };
  },
  // ── NAGŁÓWEK PRZEZ WSPÓLNY BUDOWNIK, NIE RĘCZNIE ──────────────────────────
  // Ta trasa była JEDYNĄ powierzchnią treściową modułu, która składała `meta`
  // z palca. Kosztowało to cztery rzeczy naraz: (1) brak adresu kanonicznego
  // i klastra hreflang PL/EN, więc `/web-stories/x` i `/en/web-stories/x`
  // konkurowały ze sobą w indeksie; (2) brak `og:url` i `og:site_name`, więc
  // udostępnienie wychodziło bez marki; (3) tytuł BRANY ZAWSZE z `title_pl`
  // niezależnie od języka renderu - czytelnik `/en/...` dostawał polską nazwę
  // w karcie linku; (4) separator „·" zamiast dywizu i brak `SITE_NAME`.
  head: ({ loaderData }) => {
    const url = getRequestUrl() || "/web-stories";
    const lang = activeLang(url);
    const s = loaderData?.story;
    // `head()` bywa wołane bez ładunku loadera (przerwana nawigacja, 404).
    // Strona bez historii nie ma czego obiecywać, więc wychodzi z indeksu
    // zamiast zostawić w nim pusty tytuł.
    if (!s) {
      return buildContentHead({
        url,
        lang,
        type: "website",
        // Nazwa formatu jest ta sama w obu językach - ternary o identycznych
        // gałęziach byłby tu tylko szumem (patrz lib/ci/hardcodedLanguage).
        title: "Web Story",
        description:
          lang === "en" ? "This web story is unavailable." : "Ta historia jest niedostępna.",
        robots: "noindex",
      });
    }
    const title = storyTitle(s, lang) || "Web Story";
    const description =
      storyDescription(s, lang).slice(0, 300) ||
      (lang === "en" ? "A web story by New European Strategies." : "Web story New European Strategies.");
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
    const head = buildContentHead({
      url,
      lang,
      type: "article",
      title,
      documentTitle: `${title} - ${SITE_NAME}`,
      description,
      image: s.cover_url,
      publishedAt: s.published_at,
    });
    return {
      ...head,
      // Równoległy dokument <amp-story> (kwalifikacja do prezentacji Web
      // Stories w Google); URL względny rozwiązuje się do bieżącego hosta.
      // Do tego preload okładki (LCP) - fetch rusza z <head>, zanim parser
      // dojdzie do <img> w body.
      links: [
        ...head.links,
        ...(s.cover_url ? [{ rel: "amphtml", href: `/web-stories/${s.slug}/amp` }] : []),
        ...(loaderData?.coverPreload ? [imagePreloadLink(loaderData.coverPreload)] : []),
      ],
      scripts: [{ type: "application/ld+json", children: safeJsonLd(jsonLd) }],
    };
  },
  // Surowy `error.message` (komunikat PostgREST) NIE idzie do odwiedzającego:
  // to jednocześnie wyciek szczegółów bazy i zdanie wyłącznie po angielsku,
  // bez drogi powrotu. Wspólny fallback ma jedno i drugie.
  errorComponent: (props) => (
    <RouteErrorFallback
      {...props}
      title={activeLang() === "en" ? "Failed to load the story" : "Nie udało się załadować historii"}
    />
  ),
  notFoundComponent: () => (
    <div className="container mx-auto p-8 text-sm text-muted-foreground">
      {activeLang() === "en" ? "Story not found." : "Nie znaleziono historii."}
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
            sizes={COVER_IMAGE_SIZES}
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
                    <OptimizedImage
                      src={m.cover_url}
                      alt=""
                      responsive
                      sizes="(min-width: 768px) 200px, 45vw"
                      className="absolute inset-0 w-full h-full object-cover"
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
