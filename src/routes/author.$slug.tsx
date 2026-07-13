// Hub eksperta: /author/$slug. Nie jest to prosta wizytówka - to hub treściowy
// agregujący WSZYSTKIE relacje eksperta (stanowisko, funkcje, programy, obszary,
// kontakt bezpośredni i dla mediów, „W mediach" oraz filtrowalny zbiór
// materiałów: publikacje, raporty, wideo, podcasty, wydarzenia).
// Slug może być też UUID użytkownika (kompatybilność wsteczna).
import { createFileRoute, notFound } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BadgeCheck, Globe, Linkedin } from "lucide-react";
import { XIcon } from "@/components/atoms/XIcon";
import { BrandIcon } from "@/components/atoms/BrandIcon";
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
import "@/lib/i18n-experts";

export const Route = createFileRoute("/author/$slug")({
  loader: async ({ params, context }) => {
    const data = await context.queryClient.ensureQueryData(expertHubQueryOptions(params.slug));
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
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const personalized = usePersonalizedSettings();
  // Pełny zestaw odznak (ekspert/redakcja/autor gościnny) - parytet z /people;
  // duplikat "Zweryfikowany" odpada, gdy pill verified_at już świeci.
  const badgesQ = useUserBadges(data?.expert.id);
  // Agregacja odcinków, w których ekspert prowadzi/gości lub jest autorem.
  const podcastsQ = useQuery(podcastsByProfileQueryOptions(data?.expert.id ?? ""));
  if (!data) return <PublicNotFound />;
  const { expert } = data;
  // Pełny zestaw odznak; duplikat "Zweryfikowany" odpada, gdy pill verified świeci.
  const extraBadges = (badgesQ.data ?? []).filter(
    (badge) => !(badge === "verified" && expert.verified_at),
  );
  const name = expert.display_name ?? (lang === "en" ? "Expert" : "Ekspert");
  const roleLine = [expert.job_title, expert.company].filter(Boolean).join(" · ");
  const functions = expert.org_functions
    .map((f) => (lang === "en" ? f.en || f.pl : f.pl || f.en))
    .filter(Boolean);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="w-full flex-1">
        <header className="relative">
          {expert.cover_url && (
            <div className="h-40 w-full overflow-hidden bg-muted sm:h-56">
              <img src={expert.cover_url} alt="" className="h-full w-full object-cover" />
            </div>
          )}
          <div className="mx-auto max-w-[1200px] px-4 py-8 lg:px-8">
            <Breadcrumbs items={[{ label: name }]} />
            <div className="flex flex-col items-start gap-5 sm:flex-row">
              {expert.avatar_url && (
                <img
                  src={expert.avatar_url}
                  alt={name}
                  className="-mt-16 h-24 w-24 rounded-full border-4 border-background object-cover shadow"
                />
              )}
              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="font-display text-3xl lg:text-4xl">{name}</h1>
                  {expert.is_expert && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand)]/10 px-2 py-0.5 text-xs font-medium text-[var(--brand)]">
                      {t("expert.expertBadge")}
                    </span>
                  )}
                  {expert.verified_at && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300"
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
                    <FollowButton targetType="author" targetId={expert.id} lang={lang} />
                  )}
                </div>
                {roleLine && <p className="text-base text-muted-foreground">{roleLine}</p>}
                {functions.length > 0 && (
                  <p className="text-sm text-foreground/80">
                    <span className="text-muted-foreground">{t("expert.functions")}: </span>
                    {functions.join(" · ")}
                  </p>
                )}
                <div className="flex flex-wrap gap-3 pt-1 text-sm">
                  {expert.website_url && (
                    <a
                      href={expert.website_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-brand"
                    >
                      <BrandIcon name="website" fallback={Globe} className="h-4 w-4" alt="WWW" />
                      WWW
                    </a>
                  )}
                  {expert.twitter_url && (
                    <a
                      href={expert.twitter_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-brand"
                    >
                      <BrandIcon name="x" fallback={XIcon} className="h-4 w-4" alt="X" />X
                    </a>
                  )}
                  {expert.linkedin_url && (
                    <a
                      href={expert.linkedin_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-brand"
                    >
                      <BrandIcon
                        name="linkedin"
                        fallback={Linkedin}
                        className="h-4 w-4"
                        alt="LinkedIn"
                      />
                      LinkedIn
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        </header>
        <AuthorCvSections userId={expert.id} />
        {podcastsQ.data && podcastsQ.data.length > 0 && (
          <section className="max-w-[1200px] mx-auto px-4 lg:px-8 pb-4">
            <PodcastEpisodeStrip
              episodes={podcastsQ.data}
              lang={lang}
              title={lang === "en" ? "Podcasts" : "Podcasty"}
            />
          </section>
        )}
        <section className="max-w-[1200px] mx-auto px-4 lg:px-8 pb-12">
          <ExpertMaterialsExplorer data={data} lang={lang} />
        </section>
      </div>
    </div>
  );
}
