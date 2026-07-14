// Hub eksperta: /author/$slug. Nie jest to prosta wizytówka - to hub treściowy
// agregujący WSZYSTKIE relacje eksperta (stanowisko, funkcje, programy, obszary,
// kontakt bezpośredni i dla mediów, „W mediach" oraz filtrowalny zbiór
// materiałów: publikacje, raporty, wideo, podcasty, wydarzenia).
// Slug może być też UUID użytkownika (kompatybilność wsteczna).
//
// Layout hero i kolejność sekcji dziedziczone są z `expert_layout_settings`
// (per tenant) i renderowane tym samym komponentem, którego używa podgląd
// w /admin/expert-layouts - dzięki temu preview == produkcja.
import { createFileRoute, notFound } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BadgeCheck } from "lucide-react";
import { PublicNotFound } from "@/components/molecules/PublicNotFound";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AuthorCvSections } from "@/components/author/AuthorCvSections";
import { FollowButton } from "@/components/FollowButton";
import { ProfileBadges } from "@/components/profile/ProfileBadges";
import { ExpertMaterialsExplorer } from "@/components/experts/ExpertMaterialsExplorer";
import { ExpertHubDetails } from "@/components/experts/ExpertHubDetails";
import { ExpertInTheNews } from "@/components/experts/ExpertInTheNews";
import { usePersonalizedSettings } from "@/hooks/usePersonalizedSettings";
import { useUserBadges } from "@/lib/profile/badges";
import { expertHubQueryOptions } from "@/lib/experts/queries";
import { podcastsByProfileQueryOptions } from "@/lib/queries/podcasts";
import { PodcastEpisodeStrip } from "@/components/podcast/PodcastEpisodeStrip";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import { safeJsonLd } from "@/lib/seo/jsonld";
import { expertLayoutSettingsQueryOptions } from "@/hooks/useExpertLayoutSettings";
import {
  ExpertLayoutHero,
  ExpertSectionsList,
  expertLayoutCssVars,
} from "@/components/experts/ExpertLayoutRenderer";
import { isSectionVisible } from "@/lib/expertLayouts";
import "@/lib/i18n-experts";

export const Route = createFileRoute("/author/$slug")({
  loader: async ({ params, context }) => {
    const [data] = await Promise.all([
      context.queryClient.ensureQueryData(expertHubQueryOptions(params.slug)),
      context.queryClient.ensureQueryData(expertLayoutSettingsQueryOptions()),
    ]);
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData, params }) => {
    const expert = loaderData?.expert;
    const url = getRequestUrl() || `/author/${params.slug}`;
    const lang = activeLang(url);
    const name = expert?.display_name ?? (lang === "en" ? "Expert" : "Ekspert");
    const bioRaw = expert
      ? lang === "en"
        ? expert.bio_en || expert.bio_pl
        : expert.bio_pl || expert.bio_en
      : null;
    const fallbackDesc =
      lang === "en" ? `Materials by ${name}.` : `Materiały eksperta ${name}.`;
    const description =
      (bioRaw ?? "").replace(/<[^>]+>/g, " ").trim().slice(0, 160) || fallbackDesc;

    const sameAs = [expert?.website_url, expert?.twitter_url, expert?.linkedin_url].filter(
      Boolean,
    ) as string[];
    const areas = (loaderData?.areas ?? []).map((a) => (lang === "en" ? a.name_en : a.name_pl));
    const jsonLd: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Person",
      name,
      ...(expert?.job_title ? { jobTitle: expert.job_title } : {}),
      ...(expert?.company
        ? { worksFor: { "@type": "Organization", name: expert.company } }
        : {}),
      ...(expert?.avatar_url ? { image: expert.avatar_url } : {}),
      ...(sameAs.length ? { sameAs } : {}),
      ...(areas.length ? { knowsAbout: areas } : {}),
      ...(description ? { description } : {}),
    };

    return {
      ...buildContentHead({
        url,
        lang,
        type: "website",
        title: expert?.job_title ? `${name} - ${expert.job_title}` : name,
        description,
        image: expert?.avatar_url ?? null,
      }),
      scripts: [{ type: "application/ld+json", children: safeJsonLd(jsonLd) }],
    };
  },
  component: ExpertHubPage,
  pendingComponent: () => <ArchiveSkeleton />,
  notFoundComponent: PublicNotFound,
  errorComponent: (props) => (
    <RouteErrorFallback
      {...props}
      title={
        activeLang() === "en" ? "Failed to load the profile" : "Nie udało się załadować profilu"
      }
    />
  ),
});

