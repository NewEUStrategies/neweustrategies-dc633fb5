// Nawigacja STUDIA WYDARZENIA - model danych, nie JSX.
//
// DLACZEGO OSOBNY SIDEBAR, A NIE POZYCJE W PANELU. Wydarzenie nie jest wierszem
// w tabeli: ma wlasne strony i menu, wlasne grupy uczestnikow z uprawnieniami,
// wlasny branding, wlasny formularz zapisu, wlasny regulamin i wlasna analityke
// (`docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md` §0). Blisko trzydziesci
// ekranow jednego wydarzenia w sidebarze CALEGO panelu utopiloby reszte
// administracji, a podnawigacja modulu (`EventsSubNav`) nie ma gdzie pokazac,
// KTORE wydarzenie jest w reku. Studio wymienia lewy pas na czas pracy nad
// jednym wydarzeniem - dokladnie tak jak wzorzec referencyjny.
//
// DWA POZIOMY, BO PLASKA LISTA KLAMALA. Poprzedni model mial PIETNASCIE pozycji
// „na plasko": „Rejestracja w aplikacji", „Tresc", „Spotkania" i „Na miejscu"
// byly JEDNA pozycja kazda, a w srodku sciagaly zakladki. To ma trzy skutki,
// z ktorych kazdy widac na ekranie: (1) zakladka NIE JEST w adresie, wiec nie da
// sie odeslac wspolpracownikowi linku do „Kolizji" ani wrocic do niej
// z zakladki przegladarki; (2) sidebar mowi „jestem w Tresci", a nie „jestem
// w Salach", czyli gubi poziom, na ktorym redaktor faktycznie pracuje;
// (3) dwie nawigacje jedna nad druga (sidebar + zakladki) odpowiadaja na to samo
// pytanie „gdzie jestem" dwa razy. Wzorzec ma tu grupy z podpozycjami i KAZDA
// podstrona ma wlasny adres - stad ten model.
//
// TRZECIEGO POZIOMU NIE MA. „Sponsorzy i reklama" oraz „Regulaminy" zostaja
// POZYCJAMI z zakladkami w srodku, bo sidebar wzorca jest dwupoziomowy:
// „Kreator > Sponsorzy > Poziomy" byloby ksztaltem, ktorego wzorzec nie zna.
// Tak samo szczegol rekordu (sesja, zgloszenie) nie dopisuje sie do sidebara -
// podswietlenie zostaje na pozycji listy, a powrot realizuje odnosnik w tresci.
//
// LISTA JEST DANYMI, NIE JSX-em. Kolejny etap dopisuje JEDNA linie do
// `EVENT_STUDIO_NAV`, a nie kolejny blok `<Link>`: wtedy nie da sie dodac sekcji
// bez etykiety w obu jezykach ani zapomniec o stanie aktywnym i o adresie.
//
// NIE MA TU ATRAP. W nawigacji stoi tylko to, co realnie istnieje jako ekran.
// Wzorzec ma jeszcze `People`, `Items`, `Feed channels`, `Discussions`,
// `Exhibitors`, `Exhibitor Marketplace` i `Codes` - u nas tych ekranow nie ma,
// wiec ich pozycje maja byc NIEOBECNE, a nie puste.
//
// IKONY SA NAZWAMI, NIE KOMPONENTAMI. Ten modul jest lisciem: zero Reacta, zero
// i18next, zero klienta bazy - wolno go zaimportowac z testu jednostkowego bez
// DOM-u. Nazwe rozwiazuje `DynamicIcon` po stronie widoku (ten sam wzorzec, co
// ikona rodzaju wydarzenia w wierszu listy).

/**
 * Sekcje studia - LISCIE, czyli wylacznie te, ktore maja wlasna trase.
 *
 * Klucz jest camelCase-owym zapisem OGONA adresu: `registrationTickets` stoi
 * pod `registration/tickets`. Grupy (`registration`, `content`, ...) NIE sa
 * sekcjami: same nie renderuja ekranu, tylko przekierowuja na pierwsze dziecko.
 */
export const EVENT_STUDIO_SECTIONS = [
  "overview",
  "general",
  "pages",
  "groups",
  "branding",
  "sponsors",
  "terms",
  "registrationList",
  "registrationTickets",
  "registrationForm",
  "contentSessions",
  "contentTracks",
  "contentRooms",
  "contentConflicts",
  "meetingsTables",
  "meetingsSettings",
  "meetingsList",
  "meetingsStats",
  "onsiteDesk",
  "onsiteLog",
  "onsiteStats",
  "onsiteCheckpoints",
  "onsiteDevices",
  "onsiteBadges",
  "onsiteLeads",
  "communications",
  "integrations",
  "analytics",
  "features",
] as const;

export type EventStudioSection = (typeof EVENT_STUDIO_SECTIONS)[number];

