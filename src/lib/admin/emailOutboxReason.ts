// Powód w Skrzynce wysyłek (`email_send_log.error_message`) -> klucz etykiety
// PL/EN (I9, Z-I9c-02).
//
// DLACZEGO. Kolumna „Powód" wypisywała surowe kody, które piszą dren kolejki,
// bramka blokad i baza (`suppressed:hard_bounce`, `cancelled:account_deleted`,
// `skipped:exited:unsubscribed`) - redakcja nie wie, czy to awaria, czy
// zamierzone zatrzymanie (odbiorca wypisany, konto usunięte, zapis zakończony).
// Kod zostaje w podpowiedzi wiersza dla wsparcia; etykieta mówi, co się stało.
//
// ŹRÓDŁA KODÓW (parytet: `__tests__/emailOutboxReason.test.ts`):
//   - `suppressed` i `suppressed:<SuppressionReason>` - bramka blokad
//     (`suppressionSkipReason`, dren kolejki, wysyłka transakcyjna, kampanie;
//     kampania dopisuje `suppressed:unknown`, gdy blokada nie ma powodu);
//   - `cancelled:account_deleted` - anulowanie przy usunięciu konta
//     (`ACCOUNT_DELETED_CANCEL_REASON`, SQL 20261020160900);
//   - `skipped:*` - werdykt `email_queue_send_recheck` (najnowsza definicja):
//     brak zapisu, zapis zakończony (`skipped:exited:<JourneyExitReason>`),
//     werdykt zgody `_journey_marketing_consent`, konto usunięte, digest
//     wyłączony.
// Inne napisy (`rate_limited`, `http_<status>`, tekst dostawcy) zostają
// surowe - `null` = pokaż kod bez etykiety.
//
// Moduł czysty (bez słownika i bez stałych runtime innych modułów) - panel
// skrzynki ładuje go w swoim leniwym chunku.
import type { SuppressionReason } from "@/lib/email/suppressionPolicy";
import type { JourneyExitReason } from "@/lib/journeys/limits";

/** Powody blokady z etykietą (lustro `SuppressionReason`, kompletność - typ). */
const SUPPRESSION_KEYS: Readonly<Record<SuppressionReason, true>> = {
  hard_bounce: true,
  soft_bounce: true,
  complaint: true,
  manual: true,
  unsubscribe: true,
  invalid: true,
  blocked: true,
};

/** Powody wyjścia z zapisu (lustro `JOURNEY_EXIT_REASONS`, kompletność - typ). */
const EXIT_KEYS: Readonly<Record<JourneyExitReason, true>> = {
  completed: true,
  goal: true,
  exit_event: true,
  consent: true,
  unsubscribed: true,
  suppressed: true,
  manual: true,
  journey_archived: true,
  error: true,
  entry_filter: true,
  account_deleted: true,
};

/**
 * Pominięcia `skipped:<kod>` poza wyjściem z zapisu: werdykty
 * `email_queue_send_recheck` i `_journey_marketing_consent` (bez `ok`).
 */
export const OUTBOX_SKIP_CODES = [
  "enrollment_missing",
  "no_consent",
  "unsubscribed",
  "account_deleted",
  "digest_disabled",
] as const;
export type OutboxSkipCode = (typeof OUTBOX_SKIP_CODES)[number];

const SKIP_SET: ReadonlySet<string> = new Set(OUTBOX_SKIP_CODES);

/** Wszystkie powody blokady z etykietą - dla testu parytetu słownika. */
export const OUTBOX_SUPPRESSION_REASONS = Object.keys(SUPPRESSION_KEYS) as SuppressionReason[];
/** Wszystkie powody wyjścia z etykietą - dla testu parytetu z `JOURNEY_EXIT_REASONS`. */
export const OUTBOX_EXIT_REASONS = Object.keys(EXIT_KEYS) as JourneyExitReason[];

const has = <T extends string>(map: Readonly<Record<T, true>>, code: string): code is T =>
  Object.hasOwn(map, code);

/**
 * Klucz słownika (`adminOutbox.reason.*`) etykiety powodu z dziennika wysyłek;
 * `null` = kod bez etykiety (panel pokazuje go surowo).
 */
export function outboxReasonKey(code: string | null | undefined): string | null {
  const raw = (code ?? "").trim();
  if (!raw) return null;
  if (raw === "suppressed" || raw === "suppressed:unknown") {
    return "adminOutbox.reason.suppressed.generic";
  }
  if (raw.startsWith("suppressed:")) {
    const reason = raw.slice("suppressed:".length);
    return has(SUPPRESSION_KEYS, reason) ? `adminOutbox.reason.suppressed.${reason}` : null;
  }
  if (raw === "cancelled:account_deleted") {
    return "adminOutbox.reason.cancelledAccountDeleted";
  }
  if (raw.startsWith("skipped:exited:")) {
    const reason = raw.slice("skipped:exited:".length);
    // `unknown` - zapis wyszedł bez powodu (SQL: COALESCE(exit_reason, 'unknown')).
    if (reason === "unknown") return "adminOutbox.reason.exited.unknown";
    return has(EXIT_KEYS, reason) ? `adminOutbox.reason.exited.${reason}` : null;
  }
  if (raw.startsWith("skipped:")) {
    const reason = raw.slice("skipped:".length);
    return SKIP_SET.has(reason) ? `adminOutbox.reason.skipped.${reason}` : null;
  }
  return null;
}
