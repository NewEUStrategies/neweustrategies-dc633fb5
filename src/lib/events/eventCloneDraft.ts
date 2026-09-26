// Czyste reguly FORMULARZA KLONU EDYCJI: stan szkicu, walidacja i ladunek.
//
// CZEGO TU NIE MA. Przesuniecia dat. Termin kazdej sesji, biletu i progu cen
// liczy baza (`_event_clone_shift`, w czasie lokalnym strefy wydarzenia) - tu
// jest wylacznie to, co wpisuje organizator: tytuly, adres, poczatek, koniec,
// strefa i przelaczniki. Podpowiedz poczatku (ta sama godzina rok pozniej)
// tez przychodzi z bazy (`target.suggested_starts_at`).
//
// DOMYSLNE PRZELACZNIKI TEZ SA Z BAZY. Szkic startuje od `include`/`options`
// oddanych przez podglad, wiec domyslna "co kopiujemy" ma jedno zrodlo
// prawdy (`_event_clone_settings`) zamiast drugiej listy w TypeScripcie.
//
// WALIDACJA LUSTRZANA DO SQL. Kazdy klucz bledu odpowiada odmowie, ktora baza
// i tak by podniosla (`invalid_titles`, `invalid_slug`, `invalid_code_suffix`,
// `invalid_task_due_days`, `external_url_*`, `invalid_ends_at`) - formularz
// mowi o niej ZANIM organizator kliknie, a nie zamiast bazy.
import type {
  CloneFlags,
  CloneInclude,
  EventCloneInput,
  EventClonePreview,
} from "@/lib/events/eventCloneApi";

export interface EventCloneDraft {
  titlePl: string;
  titleEn: string;
  /** Pusty = adres z tytulu PL (liczy baza). */
  slug: string;
  /** ISO albo `""`. */
  startsAt: string;
  /** ISO albo `""` = koniec przesuniety jak reszta. */
  endsAt: string;
  timezone: string;
  /** Uzywany tylko, gdy zrodlo zapisuje w obcym systemie. */
  externalRegistrationUrl: string;
  include: CloneInclude;
  flags: CloneFlags;
  codeSuffix: string;
  /** Tekst pola liczbowego - walidowany, zanim trafi do ladunku. */
  crmTaskDueDays: string;
}

/** Klucze i18n powodow odrzucenia szkicu (`adminEventClone.issues.*`). */
export type EventCloneIssue =
  | "adminEventClone.issues.titles"
  | "adminEventClone.issues.titleLength"
  | "adminEventClone.issues.startsAt"
  | "adminEventClone.issues.endsAt"
  | "adminEventClone.issues.timezone"
  | "adminEventClone.issues.slug"
  | "adminEventClone.issues.externalUrl"
  | "adminEventClone.issues.externalUrlInvalid"
  | "adminEventClone.issues.codeSuffix"
  | "adminEventClone.issues.dueDays";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ta sama regula co `events.slug` (CHECK) i `admin_event_clone`. */
const SLUG_RE = /^[a-z0-9-]{3,120}$/;
/** Ta sama regula co `_event_clone_settings` (po `upper`). */
const CODE_SUFFIX_RE = /^[A-Z0-9_-]{1,20}$/;
/** Ta sama regula co `admin_event_clone` (`^https://[^[:space:]]+$`, 2048). */
const EXTERNAL_URL_RE = /^https:\/\/\S+$/i;
const TITLE_MAX = 200;

/**
 * Stan adresu `/admin/events/new`: `?from=<uuid>` wlacza tryb kopii. Wszystko
 * inne jest odrzucane - adres przeklejony z literowka nie moze poleciec do RPC
 * jako nie-UUID (odmowa `22P02` nic nie mowi organizatorowi).
 *
 * KLUCZ `from` JEST ZAWSZE W WYNIKU (takze jako `undefined`). Router scala
 * search dziecka z search rodzica, a korzen nie waliduje niczego - pominiety
 * klucz przepuscilby wiec surowe `?from=nie-uuid` do komponentu. Jawny
 * `undefined` nadpisuje surowa wartosc.
 */
export function parseCloneSearch(search: Record<string, unknown>): { from: string | undefined } {
  const from = typeof search.from === "string" ? search.from.trim() : "";
  return { from: UUID_RE.test(from) ? from.toLowerCase() : undefined };
}

/**
 * Tytul kolejnej edycji: kazdy rok (1900-2099) w tytule o jeden wyzej.
 * "Kongres 2026" -> "Kongres 2027", "Forum 2025/2026" -> "Forum 2026/2027".
 * Tytul bez roku zostaje bez zmian - lepiej nic nie dopisac, niz zgadnac zle.
 */
export function suggestEditionTitle(title: string): string {
  return title.replace(/\b(19|20)\d{2}\b/g, (year) => String(Number(year) + 1));
}

