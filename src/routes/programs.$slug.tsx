import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  ExternalLink,
  FileText,
  Headphones,
  Mail,
  Users,
} from "lucide-react";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { PublicNotFound } from "@/components/molecules/PublicNotFound";
import { PostListCard } from "@/components/molecules/PostListCard";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NewsletterForm } from "@/components/NewsletterForm";
import { ProgramIcon } from "@/components/programs/ProgramIcon";
import {
  programBySlugQueryOptions,
  type ProgramLanding,
  type ProgramMember,
  type ProgramProject,
} from "@/lib/queries/programs";
import type { PublicEvent } from "@/lib/community/publicQueries";
import type { Podcast } from "@/lib/podcast/types";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { formatDateShort } from "@/lib/i18n/format";
import { safeAccent, accentRgba, readableTextColor } from "@/lib/programs/visual";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import { breadcrumbListJsonLd, safeJsonLd } from "@/lib/seo/jsonld";
import "@/lib/i18n-programs";

export const Route = createFileRoute("/programs/$slug")({
  loader: async ({ context, params }) => {
    const landing = await context.queryClient
      .ensureQueryData(programBySlugQueryOptions(params.slug))
      .catch(() => null); // crawler surfaces degrade, never 500
    if (!landing) throw notFound();
    return { landing };
  },
  head: ({ loaderData, params }) => {
    const url = getRequestUrl() || `/programs/${params.slug}`;
    const lang = activeLang(url);
    const landing = (loaderData as { landing: ProgramLanding } | undefined)?.landing ?? null;
    const program = landing?.program ?? null;
    if (!program) {
      return buildContentHead({
        url,
        lang,
        type: "website",
        title: lang === "en" ? "Research programs" : "Programy badawcze",
        description: "",
        robots: "noindex, follow",
      });
    }
    let origin = "";
    try {
      origin = new URL(url).origin;
    } catch {
      /* relative URL in tests */
    }
    const name = pickLocalized(program, "name", lang);
    const tagline = pickLocalized(program, "tagline", lang);
    const scope = pickLocalized(program, "scope", lang);
    const head = buildContentHead({
      url,
      lang,
      type: "website",
      title: `${name} — New European Strategies`,
      documentTitle: `${name} — New European Strategies`,
      description: tagline || scope || name,
      image: program.hero_image_url,
      modifiedAt: program.updated_at,
    });
    const breadcrumbs = breadcrumbListJsonLd(
      [
        { label: lang === "en" ? "Research programs" : "Programy badawcze", href: "/programs" },
        { label: name, href: `/programs/${program.slug}` },
      ],
      origin,
      lang,
    );
    return {
      ...head,
      scripts: [{ type: "application/ld+json", children: safeJsonLd(breadcrumbs) }],
    };
  },
  component: ProgramDetail,
  notFoundComponent: PublicNotFound,
  errorComponent: (props) => (
    <RouteErrorFallback
      {...props}
      title={
        activeLang() === "en" ? "Failed to load the program" : "Nie udało się załadować programu"
      }
    />
  ),
});

// ---------- section primitives --------------------------------------------

function Section({
  id,
  title,
  icon,
  children,
}: {
  id: string;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-4 scroll-mt-24">
      <h2 className="font-display text-2xl flex items-center gap-2">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "NES"
  );
}

