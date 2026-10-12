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
      // TRZECIA PRÓBA NIE MOŻE UŻYWAĆ OPCJI WOŁAJĄCEGO. Odrzucona KOMBINACJA
      // opcji (np. `dateStyle` razem z `hour`) nie zależy od strefy, więc skoro
      // padły obie próby wyżej, padłaby i ta - a wyjątek stąd wychodzi z funkcji
      // i zabiera ze sobą render całej listy wydarzeń. Znacznik ISO jest brzydki,
      // ale czytelny, jednoznaczny co do strefy (`Z`) i nie przechodzi przez
      // `Intl`, więc ostatnia bramka jest bezwarunkowo bezpieczna.
      return date.toISOString();
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

// ── Zegar ścienny w NAZWANEJ strefie <-> chwila ─────────────────────────────
//
// Pole `datetime-local` oddaje napis BEZ STREFY (`2026-09-14T09:30`).
// `new Date(napis)` czyta go w strefie PRZEGLĄDARKI - a siatka slotów giełdy
// (`_event_meeting_slot_valid`) liczy godziny w strefie WYDARZENIA
// (`(dzień + godzina) AT TIME ZONE s.timezone`). Okna dostępności liczone przez
// `new Date` zamieniały „9:30" wpisane przez uczestnika z Londynu (myślącego
// o programie kongresu w Warszawie) w 10:30 czasu kongresu (OPS-15). Dwie
// funkcje niżej robią tę zamianę dla DOWOLNEJ strefy IANA, bez zależności od
// strefy maszyny - wspólnie dla każdego formularza, który ma czytać godziny
// w strefie wydarzenia.
//
// REGUŁA DLA GODZIN, KTÓRYCH NIE MA ALBO KTÓRE SĄ DWIE, JEST REGUŁĄ POSTGRESA.
// Baza rozstrzyga `timestamp AT TIME ZONE` tak (`DetermineTimeZoneOffset`,
// sprawdzone na PostgreSQL 16):
//   * wiosną (luka, np. 02:30 w Warszawie 29.03.2026) - przesunięcie SPRZED
//     zmiany, więc chwila wypada o długość luki później (03:30 CEST);
//   * jesienią (zakładka, np. 02:30 w Warszawie 25.10.2026) - przesunięcie PO
//     zmianie, czyli DRUGIE wystąpienie godziny (02:30 CET).
// Ta sama reguła po obu stronach znaczy, że napis „02:30" z formularza i slot
// „02:30" z siatki bazy są zawsze TĄ SAMĄ chwilą - także w noc zmiany czasu.
// Reguła Temporala „compatible" (wcześniejsze wystąpienie jesienią) dawałaby
// tej nocy okno przesunięte o godzinę względem slotów.

/**
 * Jak napis zegarowy zamienił się w chwilę.
 *
 * `exact` - godzina istnieje w tej strefie dokładnie raz.
 * `gap` - godziny NIE MA (wiosenne przestawienie zegara); chwila jest
 *   przesunięta do przodu o długość luki.
 * `overlap` - godzina wypada DWA RAZY (jesienne przestawienie zegara); wybrane
 *   jest DRUGIE wystąpienie.
 */
export type WallClockResolution = "exact" | "gap" | "overlap";

export interface ZonedInstant {
  /** Chwila w UTC, postać `toISOString()`. */
  iso: string;
  resolution: WallClockResolution;
}

/** Formatery części zegara per strefa - ten sam bezpiecznik rozmiaru co wyżej. */
const WALL_CLOCK_FORMATS = new Map<string, Intl.DateTimeFormat>();

function wallClockFormat(zone: string): Intl.DateTimeFormat {
  const cached = WALL_CLOCK_FORMATS.get(zone);
  if (cached !== undefined) return cached;
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  if (WALL_CLOCK_FORMATS.size < TZ_VALIDITY_LIMIT) WALL_CLOCK_FORMATS.set(zone, format);
  return format;
}

interface WallClockFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Odczyt zegara strefy w danej chwili; `null`, gdy `Intl` odmówi. */
function wallClockFieldsAt(epochMs: number, zone: string): WallClockFields | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = wallClockFormat(zone).formatToParts(new Date(epochMs));
  } catch {
    return null;
  }
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
  const fields: WallClockFields = {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Część silników oddaje północ jako „24" mimo `h23` - doba jest ta sama.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
  return Object.values(fields).every(Number.isFinite) ? fields : null;
}

