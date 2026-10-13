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
//
// TERMIN NOWEJ EDYCJI JEST ZEGAREM W JEJ STREFIE (klasa OPS-15). Pola niosa
// napis `YYYY-MM-DDTHH:mm` w strefie `timezone` z droplisty formularza, a nie
// w strefie przegladarki - tak jak kreator wydarzenia. Chwile liczy wspolny
// `lib/events/eventLocalInput.ts` (regula Postgresa dla luki i zakladki).
// Podpowiedz z bazy (`suggested_starts_at`) jest kotwica `savedTimes`:
// nietkniety poczatek jedzie do bazy dokladnie ta chwila (z sekundami).
//
// ZMIANA STREFY ZOSTAWIA GODZINE, a przelicza chwile - jak w kreatorze i jak
// w samym klonie: `admin_event_clone` przesuwa sesje, bilety i okna o roznice
// ZEGAROW LOKALNYCH (`_event_clone_shift`: czas lokalny w strefie zrodla
// + delta, czytany w strefie celu), a podpowiedz liczy jako „ta sama godzina
// lokalna rok pozniej" w strefie celu. „09:00" przeczytane w nowej strefie daje
// wiec edycje, w ktorej CALY program stoi o tych samych godzinach lokalnych.
// (Inaczej niz „Informacje ogolne" istniejacego wydarzenia, gdzie baza
// zaleznych terminow nie przesuwa - patrz `eventGeneralDraft.ts`.)
import {
  canonicalInstant,
  eventLocalInput,
  eventLocalInputToIso,
  type SavedInstants,
} from "@/lib/events/eventLocalInput";
import type {
  CloneFlags,
  CloneInclude,
  EventCloneInput,
  EventClonePreview,
} from "@/lib/events/eventCloneApi";

// Parser adresu `?from=` zyje w osobnym lisciu (`eventCloneSearch`): trasa
// `/admin/events/new` wola go w `validateSearch`, a ta czesc definicji trasy
// jedzie w chunku startowym - reszta regul formularza nie musi.
export { parseCloneSearch } from "@/lib/events/eventCloneSearch";

export interface EventCloneDraft {
  titlePl: string;
  titleEn: string;
  /** Pusty = adres z tytulu PL (liczy baza). */
  slug: string;
  /** `YYYY-MM-DDTHH:mm` w strefie `timezone` albo `""`. */
  startsAt: string;
  /** Jak `startsAt`; `""` = koniec przesuniety jak reszta. */
  endsAt: string;
  timezone: string;
  /** Chwila podpowiedzi z bazy, z ktorej powstal `startsAt` (kotwica nietknietego pola). */
  savedTimes: SavedInstants<"startsAt" | "endsAt">;
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

/** Ta sama regula co `events.slug` (CHECK) i `admin_event_clone`. */
const SLUG_RE = /^[a-z0-9-]{3,120}$/;
/** Ta sama regula co `_event_clone_settings` (po `upper`). */
const CODE_SUFFIX_RE = /^[A-Z0-9_-]{1,20}$/;
/** Ta sama regula co `admin_event_clone` (`^https://[^[:space:]]+$`, 2048). */
const EXTERNAL_URL_RE = /^https:\/\/\S+$/i;
const TITLE_MAX = 200;

/**
 * Tytul kolejnej edycji: kazdy rok (1900-2099) w tytule o jeden wyzej.
 * "Kongres 2026" -> "Kongres 2027", "Forum 2025/2026" -> "Forum 2026/2027".
 * Tytul bez roku zostaje bez zmian - lepiej nic nie dopisac, niz zgadnac zle.
 */
export function suggestEditionTitle(title: string): string {
  return title.replace(/\b(19|20)\d{2}\b/g, (year) => String(Number(year) + 1));
}

/**
 * Pole terminu -> chwila w UTC albo `null` (pole puste albo niepelne). Pole
 * zgodne z kotwica (w strefie szkicu) oddaje ja co do milisekundy.
 */
export function cloneDraftInstant(
  draft: EventCloneDraft,
  field: "startsAt" | "endsAt",
): string | null {
  return eventLocalInputToIso(draft[field], draft.timezone, draft.savedTimes[field] ?? null);
}

/** Szkic startowy z podgladu zrodla: tytuly z podbitym rokiem, termin z bazy. */
export function cloneDraftFromPreview(preview: EventClonePreview): EventCloneDraft {
  const suggested = canonicalInstant(preview.target.suggestedStartsAt);
  // Podpowiedz liczy baza w strefie zrodla (podglad zrodla nie podaje strefy
  // celu), wiec pole pokazuje ja jako zegar tej strefy.
  const startsAt = eventLocalInput(suggested, preview.source.timezone);
  return {
    titlePl: suggestEditionTitle(preview.source.titlePl),
    titleEn: suggestEditionTitle(preview.source.titleEn),
    slug: "",
    startsAt,
    endsAt: "",
    timezone: preview.source.timezone,
    savedTimes: { startsAt: suggested },
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
    // Przyrostek z roku nowej edycji (w jej strefie): kod `VIP` staje sie `VIP-2027`.
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
export function eventCloneIssue(
  draft: EventCloneDraft,
  externalMode: boolean,
): EventCloneIssue | null {
  const titlePl = draft.titlePl.trim();
  const titleEn = draft.titleEn.trim();
  if (titlePl === "" || titleEn === "") return "adminEventClone.issues.titles";
  if (titlePl.length > TITLE_MAX || titleEn.length > TITLE_MAX) {
    return "adminEventClone.issues.titleLength";
  }
  // Chwile w strefie nowej edycji - te same, ktore pojda do bazy. Porownujemy
  // CHWILE: w jesiennej zakladce 02:30 po 02:59 bywa pozniejsze.
  const startsIso = cloneDraftInstant(draft, "startsAt");
  if (startsIso === null) return "adminEventClone.issues.startsAt";
  const starts = Date.parse(startsIso);
  if (draft.endsAt.trim() !== "") {
    const endsIso = cloneDraftInstant(draft, "endsAt");
    if (endsIso === null || Date.parse(endsIso) <= starts) return "adminEventClone.issues.endsAt";
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
  // Chwile w strefie szkicu; pole puste albo niepelne nie jedzie (baza bierze
  // wtedy podpowiedz albo przesuwa koniec jak reszte).
  const endsAt = cloneDraftInstant(draft, "endsAt") ?? "";
  const startsAt = cloneDraftInstant(draft, "startsAt") ?? "";
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