function MemberCard({ member, lang }: { member: ProgramMember; lang: "pl" | "en" }) {
  const role = pickLocalized(
    { role_pl: member.member_role_pl, role_en: member.member_role_en },
    "role",
    lang,
    member.job_title ?? "",
  );
  const inner = (
    <>
      <Avatar className="w-12 h-12">
        {member.avatar_url && <AvatarImage src={member.avatar_url} alt={member.display_name} />}
        <AvatarFallback>{initials(member.display_name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="font-medium truncate">{member.display_name}</p>
        {role && <p className="text-sm text-muted-foreground truncate">{role}</p>}
      </div>
    </>
  );
  const className = "flex items-center gap-3 p-3 rounded-lg border border-border bg-card";
  return member.profile_slug ? (
    <Link
      to="/author/$slug"
      params={{ slug: member.profile_slug }}
      className={`${className} hover:border-brand transition-colors`}
    >
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

const PROJECT_STATUS_STYLE: Record<ProgramProject["project_status"], string> = {
  planned: "bg-muted text-muted-foreground",
  active: "bg-primary/10 text-primary",
  completed: "bg-muted text-foreground/70",
};

function ProjectCard({ project, lang }: { project: ProgramProject; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const name = pickLocalized(project, "name", lang);
  const summary = pickLocalized(project, "summary", lang);
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-medium leading-snug">{name}</h3>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${PROJECT_STATUS_STYLE[project.project_status]}`}
        >
          {t(`programs.projectStatus.${project.project_status}`)}
        </span>
      </div>
      {summary && <p className="text-sm text-muted-foreground">{summary}</p>}
      {project.url && (
        <span className="inline-flex items-center gap-1 text-sm text-primary">
          {lang === "en" ? "Learn more" : "Więcej"}
          <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
        </span>
      )}
    </>
  );
  const className = "flex flex-col gap-2 p-4 rounded-lg border border-border bg-card";
  return project.url ? (
    <a
      href={project.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`${className} hover:border-brand transition-colors`}
    >
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}

function PodcastCard({ podcast, lang }: { podcast: Podcast; lang: "pl" | "en" }) {
  const title = pickLocalized(podcast, "title", lang);
  const excerpt = pickLocalized(podcast, "excerpt", lang);
  return (
    <Link
      to="/podcast/$slug"
      params={{ slug: podcast.slug }}
      className="flex gap-4 p-4 rounded-lg border border-border bg-card hover:border-brand transition-colors"
    >
      <div className="w-16 h-16 rounded-md bg-muted overflow-hidden shrink-0 flex items-center justify-center">
        {podcast.cover_image_url ? (
          <OptimizedImage
            src={podcast.cover_image_url}
            alt={title}
            width={64}
            height={64}
            className="w-full h-full object-cover"
          />
        ) : (
          <Headphones className="w-6 h-6 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 space-y-1">
        <p className="font-medium leading-snug line-clamp-2">{title}</p>
        {excerpt && <p className="text-sm text-muted-foreground line-clamp-2">{excerpt}</p>}
      </div>
    </Link>
  );
}

function EventCard({ event, lang }: { event: PublicEvent; lang: "pl" | "en" }) {
  const title = pickLocalized(event, "title", lang);
  const when = new Date(event.starts_at).toLocaleString(lang === "en" ? "en-GB" : "pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <Link
      to="/events/$slug"
      params={{ slug: event.slug }}
      className="flex flex-col gap-1.5 p-4 rounded-lg border border-border bg-card hover:border-brand transition-colors"
    >
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
        {when}
      </span>
      <p className="font-medium leading-snug">{title}</p>
      {event.location && <p className="text-sm text-muted-foreground">{event.location}</p>}
    </Link>
  );
}

// ---------- page -----------------------------------------------------------

function ProgramDetail() {
  const { slug } = Route.useParams();
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const { data: landing, isLoading } = useQuery(programBySlugQueryOptions(slug));

  if (isLoading && !landing) {
    return <div className="container mx-auto max-w-4xl px-4 py-12" aria-hidden="true" />;
  }
  if (!landing) return <PublicNotFound />;

  const {
    program,
    lead,
    team,
    projects,
    partners,
    flagshipReports,
    latestPublications,
    podcasts,
    events,
  } = landing;
  const accent = safeAccent(program.accent_color);
  const name = pickLocalized(program, "name", lang);
  const tagline = pickLocalized(program, "tagline", lang);
  const scope = pickLocalized(program, "scope", lang);
  const questions = program.research_questions
    .map((q) => (lang === "en" ? q.en || q.pl : q.pl || q.en))
    .filter((s) => s.trim() !== "");
  // Non-lead members (lead is highlighted separately).
  const teamRest = team.filter((m) => !m.is_lead);

  return (
    <div className="pb-16" style={{ ["--accent" as string]: accent }}>
      {/* Hero */}
      <header className="relative overflow-hidden border-b border-border">
        {program.hero_image_url && (
          <div className="absolute inset-0" aria-hidden="true">
            <OptimizedImage
              src={program.hero_image_url}
              alt=""
              className="w-full h-full object-cover"
              responsive
            />
            <div
              className="absolute inset-0"
              style={{ backgroundColor: accentRgba(accent, 0.88) }}
            />
          </div>
        )}
        <div
          className="absolute inset-0"
          style={
            program.hero_image_url
              ? undefined
              : {
                  background: `linear-gradient(135deg, ${accentRgba(accent, 0.14)}, ${accentRgba(accent, 0.02)})`,
                }
          }
          aria-hidden="true"
        />
        <div className="relative container mx-auto max-w-4xl px-4 py-12 space-y-5">
          <Link
            to="/programs"
            className="inline-flex items-center gap-1 text-sm opacity-80 hover:opacity-100"
            style={program.hero_image_url ? { color: readableTextColor(accent) } : undefined}
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            {t("programs.backToPrograms")}
          </Link>
          <div className="flex items-start gap-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
              style={{
                backgroundColor: program.hero_image_url
                  ? accentRgba("#ffffff", 0.18)
                  : accentRgba(accent, 0.12),
                color: program.hero_image_url ? readableTextColor(accent) : accent,
              }}
            >
              <ProgramIcon name={program.icon} className="w-7 h-7" />
            </div>
            <div className="space-y-2">
              <h1
                className="font-display text-3xl lg:text-4xl"
                style={program.hero_image_url ? { color: readableTextColor(accent) } : undefined}
              >
                {name}
              </h1>
              {tagline && (
                <p
                  className="text-lg max-w-2xl"
                  style={
                    program.hero_image_url
                      ? { color: readableTextColor(accent), opacity: 0.9 }
                      : undefined
                  }
                >
                  {tagline}
                </p>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto max-w-4xl px-4 py-10 space-y-12">
        {/* Teza i zakres badań */}
        {scope && (
          <Section id="scope" title={t("programs.thesis")}>
            <p className="text-base leading-relaxed text-foreground/90 whitespace-pre-line">
              {scope}
            </p>
          </Section>
        )}

        {/* Główne pytania badawcze */}
        {questions.length > 0 && (
          <Section id="questions" title={t("programs.researchQuestions")}>
            <ul className="space-y-3">
              {questions.map((q, i) => (
                <li key={i} className="flex gap-3 p-4 rounded-lg border border-border bg-card">
                  <span className="font-display text-lg leading-none" style={{ color: accent }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-foreground/90">{q}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Lider i zespół */}
        {(lead || teamRest.length > 0) && (
          <Section
            id="team"
            title={t("programs.team")}
            icon={<Users className="w-5 h-5" style={{ color: accent }} />}
          >
            {lead && (
              <div className="mb-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  {t("programs.lead")}
                </p>
                <div className="max-w-sm">
                  <MemberCard member={lead} lang={lang} />
                </div>
              </div>
            )}
            {teamRest.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {teamRest.map((m) => (
                  <MemberCard key={m.profile_id} member={m} lang={lang} />
                ))}
              </div>
            )}
          </Section>
        )}

        {/* Projekty */}
        {projects.length > 0 && (
          <Section id="projects" title={t("programs.projects")}>
            <div className="grid gap-4 sm:grid-cols-2">
              {projects.map((p) => (
                <ProjectCard key={p.id} project={p} lang={lang} />
              ))}
            </div>
          </Section>
        )}

        {/* Raporty flagowe */}
        {flagshipReports.length > 0 && (
          <Section
            id="flagship"
            title={t("programs.flagshipReports")}
            icon={<FileText className="w-5 h-5" style={{ color: accent }} />}
          >
            <div className="grid gap-6 sm:grid-cols-2">
              {flagshipReports.map((post) => (
                <PostListCard
                  key={post.id}
                  post={post}
                  href={post.href}
                  lang={lang}
                  titleClassName="text-lg"
                />
              ))}
            </div>
          </Section>
        )}

        {/* Najnowsze publikacje */}
        {latestPublications.length > 0 && (
          <Section id="publications" title={t("programs.latestPublications")}>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {latestPublications.map((post) => (
                <PostListCard
                  key={post.id}
                  post={post}
                  href={post.href}
                  lang={lang}
                  titleClassName="text-base"
                />
              ))}
            </div>
          </Section>
        )}

        {/* Podcasty i wideo */}
        {podcasts.length > 0 && (
          <Section
            id="podcasts"
            title={t("programs.podcasts")}
            icon={<Headphones className="w-5 h-5" style={{ color: accent }} />}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {podcasts.map((p) => (
                <PodcastCard key={p.id} podcast={p} lang={lang} />
              ))}
            </div>
          </Section>
        )}

        {/* Wydarzenia */}
        {events.length > 0 && (
          <Section
            id="events"
            title={t("programs.events")}
            icon={<CalendarClock className="w-5 h-5" style={{ color: accent }} />}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {events.map((e) => (
                <EventCard key={e.id} event={e} lang={lang} />
              ))}
            </div>
          </Section>
        )}

        {/* Partnerzy */}
        {partners.length > 0 && (
          <Section id="partners" title={t("programs.partners")}>
            <div className="flex flex-wrap gap-4 items-center">
              {partners.map((partner) => {
                const logo = partner.logo_url ? (
                  <OptimizedImage
                    src={partner.logo_url}
                    alt={partner.name}
                    height={40}
                    className="h-10 w-auto object-contain"
                  />
                ) : (
                  <span className="font-medium">{partner.name}</span>
                );
                return partner.url ? (
                  <a
                    key={partner.id}
                    href={partner.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-3 rounded-lg border border-border bg-card hover:border-brand transition-colors"
                    title={partner.name}
                  >
                    {logo}
                    <ExternalLink
                      className="w-3.5 h-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </a>
                ) : (
                  <div
                    key={partner.id}
                    className="flex items-center px-4 py-3 rounded-lg border border-border bg-card"
                    title={partner.name}
                  >
                    {logo}
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Newsletter + kontakt */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Section id="newsletter" title={t("programs.newsletter")}>
            <p className="text-sm text-muted-foreground mb-3">{t("programs.newsletterIntro")}</p>
            <NewsletterForm lang={lang} source={`program:${program.slug}`} variant="inline" />
          </Section>

          {program.contact_email && (
            <Section
              id="contact"
              title={t("programs.contact")}
              icon={<Mail className="w-5 h-5" style={{ color: accent }} />}
            >
              <p className="text-sm text-muted-foreground mb-3">{t("programs.contactIntro")}</p>
              <a
                href={`mailto:${program.contact_email}`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
                style={{ backgroundColor: accent, color: readableTextColor(accent) }}
              >
                <Mail className="w-4 h-4" aria-hidden="true" />
                {t("programs.contactCta")}
              </a>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
