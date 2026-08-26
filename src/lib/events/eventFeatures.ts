// Przelaczniki modulow JEDNEGO wydarzenia: stan roboczy ekranu, kontrakt zapisu
// i mapa „funkcja -> sekcje studia".
//
// KLUCZ NIEOBECNY = MODUL WLACZONY. Kolumna `events.features` trzyma WYLACZNIE
// wylaczenia (`admin_event_features_save` wyrzuca `true` z zapisu), wiec brak
// klucza nie znaczy „nie wiem", tylko „wlaczony". Gdyby bylo odwrotnie - gdyby
// zapisywac komplet siedmiu flag - modul dodany w przyszlosci ZNIKALBY kazdemu
// wydarzeniu zapisanemu przed jego powstaniem: jego klucz nie stalby w kolumnie,
// a odczyt czytalby brak jako „wylaczony".
//
// PRZELACZNIK CHOWA SEKCJE W PANELU, NIE NA STRONIE PUBLICZNEJ. Widocznoscia
// dla uczestnika rzadzi osobne zrodlo prawdy (`event_page_sections` +
// `event_sections`); dwa przelaczniki na te sama rzecz znaczylyby dwa miejsca,
// w ktorych mozna ja wylaczyc, i jedno, ktore ktos pamieta. Tu chowamy POZYCJE
// W NAWIGACJI STUDIA - dane zostaja na miejscu i wracaja po ponownym wlaczeniu.
//
// SKLAD GRUPY BIERZEMY Z `EVENT_STUDIO_NAV`, A NIE Z DRUGIEJ LISTY OBOK.
// „Rejestracja" to dzis trzy podstrony, ale to sie zmienia przy kazdym nowym
// ekranie; wypisana tu recznie lista dzieci rozjechalaby sie po pierwszej takiej
// zmianie i nowa podstrona zostalaby widoczna przy wylaczonym module - czyli
// przelacznik przestalby wylaczac cala grupe, a nikt by tego nie zauwazyl.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero klienta bazy. Etykiety stoja
// tu KLUCZAMI (`Record<EventFeatureKey, string>` wymusza pokrycie kazdego
// wariantu), a napisy - w slowniku modulu.
import {
  EVENT_STUDIO_NAV,
  eventStudioNodeSections,
  type EventStudioNavGroup,
  type EventStudioSection,
} from "@/lib/events/eventStudioNav";

/**
 * Biala lista kluczy - DOKLADNIE ta, ktora zna `admin_event_features_save`.
 * Kolejnosc jest kolejnoscia przelacznikow na ekranie: najpierw to, co dotyka
 * strony wydarzenia, potem zapisy, na koncu moduly dnia wydarzenia.
 */
export const EVENT_FEATURE_KEYS = [
  "pages",
  "registration",
  "tickets",
  "sessions",
  "meetings",
  "onsite",
  "sponsors",
] as const;

export type EventFeatureKey = (typeof EVENT_FEATURE_KEYS)[number];

/** Stan siedmiu przelacznikow. `true` = modul wlaczony dla tego wydarzenia. */
export type EventFeaturesDraft = Record<EventFeatureKey, boolean>;

export const EVENT_FEATURE_LABEL_KEYS: Record<EventFeatureKey, string> = {
  pages: "adminEvents.studio.features.labels.pages",
  registration: "adminEvents.studio.features.labels.registration",
  tickets: "adminEvents.studio.features.labels.tickets",
  sessions: "adminEvents.studio.features.labels.sessions",
  meetings: "adminEvents.studio.features.labels.meetings",
  onsite: "adminEvents.studio.features.labels.onsite",
  sponsors: "adminEvents.studio.features.labels.sponsors",
};

/** Zdanie „co zniknie po wylaczeniu" - bez niego przelacznik kaze zgadywac. */
export const EVENT_FEATURE_HINT_KEYS: Record<EventFeatureKey, string> = {
  pages: "adminEvents.studio.features.hints.pages",
  registration: "adminEvents.studio.features.hints.registration",
  tickets: "adminEvents.studio.features.hints.tickets",
  sessions: "adminEvents.studio.features.hints.sessions",
  meetings: "adminEvents.studio.features.hints.meetings",
  onsite: "adminEvents.studio.features.hints.onsite",
  sponsors: "adminEvents.studio.features.hints.sponsors",
};

