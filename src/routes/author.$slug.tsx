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
      {/* CSIS-style hero: ciemny pas z prostokątnym portretem nachodzącym na dół */}
      <header className="relative">
        <div
          className="relative bg-[var(--brand)] text-white"
          style={
            expert.cover_url
              ? {
                  backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.75)), url(${expert.cover_url})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : undefined
          }
        >
          <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-6 lg:px-8 lg:pb-28 lg:pt-8">
            <div className="[&_*]:!text-white/80 [&_a:hover]:!text-white">
              <Breadcrumbs items={[{ label: name }]} />
            </div>
            <div className="mt-6 grid gap-6 sm:grid-cols-[220px_1fr] lg:grid-cols-[260px_1fr] lg:gap-10">
              <div className="row-span-2">
                {expert.avatar_url ? (
                  <img
                    src={expert.avatar_url}
                    alt={name}
                    className="aspect-[3/4] w-full max-w-[260px] rounded-[2px] object-cover shadow-2xl ring-1 ring-white/10"
                  />
                ) : (
                  <div className="grid aspect-[3/4] w-full max-w-[260px] place-items-center rounded-[2px] bg-white/10 text-4xl font-display text-white/70 shadow-2xl ring-1 ring-white/10">
                    {name.slice(0, 1)}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  {expert.is_expert && (
                    <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider">
                      {t("expert.expertBadge")}
                    </span>
                  )}
                  {expert.verified_at && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-sky-400/25 px-2 py-0.5 text-[11px] font-medium text-sky-50"
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
                </div>
                <h1 className="font-display text-4xl leading-[1.05] lg:text-5xl">{name}</h1>
                {roleLine && (
                  <p className="text-lg font-medium text-white/85">{roleLine}</p>
                )}
                {functions.length > 0 && (
                  <p className="text-sm text-white/70">{functions.join(" · ")}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {expert.website_url && (
                    <a
                      href={expert.website_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Website"
                      className="grid h-9 w-9 place-items-center rounded-full border border-white/25 text-white/85 transition-colors hover:border-white hover:text-white"
                    >
                      <BrandIcon name="website" fallback={Globe} className="h-4 w-4" alt="WWW" />
                    </a>
                  )}
                  {expert.linkedin_url && (
                    <a
                      href={expert.linkedin_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="LinkedIn"
                      className="grid h-9 w-9 place-items-center rounded-full border border-white/25 text-white/85 transition-colors hover:border-white hover:text-white"
                    >
                      <BrandIcon name="linkedin" fallback={Linkedin} className="h-4 w-4" alt="LinkedIn" />
                    </a>
                  )}
                  {expert.twitter_url && (
                    <a
                      href={expert.twitter_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="X"
                      className="grid h-9 w-9 place-items-center rounded-full border border-white/25 text-white/85 transition-colors hover:border-white hover:text-white"
                    >
                      <BrandIcon name="x" fallback={XIcon} className="h-4 w-4" alt="X" />
                    </a>
                  )}
                  {personalized.followInAuthorHeader && (
                    <div className="ml-1">
                      <FollowButton targetType="author" targetId={expert.id} lang={lang} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Pasek obszarów ekspertyzy pod hero (CSIS-style) */}
        {data.areas.length > 0 && (
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
        <section className="mx-auto max-w-[1200px] px-4 py-10 lg:px-8 lg:py-12">
          <ExpertHubDetails data={data} lang={lang} />
        </section>
        {data.mediaMentions.length > 0 && (
          <section className="mx-auto max-w-[1200px] px-4 pb-10 lg:px-8">
            <ExpertInTheNews mentions={data.mediaMentions} lang={lang} />
          </section>
        )}
        {podcastsQ.data && podcastsQ.data.length > 0 && (
          <section className="mx-auto max-w-[1200px] px-4 pb-6 lg:px-8">
            <PodcastEpisodeStrip
              episodes={podcastsQ.data}
              lang={lang}
              title={lang === "en" ? "Podcasts" : "Podcasty"}
            />
          </section>
        )}
        <section className="mx-auto max-w-[1200px] px-4 pb-14 lg:px-8">
          <ExpertMaterialsExplorer data={data} lang={lang} />
        </section>
        <div className="mx-auto w-full max-w-[1200px]">
          <AuthorCvSections userId={expert.id} />
        </div>
      </div>
    </div>
  );
}
