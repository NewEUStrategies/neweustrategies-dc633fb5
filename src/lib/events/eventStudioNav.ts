// Nawigacja STUDIA WYDARZENIA - model danych, nie JSX.
//
// DLACZEGO OSOBNY SIDEBAR, A NIE POZYCJE W PANELU. Wydarzenie nie jest wierszem
// w tabeli: ma wlasne strony i menu, wlasne grupy uczestnikow z uprawnieniami,
// wlasny branding, wlasny formularz zapisu, wlasny regulamin i wlasna analitykę
// (`docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md` §0). Piętnaście sekcji
// jednego wydarzenia w sidebarze CALEGO panelu utopiloby reszte administracji,
// a podnawigacja modulu (`EventsSubNav`) nie ma gdzie pokazac, KTORE wydarzenie
// jest w reku. Studio wymienia lewy pas na czas pracy nad jednym wydarzeniem -
// dokladnie tak jak wzorzec referencyjny.
//
// LISTA JEST DANYMI, NIE JSX-em. Kolejny etap dopisuje JEDNA linie do
// `EVENT_STUDIO_NAV`, a nie kolejny blok `<Link>`: wtedy nie da sie dodac sekcji
// bez etykiety w obu jezykach ani zapomniec o stanie aktywnym i o adresie.
//
// IKONY SA NAZWAMI, NIE KOMPONENTAMI. Ten modul jest lisciem: zero Reacta, zero
// i18next, zero klienta bazy - wolno go zaimportowac z testu jednostkowego bez
// DOM-u. Nazwe rozwiazuje `DynamicIcon` po stronie widoku (ten sam wzorzec, co
// ikona rodzaju wydarzenia w wierszu listy).

/** Sekcje studia. Klucz = ostatni segment adresu. */
export const EVENT_STUDIO_SECTIONS = [
  "overview",
  "general",
  "pages",
  "groups",
  "branding",
  "sponsors",
  "terms",
  "registration",
  "content",
  "meetings",
  "communications",
  "onsite",
  "integrations",
  "analytics",
  "features",
] as const;

export type EventStudioSection = (typeof EVENT_STUDIO_SECTIONS)[number];

/**
 * Adresy sekcji. Literaly, a nie sklejanie napisow: router jest typowany po
 * zbiorze tras, wiec sklejony adres traci sprawdzenie w czasie kompilacji
 * i literowka w segmencie wychodzi dopiero jako pusty ekran u redaktora.
 */
export const EVENT_STUDIO_ROUTES = {
  overview: "/admin/events/$eventId/overview",
  general: "/admin/events/$eventId/general",
  pages: "/admin/events/$eventId/pages",
  groups: "/admin/events/$eventId/groups",
  branding: "/admin/events/$eventId/branding",
  sponsors: "/admin/events/$eventId/sponsors",
  terms: "/admin/events/$eventId/terms",
  registration: "/admin/events/$eventId/registration",
  content: "/admin/events/$eventId/content",
  meetings: "/admin/events/$eventId/meetings",
  communications: "/admin/events/$eventId/communications",
  onsite: "/admin/events/$eventId/onsite",
  integrations: "/admin/events/$eventId/integrations",
  analytics: "/admin/events/$eventId/analytics",
  features: "/admin/events/$eventId/features",
} as const satisfies Record<EventStudioSection, `/admin/events/$eventId/${string}`>;

export interface EventStudioNavEntry {
  key: EventStudioSection;
  /** Klucz i18n etykiety - napis nigdy nie mieszka w tym pliku. */
  labelKey: string;
  /** Nazwa ikony w kebab-case dla `DynamicIcon`. */
  icon: string;
  /**
   * Slowa, po ktorych wyszukiwarka studia ma znalezc sekcje MIMO innej nazwy
   * („bilety" prowadza do zapisow, „QR" do odprawy). Bez nich wyszukiwarka
   * odpowiada wylacznie na doslowna etykiete, czyli na to, co redaktor
   * juz widzi na ekranie.
   */
  keywordKeys?: readonly string[];
}

export interface EventStudioNavGroup {
  key: string;
  /** `null` = pozycja samodzielna, bez naglowka grupy (Pulpit). */
  labelKey: string | null;
  icon: string;
  entries: readonly EventStudioNavEntry[];
}

