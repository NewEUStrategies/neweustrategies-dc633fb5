// Organizm: PASEK ZAKŁADEK wydarzenia - nawigacja chrome'u powłoki
// `/events/<slug>/…`.
//
// WZORZEC: docs/zrzuty/swapcard-2026-08-23/38-preview-event-home-desktop.png
// (i identycznie 39, 40) - jeden wyśrodkowany rząd napisów nad treścią, ten sam
// na KAŻDEJ zakładce. Zmierzone z pikseli zrzutu 40: pozycja aktywna to sam
// pogrubiony, prawie czarny napis (#04102D), nieaktywna jest szara (#7784 9C),
// pod aktywną NIE MA podkreślenia, a pasek nie ma linii - kończy go zmiana tła
// strony. My linii używamy, bo nasza strona nie ma osobnego tła treści, więc
// bez niej pasek zlewałby się z pierwszą sekcją.
//
// DLACZEGO OSOBNY ORGANIZM, A NIE TRZECI TRYB `EventMenuNav`. Tamten komponent
// rysuje spis podstron w układzie WYBRANYM PRZEZ ORGANIZATORA
// (`events.pages_display_mode`: „list” albo „grid”) i stoi w treści strony
// głównej. Ten pasek jest CHROME'M POWŁOKI: jest zawsze, jest zawsze poziomy,
// zna pozycję aktywną i ma pozycję „Strona główna”, której w `event_menu` nie
// ma i być nie może (to nie jest podstrona). Dorobienie tego do tamtego
// komponentu znaczyłoby, że przełącznik w panelu przestaje rozstrzygać jedno
// pytanie - a przy trzeciej wartości nie rozstrzygałby żadnego.
//
// POZYCJE SĄ Z BAZY, RAZEM Z FILTREM WIDOCZNOŚCI. `event_menu` oddaje podstrony
// JUŻ przefiltrowane po grupach zapisu wołającego i tylko opublikowane
// (z opublikowanym łańcuchem rodziców). Zakładka „Partnerzy” widoczna wyłącznie
// dla wystawców nie może więc wyciec do gościa przez pasek nawigacji - a
// filtrowanie w kliencie znaczyłoby dokładnie to.
//
// KOLOR POZYCJI IDZIE PRZEZ `activeProps`/`inactiveProps`, NIE PRZEZ KLASĘ
// BAZOWĄ - i to jest poprawka defektu. Router SKLEJA `className` z klasami
// z `activeProps`/`inactiveProps` zwykłą spacją, bez `tailwind-merge`, więc
// kolor wyciszony trzymany w klasie bazowej współistniał na bieżącym odnośniku
// z kolorem aktywnym. Przy równej specyficzności rozstrzygała kolejność
// w arkuszu, a ta stawiała wyciszony PÓŹNIEJ - bieżąca zakładka dostawała
// odcień wyciszony. Rozdzielone na dwa propsy dają DOKŁADNIE JEDNĄ klasę koloru
// na węźle w danym momencie (uzasadnienie w całości: `EventTabsBar`).
//
// ETYKIETA JEST Z BAZY, KLUCZ i18n JEST ZAPASOWY. Organizator ma prawo nazwać
// swoją podstronę („Program” zamiast „Agenda”), więc pierwsze słowo należy do
// `menu_label_*`, a po nim do tytułu strony. Klucz `eventFront.header.tabs.*`
// wchodzi dopiero wtedy, gdy z bazy nie przyszło nic - i tylko dla pozycji
// modułowej, bo tylko dla niej wiemy, o którą z pięciu chodzi.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";

import { useAuth } from "@/hooks/useAuth";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { eventModuleLabelKey, eventModuleOf } from "@/lib/events/eventModules";
import { useEventMenu } from "@/lib/events/usePublicEvent";
import { EventPageLink } from "@/components/events/public/atoms/EventPageLink";
import {
  EventTabsBar,
  EVENT_TAB_ACTIVE_CLASS,
  EVENT_TAB_CLASS,
  EVENT_TAB_INACTIVE_CLASS,
} from "@/components/events/public/molecules/EventTabsBar";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
import { ensureI18n as ensureEventMeI18n } from "@/lib/i18n-cart";
import type { EventMenuItem } from "@/lib/events/publicEventApi";

