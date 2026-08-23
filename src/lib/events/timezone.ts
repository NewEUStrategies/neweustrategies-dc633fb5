// Czas wydarzenia - JEDNO ŹRÓDŁO PRAWDY dla całego repo.
//
// STAN PRZED (audyt `PROJEKT_FRONT_WYDARZENIA_2026-08-23.md` §4.4, zadanie
// EB-912). Data wydarzenia liczyła się w czterech miejscach i tylko JEDNO z nich
// znało strefę:
//
//   * `EventsListView.tsx` - jedyna implementacja świadoma `row.timezone`,
//     z fallbackiem i `try/catch` na `RangeError`; funkcje PRYWATNE, nieeksportowane,
//     więc nie do użycia nigdzie indziej;
//   * `src/lib/i18n/format.ts` - `formatDate`/`formatDateTime` NIE przyjmują
//     strefy wcale;
//   * `events.$slug.tsx` - dokleja `` ` (${ev.timezone})` `` jako goły tekst,
//     bez konwersji: uczestnik z Brukseli widzi godzinę warszawską opisaną
//     jako warszawska i musi przeliczyć ją sam;
//   * `EventCountdownCardView` - IGNORUJE `timezone` całkowicie.
//
// Cztery implementacje jednej reguły to cztery różne odpowiedzi na pytanie
// „o której to jest". Ten moduł jest piątym miejscem tylko na chwilę - jego
// zadaniem jest zastąpić poprzednie cztery.
//
// DLACZEGO `try/catch` WOKÓŁ `Intl`. `events.timezone` jest w bazie kolumną
// `text` bez CHECK-a na listę IANA, więc wartość spoza katalogu strefy jest
// osiągalna (import, ręczna korekta, literówka). `Intl.DateTimeFormat` rzuca
// wtedy `RangeError` i wywraca cały render listy. Degradacja do strefy
// domyślnej jest zawsze lepsza niż biała strona.
//
// GRANICA WARSTW: zero Reacta, zero i18next. Moduł jest liściem.
import { uiLocale, type UiLang } from "@/lib/i18n/format";

/**
 * Strefa domyślna serwisu. Ta sama wartość, którą trzymał prywatny
 * `DEFAULT_EVENT_TZ` w `EventsListView` - organizacja jest polska, a wydarzenie
 * bez strefy dzieje się tam, gdzie jej biuro.
 */
export const EVENT_DEFAULT_TZ = "Europe/Warsaw";

/** Strefa wydarzenia z fallbackiem. Pusty napis i `null` znaczą to samo. */
export function eventTimeZone(row: { timezone?: string | null }): string {
  const value = row.timezone;
  return value === null || value === undefined || value.trim() === "" ? EVENT_DEFAULT_TZ : value;
}

/**
 * Data i godzina w STREFIE WYDARZENIA, w języku interfejsu.
 *
 * Zwraca pusty napis dla wartości, której nie da się sparsować - wywołujący
 * pokazuje wtedy „bez terminu", a nie „Invalid Date".
 */
export function formatEventDateTime(
  startsAt: string | null | undefined,
  timezone: string | null | undefined,
  lang: UiLang,
  options: Intl.DateTimeFormatOptions = { dateStyle: "long", timeStyle: "short" },
): string {
  if (startsAt === null || startsAt === undefined || startsAt === "") return "";
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "";
  const locale = uiLocale(lang);
  try {
    return date.toLocaleString(locale, { ...options, timeZone: eventTimeZone({ timezone }) });
  } catch {
    return date.toLocaleString(locale, options);
  }
}

/** Sam dzień w strefie wydarzenia - do bloku daty i grupowania agendy. */
export function formatEventDate(
  startsAt: string | null | undefined,
  timezone: string | null | undefined,
  lang: UiLang,
): string {
  return formatEventDateTime(startsAt, timezone, lang, { dateStyle: "medium" });
}

/** Sama godzina w strefie wydarzenia - do wiersza sesji i listy godzin. */
export function formatEventTime(
  startsAt: string | null | undefined,
  timezone: string | null | undefined,
  lang: UiLang,
): string {
  return formatEventDateTime(startsAt, timezone, lang, { timeStyle: "short" });
}

/** Blok daty (dzień + skrócony miesiąc) w strefie wydarzenia. */
export function eventDateBlock(
  startsAt: string | null | undefined,
  timezone: string | null | undefined,
  lang: UiLang,
): { day: string; month: string } | null {
  if (startsAt === null || startsAt === undefined || startsAt === "") return null;
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;
  const locale = uiLocale(lang);
  try {
    const timeZone = eventTimeZone({ timezone });
    return {
      day: date.toLocaleDateString(locale, { day: "numeric", timeZone }),
      month: date.toLocaleDateString(locale, { month: "short", timeZone }),
    };
  } catch {
    return {
      day: date.toLocaleDateString(locale, { day: "numeric" }),
      month: date.toLocaleDateString(locale, { month: "short" }),
    };
  }
}

/**
 * Etykieta strefy do pokazania OBOK godziny („CEST", „GMT+2").
 *
 * Uczestnik z innej strefy musi widzieć, w JAKIEJ strefie podana jest godzina -
 * inaczej przelicza ją sam i myli się o godzinę dwa razy w roku. `timeZoneName`
 * daje nazwę krótką, a nie identyfikator IANA: „CEST" jest czytelne,
 * „Europe/Warsaw" obok godziny wygląda jak awaria.
 */
export function eventTimeZoneLabel(
  startsAt: string | null | undefined,
  timezone: string | null | undefined,
  lang: UiLang,
): string {
  if (startsAt === null || startsAt === undefined || startsAt === "") return "";
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "";
  const zone = eventTimeZone({ timezone });
  try {
    const parts = new Intl.DateTimeFormat(uiLocale(lang), {
      timeZone: zone,
      timeZoneName: "short",
    }).formatToParts(date);
    return parts.find((part) => part.type === "timeZoneName")?.value ?? zone;
  } catch {
    return zone;
  }
}

/**
 * Czy uczestnik widzi wydarzenie w INNEJ strefie niż jego własna.
 *
 * To jest warunek pokazania ostrzeżenia o przeliczeniu. Bez niego albo
 * ostrzegamy wszystkich (szum dla 90% uczestników z tej samej strefy), albo
 * nikogo (i wtedy ktoś przychodzi o złej godzinie).
 *
 * `viewerZone` jest PARAMETREM, a nie `Intl...resolvedOptions()` w ciele:
 * funkcja czysta daje się przetestować bez podmiany globalnego `Intl`, a strefa
 * widza pochodzi z jego preferencji albo z przeglądarki - o tym decyduje
 * wywołujący.
 */
export function isForeignTimeZone(
  timezone: string | null | undefined,
  viewerZone: string | null | undefined,
): boolean {
  if (viewerZone === null || viewerZone === undefined || viewerZone.trim() === "") return false;
  return eventTimeZone({ timezone }) !== viewerZone;
}

/** Strefa przeglądarki albo domyślna serwisu, gdy `Intl` jej nie zna. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || EVENT_DEFAULT_TZ;
  } catch {
    return EVENT_DEFAULT_TZ;
  }
}