/**
 * Pola zegara czytane jako UTC -> milisekundy. `setUTCFullYear` zamiast
 * `Date.UTC`, bo ten drugi zamienia lata 0-99 na 1900-1999.
 */
function utcMs(fields: WallClockFields, millisecond = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(fields.year, fields.month - 1, fields.day);
  date.setUTCHours(fields.hour, fields.minute, fields.second, millisecond);
  return date.getTime();
}

/** Przesunięcie strefy względem UTC w danej chwili, w ms (Warszawa latem: +7 200 000). */
function zoneOffsetMs(epochMs: number, zone: string): number | null {
  const whole = Math.floor(epochMs / 1000) * 1000;
  const fields = wallClockFieldsAt(whole, zone);
  return fields === null ? null : utcMs(fields) - whole;
}

const WALL_CLOCK_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const DAY_MS = 86_400_000;
const MAX_DATE_MS = 8.64e15;

/**
 * Chwila -> napis zegara w strefie `zone`, w postaci wartości pola
 * `datetime-local` (`YYYY-MM-DDTHH:mm`). Sekundy odpadają, bo pole ich nie
 * pokazuje. Pusta albo nieczytelna chwila daje pusty napis, nigdy
 * „Invalid Date" w polu. Strefa przechodzi przez `eventTimeZone`, więc
 * identyfikator nieznany `Intl` degraduje do strefy domyślnej, nie do strefy
 * maszyny.
 */
export function wallClockInZone(
  iso: string | null | undefined,
  zone: string | null | undefined,
): string {
  if (iso === null || iso === undefined || iso === "") return "";
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const fields = wallClockFieldsAt(ms, eventTimeZone({ timezone: zone }));
  if (fields === null) return "";
  const pad = (value: number, size = 2): string => String(value).padStart(size, "0");
  return (
    `${pad(fields.year, 4)}-${pad(fields.month)}-${pad(fields.day)}` +
    `T${pad(fields.hour)}:${pad(fields.minute)}`
  );
}

/**
 * Napis zegara wpisany w strefie `zone` -> chwila, z regułą Postgresa dla luki
 * i zakładki (patrz nagłówek sekcji). Przyjmuje wartość pola `datetime-local`
 * (`YYYY-MM-DDTHH:mm`, opcjonalnie z sekundami - pole oddaje je przy `step`
 * poniżej minuty). Napis niepełny albo nieistniejąca data (`2026-02-30`) dają
 * `null`, a nie chwilę przesuniętą o kilka dni.
 */
export function instantFromWallClock(
  value: string,
  zone: string | null | undefined,
): ZonedInstant | null {
  const match = WALL_CLOCK_INPUT.exec(value.trim());
  if (match === null) return null;
  const fields: WallClockFields = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? "0"),
  };
  const millisecond = Number((match[7] ?? "").padEnd(3, "0"));
  // Zegar czytany jako UTC. Pola spoza zakresu (`25:00`, `02-30`) `Date`
  // przenosi na następną dobę albo miesiąc - porównanie wraca do nich i odrzuca.
  const naive = utcMs(fields);
  const check = new Date(naive);
  if (
    check.getUTCFullYear() !== fields.year ||
    check.getUTCMonth() + 1 !== fields.month ||
    check.getUTCDate() !== fields.day ||
    check.getUTCHours() !== fields.hour ||
    check.getUTCMinutes() !== fields.minute ||
    check.getUTCSeconds() !== fields.second
  ) {
    return null;
  }

  const tz = eventTimeZone({ timezone: zone });
  // Przesunięcia dobę przed i dobę po: zmiana czasu, jeśli jest w pobliżu,
  // leży między nimi. Kandydat jest prawdziwy, gdy zegar strefy w tej chwili
  // pokazuje dokładnie wpisany napis.
  const before = zoneOffsetMs(naive - DAY_MS, tz);
  const after = zoneOffsetMs(naive + DAY_MS, tz);
  if (before === null || after === null) return null;
  const candidates = [...new Set([naive - before, naive - after])].filter(
    (candidate) => zoneOffsetMs(candidate, tz) === naive - candidate,
  );

  let instant: number;
  let resolution: WallClockResolution;
  if (candidates.length === 1) {
    instant = candidates[0] as number;
    resolution = "exact";
  } else if (candidates.length > 1) {
    instant = Math.max(...candidates);
    resolution = "overlap";
  } else {
    instant = naive - before;
    resolution = "gap";
  }
  instant += millisecond;
  if (!Number.isFinite(instant) || Math.abs(instant) > MAX_DATE_MS) return null;
  return { iso: new Date(instant).toISOString(), resolution };
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
