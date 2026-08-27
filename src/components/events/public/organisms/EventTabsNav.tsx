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
// ETYKIETA JEST Z BAZY, KLUCZ i18n JEST ZAPASOWY. Organizator ma prawo nazwać
// swoją podstronę („Program” zamiast „Agenda”), więc pierwsze słowo należy do
// `menu_label_*`, a po nim do tytułu strony. Klucz `eventFront.header.tabs.*`
// wchodzi dopiero wtedy, gdy z bazy nie przyszło nic - i tylko dla pozycji
// modułowej, bo tylko dla niej wiemy, o którą z pięciu chodzi.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";

import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { eventModuleLabelKey, eventModuleOf } from "@/lib/events/eventModules";
import { useEventMenu } from "@/lib/events/usePublicEvent";
import { EventPageLink } from "@/components/events/public/atoms/EventPageLink";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
import type { EventMenuItem } from "@/lib/events/publicEventApi";

ensureEventFrontI18n();

const TAB_CLASS =
  "inline-block whitespace-nowrap rounded-[6px] px-1 py-4 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
// Pogrubienie NIE zmienia rozmiaru napisu, więc pasek nie drga przy przejściu
// między zakładkami; kolor bierze `--foreground`, bo `--primary` jest w jasnym
// motywie prawie czernią, a w ciemnym prawie bielą i nie niesie tu żadnej treści.
const TAB_ACTIVE_CLASS = "font-semibold text-foreground";

export function EventTabsNav({ slug, enabled = true }: { slug: string; enabled?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const menuQuery = useEventMenu(slug, enabled);
  const items = menuQuery.data ?? [];

  // Wydarzenie bez ANI JEDNEJ podstrony nie dostaje paska z jedną pozycją:
  // „Strona główna” sama w sobie nie jest nawigacją, tylko ozdobną kreską nad
  // treścią. Ta sama furtka obsługuje wczytywanie i błąd - pasek, który miga
  // po to, żeby zniknąć, przesuwa treść pod kursorem czytelnika.
  if (items.length === 0) return null;

  return (
    <nav aria-label={t("eventFront.header.tabsLabel")} className="border-b border-border">
      {/* Wyśrodkowany rząd - na wzorcu pasek stoi w osi strony, nie przy lewej
          krawędzi. Zawijanie zamiast przewijania: sześć krótkich napisów mieści
          się na telefonie w dwóch rzędach, a poziomy pasek przewijany chowałby
          ostatnią zakładkę poza ekranem bez żadnego znaku, że tam jest. */}
      <ul className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-6 px-4">
        <li>
          {/* `exact`: bez tego „Strona główna” zostawałaby aktywna na każdej
              zakładce, bo `/events/<slug>` jest przedrostkiem ich wszystkich. */}
          <Link
            to="/events/$slug"
            params={{ slug }}
            activeOptions={{ exact: true }}
            className={TAB_CLASS}
            activeProps={{ className: TAB_ACTIVE_CLASS }}
          >
            {t("eventFront.header.tabs.overview")}
          </Link>
        </li>
        {items.map((item) => (
          <li key={item.id}>
            <EventPageLink
              item={item}
              eventSlug={slug}
              className={TAB_CLASS}
              activeProps={{ className: TAB_ACTIVE_CLASS }}
            >
              {tabLabel(item, lang, t)}
            </EventPageLink>
          </li>
        ))}
      </ul>
    </nav>
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