/** Stan domyslny: wszystko wlaczone, bo brak klucza znaczy „wlaczony". */
export const ALL_EVENT_FEATURES_ENABLED: EventFeaturesDraft = {
  pages: true,
  registration: true,
  tickets: true,
  sessions: true,
  meetings: true,
  onsite: true,
  sponsors: true,
};

/**
 * Odczyt kolumny `jsonb`.
 *
 * SMIEC DEGRADUJE, NIE RZUCA. Tablica, napis albo `null` w kolumnie znaczy
 * „nie wiemy, co tam jest" - a jedyna bezpieczna odpowiedz na to pytanie brzmi
 * „wszystko wlaczone": wyjatek zabralby redaktorowi CALE studio, a domysl
 * „wszystko wylaczone" schowalby przed nim polowe panelu bez zadnego powodu.
 *
 * WYLACZA WYLACZNIE DOSLOWNE `false`. `"false"`, `0` i `null` pod kluczem to
 * nie to samo co `false` - baza takich wartosci nie zapisze (RPC wymaga
 * booleana), wiec jesli sie tam znajda, przyszly z pominieciem RPC i nie ma
 * powodu im wierzyc.
 */
export function eventFeaturesFromJson(value: unknown): EventFeaturesDraft {
  const draft: EventFeaturesDraft = { ...ALL_EVENT_FEATURES_ENABLED };
  if (value === null || typeof value !== "object" || Array.isArray(value)) return draft;
  const source: Record<string, unknown> = value as Record<string, unknown>;
  for (const key of EVENT_FEATURE_KEYS) {
    if (source[key] === false) draft[key] = false;
  }
  return draft;
}

/**
 * Payload dla `admin_event_features_save`.
 *
 * KOMPLET SIEDMIU KLUCZY, A NIE SAME WYLACZENIA - i to jest tu jedyna
 * nieoczywista decyzja. Kolumna trzyma tylko wylaczenia (RPC wyrzuca `true`
 * z zapisu, patrz naglowek pliku), ale KLUCZ POMINIETY W PAYLOADZIE ZACHOWUJE
 * DZISIEJSZY STAN - taka jest umowa RPC, zeby dalo sie wyslac jeden przelacznik
 * bez wlaczania przy okazji szesciu pozostalych. Payload zlozony z samych
 * `false` umialby wiec tylko WYLACZAC: ponowne wlaczenie modulu wysylaloby
 * `{}` i baza nie zmienilaby niczego, a przelacznik wracalby na „wylaczony"
 * przy pierwszym odswiezeniu. Przelacznik, ktorego nie da sie wlaczyc, klamie
 * dokladnie tak samo jak ten, ktory nie wylacza.
 *
 * Ekran zapisuje CALY formularz naraz, wiec komplet kluczy jest jednoczesnie
 * najprostszym opisem tego, co redaktor widzi na ekranie w chwili zapisu.
 */
export function eventFeaturesPayload(draft: EventFeaturesDraft): Record<EventFeatureKey, boolean> {
  const payload = {} as Record<EventFeatureKey, boolean>;
  for (const key of EVENT_FEATURE_KEYS) {
    payload[key] = draft[key];
  }
  return payload;
}

/**
 * Co z payloadu trafi do kolumny. Wylacznie `false` - reszta jest wartoscia
 * domyslna i celowo NIE jest zapisywana (naglowek pliku mowi, dlaczego).
 * Funkcja istnieje po to, zeby ta regula miala jedno miejsce w kodzie i dala
 * sie sprawdzic testem, a nie tylko przeczytac w migracji.
 */
export function eventFeaturesStored(draft: EventFeaturesDraft): Record<string, boolean> {
  const stored: Record<string, boolean> = {};
  for (const key of EVENT_FEATURE_KEYS) {
    if (!draft[key]) stored[key] = false;
  }
  return stored;
}

export function eventFeaturesDirty(a: EventFeaturesDraft, b: EventFeaturesDraft): boolean {
  return EVENT_FEATURE_KEYS.some((key) => a[key] !== b[key]);
}

