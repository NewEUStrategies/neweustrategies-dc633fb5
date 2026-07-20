// Lista publicznych wydarzeń. URL: /events
// Filtry: nadchodzące vs. archiwum. RSVP wymaga logowania.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BadgeCheck, Calendar, Lock, MapPin, Users, Video } from "lucide-react";
import { fetchPublicEvents, type PublicEvent } from "@/lib/community/publicQueries";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-community";
export const Route = createFileRoute("/events")({
  component: EventsPage,
  head: () => {
    const url = getRequestUrl() || "/events";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title:
        lang === "en" ? "Events - New European Strategies" : "Wydarzenia - New European Strategies",
      description:
        lang === "en"
          ? "Panels, webinars, live briefings and members-only meet-ups on European affairs."
          : "Panele, webinaria, spotkania na żywo i briefingi tylko dla społeczności.",
    });
  },
});

function EventsPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureCommunityI18n();
  const { t, i18n } = useTranslation();
  const lang = (i18n.language.startsWith("en") ? "en" : "pl") as "pl" | "en";
  const modules = useCommunityModules();
  const query = useQuery({
    queryKey: ["public-events"],
    queryFn: fetchPublicEvents,
    enabled: modules.events_enabled,
  });

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const rows = query.data ?? [];
    const u: PublicEvent[] = [];
    const p: PublicEvent[] = [];
    for (const ev of rows) {
      const t2 = ev.ends_at ? new Date(ev.ends_at).getTime() : new Date(ev.starts_at).getTime();
      (t2 >= now ? u : p).push(ev);
    }
    u.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    p.sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
    return { upcoming: u, past: p };
  }, [query.data]);

  if (!modules.events_enabled) return <CommunityDisabled />;

  return (
    <div className="container mx-auto max-w-5xl px-4 py-12 md:py-16">
      <header className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight">{t("community.events.title")}</h1>
        <p className="mt-3 text-muted-foreground">{t("community.events.subtitle")}</p>
      </header>

      {query.isLoading && <p className="text-muted-foreground">{t("community.common.loading")}</p>}
      {query.isError && <p className="text-destructive">{t("community.common.loadError")}</p>}

      {!query.isLoading && !query.isError && (
        <>
          <Section
            title={t("community.events.upcoming")}
            events={upcoming}
            lang={lang}
            emptyKey="community.events.empty"
          />
          <Section
            title={t("community.events.past")}
            events={past}
            lang={lang}
            emptyKey="community.events.pastEmpty"
            className="mt-14"
          />
        </>
      )}
    </div>
  );
}

function Section({
  title,
  events,
  lang,
  emptyKey,
  className,
}: {
  title: string;
  events: PublicEvent[];
  lang: "pl" | "en";
  emptyKey: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <section className={className}>
      <h2 className="mb-6 text-2xl font-semibold">{title}</h2>
      {events.length === 0 ? (
        <p className="text-muted-foreground">{t(emptyKey)}</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {events.map((ev) => (
            <EventCard key={ev.id} event={ev} lang={lang} />
          ))}
        </ul>
      )}
    </section>
  );
}

function EventCard({ event, lang }: { event: PublicEvent; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const title = lang === "en" ? event.title_en || event.title_pl : event.title_pl || event.title_en;
  const desc = lang === "en" ? event.description_en : event.description_pl;
  const when = new Date(event.starts_at).toLocaleString(lang === "en" ? "en-GB" : "pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <li className="group relative overflow-hidden rounded-lg border border-border bg-card transition hover:border-primary/60">
      {event.cover_url && (
        <div className="aspect-video w-full overflow-hidden bg-muted">
          <img src={event.cover_url} alt="" loading="lazy" className="h-full w-full object-cover" />
        </div>
      )}
      <div className="p-5">
        {event.visibility === "members" && (
          <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {event.kind === "briefing" ? (
              <>
                <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                {t("community.events.proBriefing")}
              </>
            ) : (
              <>
                <Lock className="h-3 w-3" aria-hidden="true" />
                {t("community.events.membersOnly")}
              </>
            )}
          </span>
        )}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            {when}
          </span>
          {event.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {event.location}
            </span>
          )}
          {event.kind === "online" && (
            <span className="inline-flex items-center gap-1">
              <Video className="h-3.5 w-3.5" aria-hidden="true" />
              online
            </span>
          )}
          {event.capacity !== null && (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {event.capacity}
            </span>
          )}
        </div>
        <h3 className="mt-3 text-lg font-semibold leading-snug">
          <Link
            to="/events/$slug"
            params={{ slug: event.slug }}
            className="after:absolute after:inset-0"
          >
            {title}
          </Link>
        </h3>
        {desc && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{desc}</p>}
        <span className="mt-4 inline-block text-sm font-medium text-primary">
          {t("community.events.readMore")} -&gt;
        </span>
      </div>
    </li>
  );
}
