// Reguły TRZECH formularzy przestrzeni roboczej: wydarzenia klubu, pozycji
// harmonogramu wątku i źródła wątku.
//
// PO CO OSOBNY MODUŁ. Te trzy formularze niosły razem ~1000 linii, w których
// reguła produktu siedziała WEWNĄTRZ domknięcia komponentu: uzupełnienie
// tytułu z drugiego języka, parsowanie limitu miejsc, zamiana pustego napisu
// na `null` ("wyczyść pole"), przeliczenie presetu terminu, przycięcie
// wartości pola przy wejściu w tryb całodniowy. Każda z nich jest KONTRAKTEM
// z bazą (CHECK-i migracji 20260808300000) albo z kuratorem - a nie układem.
// Dopóki mieszkały w handlerach JSX-a, jedynym sposobem sprawdzenia „co
// dokładnie poleci do RPC” było zamontowanie całego okna z atrapą Radiksa.
//
// GRANICA WARSTW. Zero Reacta, zero i18n, zero dostępu do bazy i - poza jawnie
// podanym `nowMs` - zero zegara. Wejściem są napisy z pól formularza (czas
// LOKALNY bez strefy, tak jak je niosą `datetime-local` i `date`), wyjściem
// gotowy payload mutacji. Autoryzacja nie jest tu liczona ani powtarzana:
// pilnuje jej SECURITY DEFINER.
//
// STREFA CZASOWA JEST TU SEDNEM, NIE DETALEM. Pole `datetime-local` niesie czas
// lokalny bez strefy, a `timestamptz` bez strefy interpretuje wejście według
// strefy SERWERA - stąd całodobowe przesunięcia terminów. Dlatego termin
// całodniowy kotwiczymy w POŁUDNIE czasu lokalnego: północ po przeliczeniu na
// UTC wypada dzień wcześniej dla całej Europy Środkowej.
import { clubEventSlug } from "./eventSlug";
import type { ClubDocumentInput, ClubMilestoneInput } from "./threadWorkspaceApi";
import type {
  ClubEventKind,
  ClubEventStatus,
  ClubEventUpsertInput,
  ClubMilestoneKind,
  ClubMilestoneStatus,
  ClubThreadDocumentKind,
} from "./workspaceTypes";
import { clubDocumentNeedsUrl } from "./threadWorkspaceTypes";

