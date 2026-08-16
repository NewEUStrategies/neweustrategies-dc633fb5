import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { uiLang } from "@/lib/i18n/format";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  podcastBySlugQueryOptions,
  podcastSettingsQueryOptions,
  showEpisodesQueryOptions,
  episodePeopleQueryOptions,
} from "@/lib/queries/podcasts";
import { supabase } from "@/integrations/supabase/client";
import { PODCAST_SHOW_FIELDS } from "@/lib/queries/podcasts";
import type { PodcastShow } from "@/lib/podcast/types";
import { PodcastPlayer } from "@/components/atoms/PodcastPlayer";
import { Mic, Quote as QuoteIcon, Copy, Check } from "@/lib/lucide-shim";
import { ExternalLink } from "lucide-react";
import {
  podcastTitle,
  podcastEpisodeLabel,
  formatDuration,
  personRoleLabel,
  parseChapters,
  parseQuotes,
  parseResources,
  showTitle,
} from "@/lib/podcast/types";
import { safeJsonLd } from "@/lib/seo/jsonld";
import { activeLang } from "@/lib/seo/head";
import {
  SITE_CANONICAL_ORIGIN,
  buildContentHead,
  feedAlternateLink,
  imagePreloadLink,
  imagePreloadLinkHeaderValue,
  siteDescription,
  splitUrl,
  type ImagePreloadInput,
} from "@/lib/seo/meta";
import { appendLinkHeader } from "@/lib/http/responseHeaders";
import { getRequestUrl } from "@/lib/seo/request";
import { sanitizeHtml } from "@/lib/sanitize";
import { buildAvatarSrc } from "@/lib/cropSizes";
import { pickLocalized, pickPair } from "@/lib/i18n/pickLocalized";
import { ensureI18n as ensurePodcastsI18n } from "@/lib/i18n-podcasts";

export const Route = createFileRoute("/podcast/$slug")({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(podcastBySlugQueryOptions(params.slug));
    if (!data) throw notFound();
    // Preload LCP okładki odcinka - render to zwykłe <img src> bez srcSet,
    // więc deskryptor niesie sam `href` (para srcset/sizes wskazywałaby inny
    // wariant niż malowany i podwoiłaby pobranie). Wartość idzie też jako
    // nagłówek HTTP `Link` (fetch przed parsowaniem HTML, 103 Early Hints).
    // PARYTET: ten sam buildAvatarSrc(…, 128) co w malowanym <img> - okładka
    // renderuje się w polu 128x128, więc preload/paint schodzą na ~256 px
    // wariant ze Storage zamiast pełnowymiarowego oryginału na wysokim
    // priorytecie (URL-e spoza Supabase przechodzą bez zmian).
    const coverPreload: ImagePreloadInput | null = data.cover_image_url
      ? { href: buildAvatarSrc(data.cover_image_url, 128) }
      : null;
    if (coverPreload) appendLinkHeader(imagePreloadLinkHeaderValue(coverPreload));
    return { podcast: data, coverPreload };
  },
  head: ({ loaderData }) => {
    const p = loaderData?.podcast;
    if (!p) return { meta: [{ title: "Podcast" }] };
    const title = p.title_pl || p.title_en || "Podcast";
    const url = getRequestUrl() || `/podcast/${p.slug}`;
    const lang = activeLang(url);
    const origin = splitUrl(url).origin || SITE_CANONICAL_ORIGIN;
    // Odcinek bez zajawki: opis marki zamiast pustego <meta name="description">
    // (stary ręczny head w ogóle pomijał wtedy ten tag - fallback jest lepszy
    // dla SERP niż brak i niż pusty content).
    const excerpt = (p.excerpt_pl || p.excerpt_en || "").slice(0, 300);
    const description = excerpt || siteDescription(lang, origin);
    // Pełny kontrakt <head> przez buildContentHead (canonical, hreflang,
    // twitter:card, og:url, og:image z fallbackiem marki) - ręczne meta go nie
    // niosły. Tytuł i opis bez zmian: documentTitle z sufiksem "· Podcast",
    // czysty tytuł w og:title/twitter:title.
    const base = buildContentHead({
      url,
      lang,
      type: "article",
      title,
      documentTitle: `${title} · Podcast`,
      description,
      image: p.cover_image_url,
      publishedAt: p.published_at,
    });
    // JSON-LD PodcastEpisode: pozwala wyszukiwarkom rozpoznać odcinek podcastu.
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "PodcastEpisode",
      name: title,
      // JSON-LD opisuje ODCINEK - opis marki tu nie należy (tylko realna zajawka).
      ...(excerpt ? { description: excerpt } : {}),
      ...(p.episode_number != null ? { episodeNumber: p.episode_number } : {}),
      ...(p.published_at ? { datePublished: p.published_at } : {}),
      associatedMedia: {
        "@type": "MediaObject",
        contentUrl: p.audio_url,
      },
    };
    // Autodiscovery kanału podcastu wprost ze strony odcinka - to najczęstszy
    // punkt wejścia z social mediów, a czytnik/Apple szuka <link rel="alternate">.
    // Strona odcinka zna show_id, nie slug programu, więc wskazujemy kanał
    // sieciowy (zawiera ten odcinek), a nie per-program. Do tego preload
    // okładki (LCP) - fetch rusza z <head>, zanim parser dojdzie do <img>.
    return {
      ...base,
      links: [
        ...base.links,
        ...(loaderData?.coverPreload ? [imagePreloadLink(loaderData.coverPreload)] : []),
        feedAlternateLink({
          origin,
          feedPath: "/podcast/rss.xml",
          title: lang === "en" ? "NES Podcast - RSS" : "Podcast NES - RSS",
          lang,
        }),
      ],
      scripts: [{ type: "application/ld+json", children: safeJsonLd(jsonLd) }],
    };
  },
  // Oba komunikaty ze słownika: renderują się jak każdy inny komponent, więc
  // `t()` jest dostępne - literały były jedynymi miejscami na tej trasie, które
  // mówiły po polsku do wszystkich.
  errorComponent: () => <PodcastNotice messageKey="podcastNetwork.episodeLoadFailed" />,
  notFoundComponent: () => <PodcastNotice messageKey="podcastNetwork.episodeNotFound" />,
  component: PodcastSinglePage,
});

