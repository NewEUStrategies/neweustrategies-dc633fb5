// Czyste reguły ekranów NABORU PRELEGENTÓW: strony listy, liczby ocen,
// odpowiedzi na pytania, stan maila o decyzji, dozwolone przyciski.
//
// DLACZEGO OSOBNO OD KOMPONENTÓW. Te rachunki czytają i panel organizatora,
// i panel prelegenta, i panel recenzenta; w JSX-ie rozjechałyby się przy
// pierwszej poprawce, a tu każda gałąź ma test bez renderu.
//
// PRZYCISKI WYNIKAJĄ ZE STANU WIERSZA - lustro przejść z migracji
// `20260926100000_event_cfp.sql`. Lepiej nie pokazać przycisku, niż pokazać
// go i przegrać z odmową bazy, której treść nic prelegentowi nie mówi.
import {
  CFP_DECIDABLE_STATUSES,
  CFP_NOTICES,
  type CfpFieldType,
  type CfpNotice,
  type CfpSubmissionStatus,
} from "@/lib/events/cfpEnums";
import type { CfpChoiceOption } from "@/lib/events/cfpSurface";
import { uiLocale } from "@/lib/i18n/format";

/** Liczba stron listy (co najmniej jedna - pusta lista też ma „stronę 1 z 1"). */
export function cfpPageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Zakres wierszy strony `page` (0-based) do napisu „21-40 z 57". */
export function cfpPageRange(
  page: number,
  pageSize: number,
  total: number,
): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  const from = page * pageSize + 1;
  return { from, to: Math.min(total, from + pageSize - 1) };
}

/** Średnia z jedną cyfrą po przecinku w konwencji języka; brak = `null`. */
export function formatCfpScore(value: number | null, lang: "pl" | "en"): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat(uiLocale(lang), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

/** Czy organizator może jeszcze zmienić decyzję albo przyjąć zgłoszenie. */
export function isCfpDecidable(status: CfpSubmissionStatus): boolean {
  return CFP_DECIDABLE_STATUSES.includes(status);
}

/** Stan zgłoszenia, o którym idzie mail do prelegenta; inaczej `null`. */
export function cfpNoticeFor(status: CfpSubmissionStatus): CfpNotice | null {
  return (CFP_NOTICES as readonly string[]).includes(status) ? (status as CfpNotice) : null;
}

export type CfpNotifyState = "notApplicable" | "upToDate" | "failed" | "pending";

/**
 * Co panel mówi o mailu do prelegenta. „Aktualny" tylko wtedy, gdy ostatni
 * wysłany mail dotyczył OBECNEGO stanu i wyszedł po ostatniej decyzji - zmiana
 * decyzji po wysyłce wraca do „czeka".
 */
export function cfpNotifyState(input: {
  status: CfpSubmissionStatus;
  notifiedStatus: string | null;
  notifiedAt: string | null;
  notifyError: string | null;
  decidedAt: string | null;
}): CfpNotifyState {
  const notice = cfpNoticeFor(input.status);
  if (notice === null) return "notApplicable";
  if (input.notifyError !== null) return "failed";
  if (input.notifiedStatus !== notice || input.notifiedAt === null) return "pending";
  if (input.decidedAt !== null && Date.parse(input.notifiedAt) < Date.parse(input.decidedAt)) {
    return "pending";
  }
  return "upToDate";
}

// ------------------------------------------------------------- prelegent

/** Szkic i prośba o zmiany dają się edytować (lustro `event_cfp_submission_save`). */
export function isCfpEditable(status: CfpSubmissionStatus): boolean {
  return status === "draft" || status === "changes_requested";
}

/** Wycofać można wszystko poza stanami końcowymi (szkic = usunięcie). */
export function isCfpWithdrawable(status: CfpSubmissionStatus): boolean {
  return !["withdrawn", "rejected", "declined"].includes(status);
}

/** Odpowiedź na przyjęcie: tylko przyjęte (potwierdzić albo zrezygnować). */
export function isCfpRespondable(status: CfpSubmissionStatus): boolean {
  return status === "accepted";
}

/** Liczy się do limitu na osobę (lustro `limit_reached` w bazie). */
export function countsTowardsCfpLimit(status: CfpSubmissionStatus): boolean {
  return status !== "withdrawn";
}

// ---------------------------------------------------------- odpowiedzi

export type CfpAnswerDisplay =
  | { kind: "empty" }
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "text"; value: string }
  | { kind: "url"; value: string }
  | { kind: "list"; values: string[] };

function optionLabel(
  options: readonly CfpChoiceOption[],
  value: string,
  lang: "pl" | "en",
): string {
  const found = options.find((option) => option.value === value);
  if (found === undefined) return value;
  return (lang === "en" ? found.labelEn || found.labelPl : found.labelPl || found.labelEn) || value;
}

/** Odpowiedź z `answers` -> postać do wyświetlenia (etykiety opcji w języku UI). */
export function cfpAnswerDisplay(
  field: { fieldType: CfpFieldType; options: readonly CfpChoiceOption[] },
  value: unknown,
  lang: "pl" | "en",
): CfpAnswerDisplay {
  if (value === undefined || value === null || value === "") return { kind: "empty" };
  switch (field.fieldType) {
    case "checkbox":
      return value === true || value === "true" ? { kind: "yes" } : { kind: "no" };
    case "multiselect": {
      const values = Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : [];
      return values.length === 0
        ? { kind: "empty" }
        : { kind: "list", values: values.map((v) => optionLabel(field.options, v, lang)) };
    }
    case "select":
      return typeof value === "string"
        ? { kind: "text", value: optionLabel(field.options, value, lang) }
        : { kind: "empty" };
    case "url":
      return typeof value === "string" && /^https:\/\//i.test(value)
        ? { kind: "url", value }
        : { kind: "text", value: String(value) };
    default:
      return { kind: "text", value: typeof value === "string" ? value : String(value) };
  }
}

// ------------------------------------------------------ wynik wysyłki maila

/** Wynik funkcji serwerowej maila -> komunikat panelu (wysłano / pominięto / błąd). */
export function cfpNotifyFeedback(
  result: { ok: true; skipped?: string } | { ok: false; error: string },
): "sent" | "skipped" | "failed" {
  if (!result.ok) return "failed";
  return result.skipped === undefined || result.skipped === "duplicate" ? "sent" : "skipped";
}

// ------------------------------------------------------ plakietka stanu

/**
 * Tonacja plakietki stanu (`CfpStatusBadge`) z tokenów wariantów `Badge`:
 * przyjęte i potwierdzone = główny, odrzucone = destrukcyjny, w toku =
 * drugorzędny, stany bez dalszych kroków = obrys.
 */
export const CFP_STATUS_VARIANT: Record<
  CfpSubmissionStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "outline",
  submitted: "secondary",
  under_review: "secondary",
  changes_requested: "secondary",
  accepted: "default",
  waitlisted: "outline",
  rejected: "destructive",
  withdrawn: "outline",
  confirmed: "default",
  declined: "outline",
};
