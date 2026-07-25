// Reputacja nadawcy - czysta logika progów i wskaźników.
//
// Izomorficzny moduł (bez importów serwerowych): tych samych liczb używa
// preflight wysyłki kampanii na serwerze i panel dostarczalności w przeglądarce,
// więc admin widzi DOKŁADNIE ten wskaźnik, który zablokuje mu wysyłkę.
//
// Progi pochodzą z wytycznych Google dla nadawców masowych (Email sender
// guidelines, sekcja "Spam rate"): utrzymuj wskaźnik zgłoszeń spamu poniżej
// 0,30% i NIGDY nie osiągaj tej wartości; docelowo poniżej 0,10%. Wskaźnik
// liczy się na wiadomościach DOSTARCZONYCH, dlatego mianownikiem jest
// `delivered` (z fallbackiem na `sent`, gdy webhook 'delivered' jest wyłączony
// - wtedy mianownik jest mniejszy, więc wskaźnik konserwatywnie wyższy).
//
// Progi odbić nie są narzucone przez Google formalnie, ale utrzymanie twardych
// odbić poniżej 2% to warunek pozostania poza filtrami reputacyjnymi u Microsoftu
// i Yahoo; 5% traktujemy jak stan krytyczny.

/** Docelowy wskaźnik skarg (0,10%) - poniżej tej wartości jest "zdrowo". */
export const SPAM_RATE_TARGET = 0.001;
/** Twardy limit Google (0,30%) - osiągnięcie go oznacza filtrowanie domeny. */
export const SPAM_RATE_LIMIT = 0.003;
/** Docelowy wskaźnik odbić (2%). */
export const BOUNCE_RATE_TARGET = 0.02;
/** Krytyczny wskaźnik odbić (5%). */
export const BOUNCE_RATE_LIMIT = 0.05;

/**
 * Minimalna próbka, przy której wskaźnik w ogóle coś znaczy. Jedna skarga na
 * 20 wysyłek to 5%, ale statystycznie nic nie mówi - poniżej tej granicy
 * pokazujemy liczby, lecz nie eskalujemy statusu i nie blokujemy wysyłki.
 */
export const MIN_SAMPLE_FOR_STATUS = 200;
/** Próbka wymagana, by wskaźnik mógł ZABLOKOWAĆ wysyłkę kampanii. */
export const MIN_SAMPLE_FOR_GATE = 500;

export type ReputationStatus = "healthy" | "watch" | "critical" | "insufficient_data";

export interface DeliverabilityCounts {
  sent: number;
  delivered: number;
  bounced: number;
  hardBounced: number;
  softBounced: number;
  complained: number;
  failed: number;
  delayed: number;
  suppressedSends: number;
  activeSuppressions: number;
}

export interface ReputationMetric {
  /** Udział w przedziale 0-1 (nie w procentach). */
  rate: number;
  numerator: number;
  denominator: number;
  status: ReputationStatus;
  target: number;
  limit: number;
}

export interface ReputationSummary {
  complaint: ReputationMetric;
  bounce: ReputationMetric;
  hardBounce: ReputationMetric;
  /** Udział dostarczonych w zaakceptowanych (0-1); 0 gdy brak danych. */
  deliveryRate: number;
  /** Najgorszy ze statusów składowych. */
  overall: ReputationStatus;
  /** Czy wskaźniki uzasadniają zablokowanie kolejnej wysyłki. */
  blocksSending: boolean;
  /** Klucze i18n powodów blokady (adminNewsletter.deliverability.gate.*). */
  blockReasons: readonly ("complaint_rate" | "hard_bounce_rate")[];
}

export const EMPTY_COUNTS: DeliverabilityCounts = {
  sent: 0,
  delivered: 0,
  bounced: 0,
  hardBounced: 0,
  softBounced: 0,
  complained: 0,
  failed: 0,
  delayed: 0,
  suppressedSends: 0,
  activeSuppressions: 0,
};

/** Iloraz odporny na zero/NaN/wartości ujemne. */
export function safeRate(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  if (denominator <= 0) return 0;
  return Math.max(0, numerator) / denominator;
}

function statusFor(
  rate: number,
  denominator: number,
  target: number,
  limit: number,
): ReputationStatus {
  if (denominator < MIN_SAMPLE_FOR_STATUS) return "insufficient_data";
  if (rate >= limit) return "critical";
  if (rate >= target) return "watch";
  return "healthy";
}

function metric(
  numerator: number,
  denominator: number,
  target: number,
  limit: number,
): ReputationMetric {
  const rate = safeRate(numerator, denominator);
  return {
    rate,
    numerator: Math.max(0, numerator),
    denominator: Math.max(0, denominator),
    status: statusFor(rate, denominator, target, limit),
    target,
    limit,
  };
}

const SEVERITY: Record<ReputationStatus, number> = {
  insufficient_data: 0,
  healthy: 1,
  watch: 2,
  critical: 3,
};

/** Zwraca gorszy z dwóch statusów (insufficient_data nigdy nie wygrywa z realnym). */
export function worseStatus(a: ReputationStatus, b: ReputationStatus): ReputationStatus {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

/**
 * Mianownik wskaźnika skarg: liczba wiadomości DOSTARCZONYCH. Gdy dostawca nie
 * raportuje dostarczeń (webhook wyłączony), schodzimy na zaakceptowane wysyłki
 * pomniejszone o odbicia - wskaźnik pozostaje konserwatywny.
 */
export function deliveredBase(counts: DeliverabilityCounts): number {
  if (counts.delivered > 0) return counts.delivered;
  return Math.max(0, counts.sent - counts.bounced);
}

export function computeReputation(counts: DeliverabilityCounts): ReputationSummary {
  const base = deliveredBase(counts);
  const complaint = metric(counts.complained, base, SPAM_RATE_TARGET, SPAM_RATE_LIMIT);
  const bounce = metric(counts.bounced, counts.sent, BOUNCE_RATE_TARGET, BOUNCE_RATE_LIMIT);
  const hardBounce = metric(counts.hardBounced, counts.sent, BOUNCE_RATE_TARGET, BOUNCE_RATE_LIMIT);

  const blockReasons: ("complaint_rate" | "hard_bounce_rate")[] = [];
  if (complaint.denominator >= MIN_SAMPLE_FOR_GATE && complaint.rate >= SPAM_RATE_LIMIT) {
    blockReasons.push("complaint_rate");
  }
  if (hardBounce.denominator >= MIN_SAMPLE_FOR_GATE && hardBounce.rate >= BOUNCE_RATE_LIMIT) {
    blockReasons.push("hard_bounce_rate");
  }

  return {
    complaint,
    bounce,
    hardBounce,
    deliveryRate: safeRate(counts.delivered, counts.sent),
    // Bez wartości początkowej: seed "healthy" pokazywałby zielony status
    // tenantowi, który nie ma jeszcze ŻADNYCH danych - a to nie to samo.
    overall: [complaint.status, bounce.status, hardBounce.status].reduce(worseStatus),
    blocksSending: blockReasons.length > 0,
    blockReasons,
  };
}

/**
 * Formatuje udział jako procent z sensowną liczbą miejsc: przy progach rzędu
 * 0,1% zaokrąglenie do jednego miejsca zjadałoby całą informację.
 */
export function formatRate(rate: number, locale: string): string {
  const pct = Math.max(0, rate) * 100;
  const digits = pct === 0 ? 0 : pct < 0.1 ? 3 : pct < 1 ? 2 : 1;
  return `${pct.toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}