/** Szkic startowy z podgladu zrodla: tytuly z podbitym rokiem, termin z bazy. */
export function cloneDraftFromPreview(preview: EventClonePreview): EventCloneDraft {
  const startsAt = preview.target.suggestedStartsAt ?? "";
  return {
    titlePl: suggestEditionTitle(preview.source.titlePl),
    titleEn: suggestEditionTitle(preview.source.titleEn),
    slug: "",
    startsAt,
    endsAt: "",
    timezone: preview.source.timezone,
    externalRegistrationUrl: preview.source.externalRegistrationUrl ?? "",
    include: { ...preview.include },
    flags: {
      includeCancelledSessions: preview.options.includeCancelledSessions,
      sessionsAsDraft: preview.options.sessionsAsDraft,
      sponsorsUnpublished: preview.options.sponsorsUnpublished,
      keepAccessCodes: preview.options.keepAccessCodes,
      refreshSponsorSnapshots: preview.options.refreshSponsorSnapshots,
      crmRenewalTasks: preview.options.crmRenewalTasks,
      cfpReviewers: preview.options.cfpReviewers,
    },
    // Przyrostek z roku nowej edycji: kod `VIP` staje sie `VIP-2027`.
    codeSuffix: startsAt === "" ? "" : `-${startsAt.slice(0, 4)}`,
    crmTaskDueDays: String(preview.options.crmTaskDueDays),
  };
}

function parseDueDays(raw: string): number | null {
  const value = raw.trim();
  if (!/^\d{1,3}$/.test(value)) return null;
  const days = Number(value);
  return days >= 1 && days <= 365 ? days : null;
}

/**
 * Klucz i18n pierwszego powodu, dla ktorego szkic nie przejdzie, albo `null`.
 * `externalMode` = zrodlo zapisuje w obcym systemie (wtedy adres jest wymagany).
 */
export function eventCloneIssue(draft: EventCloneDraft, externalMode: boolean): EventCloneIssue | null {
  const titlePl = draft.titlePl.trim();
  const titleEn = draft.titleEn.trim();
  if (titlePl === "" || titleEn === "") return "adminEventClone.issues.titles";
  if (titlePl.length > TITLE_MAX || titleEn.length > TITLE_MAX) {
    return "adminEventClone.issues.titleLength";
  }
  const starts = Date.parse(draft.startsAt);
  if (Number.isNaN(starts)) return "adminEventClone.issues.startsAt";
  if (draft.endsAt.trim() !== "") {
    const ends = Date.parse(draft.endsAt);
    if (Number.isNaN(ends) || ends <= starts) return "adminEventClone.issues.endsAt";
  }
  if (draft.timezone.trim() === "") return "adminEventClone.issues.timezone";
  const slug = draft.slug.trim().toLowerCase();
  if (slug !== "" && !SLUG_RE.test(slug)) return "adminEventClone.issues.slug";
  if (externalMode) {
    const url = draft.externalRegistrationUrl.trim();
    if (url === "") return "adminEventClone.issues.externalUrl";
    if (!EXTERNAL_URL_RE.test(url) || url.length > 2048) {
      return "adminEventClone.issues.externalUrlInvalid";
    }
  }
  if (draft.include.codes && !CODE_SUFFIX_RE.test(draft.codeSuffix.trim().toUpperCase())) {
    return "adminEventClone.issues.codeSuffix";
  }
  if (draft.flags.crmRenewalTasks && parseDueDays(draft.crmTaskDueDays) === null) {
    return "adminEventClone.issues.dueDays";
  }
  return null;
}

/** To, co formularz musi wiedziec o zrodle, zeby zlozyc ladunek. */
export interface CloneSourceContext {
  id: string;
  /** Zrodlo zapisuje w obcym systemie - adres zapisow jest wymagany. */
  externalMode: boolean;
  externalUrl: string | null;
}

export function cloneSourceContext(preview: EventClonePreview): CloneSourceContext {
  return {
    id: preview.source.id,
    externalMode: preview.source.registrationMode === "external",
    externalUrl: preview.source.externalRegistrationUrl,
  };
}

/**
 * Szkic -> wejscie RPC. Puste pola nie jada (baza bierze wartosc zrodla albo
 * domyslna). Adres zapisow zewnetrznych jedzie TYLKO, gdy organizator go
 * zmienil - niezmieniony adres to "kopiuj adres zrodla", a wtedy baza
 * slusznie ostrzega, ze prowadzi on do poprzedniej edycji. Niepoprawny termin
 * zadan i przyrostek dostaja wartosc neutralna - podglad nie odmawia przez
 * nie, a klon ich nie dostanie, bo formularz nie wysle szkicu z
 * `eventCloneIssue !== null`.
 */
export function cloneDraftToInput(
  source: CloneSourceContext,
  draft: EventCloneDraft,
  idempotencyKey?: string,
): EventCloneInput {
  const suffix = draft.codeSuffix.trim().toUpperCase();
  const slug = draft.slug.trim().toLowerCase();
  const endsAt = draft.endsAt.trim();
  const startsAt = draft.startsAt.trim();
  const timezone = draft.timezone.trim();
  const url = draft.externalRegistrationUrl.trim();
  const sendUrl = source.externalMode && url !== (source.externalUrl ?? "");
  return {
    sourceEventId: source.id,
    titlePl: draft.titlePl.trim(),
    titleEn: draft.titleEn.trim(),
    ...(startsAt === "" ? {} : { startsAt }),
    ...(endsAt === "" ? {} : { endsAt }),
    ...(timezone === "" ? {} : { timezone }),
    ...(slug === "" ? {} : { slug }),
    ...(sendUrl ? { externalRegistrationUrl: url } : {}),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    include: { ...draft.include },
    options: {
      ...draft.flags,
      codeSuffix: CODE_SUFFIX_RE.test(suffix) ? suffix : null,
      crmTaskDueDays: parseDueDays(draft.crmTaskDueDays) ?? 30,
    },
  };
}
