// Pole `datetime-local` formularzy panelu wydarzen - zegar w STREFIE WYDARZENIA.
//
// PROBLEM (ta sama klasa bledu co OPS-15, przekazanie z S6). Formularze biletu,
// pakietu, sesji i gieldy spotkan czytaly napis pola przez `new Date(napis)`,
// czyli w strefie PRZEGLADARKI, a zapisywaly jego odczyt jako chwile. Ten sam
// formularz dawal wiec dwie rozne chwile u dwoch organizatorow: "sprzedaz do
// 18:00" wpisane w Londynie dla kongresu w Warszawie zamykala sprzedaz o 19:00
// czasu kongresu, a sesja "9:30" z programu ladowala o 10:30. Okno dialogu
// sesji obiecywalo przy tym "godziny podajesz w strefie wydarzenia" - i nie
// bylo to prawda.
//
// ZEGAR W NAZWANEJ STREFIE. Obie konwersje ida przez `wallClockInZone`
// i `instantFromWallClock` z `lib/events/timezone.ts` (S6): niezaleznie od
// strefy maszyny, z regula Postgresa dla nocy zmiany czasu - wiosenna luka
// przesuwa godzine o dlugosc luki do przodu, jesienna zakladka bierze DRUGIE
// wystapienie. Tak samo rozstrzyga baza (`timestamp AT TIME ZONE`), wiec napis
// z formularza i godzina liczona w SQL-u sa ta sama chwila.
//
// NIETKNIETE POLE WRACA DO BAZY CO DO MILISEKUNDY. Napis zegara nie niesie
// sekund ani tego, ktore z dwoch wystapien jesiennej godziny chodzi. Bez
// pamieci chwili z bazy kazde "przelacz aktywnosc" albo zapis samej nazwy
// biletu przycinalby `sales_to` 23:59:59 do 23:59:00, a termin z pierwszego
// wystapienia 02:30 przesuwal o godzine. Pole zgodne z chwila z bazy (w tej
// samej strefie) oddaje wiec te chwile - ta sama regula co `resolveWindowField`
// w `meetingWindowDraft.ts`.
//
// GRANICA WARSTW: zero Reacta. `t` wchodzi parametrem, jak w `roleLabel`.
import type { TFunction } from "i18next";
import {
  eventTimeZone,
  formatEventDateTime,
  formatEventTime,
  instantFromWallClock,
  wallClockInZone,
  type ZonedInstant,
} from "@/lib/events/timezone";
import type { UiLang } from "@/lib/i18n/format";

/**
 * Chwile z bazy, z ktorych powstaly pola szkicu. Brak klucza albo `null` -
 * pole nowe albo puste w bazie; wtedy liczy sie wylacznie napis.
 */
export type SavedInstants<K extends string> = Partial<Record<K, string | null>>;

/** Wartosc z bazy w postaci kanonicznej `toISOString()` albo `null`. */
export function canonicalInstant(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Chwila z bazy -> wartosc pola `datetime-local` (`YYYY-MM-DDTHH:mm`) w strefie
 * `zone`. Pusta albo nieczytelna chwila daje pusty napis. Strefa nieznana
 * `Intl` degraduje do strefy domyslnej serwisu, nie do strefy przegladarki.
 */
export function eventLocalInput(
  iso: string | null | undefined,
  zone: string | null | undefined,
): string {
  return wallClockInZone(iso, zone);
}

/**
 * Pole -> chwila z rozstrzygnieciem (`exact` | `gap` | `overlap`). Pole zgodne
 * z chwila z bazy oddaje te chwile bez zmian; pole puste albo niepelne -
 * `null`, nigdy "Invalid Date".
 */
export function resolveEventLocalInput(
  value: string,
  zone: string | null | undefined,
  saved: string | null = null,
): ZonedInstant | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const savedIso = canonicalInstant(saved);
  if (savedIso !== null && wallClockInZone(savedIso, zone) === trimmed) {
    return { iso: savedIso, resolution: "exact" };
  }
  return instantFromWallClock(trimmed, zone);
}

/** Pole -> ISO w UTC; pusty albo niepelny napis znaczy "brak" i daje `null`. */
export function eventLocalInputToIso(
  value: string,
  zone: string | null | undefined,
  saved: string | null = null,
): string | null {
  return resolveEventLocalInput(value, zone, saved)?.iso ?? null;
}

/**
 * Podpis pola daty: w jakiej strefie jest zegar, a w noc zmiany czasu - co
 * z wpisana godzina zrobimy. Klucze siedza w nakladce `adminEvents`
 * (`eventTime.*`), wspolnej dla formularzy studia wydarzenia; komponent musi
 * ja zarejestrowac (`ensureI18n` z `i18n-admin-events`).
 *
 * `quietWhenExact` - formularz, ktory juz mowi o strefie w naglowku sekcji
 * (dialog sesji), nie powtarza jej pod kazdym polem; zdanie o luce i zakladce
 * pokazuje zawsze, bo to ono mowi, ze zapiszemy inna godzine niz wpisana.
 */
export function eventLocalInputHint(
  t: TFunction,
  lang: UiLang,
  value: string,
  zone: string | null | undefined,
  saved: string | null = null,
  options: { quietWhenExact?: boolean } = {},
): string | undefined {
  const tz = eventTimeZone({ timezone: zone });
  const resolved = resolveEventLocalInput(value, tz, saved);
  if (resolved !== null && resolved.resolution === "gap") {
    return t("adminEvents.eventTime.gap", {
      zone: tz,
      value: formatEventTime(resolved.iso, tz, lang),
    });
  }
  if (resolved !== null && resolved.resolution === "overlap") {
    return t("adminEvents.eventTime.overlap", {
      zone: tz,
      value: formatEventDateTime(resolved.iso, tz, lang, {
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      }),
    });
  }
  if (options.quietWhenExact === true) return undefined;
  return t("adminEvents.eventTime.zone", { zone: tz });
}
