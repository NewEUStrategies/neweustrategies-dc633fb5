// Uzgodnienie DAWNYCH anulowań za brak płatności - typy raportu i jego
// składanie (moduł izomorficzny: bez klienta bazy i bez SDK operatora).
//
// PO CO OSOBNY PLIK. Panel administracyjny przechodzi zadanie partiami
// (kursor po `subscriptions.id`) i musi skleić raporty kolejnych partii
// w jeden obraz - liczniki, zapisy, wiersze. Logika decyzji i zapisy żyją
// w `legacyNonPaymentReconcile.server.ts` (service_role + Stripe), a tu
// zostaje wyłącznie kształt danych wspólny dla serwera i przeglądarki, więc
// panel nie wciąga do paczki klienta niczego z warstwy serwerowej.
import type { StripeEnv } from "@/lib/stripe.server";

/** Symulacja (domyślnie, zero zapisów) albo jawne zastosowanie zmian. */
export type LegacyReconcileMode = "dry_run" | "apply";

/**
 * Decyzja dla jednej subskrypcji anulowanej przed regułą karencji.
 *
 * - `clamp`               - anulowanie za brak płatności, karencja trwa:
 *                           dostęp do min(koniec okresu, kotwica + karencja),
 * - `revoke`              - anulowanie za brak płatności, karencja już minęła:
 *                           brak dostępu (uprawnienie `canceled`),
 * - `already_clamped`     - uprawnienie już nie sięga dalej niż koniec karencji
 *                           (najwyżej brakowało kotwicy w wierszu subskrypcji),
 * - `voluntary`           - rezygnacja klienta (`cancellation_requested`) -
 *                           dostęp do końca okresu zostaje, bez zmian,
 * - `paid`                - powód mówi o braku płatności, ale bieżący okres
 *                           JEST opłacony (zaległa faktura zapłacona po
 *                           anulowaniu) - bez zmian,
 * - `no_evidence`         - operator nie podał powodu, a ostatnia faktura nie
 *                           dowodzi nieudanej płatności - bez zmian,
 * - `refunded`            - uprawnienie odebrane zwrotem (stan ostateczny),
 * - `stripe_missing`      - operator nie zna subskrypcji (`resource_missing`),
 * - `stripe_not_canceled` - u operatora subskrypcja NIE jest anulowana: rozjazd
 *                           stanu (naprawia go uzgadnianie), tu bez zmian,
 * - `error`               - odczyt u operatora albo zapis się nie powiódł.
 */
export type LegacyDecision =
  | "clamp"
  | "revoke"
  | "already_clamped"
  | "voluntary"
  | "paid"
  | "no_evidence"
  | "refunded"
  | "stripe_missing"
  | "stripe_not_canceled"
  | "error";

export const LEGACY_DECISIONS: readonly LegacyDecision[] = [
  "clamp",
  "revoke",
  "already_clamped",
  "voluntary",
  "paid",
  "no_evidence",
  "refunded",
  "stripe_missing",
  "stripe_not_canceled",
  "error",
];

/** Skąd wiemy, że to anulowanie za brak płatności. */
export type LegacyEvidence = "reason" | "invoice";

/**
 * Skąd wiemy, że bieżący okres został jednak opłacony: ostatnia faktura
 * u operatora jest zapłacona (`invoice`) albo baza zaksięgowała zapłatę nie
 * wcześniej niż początek okresu (`ledger`, `subscriptions.last_payment_at`).
 */
export type LegacyPaymentProof = "invoice" | "ledger";

export interface LegacyReconcileRow {
  /** Identyfikator subskrypcji u operatora (`external_ref` uprawnienia). */
  subscriptionId: string;
  tenantId: string;
  decision: LegacyDecision;
  evidence: LegacyEvidence | null;
  /** Dowód zapłaty za bieżący okres - tylko przy decyzji `paid`. */
  paymentProof: LegacyPaymentProof | null;
  /** `cancellation_details.reason` operatora (null = nie podał). */
  cancellationReason: string | null;
  /** Status ostatniej faktury u operatora. */
  invoiceStatus: string | null;
  /** Kotwica karencji (zapisana albo wyliczona teraz). */
  anchor: string | null;
  /** Najdalszy koniec aktywnego uprawnienia PRZED zmianą (null = bez końca). */
  accessUntilBefore: string | null;
  /** Koniec dostępu po regule karencji (tylko dla decyzji braku płatności). */
  accessUntilAfter: string | null;
  /** Czy organizacja planu Zespół traci dostęp (karencja minęła). */
  suspendTeam: boolean;
  /** Czy zmiany zostały zapisane (zawsze `false` w symulacji). */
  applied: boolean;
  error: string | null;
}

export interface LegacyReconcileWrites {
  /** Wiersze `subscriptions`, którym dopisano kotwicę karencji. */
  anchors: number;
  /** Wiersze `user_subscriptions` przycięte do końca karencji. */
  entitlements: number;
  /** Organizacje planu Zespół zawieszone po karencji. */
  teams: number;
}

export interface LegacyReconcileReport {
  environment: StripeEnv;
  mode: LegacyReconcileMode;
  /** Wiersze `subscriptions` (status `canceled`) przeczytane w tej partii. */
  scanned: number;
  /** Ile z nich miało jeszcze dostęp (albo zwrot) i dostało decyzję. */
  candidates: number;
  counts: Record<LegacyDecision, number>;
  writes: LegacyReconcileWrites;
  rows: LegacyReconcileRow[];
  /** Kursor następnej partii (`subscriptions.id` ostatniego wiersza). */
  nextCursor: string | null;
  done: boolean;
}

export function emptyLegacyCounts(): Record<LegacyDecision, number> {
  return Object.fromEntries(LEGACY_DECISIONS.map((d) => [d, 0])) as Record<LegacyDecision, number>;
}

/**
 * Skleja raport kolejnej partii z dotychczasowym. Kursor i `done` pochodzą
 * z partii PÓŹNIEJSZEJ - to ona mówi, gdzie zadanie stanęło.
 */
export function mergeLegacyReconcileReports(
  acc: LegacyReconcileReport | null,
  next: LegacyReconcileReport,
): LegacyReconcileReport {
  if (!acc) return next;
  const counts = emptyLegacyCounts();
  for (const decision of LEGACY_DECISIONS) {
    counts[decision] = (acc.counts[decision] ?? 0) + (next.counts[decision] ?? 0);
  }
  return {
    environment: next.environment,
    mode: next.mode,
    scanned: acc.scanned + next.scanned,
    candidates: acc.candidates + next.candidates,
    counts,
    writes: {
      anchors: acc.writes.anchors + next.writes.anchors,
      entitlements: acc.writes.entitlements + next.writes.entitlements,
      teams: acc.writes.teams + next.writes.teams,
    },
    rows: [...acc.rows, ...next.rows],
    nextCursor: next.nextCursor,
    done: next.done,
  };
}
