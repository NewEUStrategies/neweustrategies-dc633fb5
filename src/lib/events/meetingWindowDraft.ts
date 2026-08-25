// Szkic OKNA DOSTEPNOSCI uczestnika - zamiana miedzy `datetime-local` i ISO.
//
// DLACZEGO OSOBNY MODUL, A NIE `new Date(value).toISOString()` W KOMPONENCIE.
// Pole `datetime-local` oddaje napis BEZ STREFY (`2026-09-14T09:30`), a baza
// przyjmuje `timestamptz`. Konwersja jest wiec decyzja o strefie, a nie
// formatowaniem - i musi byc podjeta w jednym miejscu, bo dwie rozne konwersje
// w dwoch komponentach daja dwa rozne okna z tego samego napisu.
//
// PRZYJMUJEMY STREFE PRZEGLADARKI, I JEST TO POPRAWNE. Uczestnik wpisuje
// godzine, o ktorej BEDZIE dostepny, patrzac na zegarek, ktory ma na sobie.
// Doklejenie strefy wydarzenia zamienialoby "9:30 u mnie" w "9:30 w Warszawie" -
// dla uczestnika z Brukseli to godzina wczesniej, niz mial na mysli. Ekran
// pokazuje obok godzine w strefie wydarzenia, zeby roznica byla widoczna,
// zamiast byc ukryta w konwersji.
//
// WALIDACJA ODWZOROWUJE OGRANICZENIA Z MIGRACJI (`15 minutes`-`16 hours`,
// `ends_at > starts_at`) - nie zeby zastapic baze, ale zeby uczestnik dowiedzial
// sie o bledzie przed wyslaniem. Ostatnie slowo ma `CHECK`.

/** Dolna i gorna granica okna z `event_meeting_availability_duration_range`. */
export const MIN_WINDOW_MINUTES = 15;
export const MAX_WINDOW_MINUTES = 16 * 60;

export interface WindowDraft {
  /** `null` znaczy "nowe okno" - dialog nie odgaduje trybu z pustych pol. */
  id: string | null;
  /** Napisy `datetime-local`, czyli czas LOKALNY przegladarki. */
  startsAtLocal: string;
  endsAtLocal: string;
  isOpen: boolean;
  note: string;
}

export const NEW_WINDOW_DRAFT: WindowDraft = {
  id: null,
  startsAtLocal: "",
  endsAtLocal: "",
  isOpen: true,
  note: "",
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** ISO z bazy -> napis dla `datetime-local` w strefie przegladarki. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Napis z `datetime-local` -> ISO w UTC. `null` dla wartosci niepelnej. */
export function localInputToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function draftFromWindow(row: {
  id: string;
  startsAt: string;
  endsAt: string;
  isOpen: boolean;
  note: string | null;
}): WindowDraft {
  return {
    id: row.id,
    startsAtLocal: isoToLocalInput(row.startsAt),
    endsAtLocal: isoToLocalInput(row.endsAt),
    isOpen: row.isOpen,
    note: row.note ?? "",
  };
}

/** Powod, dla ktorego szkicu NIE DA SIE wyslac - albo `null`. */
export type WindowDraftError = "incomplete" | "order" | "tooShort" | "tooLong" | "noteTooLong";

export function validateWindowDraft(draft: WindowDraft): WindowDraftError | null {
  const startsAt = localInputToIso(draft.startsAtLocal);
  const endsAt = localInputToIso(draft.endsAtLocal);
  if (startsAt === null || endsAt === null) return "incomplete";
  const minutes = (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000;
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
export function windowPayload(draft: WindowDraft): WindowPayload | null {
  if (validateWindowDraft(draft) !== null) return null;
  const startsAt = localInputToIso(draft.startsAtLocal);
  const endsAt = localInputToIso(draft.endsAtLocal);
  if (startsAt === null || endsAt === null) return null;
  const note = draft.note.trim();
  return {
    id: draft.id,
    startsAt,
    endsAt,
    isOpen: draft.isOpen,
    // Pusta notatka to BRAK notatki, nie pusty napis: `''` przechodzi CHECK-a
    // dlugosci i zostaje w bazie jako wiersz z widoczna, pusta adnotacja.
    note: note.length > 0 ? note : null,
  };
}
