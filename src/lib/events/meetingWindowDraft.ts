// Szkic OKNA DOSTEPNOSCI uczestnika - zamiana miedzy `datetime-local` i ISO.
//
// DLACZEGO OSOBNY MODUL, A NIE `new Date(value).toISOString()` W KOMPONENCIE.
// Pole `datetime-local` oddaje napis BEZ STREFY (`2026-09-14T09:30`), a baza
// przyjmuje `timestamptz`. Konwersja jest wiec decyzja o strefie, a nie
// formatowaniem - i musi byc podjeta w jednym miejscu, bo dwie rozne konwersje
// w dwoch komponentach daja dwa rozne okna z tego samego napisu.
//
// DOMYSLNIE STREFA WYDARZENIA, NIE PRZEGLADARKI (OPS-15). Siatka slotow gieldy
// (`_event_meeting_slot_valid`) liczy godziny w strefie wydarzenia, program
// kongresu jest w niej wydrukowany, a uczestnik planuje dzien wedlug programu.
// Dawna konwersja w strefie przegladarki zamieniala "9:30" wpisane przez
// uczestnika z Londynu (myslacego o 9:30 w Warszawie) w 10:30 czasu kongresu -
// okno o godzine obok slotow, ktore widzial na ekranie.
//
// "MOJA STREFA" JEST JAWNYM WYBOREM, NIE ZGADYWANIEM. Kto woli wpisywac godziny
// wedlug wlasnego zegarka, przelacza `inputZone` na `viewer`; przelaczenie
// PRZEPISUJE pola na nowa strefe (ta sama chwila, inny napis), wiec samo
// przelaczenie nigdy nie przesuwa okna. Obie konwersje ida przez te same
// funkcje `lib/events/timezone.ts`, z ta sama regula dla luki i zakladki zmiany
// czasu - regula Postgresa, wiec napis "02:30" z formularza i slot "02:30"
// z siatki bazy sa ta sama chwila takze w noc zmiany czasu.
//
// NIETKNIETE POLE EDYCJI WRACA DO BAZY CO DO MILISEKUNDY. Napis zegara nie
// koduje, ktore z dwoch wystapien godziny jesiennej nocy chodzi, ani sekund.
// Bez `startsAtSaved`/`endsAtSaved` zapis samej notatki potrafilby przesunac
// okno o godzine. Pole porownujemy z chwila z bazy w BIEZACEJ strefie pol:
// zgodny napis znaczy "nie ruszane" i oddaje chwile z bazy.
//
// JEDNA IMPLEMENTACJA "NIETKNIETEGO POLA". Regula pamieci chwili z bazy zyje
// w `resolveEventLocalInput` (`lib/events/eventLocalInput.ts`), wspolnej dla
// biletu, pakietu, sesji, kodow i gieldy; `resolveWindowField` tylko ja wola.
// Dwie kopie tej samej reguly rozjechalyby sie przy pierwszej poprawce jednej
// z nich - a wtedy to samo pole edycji oddawaloby inna chwile w dwoch
// formularzach.
//
// WALIDACJA ODWZOROWUJE OGRANICZENIA Z MIGRACJI (`15 minutes`-`16 hours`,
// `ends_at > starts_at`) - nie zeby zastapic baze, ale zeby uczestnik dowiedzial
// sie o bledzie przed wyslaniem. Dlugosc liczy sie z CHWIL, nie z napisow, wiec
// okno 01:00-04:00 w noc wiosennej zmiany czasu trwa 2 godziny. Ostatnie slowo
// ma `CHECK`.
import { canonicalInstant, resolveEventLocalInput } from "@/lib/events/eventLocalInput";
import {
  browserTimeZone,
  eventTimeZone,
  instantFromWallClock,
  isForeignTimeZone,
  wallClockInZone,
  type ZonedInstant,
} from "@/lib/events/timezone";

/** Dolna i gorna granica okna z `event_meeting_availability_duration_range`. */
export const MIN_WINDOW_MINUTES = 15;
export const MAX_WINDOW_MINUTES = 16 * 60;

/** W czyjej strefie uczestnik wpisuje godziny: wydarzenia albo wlasnej. */
export type WindowInputZone = "event" | "viewer";

/** Obie strefy, miedzy ktorymi wybiera uczestnik - zawsze zwalidowane. */
export interface WindowZones {
  /** Strefa wydarzenia - ta, w ktorej baza liczy siatke slotow. */
  event: string;
  /** Strefa uczestnika (przegladarki). */
  viewer: string;
}

/**
 * Strefy dla formularza. `viewerZone` jest parametrem z domyslna strefa
 * przegladarki - test podaje ja wprost, ekran bierze z `Intl`.
 */
export function windowZones(
  eventTimezone: string | null | undefined,
  viewerZone: string = browserTimeZone(),
): WindowZones {
  return {
    event: eventTimeZone({ timezone: eventTimezone }),
    viewer: eventTimeZone({ timezone: viewerZone }),
  };
}

/** Czy wybor strefy ma sens - przy tej samej strefie oba tryby daja to samo. */
export function hasZoneChoice(zones: WindowZones): boolean {
  return isForeignTimeZone(zones.event, zones.viewer);
}

export function zoneOf(inputZone: WindowInputZone, zones: WindowZones): string {
  return inputZone === "viewer" ? zones.viewer : zones.event;
}