/** Wspolny prefiks kazdego adresu studia - jedno miejsce, nie dwadziescia dziewiec. */
const STUDIO_PATH_PREFIX = "/admin/events/$eventId/";

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
  registrationList: "/admin/events/$eventId/registration/list",
  registrationTickets: "/admin/events/$eventId/registration/tickets",
  registrationForm: "/admin/events/$eventId/registration/form",
  contentSessions: "/admin/events/$eventId/content/sessions",
  contentTracks: "/admin/events/$eventId/content/tracks",
  contentRooms: "/admin/events/$eventId/content/rooms",
  contentConflicts: "/admin/events/$eventId/content/conflicts",
  meetingsTables: "/admin/events/$eventId/meetings/tables",
  meetingsSettings: "/admin/events/$eventId/meetings/settings",
  meetingsList: "/admin/events/$eventId/meetings/list",
  meetingsStats: "/admin/events/$eventId/meetings/stats",
  onsiteDesk: "/admin/events/$eventId/onsite/desk",
  onsiteLog: "/admin/events/$eventId/onsite/log",
  onsiteStats: "/admin/events/$eventId/onsite/stats",
  onsiteCheckpoints: "/admin/events/$eventId/onsite/checkpoints",
  onsiteDevices: "/admin/events/$eventId/onsite/devices",
  onsiteBadges: "/admin/events/$eventId/onsite/badges",
  onsiteLeads: "/admin/events/$eventId/onsite/leads",
  communications: "/admin/events/$eventId/communications",
  integrations: "/admin/events/$eventId/integrations",
  analytics: "/admin/events/$eventId/analytics",
  features: "/admin/events/$eventId/features",
} as const satisfies Record<EventStudioSection, `/admin/events/$eventId/${string}`>;

/** Podpozycja grupy. Bez ikony - wzorzec nie stawia ikon na drugim poziomie. */
export interface EventStudioNavEntry {
  key: EventStudioSection;
  /** Klucz i18n etykiety - napis nigdy nie mieszka w tym pliku. */
  labelKey: string;
  /**
   * Slowa, po ktorych wyszukiwarka studia ma znalezc pozycje MIMO innej nazwy
   * („bilety" prowadza do wejsciowek, „QR" do odprawy). Bez nich wyszukiwarka
   * odpowiada wylacznie na doslowna etykiete, czyli na to, co redaktor
   * juz widzi na ekranie.
   */
  keywordKeys?: readonly string[];
}

/** Pozycja SAMODZIELNA - bez strzalki i bez dzieci (Pulpit, Analityka...). */
export interface EventStudioNavItem extends EventStudioNavEntry {
  kind: "item";
  /** Nazwa ikony w kebab-case dla `DynamicIcon`. */
  icon: string;
}

/** Grupa rozwijana - strzalka i wciete dzieci. */
export interface EventStudioNavGroup {
  kind: "group";
  /** Klucz grupy do stanu rozwiniecia; NIE jest sekcja i nie ma wlasnego ekranu. */
  key: string;
  labelKey: string;
  icon: string;
  /**
   * Pozycja domyslna grupy = jej PIERWSZE dziecko.
   *
   * Klikniecie w nazwe grupy ma robic dwie rzeczy naraz: rozwinac liste
   * i wejsc na pierwszy ekran. Grupa, ktora tylko rozwija, zmusza do dwoch
   * klikniec po to samo, a jej wlasny adres (`.../registration`) i tak istnieje,
   * bo powstaje sam - z zakladki albo z uciecia ogona sciezki.
   */
  defaultSection: EventStudioSection;
  keywordKeys?: readonly string[];
  entries: readonly EventStudioNavEntry[];
}

export type EventStudioNavNode = EventStudioNavItem | EventStudioNavGroup;