function ExpertHubPage() {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery(expertHubQueryOptions(slug));
  const { data: settings } = useSuspenseQuery(expertLayoutSettingsQueryOptions());
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const personalized = usePersonalizedSettings();
  const badgesQ = useUserBadges(data?.expert.id);
  const podcastsQ = useQuery(podcastsByProfileQueryOptions(data?.expert.id ?? ""));
  if (!data) return <PublicNotFound />;
  const { expert } = data;
  const extraBadges = (badgesQ.data ?? []).filter(
    (badge) => !(badge === "verified" && expert.verified_at),
  );
  const name = expert.display_name ?? (lang === "en" ? "Expert" : "Ekspert");

  const cssVars = expertLayoutCssVars(settings);
  // Sekcja "hero_cover" jest widoczna, gdy admin ją włączył - inaczej hero
  // renderujemy zawsze (to jest wizytówka strony), ale poszczególne sekcje
  // pod hero respektują widoczność zapisaną w settings.
  const showExpertiseBar = isSectionVisible(settings, "expertise_bar");
  const showDetails = isSectionVisible(settings, "details");
  const showMediaMentions = isSectionVisible(settings, "media_mentions");
  const showPodcastStrip = isSectionVisible(settings, "podcast_strip");
  const showMaterials = isSectionVisible(settings, "materials");
  const showCv = isSectionVisible(settings, "cv");

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground" style={cssVars}>
      <header className="relative">
        <div className="mx-auto max-w-[1200px] px-4 pt-6 lg:px-8 lg:pt-8">
          <Breadcrumbs items={[{ label: name }]} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {expert.is_expert && (
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider"
                style={{
                  backgroundColor: "color-mix(in oklab, var(--pv-accent) 18%, transparent)",
                  color: "var(--pv-accent)",
                }}
              >
                {t("expert.expertBadge")}
              </span>
            )}
            {expert.verified_at && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-sky-400/25 px-2 py-0.5 text-[11px] font-medium text-sky-900 dark:text-sky-50"
                title={
                  lang === "pl"
                    ? "Profil zweryfikowany zawodowo"
                    : "Professionally verified profile"
                }
              >
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                {t("expert.verifiedBadge")}
              </span>
            )}
            <ProfileBadges badges={extraBadges} size="md" />
            {personalized.followInAuthorHeader && (
              <div className="ml-auto">
                <FollowButton targetType="author" targetId={expert.id} lang={lang} />
              </div>
            )}
          </div>
        </div>

        <ExpertLayoutHero hub={data} settings={settings} lang={lang} showPlaceholders={false} />

        {showExpertiseBar && data.areas.length > 0 && (
          <div className="border-b border-border/60 bg-card">
            <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 lg:px-8">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {t("expert.expertiseHeading")}
              </span>
              <div className="flex flex-wrap gap-2">
                {data.areas.map((a) => (
                  <span
                    key={a.id}
                    className="text-sm font-medium text-foreground/80 after:mx-2 after:text-muted-foreground/40 after:content-['/'] last:after:hidden"
                  >
                    {lang === "en" ? a.name_en : a.name_pl}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </header>

      <div className="w-full flex-1">
        {/* Automatyczny renderer sekcji z admin/expert-layouts (details,
            social_row, contact_card, programs). Kolejność i widoczność
            dokładnie takie same jak w podglądzie admina. */}
        <ExpertSectionsList hub={data} settings={settings} lang={lang} showPlaceholders={false} />

        {showDetails && (
          <section className="mx-auto max-w-[1200px] px-4 py-10 lg:px-8 lg:py-12">
            <ExpertHubDetails data={data} lang={lang} />
          </section>
        )}
        {showMediaMentions && data.mediaMentions.length > 0 && (
          <section className="mx-auto max-w-[1200px] px-4 pb-10 lg:px-8">
            <ExpertInTheNews mentions={data.mediaMentions} lang={lang} />
          </section>
        )}
        {showPodcastStrip && podcastsQ.data && podcastsQ.data.length > 0 && (
          <section className="mx-auto max-w-[1200px] px-4 pb-6 lg:px-8">
            <PodcastEpisodeStrip
              episodes={podcastsQ.data}
              lang={lang}
              title={lang === "en" ? "Podcasts" : "Podcasty"}
            />
          </section>
        )}
        {showMaterials && (
          <section className="mx-auto max-w-[1200px] px-4 pb-14 lg:px-8">
            <ExpertMaterialsExplorer data={data} lang={lang} />
          </section>
        )}
        {showCv && (
          <div className="mx-auto w-full max-w-[1200px]">
            <AuthorCvSections userId={expert.id} />
          </div>
        )}
      </div>
    </div>
  );
}