export interface WindowDraft {
  /** `null` znaczy "nowe okno" - dialog nie odgaduje trybu z pustych pol. */
  id: string | null;
  /** Napisy `datetime-local`, czyli zegar w strefie wskazanej przez `inputZone`. */
  startsAtLocal: string;
  endsAtLocal: string;
  /** Strefa pol. Domyslnie strefa WYDARZENIA. */
  inputZone: WindowInputZone;
  /** Chwile z bazy przy edycji (`null` dla nowego okna) - patrz naglowek. */
  startsAtSaved: string | null;
  endsAtSaved: string | null;
  isOpen: boolean;
  note: string;
}

export const NEW_WINDOW_DRAFT: WindowDraft = {
  id: null,
  startsAtLocal: "",
  endsAtLocal: "",
  inputZone: "event",
  startsAtSaved: null,
  endsAtSaved: null,
  isOpen: true,
  note: "",
};

/** ISO z bazy -> napis dla `datetime-local` w podanej strefie. */
export function isoToLocalInput(iso: string | null | undefined, zone: string): string {
  return wallClockInZone(iso, zone);
}

/** Napis z `datetime-local` w podanej strefie -> ISO w UTC. `null` dla wartosci niepelnej. */
export function localInputToIso(value: string, zone: string): string | null {
  return instantFromWallClock(value, zone)?.iso ?? null;
}

/**
 * Pole szkicu -> chwila. Pole zgodne z chwila z bazy (w strefie pol) oddaje
 * te chwile bez zmian; kazde inne przechodzi przez regule luki i zakladki.
 * Jedna implementacja z formularzami panelu - patrz naglowek.
 */
export function resolveWindowField(
  value: string,
  saved: string | null,
  zone: string,
): ZonedInstant | null {
  return resolveEventLocalInput(value, zone, saved);
}

export function draftFromWindow(
  row: {
    id: string;
    startsAt: string;
    endsAt: string;
    isOpen: boolean;
    note: string | null;
  },
  zones: WindowZones,
  inputZone: WindowInputZone = "event",
): WindowDraft {
  const zone = zoneOf(inputZone, zones);
  return {
    id: row.id,
    startsAtLocal: isoToLocalInput(row.startsAt, zone),
    endsAtLocal: isoToLocalInput(row.endsAt, zone),
    inputZone,
    startsAtSaved: canonicalInstant(row.startsAt),
    endsAtSaved: canonicalInstant(row.endsAt),
    isOpen: row.isOpen,
    note: row.note ?? "",
  };
}

/**
 * Przelaczenie strefy pol. Pole czytelne jest PRZEPISANE na nowa strefe
 * (ta sama chwila), pole puste albo niepelne zostaje, jak bylo - nie ma czego
 * przeliczac, a skasowanie go zabraloby uczestnikowi to, co juz wpisal.
 */
export function switchDraftZone(
  draft: WindowDraft,
  next: WindowInputZone,
  zones: WindowZones,
): WindowDraft {
  if (draft.inputZone === next) return draft;
  const from = zoneOf(draft.inputZone, zones);
  const to = zoneOf(next, zones);
  const move = (value: string, saved: string | null): string => {
    const resolved = resolveWindowField(value, saved, from);
    return resolved === null ? value : isoToLocalInput(resolved.iso, to);
  };
  return {
    ...draft,
    inputZone: next,
    startsAtLocal: move(draft.startsAtLocal, draft.startsAtSaved),
    endsAtLocal: move(draft.endsAtLocal, draft.endsAtSaved),
  };
}

/** Obie chwile szkicu w jego strefie pol. */
export function windowInstants(
  draft: WindowDraft,
  zones: WindowZones,
): { startsAt: ZonedInstant | null; endsAt: ZonedInstant | null } {
  const zone = zoneOf(draft.inputZone, zones);
  return {
    startsAt: resolveWindowField(draft.startsAtLocal, draft.startsAtSaved, zone),
    endsAt: resolveWindowField(draft.endsAtLocal, draft.endsAtSaved, zone),
  };
}

/** Powod, dla ktorego szkicu NIE DA SIE wyslac - albo `null`. */
export type WindowDraftError = "incomplete" | "order" | "tooShort" | "tooLong" | "noteTooLong";

export function validateWindowDraft(
  draft: WindowDraft,
  zones: WindowZones,
): WindowDraftError | null {
  const { startsAt, endsAt } = windowInstants(draft, zones);
  if (startsAt === null || endsAt === null) return "incomplete";
  const minutes = (new Date(endsAt.iso).getTime() - new Date(startsAt.iso).getTime()) / 60_000;
  if (minutes <= 0) return "order";
  if (minutes < MIN_WINDOW_MINUTES) return "tooShort";
  if (minutes > MAX_WINDOW_MINUTES) return "tooLong";
  if (draft.note.trim().length > 300) return "noteTooLong";
  return null;
}

export interface WindowPayload {
  id: string | null;
  startsAt: string;
  endsAt: string;
  isOpen: boolean;
  note: string | null;
}

/** Szkic -> payload RPC. Zwraca `null`, gdy szkic jest niepoprawny. */
export function windowPayload(draft: WindowDraft, zones: WindowZones): WindowPayload | null {
  if (validateWindowDraft(draft, zones) !== null) return null;
  const { startsAt, endsAt } = windowInstants(draft, zones);
  if (startsAt === null || endsAt === null) return null;
  const note = draft.note.trim();
  return {
    id: draft.id,
    startsAt: startsAt.iso,
    endsAt: endsAt.iso,
    isOpen: draft.isOpen,
    // Pusta notatka to BRAK notatki, nie pusty napis: `''` przechodzi CHECK-a
    // dlugosci i zostaje w bazie jako wiersz z widoczna, pusta adnotacja.
    note: note.length > 0 ? note : null,
  };
}