ensureEventFrontI18n();
ensureEventMeI18n();

export function EventTabsNav({ slug, enabled = true }: { slug: string; enabled?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { session } = useAuth();
  const menuQuery = useEventMenu(slug, enabled);
  const items = menuQuery.data ?? [];

  // Wydarzenie bez ANI JEDNEJ podstrony nie dostaje paska z jedną pozycją:
  // „Strona główna” sama w sobie nie jest nawigacją, tylko ozdobną kreską nad
  // treścią. Ta sama furtka obsługuje wczytywanie i błąd - pasek, który miga
  // po to, żeby zniknąć, przesuwa treść pod kursorem czytelnika.
  if (items.length === 0) return null;

  return (
    // Listwę (znacznik, wyśrodkowanie, klasy pozycji) rysuje `EventTabsBar` -
    // ten sam komponent, którym pasek rysuje podgląd studia. Tutaj zostaje
    // ŹRÓDŁO pozycji: `event_menu` i odnośniki routera.
    <EventTabsBar label={t("eventFront.header.tabsLabel")}>
      <li>
        {/* `exact`: bez tego „Strona główna” zostawałaby aktywna na każdej
              zakładce, bo `/events/<slug>` jest przedrostkiem ich wszystkich. */}
        <Link
          to="/events/$slug"
          params={{ slug }}
          activeOptions={{ exact: true }}
          className={EVENT_TAB_CLASS}
          activeProps={{ className: EVENT_TAB_ACTIVE_CLASS }}
          inactiveProps={{ className: EVENT_TAB_INACTIVE_CLASS }}
        >
          {t("eventFront.header.tabs.overview")}
        </Link>
      </li>
      {items.map((item) => (
        <li key={item.id}>
          <EventPageLink
            item={item}
            eventSlug={slug}
            className={EVENT_TAB_CLASS}
            activeProps={{ className: EVENT_TAB_ACTIVE_CLASS }}
            inactiveProps={{ className: EVENT_TAB_INACTIVE_CLASS }}
          >
            {tabLabel(item, lang, t)}
          </EventPageLink>
        </li>
      ))}
      {/* „Moje" NIE JEST podstroną organizatora, więc nie ma jej w `event_menu`
          i nie może mieć: to prywatna płaszczyzna wołającego (profil,
          networking, rejestracja). Gość jej nie widzi, bo nie miałby w niej
          ani jednego wiersza danych. */}
      {session !== null && (
        <li>
          <Link
            to="/events/$slug/me"
            params={{ slug }}
            className={EVENT_TAB_CLASS}
            activeProps={{ className: EVENT_TAB_ACTIVE_CLASS }}
            inactiveProps={{ className: EVENT_TAB_INACTIVE_CLASS }}
          >
            {t("eventMe.tab")}
          </Link>
        </li>
      )}
    </EventTabsBar>
  );
}

/**
 * Etykieta zakładki: własna nazwa z panelu -> tytuł strony -> nazwa modułu
 * ze słownika -> ścieżka.
 *
 * OSTATNI STOPIEŃ ISTNIEJE DLA POZYCJI ZWYKŁEJ, nie modułowej: strona bez
 * tytułu w języku interfejsu jest w bazie możliwa, a zakładka bez napisu nie
 * jest zakładką. Dla pozycji modułowej ostatnim sensownym stopniem jest nazwa
 * modułu, bo tę znamy niezależnie od tego, co redakcja wpisała.
 */
function tabLabel(item: EventMenuItem, lang: "pl" | "en", t: (key: string) => string): string {
  const module = eventModuleOf(item.module);
  const fallback = module === null ? item.path : t(eventModuleLabelKey(module));
  return pickLocalized({ label_pl: item.labelPl, label_en: item.labelEn }, "label", lang, fallback);
}
