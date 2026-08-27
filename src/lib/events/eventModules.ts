// SŁOWNIK MODUŁÓW WYDARZENIA - jedno miejsce, w którym „uczestnicy” znaczy
// `participants`.
//
// SKĄD TE PIĘĆ WARTOŚCI. To jest zbiór domknięty CHECK-iem w bazie
// (`event_pages_module_values`, migracja `20260826181500`), a zasiewa go
// `_event_default_pages()` (ta sama migracja, ok. linii 130-158). Front NIE
// wymyśla tu ani jednej nazwy: literały poniżej są przepisane z tamtego
// CHECK-a i test `eventModules.test.ts` pilnuje, żeby segment trasy pozostał
// DOKŁADNIE wartością modułu.
//
// PO CO SEGMENT TRASY JEST WARTOŚCIĄ `module`. Pozycja menu modułowego ma dwa
// możliwe adresy: trasę dedykowaną (`/events/<slug>/speakers`) i ścieżkę
// strony CMS pod trasą splat (`/$`). Gdyby menu linkowało do splata, a zakładki
// stały pod własnymi adresami, ta sama treść miałaby w serwisie dwa adresy
// i nic nie pilnowałoby, żeby się nie rozjechały - to jest ten sam defekt, co
// dwa niezależne renderery jednej strony, tylko wyrażony w URL-ach. Segment
// wzięty WPROST z bazy znaczy, że szósty moduł dopisany do CHECK-a wymusza
// dopisanie trasy tutaj, a nie cichy powrót do splata.
//
// ANGIELSKIE SEGMENTY SĄ ZGODNE Z RESZTĄ TRAS WYDARZEŃ: `/events`, `/register`,
// `/manage`, `/saved`. Etykieta widziana przez czytelnika jedzie z bazy
// (`menu_label_*`, tytuł strony), a nie z segmentu.

/** Zbiór domknięty CHECK-iem `event_pages_module_values` w bazie. */
export const EVENT_MODULES = [
  "participants",
  "speakers",
  "partners",
  "agenda",
  "discussions",
] as const;

export type EventModule = (typeof EVENT_MODULES)[number];

/**
 * Trasa dedykowana modułu. Klucz to wartość `event_pages.module`, wartość to
 * identyfikator trasy z `routeTree.gen.ts` - literał, bo tylko literał daje
 * typowane `<Link to=…>`. Że segment jest równy kluczowi, sprawdza test.
 */
export const EVENT_MODULE_ROUTE = {
  participants: "/events/$slug/participants",
  speakers: "/events/$slug/speakers",
  partners: "/events/$slug/partners",
  agenda: "/events/$slug/agenda",
  discussions: "/events/$slug/discussions",
} as const satisfies Record<EventModule, `/events/$slug/${EventModule}`>;

export type EventModuleRoute = (typeof EVENT_MODULE_ROUTE)[EventModule];

/**
 * Wartość z bazy -> moduł, który front umie obsłużyć.
 *
 * NIEZNANA WARTOŚĆ CZYTA SIĘ JAK JEJ BRAK, a nie jak błąd. Baza może dostać
 * szósty moduł migracją wdrożoną przed tą wersją klienta - wtedy pozycja menu
 * ma nadal działający adres (ścieżka strony CMS pod `/$`), zamiast prowadzić
 * do trasy, której ta wersja nie zna.
 */
export function eventModuleOf(value: string | null | undefined): EventModule | null {
  if (typeof value !== "string") return null;
  const found = EVENT_MODULES.find((module) => module === value);
  return found ?? null;
}

/**
 * Klucz etykiety zakładki w słowniku nakładkowym wydarzenia.
 *
 * To jest ZAPASOWA nazwa, nie główna: etykietę zakładki niesie baza
 * (`menu_label_pl/en`, a w ich braku tytuł strony), bo to organizator ma prawo
 * nazwać swoją podstronę. Klucz wchodzi dopiero wtedy, gdy z bazy nie przyszło
 * ani jedno słowo - wtedy „Prelegenci” jest lepszą etykietą niż surowa ścieżka.
 */
export function eventModuleLabelKey(module: EventModule): string {
  return `eventFront.header.tabs.${module}`;
}
