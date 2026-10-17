// Lista publicznych wydarzeń. URL: /events
//
// TO JEST TRASA INDEKSU, A NIE UKŁAD. `events.tsx` obok jest UKŁADEM całej
// sekcji `/events/*` i renderuje wyłącznie `<Outlet />`. Rozdział nie jest
// kosmetyką: w TanStack Router dziecko renderuje się TYLKO przez `<Outlet />`
// rodzica, więc dopóki lista siedziała w `events.tsx`, wejście na
// `/events/<slug>` pokazywało LISTĘ zamiast wydarzenia - a razem z nią zapis
// (`/events/<slug>/register`) i samoobsługę zgłoszenia. Ten sam podział ma już
// panel: `admin.events.tsx` (układ) + `admin.events.index.tsx` (treść).
// Filtry: nadchodzące vs. archiwum. RSVP wymaga logowania.
// SSR: loader rozgrzewa ["public-events"] przez ensureQueryData, więc HTML
// listy i JSON-LD (CollectionPage z węzłami Event) schodzą z serwera zamiast
// renderować się dopiero po hydratacji (audyt 2026-07-30: "Brak SSR listy").
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useDegradedUntilHealed } from "@/lib/ssr/useDegradedUntilHealed";
import { useTranslation } from "react-i18next";
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
import { EventCard } from "@/components/events/public/molecules/EventCatalogueCard";
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

export const Route = createFileRoute("/events/")({
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
    // DEGRADACJA NIE SKLADA ROBOTOWI OSWIADCZENIA O ZAWARTOSCI KATALOGU.
    // `headEvents` jest wtedy puste NIE dlatego, ze wydarzen nie ma, tylko
    // dlatego, ze lista nie dojechala - a `CollectionPage` z pustym
    // `ItemList` czyta sie dokladnie jak "ten serwis nie ma wydarzen".
    // Odpowiedz wychodzi na HTTP 200 (to cala pointa degradacji), a
    // `Cache-Control: private, no-store` odcina cache, nie indeksowanie, wiec
    // blip backendu w chwili wizyty crawlera zostalby zapisany jako fakt.
    // Body mowi w tej sytuacji "nie udalo sie wczytac" - dane strukturalne maja
    // milczec z tego samego powodu. Okruszki zostaja: sciezka do katalogu jest
    // prawdziwa niezaleznie od tego, czy lista dojechala.
    const collection =
      (loaderData?.degraded ?? false)
        ? null
        : eventsCollectionJsonLd({
            origin,
            lang,
            path: "/events",
            name: title,
            description,
            events: (loaderData?.headEvents ?? []).map((ev) => ({
              slug: ev.slug,
              name:
                (lang === "en" ? ev.titleEn || ev.titlePl : ev.titlePl || ev.titleEn) || ev.slug,
              startDate: ev.startsAt,
              endDate: ev.endsAt,
              kind: ev.kind,
              location: ev.location,
              image: ev.cover,
            })),
          });
    const breadcrumbs = breadcrumbListJsonLd(
      [{ label: title, href: "/events" }],
      origin,
      lang,
      url,
    );
    return {
      ...head,
      scripts: [
        ...(collection === null
          ? []
          : [{ type: "application/ld+json", children: safeJsonLd(collection) }]),
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
  return <EventsPageBody initialDegraded={degraded} />;
}

// Mount the query even when SSR seeded a fallback; keep the module gate
// outside so disabled events never fetch their catalog.
function EventsPageBody({ initialDegraded }: { initialDegraded: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language.startsWith("en") ? "en" : "pl") as "pl" | "en";
  // FABRYKA W MIEJSCU WYWOŁANIA, nie przez alias. Bramka `check:route-loaders`
  // (`src/lib/ci/publicRouteLoaders.ts`) kojarzy rozgrzanie z odczytem po NAZWIE
  // fabryki klucza, a po stronie ODCZYTU czyta wyłącznie ARGUMENTY haka
  // (`findQuerySites`). Alias `const options = publicEventsQueryOptions()`
  // podstawiał tam gołe `options`, więc zapytanie wychodziło bez żadnej fabryki
  // i trasa wpadała do kubełka „zimne zapytania" - mimo że loader wyżej grzeje
  // DOKŁADNIE ten klucz przez `loadResilient`. Powtórne wywołanie fabryki nic
  // nie kosztuje: oddaje nowy obiekt opcji przy każdym renderze tak czy owak,
  // a `useDegradedUntilHealed` bierze z klucza HASH, nie tożsamość tablicy.
  const { data } = useSuspenseQuery(publicEventsQueryOptions());
  const { degraded, retry } = useDegradedUntilHealed(
    publicEventsQueryOptions().queryKey,
    initialDegraded,
  );
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

  if (degraded) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-12 md:py-16">
        <DegradedDataNotice
          onRetry={retry}
          title={
            activeLang() === "en" ? "Couldn't load events" : "Nie udało się załadować wydarzeń"
          }
        />
      </div>
    );
  }
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
