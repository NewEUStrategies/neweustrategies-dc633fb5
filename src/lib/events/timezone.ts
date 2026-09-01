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
// DLACZEGO STREFA JEST WALIDOWANA, A NIE TYLKO OPAKOWANA W `try/catch`.
// `events.timezone` jest w bazie kolumną `text` bez CHECK-a na listę IANA, więc
// wartość spoza katalogu strefy jest osiągalna (import, ręczna korekta,
// literówka). Sam `try/catch` wokół `Intl` był na to odpowiedzią NIEPEŁNĄ i mylącą:
// gałąź ratunkowa formatowała godzinę w strefie MASZYNY, a `eventTimeZoneLabel`
// zwracała nieistniejący identyfikator z bazy. Uczestnik widział wtedy godzinę
// lokalną serwera opisaną nazwą strefy, której nie ma - czyli najgorszy możliwy
// wariant: wynik wyglądający na poprawny i będący nieprawdą.
//
// Dlatego rozstrzygnięcie strefy przechodzi przez `isUsableTimeZone`: identyfikator,
// którego `Intl` nie zna, jest odrzucany U ŹRÓDŁA i zamieniany na strefę domyślną.
// Wszyscy konsumenci - godzina, blok daty, etykieta, wykrycie obcej strefy - widzą
// wtedy tę SAMĄ strefę, więc godzina i jej podpis nie mogą się rozjechać.
// `try/catch` zostaje jako druga linia obrony (nowe wersje `Intl` mogą odrzucić
// kombinację opcji, nie samą strefę), ale degraduje już do strefy domyślnej,
// a nie do strefy maszyny.
//
// GRANICA WARSTW: zero Reacta, zero i18next. Moduł jest liściem.
import { SITE_TIME_ZONE, uiLocale, type UiLang } from "@/lib/i18n/format";

/**
 * Strefa domyślna serwisu. Ta sama wartość, którą trzymał prywatny
 * `DEFAULT_EVENT_TZ` w `EventsListView` - organizacja jest polska, a wydarzenie
 * bez strefy dzieje się tam, gdzie jej biuro.
 */
// JEDEN LITERAŁ, NIE DWA: strefa serwisu mieszka w `lib/i18n/format.ts`
// (`SITE_TIME_ZONE`), bo to liść, który importuje już cała aplikacja. Dwie
// niezależne stałe "Europe/Warsaw" mogłyby się rozjechać przy przenosinach
// redakcji, a wtedy daty wpisów i godziny wydarzeń pokazywałyby dwie różne
// strefy tego samego serwisu.
export const EVENT_DEFAULT_TZ = SITE_TIME_ZONE;

/**
 * Pamięć rozstrzygnięć `Intl` dla identyfikatorów strefy.
 *
 * `eventTimeZone` woła się raz na każdą sformatowaną datę, czyli na liście
 * dwustu wydarzeń - kilkaset razy na render. Konstruktor `Intl.DateTimeFormat`
 * nie jest darmowy, a zbiór wartości `events.timezone` w organizacji jest
 * mały i stabilny, więc odpowiedź „czy ta strefa istnieje" liczy się RAZ.
 *
 * Górny limit jest bezpiecznikiem, nie optymalizacją: gdyby kolumna kiedyś
 * przyjęła dane nieograniczone (import z obcego systemu), pamięć nie ma rosnąć
 * bez końca. Po przekroczeniu limitu przestajemy zapisywać - poprawność nie
 * zależy od pamięci, tylko szybkość.
 */
const TZ_VALIDITY = new Map<string, boolean>();
const TZ_VALIDITY_LIMIT = 512;

/** Czy `Intl` zna ten identyfikator strefy. */
function isUsableTimeZone(value: string): boolean {
  const cached = TZ_VALIDITY.get(value);
  if (cached !== undefined) return cached;
  let usable: boolean;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    usable = true;
  } catch {
    usable = false;
  }
  if (TZ_VALIDITY.size < TZ_VALIDITY_LIMIT) TZ_VALIDITY.set(value, usable);
  return usable;
}

/**
 * Strefa wydarzenia z fallbackiem.
 *
 * Pusty napis, `null` i identyfikator NIEZNANY `Intl`-owi znaczą to samo:
 * bierzemy strefę domyślną serwisu. Zwrócona wartość jest zawsze strefą, którą
 * `Intl` potrafi obsłużyć - to kontrakt, na który liczą wszystkie funkcje niżej.
 */
export function eventTimeZone(row: { timezone?: string | null }): string {
  const value = row.timezone;
  if (value === null || value === undefined || value.trim() === "") return EVENT_DEFAULT_TZ;
  const trimmed = value.trim();
  return isUsableTimeZone(trimmed) ? trimmed : EVENT_DEFAULT_TZ;
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
    // Strefa jest już zwalidowana, więc tu dochodzi wyłącznie odrzucona
    // KOMBINACJA opcji. Degradujemy do strefy domyślnej, nie do strefy maszyny -
    // godzina bez strefy jest gorsza niż godzina w strefie biura, bo nie wiadomo,
    // czyja jest.
    try {
      return date.toLocaleString(locale, { ...options, timeZone: EVENT_DEFAULT_TZ });
    } catch {
      return date.toLocaleString(locale, options);
    }
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
      day: date.toLocaleDateString(locale, { day: "numeric", timeZone: EVENT_DEFAULT_TZ }),
      month: date.toLocaleDateString(locale, { month: "short", timeZone: EVENT_DEFAULT_TZ }),
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
 * Klucz DNIA w strefie wydarzenia: `YYYY-MM-DD`.
 *
 * Grupowanie agendy potrzebuje klucza, który NIE ZALEŻY od języka interfejsu -
 * `formatEventDate` daje napis do czytania („25 sie 2026"), więc przełączenie
 * na angielski przebudowałoby zakładki dni i zgubiło wybór uczestnika. `en-CA`
 * jest tu formatem TECHNICZNYM (ISO), a nie językiem: to jedyne locale, które
 * w każdej przeglądarce daje `2026-08-25`.
 *
 * Doba liczy się w strefie WYDARZENIA, nie przeglądarki - sesja o 00:30 czasu
 * kongresu należy do dnia kongresu, a nie do wczoraj u uczestnika siedzącego
 * dwie strefy dalej.
 */
export function eventDayKey(
  startsAt: string | null | undefined,
  timezone: string | null | undefined,
): string {
  if (startsAt === null || startsAt === undefined || startsAt === "") return "";
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: eventTimeZone({ timezone }),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
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
