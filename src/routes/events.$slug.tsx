// POWŁOKA publicznej strony wydarzenia: `/events/$slug/*`.
//
// CZYM TA TRASA BYŁA, A CZYM JEST. Do tej zmiany był to LIŚĆ: 747 linii, cały
// przegląd wydarzenia razem z RSVP, biletami, bramkami warstw i JSON-LD.
// Wydarzenie ma jednak PIĘĆ zawsze obecnych podstron (uczestnicy, prelegenci,
// partnerzy, agenda, dyskusje - `event_pages.module`, migracja 20260826181500)
// i każda z nich potrzebuje tego samego chrome'u: brandingu, powrotu do
// katalogu, nazwy wydarzenia i paska zakładek. Trzymanie tego w liściu znaczyło
// pięć kopii chrome'u albo pięć stron bez niego.
//
// PODZIAŁ IDZIE PO PYTANIU „CZY TO JEST WSPÓLNE DLA WSZYSTKICH ZAKŁADEK”:
//   * TUTAJ zostaje bramka modułu, branding, powrót, nazwa wydarzenia, pasek
//     zakładek i bazowe metadane - bo to widać na każdej zakładce (zrzuty
//     wzorca 38, 39 i 40 mają dokładnie ten sam pasek nad różną treścią).
//     Ta trasa ten chrome SKŁADA (zna wydarzenie i router), a RYSUJE go
//     `EventPortalShell` - ten sam komponent, którym rysuje go podgląd studia;
//   * `events.$slug.index.tsx` dostaje CAŁY przegląd - okładkę, tytuł, kartę
//     meta, opis, zapisy, bilety, nagranie i JSON-LD. Ani jeden z tych bloków
//     nie zmienił zachowania; zmienił plik.
//
// `<Outlet />` JEST OBOWIĄZKOWY I BRAMKA GO PILNUJE. W TanStack Router `Match`
// renderuje ALBO `component`, ALBO `<Outlet />` - nigdy oba. Rodzic z własnym
// komponentem, który nie woła `<Outlet />`, montuje się sam, a dzieci zostają
// w drzewie tras nieosiągalne z przeglądarki. Dokładnie to stało się kiedyś
// `/events` (patrz `src/routes/__tests__/parentRoutesRenderOutlet.gate.test.ts`).
//
// `events.$slug_.register` I `events.$slug_.manage` TEJ POWŁOKI NIE DOSTAJĄ
// I TAK MA BYĆ. Podkreślnik w nazwie pliku wypina trasę z układu rodzica, więc
// obie są dziećmi `/events`, a nie `/events/$slug` (widać to w
// `routeTree.gen.ts`: `getParentRoute: () => EventsRoute`). To jest właściwe:
// formularz zapisu i samoobsługa zgłoszenia nie są zakładkami wydarzenia, tylko
// osobnymi sesjami - a pasek zakładek nad formularzem zapraszałby do wyjścia
// z niego w połowie wypełniania.
//
// BRAMKA MODUŁU STOI TUTAJ, NIE W SZEŚCIU DZIECIACH. Niezrenderowany `<Outlet />`
// to dzieci NIEZAMONTOWANE, czyli zero zapytań o menu, uczestników i program
// przy wyłączonym module. Warunek powtórzony w każdym dziecku zatrzymywałby
// rysowanie, ale nie zapytania.
import { createFileRoute, Link, notFound, Outlet, useParams } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";

