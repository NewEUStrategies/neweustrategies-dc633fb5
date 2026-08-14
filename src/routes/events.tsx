// Lista publicznych wydarzeń. URL: /events
// Filtry: nadchodzące vs. archiwum. RSVP wymaga logowania.
// SSR: loader rozgrzewa ["public-events"] przez ensureQueryData, więc HTML
// listy i JSON-LD (CollectionPage z węzłami Event) schodzą z serwera zamiast
// renderować się dopiero po hydratacji (audyt 2026-07-30: "Brak SSR listy").
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BadgeCheck, Calendar, Lock, MapPin, Users, Video } from "lucide-react";
import { publicEventsQueryOptions, type PublicEvent } from "@/lib/community/publicQueries";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { COMMUNITY_MODULES_DEFAULTS, COMMUNITY_MODULES_KEY } from "@/lib/community/modulesSettings";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead, splitUrl, SITE_NAME } from "@/lib/seo/meta";
import { breadcrumbListJsonLd, eventsCollectionJsonLd, safeJsonLd } from "@/lib/seo/jsonld";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";
import { EventsListSkeleton } from "@/components/community/EventsListSkeleton";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { DegradedDataNotice } from "@/components/molecules/DegradedDataNotice";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-community";
import { loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";

/** Ile nadchodzących wydarzeń trafia do projekcji head (JSON-LD). */
const HEAD_EVENTS_LIMIT = 30;

interface EventsHeadEvent {
  slug: string;
  titlePl: string;
  titleEn: string;
  startsAt: string;
  endsAt: string | null;
  kind: string;
  location: string | null;
  cover: string | null;
}

interface EventsLoaderData {
  /** Lekka projekcja nadchodzących wydarzeń pod JSON-LD w head(); pełne
   *  wiersze jadą raz - w dehydratowanym cache React Query. */
  headEvents: EventsHeadEvent[];
  /** Lista nie dojechała w budżecie SSR - body pokazuje uczciwy komunikat. */
  degraded: boolean;
}

/** Pusta lista jako fallback zdegradowanego renderu (patrz lib/ssr/resilientLoad). */
const NO_EVENTS: PublicEvent[] = [];

export const Route = createFileRoute("/events")({
  // Bramka modułu jest fail-soft (toggle ma bezpieczne domyślne "włączone",
  // a odczyt dedupuje się z root loaderem - ten sam klucz zapytania, zero
  // dodatkowych round-tripów).
  //
  // Sama lista była wcześniej fail-loud i to był błąd w warstwie TRANSPORTU:
  // rzut z loadera dawał HTTP 500, więc blip backendu wypadał z cache'a CDN,
  // podnosił monitory i wyglądał dla crawlera jak awaria serwera. Teraz trasa
  // degraduje się na 200 (patrz lib/ssr/resilientLoad), ale NIE udaje, że
  // wydarzeń nie ma: `degraded` jedzie do body, które renderuje uczciwy
  // komunikat z ponowieniem zamiast pustej listy.
  loader: async ({ context }): Promise<EventsLoaderData> => {
    const settings = await context.queryClient
      .ensureQueryData(siteSettingsQueryOptions)
      .catch(() => undefined);
    const modules = resolveSetting(settings, COMMUNITY_MODULES_KEY, COMMUNITY_MODULES_DEFAULTS);
    if (!modules.events_enabled) return { headEvents: [], degraded: false };

    const { data: events, degraded } = await loadResilient(
      context.queryClient,
      publicEventsQueryOptions(),
      NO_EVENTS,
    );
    setCacheControlHeader(resilientCacheControl(degraded));
    const now = Date.now();
    return {
      degraded,
      headEvents: events
        .filter((ev) => new Date(ev.ends_at ?? ev.starts_at).getTime() >= now)
        .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
        .slice(0, HEAD_EVENTS_LIMIT)
        .map((ev) => ({
          slug: ev.slug,
          titlePl: ev.title_pl,
          titleEn: ev.title_en,
          startsAt: ev.starts_at,
          endsAt: ev.ends_at,
          kind: ev.kind,
          location: ev.location,
          cover: ev.cover_url,
        })),
    };
  },
  head: ({ loaderData }) => {
    const url = getRequestUrl() || "/events";
    const lang = activeLang(url);
    const title = lang === "en" ? "Events" : "Wydarzenia";
    const description =
      lang === "en"
        ? "Panels, webinars, live briefings and members-only meet-ups on European affairs."
        : "Panele, webinaria, spotkania na żywo i briefingi tylko dla społeczności.";
    const head = buildContentHead({
      url,
      lang,
      type: "website",
      title,
      // Marka w tytule karty przeglądarki/SERP; og:title zostaje krótki.
      documentTitle: `${title} - ${SITE_NAME}`,
      description,
    });
    const { origin } = splitUrl(url);
    const collection = eventsCollectionJsonLd({
      origin,
      lang,
      path: "/events",
      name: title,
      description,
      events: (loaderData?.headEvents ?? []).map((ev) => ({
        slug: ev.slug,
        name: (lang === "en" ? ev.titleEn || ev.titlePl : ev.titlePl || ev.titleEn) || ev.slug,
        startDate: ev.startsAt,
        endDate: ev.endsAt,
        kind: ev.kind,
        location: ev.location,
        image: ev.cover,
      })),
    });
    const breadcrumbs = breadcrumbListJsonLd([{ label: title, href: "/events" }], origin, lang);
    return {
      ...head,
      scripts: [
        { type: "application/ld+json", children: safeJsonLd(collection) },
        { type: "application/ld+json", children: safeJsonLd(breadcrumbs) },
      ],
    };
  },
  component: EventsPage,
  pendingComponent: () => <EventsListSkeleton />,
  errorComponent: (props) => (
    <RouteErrorFallback
      {...props}
      title={activeLang() === "en" ? "Failed to load events" : "Nie udało się załadować wydarzeń"}
    />
  ),
});

function EventsPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureCommunityI18n();
  const modules = useCommunityModules();
  const { degraded } = Route.useLoaderData();
  if (!modules.events_enabled) return <CommunityDisabled />;
  // Render zdegradowany: zamiast fałszywego „brak wydarzeń" pokazujemy, co się
  // naprawdę stało, z przyciskiem ponowienia (router.invalidate przeładuje
  // loader - po stronie klienta backend zwykle już odpowiada).
  if (degraded) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-12 md:py-16">
        <DegradedDataNotice
          title={
            activeLang() === "en" ? "Couldn't load events" : "Nie udało się załadować wydarzeń"
          }
        />
      </div>
    );
  }
  return <EventsPageBody />;
}

// Osobny komponent, bo useSuspenseQuery nie zna `enabled`: bramkę modułu
// rozstrzyga rodzic (przy wyłączonym module loader nie rozgrzewa zapytania,
// a body się nie montuje), stany ładowania/błędu obsługują pendingComponent
// i errorComponent trasy - lista nigdy nie miga komunikatem przejściowym.
function EventsPageBody() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language.startsWith("en") ? "en" : "pl") as "pl" | "en";
  const { data } = useSuspenseQuery(publicEventsQueryOptions());

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const u: PublicEvent[] = [];
    const p: PublicEvent[] = [];
    for (const ev of data) {
      const t2 = ev.ends_at ? new Date(ev.ends_at).getTime() : new Date(ev.starts_at).getTime();
      (t2 >= now ? u : p).push(ev);
    }
    u.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    p.sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
    return { upcoming: u, past: p };
  }, [data]);

  return (
    <div className="container mx-auto max-w-5xl px-4 py-12 md:py-16">
      <header className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight">{t("community.events.title")}</h1>
        <p className="mt-3 text-muted-foreground">{t("community.events.subtitle")}</p>
      </header>

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
          {t("community.events.readMoreAbout", { title })} -&gt;
        </span>
      </div>
    </li>
  );
}
