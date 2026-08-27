// Organizm: menu podstron wydarzenia (`event_menu`).
//
// PREZENTACJĘ WYBIERA ORGANIZATOR, NIE KOMPONENT. `events.pages_display_mode`
// ma dwie wartości: `list` (pionowa lista - kongres z pięcioma podstronami
// czyta się w kolumnie) i `grid` (kafle - dziesięć podstron w kolumnie to
// przewijanie zamiast nawigacji). Gdyby układ stał tu na sztywno, przełącznik
// w panelu byłby ozdobą.
//
// WIDOCZNOŚĆ JUŻ SIĘ STAŁA W BAZIE. `event_menu` filtruje pozycje po grupach
// zapisu wołającego, więc tutaj NIE MA i nie może być filtra „dla kogo":
// filtr w kliencie znaczyłby, że pełna lista podstron (razem z nazwami stron
// dla partnerów) jedzie do każdego gościa i widać ją w narzędziach
// deweloperskich.
//
// ADRES POZYCJI ROZSTRZYGA `EventPageLink`, NIE TEN PLIK. Pozycja MODUŁOWA
// (`event_pages.module` niepuste) prowadzi do trasy dedykowanej
// `/events/<slug>/<module>`, gdzie pod dokumentem strony CMS stoją dane z bazy;
// pozycja ZWYKŁA prowadzi tam, gdzie zawsze - pod pełną ścieżkę strony w trasie
// splat (`src/routes/$.tsx`). Ten warunek żyje w JEDNYM atomie, bo te same dwa
// adresy rozstrzyga pasek zakładek i spis sekcji na stronie głównej.
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { useEventMenu } from "@/lib/events/usePublicEvent";
import { EventPageLink } from "@/components/events/public/atoms/EventPageLink";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
import type { EventMenuItem } from "@/lib/events/publicEventApi";

ensureEventFrontI18n();

export function EventMenuNav({
  slug,
  displayMode,
  enabled = true,
}: {
  slug: string;
  /** `events.pages_display_mode`; nieznana wartość czyta się jako lista. */
  displayMode: string | null;
  enabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const menuQuery = useEventMenu(slug, enabled);
  const items = menuQuery.data ?? [];

  // Wydarzenie bez podstron nie dostaje pustej nawigacji ani szkieletu -
  // większość wydarzeń nigdy nie będzie miała ani jednej podstrony.
  if (items.length === 0) return null;

  const isGrid = displayMode === "grid";

  return (
    <nav aria-label={t("eventFront.menu.label")} className="mt-8">
      <ul
        className={cn(isGrid ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3" : "flex flex-col gap-2")}
      >
        {items.map((item) => (
          <li key={item.id}>
            <EventMenuLink
              item={item}
              eventSlug={slug}
              label={menuLabel(item, lang)}
              grid={isGrid}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Etykieta w języku interfejsu; własna etykieta z panelu albo tytuł strony. */
function menuLabel(item: EventMenuItem, lang: "pl" | "en"): string {
  return pickLocalized(
    { label_pl: item.labelPl, label_en: item.labelEn },
    "label",
    lang,
    item.path,
  );
}

function EventMenuLink({
  item,
  eventSlug,
  label,
  grid,
}: {
  item: EventMenuItem;
  eventSlug: string;
  label: string;
  grid: boolean;
}) {
  return (
    <EventPageLink
      item={item}
      eventSlug={eventSlug}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50",
        grid && "h-full",
      )}
    >
      {item.icon !== null && (
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
          // Kolor pozycji jest TŁEM IKONY, nie kolorem napisu: `#RRGGBB`
          // z panelu nie ma pary w postaci koloru tekstu, a napis na losowym
          // tle bywa nieczytelny. Brak koloru = kafelek z motywu.
          style={item.color === null ? undefined : { backgroundColor: item.color }}
        >
          <DynamicIcon name={item.icon} size={18} />
        </span>
      )}
      <span className="min-w-0 flex-1">{label}</span>
    </EventPageLink>
  );
}