export const EVENT_STUDIO_NAV: readonly EventStudioNavNode[] = [
  {
    kind: "item",
    key: "overview",
    labelKey: "adminEvents.studio.sections.overview",
    icon: "home",
  },
  {
    kind: "group",
    key: "builder",
    labelKey: "adminEvents.studio.groups.builder",
    icon: "pencil-ruler",
    defaultSection: "general",
    entries: [
      {
        key: "general",
        labelKey: "adminEvents.studio.sections.general",
        keywordKeys: ["adminEvents.studio.keywords.general"],
      },
      {
        key: "pages",
        labelKey: "adminEvents.studio.sections.pages",
        keywordKeys: ["adminEvents.studio.keywords.pages"],
      },
      {
        key: "groups",
        labelKey: "adminEvents.studio.sections.groups",
        keywordKeys: ["adminEvents.studio.keywords.groups"],
      },
      {
        key: "branding",
        labelKey: "adminEvents.studio.sections.branding",
        keywordKeys: ["adminEvents.studio.keywords.branding"],
      },
      {
        key: "sponsors",
        labelKey: "adminEvents.studio.sections.sponsors",
        keywordKeys: ["adminEvents.studio.keywords.sponsors"],
      },
      {
        key: "terms",
        labelKey: "adminEvents.studio.sections.terms",
        keywordKeys: ["adminEvents.studio.keywords.terms"],
      },
    ],
  },
  {
    kind: "group",
    key: "registration",
    labelKey: "adminEvents.studio.groups.registration",
    icon: "ticket",
    defaultSection: "registrationList",
    keywordKeys: ["adminEvents.studio.keywords.registration"],
    // ETYKIETY PODPOZYCJI POCHODZA ZE SLOWNIKA MODULU, a nie z `adminEvents`.
    // To DOKLADNIE te napisy, ktore do tej zmiany stały na zakladkach w srodku
    // sekcji - przepisane do `adminEvents` rozjechalyby sie z nimi przy pierwszej
    // korekcie i ten sam ekran mialby dwie nazwy w dwoch miejscach panelu.
    entries: [
      {
        key: "registrationList",
        labelKey: "adminEventRegistration.nav.registrations",
        keywordKeys: ["adminEvents.studio.keywords.registrationList"],
      },
      {
        key: "registrationTickets",
        labelKey: "adminEventRegistration.nav.tickets",
        keywordKeys: ["adminEvents.studio.keywords.registrationTickets"],
      },
      {
        key: "registrationForm",
        labelKey: "adminEventRegistration.nav.form",
        keywordKeys: ["adminEvents.studio.keywords.registrationForm"],
      },
    ],
  },
  {
    kind: "group",
    key: "content",
    labelKey: "adminEvents.studio.groups.content",
    icon: "layers",
    defaultSection: "contentSessions",
    keywordKeys: ["adminEvents.studio.keywords.content"],
    entries: [
      {
        key: "contentSessions",
        labelKey: "adminEventAgenda.nav.sessions",
        keywordKeys: ["adminEvents.studio.keywords.contentSessions"],
      },
      {
        key: "contentTracks",
        labelKey: "adminEventAgenda.nav.tracks",
        keywordKeys: ["adminEvents.studio.keywords.contentTracks"],
      },
      {
        key: "contentRooms",
        labelKey: "adminEventAgenda.nav.rooms",
        keywordKeys: ["adminEvents.studio.keywords.contentRooms"],
      },
      {
        key: "contentConflicts",
        labelKey: "adminEventAgenda.nav.conflicts",
        keywordKeys: ["adminEvents.studio.keywords.contentConflicts"],
      },
    ],
  },
  {
    kind: "group",
    key: "meetings",
    labelKey: "adminEvents.studio.groups.meetings",
    icon: "users",
    defaultSection: "meetingsTables",
    keywordKeys: ["adminEvents.studio.keywords.meetings"],
    entries: [
      {
        key: "meetingsTables",
        labelKey: "adminEventMeetings.nav.tables",
        keywordKeys: ["adminEvents.studio.keywords.meetingsTables"],
      },
      {
        key: "meetingsSettings",
        labelKey: "adminEventMeetings.nav.settings",
        keywordKeys: ["adminEvents.studio.keywords.meetingsSettings"],
      },
      {
        key: "meetingsList",
        labelKey: "adminEventMeetings.nav.meetings",
        keywordKeys: ["adminEvents.studio.keywords.meetingsList"],
      },
      {
        key: "meetingsStats",
        labelKey: "adminEventMeetings.nav.stats",
        keywordKeys: ["adminEvents.studio.keywords.meetingsStats"],
      },
    ],
  },
  {
    kind: "group",
    key: "onsite",
    labelKey: "adminEvents.studio.groups.onsite",
    icon: "calendar-check",
    defaultSection: "onsiteDesk",
    keywordKeys: ["adminEvents.studio.keywords.onsite"],
    entries: [
      {
        key: "onsiteDesk",
        labelKey: "adminEventOnsite.nav.desk",
        keywordKeys: ["adminEvents.studio.keywords.onsiteDesk"],
      },
      {
        key: "onsiteLog",
        labelKey: "adminEventOnsite.nav.log",
        keywordKeys: ["adminEvents.studio.keywords.onsiteLog"],
      },
      {
        key: "onsiteStats",
        labelKey: "adminEventOnsite.nav.stats",
        keywordKeys: ["adminEvents.studio.keywords.onsiteStats"],
      },
      {
        key: "onsiteCheckpoints",
        labelKey: "adminEventOnsite.nav.checkpoints",
        keywordKeys: ["adminEvents.studio.keywords.onsiteCheckpoints"],
      },
      {
        key: "onsiteDevices",
        labelKey: "adminEventOnsite.nav.devices",
        keywordKeys: ["adminEvents.studio.keywords.onsiteDevices"],
      },
      {
        key: "onsiteBadges",
        labelKey: "adminEventOnsite.nav.badges",
        keywordKeys: ["adminEvents.studio.keywords.onsiteBadges"],
      },
      {
        key: "onsiteLeads",
        labelKey: "adminEventOnsite.nav.leads",
        keywordKeys: ["adminEvents.studio.keywords.onsiteLeads"],
      },
    ],
  },
  {
    kind: "item",
    key: "communications",
    labelKey: "adminEvents.studio.sections.communications",
    icon: "megaphone",
    keywordKeys: ["adminEvents.studio.keywords.communications"],
  },
  {
    kind: "item",
    key: "integrations",
    labelKey: "adminEvents.studio.sections.integrations",
    icon: "briefcase",
    keywordKeys: ["adminEvents.studio.keywords.integrations"],
  },
  {
    kind: "item",
    key: "analytics",
    labelKey: "adminEvents.studio.sections.analytics",
    icon: "bar-chart-3",
    keywordKeys: ["adminEvents.studio.keywords.analytics"],
  },
  {
    kind: "item",
    key: "features",
    labelKey: "adminEvents.studio.sections.features",
    icon: "sparkles",
    keywordKeys: ["adminEvents.studio.keywords.features"],
  },
];