function playerVariant(v: string | undefined): "mini" | "full" | "sticky" {
  return v === "mini" || v === "sticky" ? v : "full";
}

/** Fetch the parent program by id (episode page arrives with show_id, not slug). */
function showByIdQueryOptions(showId: string | null) {
  return {
    queryKey: ["podcast-shows", "id", showId] as const,
    queryFn: async (): Promise<PodcastShow | null> => {
      if (!showId) return null;
      const { data, error } = await supabase
        .from("podcast_shows")
        .select(PODCAST_SHOW_FIELDS)
        .eq("id", showId)
        .eq("status", "published")
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as PodcastShow | null;
    },
    enabled: !!showId,
    staleTime: 5 * 60_000,
  };
}

/**
 * Wspólny komunikat na całą stronę dla `errorComponent`/`notFoundComponent`.
 * Osobny komponent, bo tylko wewnątrz komponentu wolno wołać `useTranslation`,
 * a oba te wejścia renderują się przed komponentem trasy.
 */
function PodcastNotice({ messageKey }: { messageKey: string }) {
  ensurePodcastsI18n();
  const { t } = useTranslation();
  return <div className="container mx-auto p-8 text-sm text-muted-foreground">{t(messageKey)}</div>;
}

function PodcastSinglePage() {
  const { slug } = Route.useParams();
  ensurePodcastsI18n();
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = uiLang(i18n.language);

  const { data: p } = useQuery(podcastBySlugQueryOptions(slug));
  const { data: settings } = useQuery(podcastSettingsQueryOptions);
  const { data: show } = useQuery(showByIdQueryOptions(p?.show_id ?? null));
  const { data: people } = useQuery(episodePeopleQueryOptions(p?.id ?? ""));
  const { data: showEpisodes } = useQuery({
    ...showEpisodesQueryOptions(p?.show_id ?? ""),
    enabled: !!p?.show_id,
  });

  // Seek udostępniony przez odtwarzacz - rozdziały przeskakują do znacznika.
  const seekRef = useRef<((seconds: number) => void) | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const chapters = useMemo(() => parseChapters(p?.chapters), [p?.chapters]);
  const quotes = useMemo(() => parseQuotes(p?.quotes), [p?.quotes]);
  const resources = useMemo(() => parseResources(p?.resources), [p?.resources]);
  const hosts = (people ?? []).filter((x) => x.role === "host");
  const guests = (people ?? []).filter((x) => x.role === "guest");
  const recommendations = useMemo(
    () => (showEpisodes ?? []).filter((e) => e.id !== p?.id).slice(0, 4),
    [showEpisodes, p?.id],
  );

  if (!p) return null;

  const title = podcastTitle(p, lang);
  const ep = podcastEpisodeLabel(p, lang);
  // `pickLocalized` zamiast `a_en || a_pl`: ciąg z samych spacji liczy się jako
  // pusty, więc nie renderuje pustej sekcji notatek ani transkrypcji.
  const notes = pickLocalized(p, "show_notes", lang);
  const transcript = pickLocalized(p, "transcript", lang);
  const excerpt = pickLocalized(p, "excerpt", lang);

  const sources = resources.filter((r) => r.kind === "source");
  const related = resources.filter((r) => r.kind === "related");

  const copyQuote = async (text: string, attribution: string, idx: number) => {
    const body = attribution ? `„${text}" - ${attribution}` : `„${text}"`;
    try {
      await navigator.clipboard.writeText(`${body}\n\n${title}`);
      setCopiedIdx(idx);
      window.setTimeout(() => setCopiedIdx((v) => (v === idx ? null : v)), 2000);
    } catch {
      /* schowek niedostępny (np. brak HTTPS) - po cichu pomijamy */
    }
  };

  return (
    <article className="container mx-auto px-4 py-10 max-w-4xl space-y-8">
      <header className="flex flex-col sm:flex-row gap-5 sm:items-start">
        <div className="w-32 h-32 shrink-0 rounded-xl overflow-hidden border border-border bg-muted">
          {p.cover_image_url ? (
            <img
              src={buildAvatarSrc(p.cover_image_url, 128)}
              alt=""
              className="w-full h-full object-cover"
              loading="eager"
              fetchPriority="high"
              decoding="async"
              width={128}
              height={128}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Mic className="w-10 h-10 text-muted-foreground/40" />
            </div>
          )}
        </div>
        <div className="space-y-3 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            {show && (
              <Link
                to="/podcasts/$show"
                params={{ show: show.slug }}
                className="text-primary font-semibold hover:underline"
              >
                {showTitle(show, lang)}
              </Link>
            )}
            {show && ep && <span aria-hidden>·</span>}
            {ep && <span>{ep}</span>}
          </div>
          <h1 className="font-display text-3xl lg:text-4xl">{title}</h1>
          {excerpt && <p className="text-lg text-muted-foreground">{excerpt}</p>}
          <div className="text-xs text-muted-foreground">{formatDuration(p.duration_seconds)}</div>
        </div>
      </header>

      <PodcastPlayer
        src={p.audio_url}
        title={title}
        coverUrl={p.cover_image_url}
        initialDuration={p.duration_seconds}
        variant={playerVariant(settings?.default_player_variant)}
        showSpeed={settings?.show_speed_control ?? true}
        lang={lang}
        registerSeek={(fn) => {
          seekRef.current = fn;
        }}
      />

      {(settings?.spotify_url ||
        settings?.apple_url ||
        settings?.google_url ||
        settings?.rss_url) && (
        <nav className="flex flex-wrap gap-2 text-xs">
          {settings.spotify_url && (
            <a
              href={settings.spotify_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-full border border-border hover:bg-muted"
            >
              Spotify
            </a>
          )}
          {settings.apple_url && (
            <a
              href={settings.apple_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-full border border-border hover:bg-muted"
            >
              Apple Podcasts
            </a>
          )}
          {settings.google_url && (
            <a
              href={settings.google_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-full border border-border hover:bg-muted"
            >
              Google
            </a>
          )}
          {settings.rss_url && (
            <a
              href={settings.rss_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-full border border-border hover:bg-muted"
            >
              RSS
            </a>
          )}
        </nav>
      )}

      {(hosts.length > 0 || guests.length > 0) && (
        <section className="space-y-3">
          <h2 className="font-display text-xl">{t("podcastNetwork.peopleHeading")}</h2>
          <div className="flex flex-wrap gap-3">
            {[...hosts, ...guests].map((person) => {
              const inner = (
                <>
                  {person.profile_avatar_url ? (
                    <img
                      src={buildAvatarSrc(person.profile_avatar_url, 36)}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover border border-border"
                      loading="lazy"
                      decoding="async"
                      width={36}
                      height={36}
                    />
                  ) : (
                    <span className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                      <Mic className="w-4 h-4 text-muted-foreground" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium leading-tight truncate">
                      {person.display_name}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {personRoleLabel(person.role, lang)}
                    </span>
                  </span>
                </>
              );
              const cls =
                "flex items-center gap-2 px-3 py-1.5 rounded-full border border-border max-w-full";
              if (person.profile_slug) {
                return (
                  <Link
                    key={person.id}
                    to="/author/$slug"
                    params={{ slug: person.profile_slug }}
                    className={`${cls} hover:bg-muted`}
                  >
                    {inner}
                  </Link>
                );
              }
              if (person.url) {
                return (
                  <a
                    key={person.id}
                    href={person.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${cls} hover:bg-muted`}
                  >
                    {inner}
                  </a>
                );
              }
              return (
                <span key={person.id} className={cls}>
                  {inner}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {chapters.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-xl">{t("podcastNetwork.chaptersHeading")}</h2>
          <ol className="divide-y divide-border border border-border rounded-lg overflow-hidden">
            {chapters.map((c, i) => {
              const label = pickLocalized(c, "title", lang);
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => seekRef.current?.(c.start)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40 transition-colors"
                  >
                    <span className="text-xs tabular-nums text-primary font-medium w-14 shrink-0">
                      {formatDuration(c.start)}
                    </span>
                    <span className="text-sm">{label || `#${i + 1}`}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {quotes.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-xl">{t("podcastNetwork.quotesHeading")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {quotes.map((q, i) => {
              const text = pickLocalized(q, "text", lang);
              if (!text) return null;
              return (
                <figure
                  key={i}
                  className="relative rounded-lg border border-border bg-muted/30 p-4 pr-11 space-y-2"
                >
                  <QuoteIcon className="w-5 h-5 text-primary/60" />
                  <blockquote className="text-sm leading-relaxed">{text}</blockquote>
                  {q.attribution && (
                    <figcaption className="text-xs text-muted-foreground">
                      - {q.attribution}
                    </figcaption>
                  )}
                  <button
                    type="button"
                    onClick={() => copyQuote(text, q.attribution, i)}
                    aria-label={t("podcastNetwork.copyQuote")}
                    className="absolute top-3 right-3 h-8 w-8 rounded-md border border-border bg-background flex items-center justify-center hover:bg-muted"
                  >
                    {copiedIdx === i ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4 text-muted-foreground" />
                    )}
                  </button>
                </figure>
              );
            })}
          </div>
        </section>
      )}

      {notes && (
        <section className="prose prose-sm max-w-none">
          <h2 className="font-display text-xl">{t("podcastNetwork.showNotesHeading")}</h2>
          <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(notes) }} />
        </section>
      )}

      {(sources.length > 0 || related.length > 0) && (
        <section className="grid gap-6 sm:grid-cols-2">
          {sources.length > 0 && (
            <div className="space-y-2">
              <h2 className="font-display text-lg">{t("podcastNetwork.sourcesHeading")}</h2>
              <ul className="space-y-1.5">
                {sources.map((r, i) => {
                  const label = pickPair(pickLocalized(r, "label", lang), r.url);
                  return (
                    <li key={i}>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-start gap-1.5 text-sm text-primary hover:underline"
                      >
                        <ExternalLink className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>{label}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {related.length > 0 && (
            <div className="space-y-2">
              <h2 className="font-display text-lg">{t("podcastNetwork.relatedHeading")}</h2>
              <ul className="space-y-1.5">
                {related.map((r, i) => {
                  const label = pickPair(pickLocalized(r, "label", lang), r.url);
                  return (
                    <li key={i}>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-start gap-1.5 text-sm text-primary hover:underline"
                      >
                        <ExternalLink className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>{label}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      {transcript && (
        <details className="border border-border rounded-lg p-4">
          <summary className="cursor-pointer font-medium">
            {t("podcastNetwork.transcriptHeading")}
          </summary>
          <div
            className="mt-3 prose prose-sm max-w-none whitespace-pre-wrap"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(transcript) }}
          />
        </details>
      )}

      {recommendations.length > 0 && (
        <section className="space-y-3 border-t border-border pt-8">
          <h2 className="font-display text-xl">{t("podcastNetwork.moreFromShowHeading")}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {recommendations.map((e) => {
              const rEp = podcastEpisodeLabel(e, lang);
              return (
                <li key={e.id}>
                  <Link
                    to="/podcast/$slug"
                    params={{ slug: e.slug }}
                    className="flex gap-3 p-3 rounded-lg border border-border hover:bg-muted/40 transition-colors h-full"
                  >
                    {e.cover_image_url ? (
                      <img
                        src={buildAvatarSrc(e.cover_image_url, 56)}
                        alt=""
                        className="w-14 h-14 rounded-md object-cover border border-border shrink-0"
                        loading="lazy"
                        decoding="async"
                        width={56}
                        height={56}
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <Mic className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 space-y-0.5">
                      {rEp && (
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          {rEp}
                        </div>
                      )}
                      <div className="text-sm font-medium leading-snug line-clamp-2">
                        {podcastTitle(e, lang)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDuration(e.duration_seconds)}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </article>
  );
}