export const EVENT_STUDIO_NAV: readonly EventStudioNavGroup[] = [
  {
    key: "overview",
    labelKey: null,
    icon: "home",
    entries: [
      {
        key: "overview",
        labelKey: "adminEvents.studio.sections.overview",
        icon: "home",
      },
    ],
  },
  {
    key: "builder",
    labelKey: "adminEvents.studio.groups.builder",
    icon: "pencil-ruler",
    entries: [
      {
        key: "general",
        labelKey: "adminEvents.studio.sections.general",
        icon: "info",
        keywordKeys: ["adminEvents.studio.keywords.general"],
      },
      {
        key: "pages",
        labelKey: "adminEvents.studio.sections.pages",
        icon: "layout-grid",
        keywordKeys: ["adminEvents.studio.keywords.pages"],
      },
      {
        key: "groups",
        labelKey: "adminEvents.studio.sections.groups",
        icon: "users",
        keywordKeys: ["adminEvents.studio.keywords.groups"],
      },
      {
        key: "branding",
        labelKey: "adminEvents.studio.sections.branding",
        icon: "palette",
        keywordKeys: ["adminEvents.studio.keywords.branding"],
      },
      {
        key: "sponsors",
        labelKey: "adminEvents.studio.sections.sponsors",
        icon: "handshake",
        keywordKeys: ["adminEvents.studio.keywords.sponsors"],
      },
      {
        key: "terms",
        labelKey: "adminEvents.studio.sections.terms",
        icon: "shield-check",
        keywordKeys: ["adminEvents.studio.keywords.terms"],
      },
    ],
  },
  {
    key: "registration",
    labelKey: null,
    icon: "ticket",
    entries: [
      {
        key: "registration",
        labelKey: "adminEvents.studio.sections.registration",
        icon: "ticket",
        keywordKeys: ["adminEvents.studio.keywords.registration"],
      },
    ],
  },
  {
    key: "content",
    labelKey: null,
    icon: "layers",
    entries: [
      {
        key: "content",
        labelKey: "adminEvents.studio.sections.content",
        icon: "layers",
        keywordKeys: ["adminEvents.studio.keywords.content"],
      },
    ],
  },
  {
    key: "meetings",
    labelKey: null,
    icon: "users",
    entries: [
      {
        key: "meetings",
        labelKey: "adminEvents.studio.sections.meetings",
        icon: "users",
        keywordKeys: ["adminEvents.studio.keywords.meetings"],
      },
    ],
  },
  {
    key: "communications",
    labelKey: null,
    icon: "megaphone",
    entries: [
      {
        key: "communications",
        labelKey: "adminEvents.studio.sections.communications",
        icon: "megaphone",
        keywordKeys: ["adminEvents.studio.keywords.communications"],
      },
    ],
  },
  {
    key: "onsite",
    labelKey: null,
    icon: "calendar-check",
    entries: [
      {
        key: "onsite",
        labelKey: "adminEvents.studio.sections.onsite",
        icon: "calendar-check",
        keywordKeys: ["adminEvents.studio.keywords.onsite"],
      },
    ],
  },
  {
    key: "integrations",
    labelKey: null,
    icon: "briefcase",
    entries: [
      {
        key: "integrations",
        labelKey: "adminEvents.studio.sections.integrations",
        icon: "briefcase",
        keywordKeys: ["adminEvents.studio.keywords.integrations"],
      },
    ],
  },
  {
    key: "analytics",
    labelKey: null,
    icon: "bar-chart-3",
    entries: [
      {
        key: "analytics",
        labelKey: "adminEvents.studio.sections.analytics",
        icon: "bar-chart-3",
        keywordKeys: ["adminEvents.studio.keywords.analytics"],
      },
    ],
  },
  {
    key: "features",
    labelKey: null,
    icon: "sparkles",
    entries: [
      {
        key: "features",
        labelKey: "adminEvents.studio.sections.features",
        icon: "sparkles",
        keywordKeys: ["adminEvents.studio.keywords.features"],
      },
    ],
  },
];

/**
 * Sekcja wskazana adresem albo `null`.
 *
 * Dopasowanie idzie po OSTATNIM segmencie, a nie po `startsWith`: sekcja
 * `pages` byla by inaczej podswietlona takze na `.../pages-and-menu`, a to jest
 * dokladnie ta klasa bledu, ktora sprawia, ze w sidebarze swieca dwie pozycje.
 */
export function eventStudioSectionFromPath(pathname: string): EventStudioSection | null {
  const match = /^\/admin\/events\/[^/]+\/([a-z-]+)\/?$/.exec(pathname);
  if (match === null) return null;
  const segment = match[1];
  return (EVENT_STUDIO_SECTIONS as readonly string[]).includes(segment)
    ? (segment as EventStudioSection)
    : null;
}

/**
 * Filtr wyszukiwarki studia. Wejsciem sa GOTOWE napisy (etykieta + slowa
 * kluczowe), bo modul nie zna i18next - tak samo jak `AdminCatalogRow` nie zna
 * slownika modulu, w ktorym stoi.
 */
export function matchesStudioQuery(
  query: string,
  label: string,
  keywords: readonly string[] = [],
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return true;
  return [label, ...keywords].some((value) => value.toLocaleLowerCase().includes(needle));
}