import {
  eventPageHeaderQueryOptions,
  publicEventBySlugQueryOptions,
  type EventPageHeader,
  type PublicEvent,
} from "@/lib/community/publicQueries";
import { COMMUNITY_MODULES_DEFAULTS, COMMUNITY_MODULES_KEY } from "@/lib/community/modulesSettings";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";
import { DegradedDataNotice } from "@/components/molecules/DegradedDataNotice";
import { EventPortalShell } from "@/components/events/public/organisms/EventPortalShell";
import { EventTabsNav } from "@/components/events/public/organisms/EventTabsNav";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead, SITE_NAME } from "@/lib/seo/meta";
import { anyDegraded, loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-community";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

/**
 * Lekka projekcja nagłówka pod `head()`. Pełny wiersz jedzie raz - w
 * dehydratowanym cache React Query - a tutaj zostaje tylko to, czego potrzebuje
 * synchroniczna funkcja `head()`. Ten sam podział, co w `events.index.tsx`.
 */
interface EventHeadData {
  readonly slug: string;
  readonly titlePl: string;
  readonly titleEn: string;
  readonly descriptionPl: string | null;
  readonly descriptionEn: string | null;
  readonly cover: string | null;
  readonly publishedAt: string | null;
}

interface EventShellLoaderData {
  readonly headEvent: EventHeadData | null;
  /** Wydarzenie nie dojechało w budżecie SSR - body pokazuje uczciwy komunikat. */
  readonly degraded: boolean;
}

/** Fallbacki zdegradowanego renderu (patrz lib/ssr/resilientLoad). */
const NO_EVENT: PublicEvent | null = null;
const NO_HEADER: EventPageHeader | null = null;

export const Route = createFileRoute("/events/$slug")({
  // LOADER, KTÓREGO TA TRASA NIE MIAŁA - i to nie było przyspieszenie, tylko
  // brak treści. `useQuery` w komponencie nie startuje na serwerze fetcha, więc
  // SSR-owy HTML CAŁEGO modułu `/events/$slug` (powłoka + 7 podstron) nie
  // zawierał ani wydarzenia, ani `<Outlet />`, ani węzła schema.org/Event -
  // wyłącznie stan przejściowy, a po hydratacji akapit „nie udało się
  // załadować". Ten HTML wchodził potem do NES Edge Cache na 24 h, a `head()`
  // był zahardkodowany, więc KAŻDE wydarzenie serwisu dzieliło jeden tytuł,
  // jeden opis i jeden obraz społecznościowy.
  //
  // DWA ŹRÓDŁA, DWIE RÓŻNE ROLE - i to NIE jest zdublowane zapytanie:
  //   * `event_page_header` jest SECURITY DEFINER i oddaje wiersz każdemu, kto
  //     zna slug opublikowanego wydarzenia tego najemcy; bramkę warstwy tylko
  //     ETYKIETUJE. Pusty wynik znaczy więc dokładnie jedno - wydarzenia nie ma.
  //     To jest JEDYNE poprawne wejście dla `notFound()`;
  //   * `fetchPublicEventBySlug` stoi pod RLS i niesie pola, których nagłówek
  //     nie oddaje (`host_user_id`, `status`, `early_rsvp_rank`) plus adres
  //     strukturalny do węzła JSON-LD. Jego `null` przy ISTNIEJĄCYM nagłówku
  //     znaczy „nie masz dostępu" - czyli strona 200 z zaproszeniem, nie błąd.
  // Odwrotne przypisanie ról byłoby regresją GORSZĄ od naprawianego defektu:
  // odczyt serwerowy jest zawsze anonimowy, więc 404 oparte na zapytaniu pod RLS
  // zamieniłoby każde wydarzenie `members` w twarde 404 dla uprawnionego
  // czytelnika przy przeładowaniu strony.
  //
  // Transport fail-soft: rzut z loadera dawał HTTP 500, więc blip backendu
  // wypadał z cache'a i wyglądał dla crawlera na awarię serwera.
  loader: async ({ context, params }): Promise<EventShellLoaderData> => {
    const settings = await context.queryClient
      .ensureQueryData(siteSettingsQueryOptions)
      .catch(() => undefined);
    const modules = resolveSetting(settings, COMMUNITY_MODULES_KEY, COMMUNITY_MODULES_DEFAULTS);
    // Moduł wyłączony: `<Outlet />` się nie renderuje, więc nie ma po co grzać
    // ani wydarzenia, ani nagłówka.
    if (!modules.events_enabled) return { headEvent: null, degraded: false };

    // RÓWNOLEGLE, nie sekwencyjnie: budżety biegną współbieżnie, więc dwa wolne
    // zapytania kosztują tyle co jedno (patrz komentarz przy `anyDegraded`).
    const [header, event] = await Promise.all([
      loadResilient(
        context.queryClient,
        // "anon": dokument SSR jest anonimową skorupą, a to jest ten sam klucz,
        // który czyta przegląd (`user?.id ?? "anon"`) - zero dodatkowych
        // round-tripów po hydratacji dla czytelnika niezalogowanego.
        eventPageHeaderQueryOptions(params.slug, "anon"),
        NO_HEADER,
      ),
      loadResilient(context.queryClient, publicEventBySlugQueryOptions(params.slug), NO_EVENT),
    ]);
    const degraded = anyDegraded(header, event);
    setCacheControlHeader(resilientCacheControl(degraded));
    // `notFound()` WYŁĄCZNIE z CZYSTEGO odczytu. `degraded` znaczy „nie wiemy",
    // a 404 z niewiedzy wyrzuciłoby żywe wydarzenie z indeksu na dobę.
    if (!degraded && header.data === null) throw notFound();
    const h = header.data;
    return {
      degraded,
      headEvent:
        h === null
          ? null
          : {
              slug: h.slug,
              titlePl: h.title_pl,
              titleEn: h.title_en,
              descriptionPl: h.description_pl,
              descriptionEn: h.description_en,
              cover: h.cover_url,
              publishedAt: h.published_at,
            },
    };
  },
  component: EventShell,
  // `head()` JEST TERAZ STEROWANY DANYMI. Węzeł schema.org/Event ŚWIADOMIE tu
  // NIE WCHODZI: stoi w `events.$slug.index.tsx`, bo powłoka jest wspólna dla
  // siedmiu zakładek i emisja węzła tutaj rozsiałaby ten sam `Event` pod
  // siedmioma URL-ami.
  head: ({ params, loaderData }) => {
    const url = getRequestUrl() || `/events/${params.slug}`;
    const lang = activeLang(url);
    const ev = loaderData?.headEvent ?? null;
    const title = ev
      ? lang === "en"
        ? ev.titleEn || ev.titlePl
        : ev.titlePl || ev.titleEn
      : lang === "en"
        ? "Event"
        : "Wydarzenie";
    const description = ev
      ? (lang === "en"
          ? ev.descriptionEn || ev.descriptionPl
          : ev.descriptionPl || ev.descriptionEn) ||
        (lang === "en"
          ? "Community event details, RSVP and live link."
          : "Szczegóły wydarzenia, zapis i link do transmisji.")
      : lang === "en"
        ? "Community event details, RSVP and live link."
        : "Szczegóły wydarzenia, zapis i link do transmisji.";
    return buildContentHead({
      url,
      lang,
      type: "article",
      title,
      // Marka w tytule karty przeglądarki i w SERP; `og:title` zostaje krótki.
      documentTitle: `${title} - ${SITE_NAME}`,
      description,
      ...(ev?.cover ? { image: ev.cover } : {}),
      ...(ev?.publishedAt ? { publishedAt: ev.publishedAt } : {}),
    });
  },
});

function EventShell() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureCommunityI18n();
  ensureEventFrontI18n();
  const modules = useCommunityModules();
  const { degraded } = Route.useLoaderData();

  if (!modules.events_enabled) return <CommunityDisabled />;
  // Render ZDEGRADOWANY mówi prawdę zamiast udawać brak wydarzenia, i ma
  // przycisk ponowienia. Nagłówek `no-store` ustawił już loader, więc ten HTML
  // nie zamarza na brzegu (patrz lib/http/responseHeaders - dyrektywa trasy).
  if (degraded) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <DegradedDataNotice variant="page" />
      </div>
    );
  }
  return <EventShellBody />;
}