/** Sekcje pod wezlem: jedna dla pozycji samodzielnej, wszystkie dzieci dla grupy. */
export function eventStudioNodeSections(node: EventStudioNavNode): readonly EventStudioSection[] {
  return node.kind === "item" ? [node.key] : node.entries.map((entry) => entry.key);
}

/** Ogon adresu sekcji: `registration/tickets` dla `registrationTickets`. */
function sectionTail(section: EventStudioSection): string {
  return EVENT_STUDIO_ROUTES[section].slice(STUDIO_PATH_PREFIX.length);
}

/**
 * Wlasny adres grupy albo `null`, gdy grupa go nie ma.
 *
 * Wyliczany z dziecka, a nie wpisany drugi raz obok: grupa `registration` ma
 * adres `.../registration`, bo jej dzieci stoja pod `registration/...`, a grupa
 * `builder` nie ma zadnego, bo „Informacje ogolne" leza pod `.../general`.
 * Zapisane recznie rozjechaloby sie z tablica adresow.
 */
function groupTail(group: EventStudioNavGroup): string | null {
  const tail = sectionTail(group.defaultSection);
  const slash = tail.indexOf("/");
  return slash === -1 ? null : tail.slice(0, slash);
}

/**
 * Ogon adresu -> sekcja. Zamknieta tablica, a nie zgadywanie z regexpa.
 *
 * SA TU TAKZE ADRESY GRUP (`registration` -> `registrationList`). Adres grupy
 * jest legalny: trasa `.../registration/` przekierowuje na pierwsze dziecko,
 * a `src/routes/admin.tsx` pyta TEJ SAMEJ funkcji, czy schowac powloke panelu.
 * Gdyby adresu grupy tu nie bylo, na czas przekierowania panel dorysowalby
 * swoj wlasny sidebar - i redaktor zobaczylby DWA pasy nawigacji naraz.
 */
const SECTION_BY_TAIL: ReadonlyMap<string, EventStudioSection> = new Map<
  string,
  EventStudioSection
>([
  ...EVENT_STUDIO_SECTIONS.map((section): [string, EventStudioSection] => [
    sectionTail(section),
    section,
  ]),
  ...EVENT_STUDIO_NAV.filter((node): node is EventStudioNavGroup => node.kind === "group").flatMap(
    (group): [string, EventStudioSection][] => {
      const tail = groupTail(group);
      return tail === null ? [] : [[tail, group.defaultSection]];
    },
  ),
]);

/**
 * Sekcja wskazana adresem albo `null`.
 *
 * Dopasowanie idzie po CALYM ogonie adresu (jeden albo dwa segmenty), a nie po
 * `startsWith`: sekcja `pages` byla by inaczej podswietlona takze na
 * `.../pages-and-menu`, a to jest dokladnie ta klasa bledu, ktora sprawia, ze
 * w sidebarze swieca dwie pozycje. Ogon dluzszy niz dwa segmenty (szczegol
 * rekordu) NIE jest tu obslugiwany - w sidebarze zostaje wtedy pozycja listy,
 * a wraca sie odnosnikiem w tresci, tak jak we wzorcu.
 */
export function eventStudioSectionFromPath(pathname: string): EventStudioSection | null {
  const match = /^\/admin\/events\/[^/]+\/([a-z-]+(?:\/[a-z-]+)?)\/?$/.exec(pathname);
  if (match === null) return null;
  return SECTION_BY_TAIL.get(match[1]) ?? null;
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
