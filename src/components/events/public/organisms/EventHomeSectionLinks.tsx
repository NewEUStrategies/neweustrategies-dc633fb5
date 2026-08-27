// Organizm: LISTA SEKCJI na stronie głównej wydarzenia - ŹRÓDŁO POZYCJI
// I ODNOŚNIK. Sam rysunek wiersza (krążek, etykieta, szewron, kreski) mieszka
// w molekule `EventSectionLinks`, bo tego samego rysunku potrzebuje podgląd
// w studiu, który tego organizmu zamontować nie może - patrz nagłówek molekuły.
//
// DLACZEGO OSOBNY ORGANIZM, A NIE TRZECI TRYB `EventMenuNav`. Tamten komponent
// jest NAWIGACJĄ CHROME'U strony i ma dwa układy, między którymi wybiera
// organizator (`events.pages_display_mode`: „list” albo „grid”). Ten spis jest
// TREŚCIĄ strony głównej - stoi na wzorcu w kolumnie środkowej, pod okładką
// i nad poziomami partnerów, niezależnie od tego, co organizator wybrał dla
// paska nawigacji. Dorobienie tu trzeciej wartości trybu znaczyłoby, że
// przełącznik w panelu przestaje rozstrzygać jedno pytanie.
//
// ŹRÓDŁO I ADRES DZIAŁAJĄ JAK W `EventMenuNav` - jeden hook, jedna reguła:
// `useEventMenu` oddaje pozycje JUŻ przefiltrowane po grupach zapisu wołającego
// (filtr w kliencie znaczyłby, że pełna lista podstron jedzie do każdego
// gościa), a o adres pyta się `EventPageLink` - pozycja modułowa idzie do trasy
// dedykowanej `/events/<slug>/<module>`, zwykła pod ścieżkę strony w trasie
// splat. Ten warunek stoi w jednym atomie dla wszystkich trzech spisów.
//
// KOMPONENT NIE ZAKŁADA ZALOGOWANEGO. `useEventMenu` woła RPC z GRANT-em dla
// `anon`, a hook trzyma gościa pod własną tożsamością w kluczu cache - tutaj
// nie ma i nie może być ani jednego odwołania do sesji.
import { useTranslation } from "react-i18next";

import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { useEventMenu } from "@/lib/events/usePublicEvent";
import { EventPageLink } from "@/components/events/public/atoms/EventPageLink";
import {
  EventSectionLinkBody,
  EventSectionLinks,
  EVENT_SECTION_LINK_CLASS,
} from "@/components/events/public/molecules/EventSectionLinks";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
import type { EventMenuItem } from "@/lib/events/publicEventApi";

ensureEventFrontI18n();

export function EventHomeSectionLinks({
  slug,
  enabled = true,
}: {
  slug: string;
  enabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const menuQuery = useEventMenu(slug, enabled);
  const items = menuQuery.data ?? [];

  // PUSTO ZNACZY NIC W DOM-ie - bez nagłówka, bez ramki, bez szkieletu.
  // Ta sama furtka obsługuje wczytywanie i błąd, i tak ma być: szkielet migałby
  // po to, żeby zniknąć, a ramka „Sekcje” bez wiersza w środku wygląda jak
  // awaria. Po zasiewie pięciu stron modułowych (migracja 20260826181500)
  // pustka jest już PRZYPADKIEM GRANICZNYM, nie stanem zwykłym - ale nadal
  // istnieje: wydarzenie, którego wszystkie podstrony redakcja zdjęła z menu,
  // ma tę listę pustą.
  if (items.length === 0) return null;

  return (
    <EventSectionLinks label={t("eventFront.homeSections.label")}>
      {items.map((item) => (
        <li key={item.id}>
          <SectionLinkRow
            item={item}
            eventSlug={slug}
            label={pickLocalized(
              { label_pl: item.labelPl, label_en: item.labelEn },
              "label",
              lang,
              item.path,
            )}
          />
        </li>
      ))}
    </EventSectionLinks>
  );
}

function SectionLinkRow({
  item,
  eventSlug,
  label,
}: {
  item: EventMenuItem;
  eventSlug: string;
  label: string;
}) {
  return (
    <EventPageLink item={item} eventSlug={eventSlug} className={EVENT_SECTION_LINK_CLASS}>
      <EventSectionLinkBody icon={item.icon} color={item.color} label={label} />
    </EventPageLink>
  );
}