/**
 * Co chowa jedna funkcja: pojedyncza sekcje albo CALA grupe sidebara.
 *
 * Sekcja jest typowana zbiorem sekcji studia, wiec literowka w niej nie
 * kompiluje sie. Klucz grupy jest w modelu nawigacji zwyklym napisem - jego
 * literowke lapie test (grupa nieistniejaca oddaje ZERO sekcji, czyli
 * przelacznik przestaje chowac cokolwiek).
 */
type EventFeatureTarget =
  | { readonly kind: "section"; readonly section: EventStudioSection }
  | { readonly kind: "group"; readonly group: string };

/**
 * MAPA JEST JEDNOZNACZNA, ale nie jest bijekcja i tak ma byc: „Bilety" chowaja
 * JEDNA podstrone grupy rejestracji, a „Rejestracja" cala grupe razem z nimi.
 * Wydarzenie z zapisami bez wejsciowek (wolny wstep, lista obecnosci) to
 * najczestszy przypadek w kalendarzu, a wejsciowki bez zapisow nie istnieja.
 */
const EVENT_FEATURE_TARGETS: Record<EventFeatureKey, EventFeatureTarget> = {
  pages: { kind: "section", section: "pages" },
  registration: { kind: "group", group: "registration" },
  tickets: { kind: "section", section: "registrationTickets" },
  sessions: { kind: "group", group: "content" },
  meetings: { kind: "group", group: "meetings" },
  onsite: { kind: "group", group: "onsite" },
  sponsors: { kind: "section", section: "sponsors" },
};

/** Klucz grupy -> jej dzieci. Liczone z modelu nawigacji, nie przepisane. */
const SECTIONS_BY_GROUP: ReadonlyMap<string, readonly EventStudioSection[]> = new Map(
  EVENT_STUDIO_NAV.filter((node): node is EventStudioNavGroup => node.kind === "group").map(
    (group): [string, readonly EventStudioSection[]] => [group.key, eventStudioNodeSections(group)],
  ),
);

function targetSections(target: EventFeatureTarget): readonly EventStudioSection[] {
  return target.kind === "section" ? [target.section] : (SECTIONS_BY_GROUP.get(target.group) ?? []);
}

/**
 * Sekcja -> funkcja, ktora ja chowa. Jedno przejscie dla obu odpowiedzi
 * ponizej: „ktore pozycje schowac" i „ktory modul stoi za tym pustym ekranem".
 */
function hiddenSectionMap(draft: EventFeaturesDraft): Map<EventStudioSection, EventFeatureKey> {
  const hidden = new Map<EventStudioSection, EventFeatureKey>();
  for (const key of EVENT_FEATURE_KEYS) {
    if (draft[key]) continue;
    for (const section of targetSections(EVENT_FEATURE_TARGETS[key])) {
      // Pierwsze wylaczenie wygrywa: przy „Rejestracji" i „Biletach" naraz
      // ekran wejsciowek ma tlumaczyc sie SZERSZYM modulem, bo wlaczenie samych
      // biletow nie przywroci go do nawigacji.
      if (!hidden.has(section)) hidden.set(section, key);
    }
  }
  return hidden;
}

/** Sekcje, ktorych pozycji sidebar NIE renderuje przy tym stanie przelacznikow. */
export function hiddenStudioSections(draft: EventFeaturesDraft): ReadonlySet<EventStudioSection> {
  return new Set(hiddenSectionMap(draft).keys());
}

/**
 * Funkcja, ktora chowa te sekcje, albo `null`, gdy sekcja jest widoczna.
 *
 * Sluzy ekranowi wylaczonej sekcji: „Moduł X jest wyłączony" mowi, czego
 * szukac w „Funkcjach dodatkowych", a samo „ten moduł" kaze zgadywac, ktory
 * z siedmiu przelacznikow odpowiada za pusty ekran.
 */
export function eventFeatureHidingSection(
  draft: EventFeaturesDraft,
  section: EventStudioSection,
): EventFeatureKey | null {
  return hiddenSectionMap(draft).get(section) ?? null;
}