// ---------------------------------------------------------------------------
// Czas: pole formularza <-> ISO
// ---------------------------------------------------------------------------

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `Date` -> wartość pola `date` (czas LOKALNY, nie UTC). */
export function clubFormLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `Date` -> wartość pola `datetime-local`. `toISOString()` dałoby tu UTC. */
export function clubFormLocalDateTime(date: Date): string {
  return `${clubFormLocalDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** ISO -> wartość pola `datetime-local` (czas LOKALNY, bez strefy i sekund). */
export function toLocalInputValue(iso: string | null, allDay: boolean): string {
  if (iso === null || iso.length === 0) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = clubFormLocalDate(date);
  return allDay ? day : `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Wartość pola -> ISO ze strefą. Termin całodniowy kotwiczymy na POŁUDNIU
 * czasu lokalnego, nie na północy: północ przy przeliczeniu na UTC wypada
 * poprzedniego dnia dla całej Europy Środkowej, więc "14 września" pokazywałby
 * się jako 13 września w kalendarzu liczonym w UTC.
 */
export function toIsoValue(input: string, allDay: boolean): string | null {
  if (input.length === 0) return null;
  const date = allDay ? new Date(`${input}T12:00:00`) : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Wartość pola po wejściu/wyjściu z trybu całodniowego - wariant PRZYCINAJĄCY
 * (kalendarz klubu). Zostawienie „2026-08-10T18:00” w polu typu `date` kończy
 * się tym, że przeglądarka po cichu je czyści i kurator traci termin.
 */
export function clubAllDayFieldValue(current: string, allDay: boolean): string {
  return allDay ? current.slice(0, 10) : current;
}

/**
 * Wartość pola po zmianie trybu - wariant PRZELICZAJĄCY (harmonogram wątku).
 * Idzie przez ISO, więc powrót z trybu całodniowego daje godzinę 12:00, a nie
 * przypadkową północ. Puste pole zostaje puste: nie ma czego przeliczać.
 */
export function clubModeFieldValue(current: string, from: boolean, to: boolean): string {
  return current.length === 0 ? current : toLocalInputValue(toIsoValue(current, from), to);
}

// ---------------------------------------------------------------------------
// Wydarzenie klubu
// ---------------------------------------------------------------------------

/** Stan pól okna wydarzenia - napisy DOKŁADNIE takie, jakie niosą pola. */
export interface ClubEventFormDraft {
  readonly titlePl: string;
  readonly titleEn: string;
  readonly descriptionPl: string;
  readonly descriptionEn: string;
  readonly kind: ClubEventKind;
  readonly status: ClubEventStatus;
  readonly allDay: boolean;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly location: string;
  readonly meetingUrl: string;
  readonly rsvpEnabled: boolean;
  readonly capacity: string;
}

/**
 * Wydarzenie bez tytułu w ŻADNYM języku albo bez terminu nie ma prawa pojechać
 * do RPC: `club_event_upsert` wymaga daty, a CHECK długości odrzuca tytuł
 * krótszy niż dwa znaki. Wystarczy JEDEN język - drugi dopisuje
 * `buildClubEventUpsert`.
 */
export function clubEventFormInvalid(draft: {
  readonly titlePl: string;
  readonly titleEn: string;
  readonly startsAt: string;
}): boolean {
  const pl = draft.titlePl.trim();
  const en = draft.titleEn.trim();
  return (pl.length < 2 && en.length < 2) || draft.startsAt.length === 0;
}

/** Tytuł pokazywany w podsumowaniu: polski, a gdy pusty - angielski. */
export function clubEventPreviewTitle(titlePl: string, titleEn: string): string {
  const pl = titlePl.trim();
  return pl.length > 0 ? pl : titleEn.trim();
}

/** Limit miejsc z pola tekstowego. Zero, minus i śmieci znaczą „bez limitu”. */
export function clubEventCapacityValue(capacity: string): number | null {
  const raw = capacity.trim();
  if (raw.length === 0) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Pusty napis znaczy „brak”, nie „pusty tekst” - CHECK długości przepuściłby "". */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Payload `club_event_upsert`.
 *
 * `editingId === null` znaczy TWORZENIE: leci `slug`, bo RPC go wtedy wymaga.
 * Przy redakcji slug NIE JEDZIE - zmiana adresu psuje linki rozesłane
 * w zaproszeniach.
 *
 * `nowMs` jest podane z zewnątrz, bo zegar wchodzi w dwa miejsca: sufiks sluga
 * i awaryjny `starts_at` dla wartości, której przeglądarka nie sparsowała.
 */
export function buildClubEventUpsert(
  draft: ClubEventFormDraft,
  editingId: string | null,
  nowMs: number,
): ClubEventUpsertInput {
  const pl = draft.titlePl.trim();
  const en = draft.titleEn.trim();
  const finalPl = pl.length >= 2 ? pl : en;
  const finalEn = en.length >= 2 ? en : pl;

  return {
    ...(editingId !== null ? { id: editingId } : { slug: clubEventSlug(finalPl, nowMs) }),
    title_pl: finalPl,
    title_en: finalEn,
    description_pl: orNull(draft.descriptionPl),
    description_en: orNull(draft.descriptionEn),
    kind: draft.kind,
    status: draft.status,
    all_day: draft.allDay,
    starts_at: toIsoValue(draft.startsAt, draft.allDay) ?? new Date(nowMs).toISOString(),
    ends_at: draft.endsAt.length > 0 ? toIsoValue(draft.endsAt, draft.allDay) : null,
    location: orNull(draft.location),
    meeting_url: orNull(draft.meetingUrl),
    rsvp_enabled: draft.rsvpEnabled,
    capacity: clubEventCapacityValue(draft.capacity),
  };
}

/**
 * Preset terminu („dziś”, „jutro”, „za tydzień”). Wydarzenie godzinowe ląduje
 * na 18:00 - to jest godzina, o której klub realnie się spotyka, a klikanie
 * w natywny kalendarz przy każdym wpisie jest wolniejsze niż jeden guzik.
 */
export function clubEventStartPreset(now: Date, offsetDays: number, allDay: boolean): string {
  const date = new Date(now.getTime());
  date.setDate(date.getDate() + offsetDays);
  if (allDay) return clubFormLocalDate(date);
  date.setHours(18, 0, 0, 0);
  return clubFormLocalDateTime(date);
}

/**
 * Koniec wyliczony z długości spotkania. `null` = nie ma czego liczyć (tryb
 * całodniowy, brak początku, początek nie do sparsowania) i wtedy pole końca
 * ZOSTAJE nietknięte, zamiast wyzerować się w cudzysłowie.
 */
export function clubEventEndFromDuration(
  startsAt: string,
  minutes: number,
  allDay: boolean,
): string | null {
  if (allDay || startsAt.length === 0) return null;
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return null;
  return clubFormLocalDateTime(new Date(start.getTime() + minutes * 60_000));
}

/**
 * Wartość pola końca po kliknięciu guzika długości. Gdy nie ma czego liczyć,
 * oddaje wartość OBECNĄ - klik nie ma prawa wyczyścić pola, które kurator już
 * wypełnił ręcznie.
 */
export function clubEventEndValue(
  current: string,
  startsAt: string,
  minutes: number,
  allDay: boolean,
): string {
  return clubEventEndFromDuration(startsAt, minutes, allDay) ?? current;
}

/** Klucz i18n guzika długości. Nieznana długość dostaje klucz dwugodzinny. */
export function clubEventDurationLabelKey(minutes: number): string {
  if (minutes === 30) return "club.eventForm.duration30";
  if (minutes === 60) return "club.eventForm.duration60";
  if (minutes === 90) return "club.eventForm.duration90";
  return "club.eventForm.duration120";
}

/**
 * Czy podsumowanie ma pokazać ADRES wydarzenia. Przy redakcji NIE - slug
 * zostaje nietknięty, więc obiecywanie zmiany adresu byłoby kłamstwem.
 */
export function clubEventShowsSlug(editing: boolean, previewSlug: string): boolean {
  return !editing && previewSlug.length > 0;
}

/**
 * Zakres w podsumowaniu. Wpis BEZ końca jest punktem w czasie, nie zakresem
 * z pustą prawą stroną - dlatego nie ma tu wiszącego separatora.
 */
export function clubEventRangeLabel(start: string, end: string, allDay: boolean): string {
  const label = (value: string) => (allDay ? value : value.replace("T", ", "));
  if (end.length === 0) return label(start);
  return `${label(start)} - ${label(end)}`;
}

// ---------------------------------------------------------------------------
// Pozycja harmonogramu wątku
// ---------------------------------------------------------------------------

/** Stan pól formularza harmonogramu. */
export interface ClubMilestoneFormDraft {
  readonly title: string;
  readonly description: string;
  readonly kind: ClubMilestoneKind;
  readonly status: ClubMilestoneStatus;
  readonly allDay: boolean;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly location: string;
  readonly url: string;
}

/**
 * Koniec przed początkiem odrzuca CHECK bazy (23514). Blokujemy wcześniej, bo
 * surowy błąd Postgresa wraca do kuratora PO utracie formularza.
 */
export function clubMilestoneRangeInvalid(startIso: string | null, endIso: string | null): boolean {
  return startIso !== null && endIso !== null && endIso < startIso;
}

/** Pozycja bez trzyznakowego tytułu albo bez początku nie jedzie do RPC. */
export function clubMilestoneFormInvalid(
  title: string,
  startIso: string | null,
  rangeInvalid: boolean,
): boolean {
  return title.trim().length < 3 || startIso === null || rangeInvalid;
}

/** Payload `club_thread_milestone_upsert`. `startIso` jest już zwalidowany. */
export function buildClubMilestonePayload(
  draft: ClubMilestoneFormDraft,
  threadId: string,
  editingId: string | null,
  startIso: string,
  endIso: string | null,
): ClubMilestoneInput {
  return {
    ...(editingId !== null ? { id: editingId } : {}),
    thread_id: threadId,
    title: draft.title.trim(),
    description: orNull(draft.description),
    kind: draft.kind,
    status: draft.status,
    starts_at: startIso,
    ends_at: endIso,
    all_day: draft.allDay,
    location: orNull(draft.location),
    url: orNull(draft.url),
  };
}

// ---------------------------------------------------------------------------
// Źródło wątku
// ---------------------------------------------------------------------------

/** Stan pól formularza źródła. */
export interface ClubDocumentFormDraft {
  readonly kind: ClubThreadDocumentKind;
  readonly title: string;
  readonly url: string;
  readonly description: string;
  readonly sourceLabel: string;
  readonly publishedOn: string;
  readonly isPrimary: boolean;
}

/** Rodzaj wymagający adresu, a adresu nie ma - CHECK `..._url_required`. */
export function clubDocumentUrlMissing(kind: string, url: string): boolean {
  return clubDocumentNeedsUrl(kind) && url.trim().length === 0;
}

/** Źródło bez trzyznakowego tytułu albo bez wymaganego adresu nie jedzie. */
export function clubDocumentFormInvalid(title: string, urlMissing: boolean): boolean {
  return title.trim().length < 3 || urlMissing;
}

/**
 * Payload `club_thread_document_upsert`.
 *
 * `is_primary` jedzie WYŁĄCZNIE od kuratora: klucz NIEOBECNY znaczy „nie ruszaj
 * pola”, więc członek bez uprawnienia nie zdejmie cudzego wyróżnienia samym
 * zapisem opisu.
 */
export function buildClubDocumentPayload(
  draft: ClubDocumentFormDraft,
  threadId: string,
  editingId: string | null,
  canCurate: boolean,
): ClubDocumentInput {
  return {
    ...(editingId !== null ? { id: editingId } : {}),
    thread_id: threadId,
    kind: draft.kind,
    title: draft.title.trim(),
    url: orNull(draft.url),
    description: orNull(draft.description),
    source_label: orNull(draft.sourceLabel),
    published_on: draft.publishedOn.length > 0 ? draft.publishedOn : null,
    ...(canCurate ? { is_primary: draft.isPrimary } : {}),
  };
}
