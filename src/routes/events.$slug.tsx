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
//     wzorca 38, 39 i 40 mają dokładnie ten sam pasek nad różną treścią);
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
import { createFileRoute, Link, Outlet, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";

import { fetchPublicEventBySlug } from "@/lib/community/publicQueries";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";
import { EventBrandingStyle } from "@/components/events/public/atoms/EventBrandingStyle";
import { EventTabsNav } from "@/components/events/public/organisms/EventTabsNav";
import { eventBrandingScopeProps } from "@/lib/events/eventBrandingCss";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-community";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

export const Route = createFileRoute("/events/$slug")({
  component: EventShell,
  head: ({ params }) => {
    const url = getRequestUrl() || `/events/${params.slug}`;
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "article",
      title:
        lang === "en" ? "Event - New European Strategies" : "Wydarzenie - New European Strategies",
      description:
        lang === "en"
          ? "Community event details, RSVP and live link."
          : "Szczegóły wydarzenia, zapis i link do transmisji.",
    });
  },
});

function EventShell() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureCommunityI18n();
  ensureEventFrontI18n();
  const { slug } = useParams({ from: "/events/$slug" });
  const { t, i18n } = useTranslation();
  const lang = (i18n.language.startsWith("en") ? "en" : "pl") as "pl" | "en";
  const modules = useCommunityModules();

  // TEN SAM KLUCZ, CO W PRZEGLĄDZIE I W POZOSTAŁYCH ZAKŁADKACH. Powłoka
  // potrzebuje nazwy i brandingu, przegląd potrzebuje wszystkiego - a react-query
  // scala oba wywołania w JEDNO zapytanie po kluczu. Przekazywanie wydarzenia
  // przez kontekst trasy dałoby drugie źródło tej samej migawki.
  const eventQ = useQuery({
    queryKey: ["public-event", slug],
    queryFn: () => fetchPublicEventBySlug(slug),
    enabled: modules.events_enabled,
  });

  if (!modules.events_enabled) return <CommunityDisabled />;
  if (eventQ.isLoading) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">{t("community.common.loading")}</div>
    );
  }
  if (!eventQ.data) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <p className="text-muted-foreground">{t("community.common.loadError")}</p>
        <Link to="/events" className="mt-4 inline-block text-sm text-primary">
          {t("community.events.backToList")}
        </Link>
      </div>
    );
  }

  const ev = eventQ.data;
  const title = lang === "en" ? ev.title_en || ev.title_pl : ev.title_pl || ev.title_en;

  return (
    // Branding wydarzenia wchodzi na OPAKOWANIE tej strony, nigdy na `:root`:
    // kolory jednego kongresu nie mogą przemalować nagłówka serwisu ani
    // sąsiedniej zakładki. Zmienne generuje `EventBrandingStyle`. Zakres jest
    // na POWŁOCE, więc obejmuje także pasek zakładek i każdą podstronę - inaczej
    // przegląd byłby w barwach wydarzenia, a lista prelegentów w barwach serwisu.
    <div {...eventBrandingScopeProps} className="pb-12 md:pb-16">
      <EventBrandingStyle branding={ev.branding} />

      <div className="mx-auto w-full max-w-5xl px-4 pt-10">
        <Link
          to="/events"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("community.events.backToList")}
        </Link>

        {/* NAZWA WYDARZENIA W CHROME'IE, a nie tylko w treści przeglądu. Na
            zakładce „Prelegenci” nie ma okładki ani tytułu (zrzuty 39 i 40), więc
            bez tego wiersza czytelnik widziałby listę nazwisk bez informacji,
            czyje one są. Na przeglądzie stoi nad nią duży `h1` z tytułem - tak
            samo jak na wzorcu, gdzie nazwa jest i w pasku, i na banerze.
            To jest odnośnik, a nie nagłówek: nagłówek poziomu 1 należy do
            treści zakładki, a dwa `h1` na stronie to defekt SEO. */}
        <p className="mt-4">
          <Link
            to="/events/$slug"
            params={{ slug }}
            className="text-sm font-semibold text-foreground hover:underline"
          >
            {title}
          </Link>
        </p>
      </div>

      {/* Pasek zakładek: pozycje z `event_menu` (już przefiltrowane po grupach
          zapisu wołającego) plus „Strona główna”, której w menu nie ma. */}
      <div className="mt-4">
        <EventTabsNav slug={slug} />
      </div>

      <Outlet />
    </div>
  );
}