/**
 * Ciało powłoki wydzielone, bo `useSuspenseQuery` nie zna opcji `enabled`:
 * bramkę modułu i ścieżkę degradacji rozstrzyga rodzic (przy wyłączonym module
 * loader nie grzeje zapytania, a to ciało się nie montuje). Ten sam podział
 * stoi w `events.index.tsx`.
 */
function EventShellBody() {
  const { slug } = useParams({ from: "/events/$slug" });
  const { t, i18n } = useTranslation();
  const lang = (i18n.language.startsWith("en") ? "en" : "pl") as "pl" | "en";
  // TEN SAM KLUCZ, CO W PRZEGLĄDZIE I W POZOSTAŁYCH ZAKŁADKACH - loader
  // rozgrzał go przez `ensureQueryData`, więc `useSuspenseQuery` rozstrzyga się
  // synchronicznie i w SSR, i po hydratacji. Przekazywanie wydarzenia przez
  // kontekst trasy dałoby drugie źródło tej samej migawki.
  const { data } = useSuspenseQuery(publicEventBySlugQueryOptions(slug));

  // NIE MA JUŻ EKRANU „nie udało się załadować". Brak wydarzenia rozstrzygnął
  // loader (`notFound()` na pustym nagłówku definerowym), a awarię transportu -
  // gałąź `degraded` w rodzicu. `null` tutaj znaczy więc DOKŁADNIE JEDNO: RLS
  // ucięło wiersz adresatowi bramki warstwy. Adresat bramki ma dostać
  // zaproszenie, nie komunikat błędu.
  if (data === null) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <p className="text-muted-foreground">{t("community.events.tierRequiredGeneric")}</p>
        <Link to="/pricing" className="mt-4 inline-block text-sm text-primary">
          {t("community.events.tierUpgradeCta")}
        </Link>
      </div>
    );
  }

  const ev = data;
  const title = lang === "en" ? ev.title_en || ev.title_pl : ev.title_pl || ev.title_en;

  return (
    // CHROME RYSUJE `EventPortalShell`, nie ten plik. Zakres brandingu, powrót,
    // nazwa wydarzenia i miejsce na pasek zakładek żyją tam, bo DOKŁADNIE TEN
    // rysunek musi pokazać także podgląd w studiu - a dopóki mieszkał tutaj,
    // podgląd przepisywał go po swojemu i rozjeżdżał się cicho. Pilnuje tego
    // bramka `eventPreviewPublicParity.gate.test.tsx`.
    //
    // POWRÓT I NAZWA WCHODZĄ SLOTAMI, bo to jedyna różnica między stroną
    // a podglądem, która jest ZAMIERZONA: tutaj są odnośnikami routera,
    // w podglądzie napisami (klik wyprowadzałby redaktora ze studia).
    //
    // Pasek zakładek bierze pozycje z `event_menu` (już przefiltrowane po
    // grupach zapisu wołającego) plus „Strona główna”, której w menu nie ma.
    <EventPortalShell
      branding={ev.branding}
      backSlot={
        <Link
          to="/events"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("community.events.backToList")}
        </Link>
      }
      titleSlot={
        <Link
          to="/events/$slug"
          params={{ slug }}
          className="text-sm font-semibold text-foreground hover:underline"
        >
          {title}
        </Link>
      }
      tabsSlot={<EventTabsNav slug={slug} />}
    >
      <Outlet />
    </EventPortalShell>
  );
}
