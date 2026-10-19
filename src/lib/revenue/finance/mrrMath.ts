// ARYTMETYKA MRR PO STRONIE TS - JEDNA NORMALIZACJA Z CENNIKIEM I Z SQL.
//
// DLACZEGO TEN PLIK NIE LICZY MIESIĘCY SAM. Normalizacja kwoty okresu do
// miesiąca istnieje już w `monthlyEquivalent` (subscriptionRepricing.ts) -
// z niej liczy się MRR podglądu przeceny v6.2 i framing ceny rocznej na
// /pricing. Druga kopia (np. „tydzień = 4,33 miesiąca") rozjechałaby się
// z nią i z lustrem SQL (`billing_months_per_interval`, migracja
// 20261020110000) przy pierwszej zmianie. Tu są wyłącznie złożenia:
// cykl z katalogu (`catalogRecurringFor`), kwota z wyceny kasy
// (`catalogPlanQuote`) i zaokrąglenie - wszystkie trzy wspólne z resztą kodu.
// Parytet z SQL: src/lib/billing/__tests__/billingCatalogSqlParity.test.ts.
//
// Moduł czysty (bez Reacta i bez sieci): czytają go parsery, testy i panel.
import {
  catalogPlanQuote,
  catalogRecurringFor,
  type CatalogPriceEntry,
} from "@/lib/billing/catalog";
import { monthlyEquivalent } from "@/lib/billing/subscriptionRepricing";

/** Cykl operatora (słownik Stripe) - wejście `monthlyEquivalent`. */
export interface MrrCycle {
  interval: "day" | "week" | "month" | "year";
  intervalCount: number;
}

/**
 * Cykl pozycji katalogu w słowniku operatora (`two_weeks` = tydzień × 2,
 * `quarter` = miesiąc × 3) albo `null` dla pozycji jednorazowej - ta sama
 * funkcja, z której synchronizacja zakłada cenę u operatora.
 */
export function cycleOfCatalogEntry(entry: CatalogPriceEntry): MrrCycle | null {
  const recurring = catalogRecurringFor(entry);
  if (!recurring) return null;
  return { interval: recurring.interval, intervalCount: recurring.interval_count };
}

/**
 * MRR kwoty jednego okresu w jednostkach drobnych - zaokrąglenie połówek
 * w górę (`Math.round`), tak jak `round(numeric)` w SQL dla kwot nieujemnych.
 */
export function mrrMinorFromAmount(amountMinor: number, cycle: MrrCycle): number {
  return Math.round(monthlyEquivalent(amountMinor, cycle));
}

/** Plan najemcy w kształcie, jakiego potrzebuje wycena kasy. */
export interface CatalogPlanInput {
  tier_key: string | null;
  interval: string | null;
  price_cents: number | null;
  volume_threshold_seats?: number | null;
  volume_price_cents?: number | null;
}

/**
 * MRR z KATALOGU najemcy (D-05: podstawa `catalog`) - ta sama wycena co kasa
 * (`catalogPlanQuote`: miejsca tylko dla planu za miejsce, próg wolumenowy),
 * rabat na okres odjęty, ale nigdy poniżej zera. `null` = brak pary w
 * katalogu albo pozycja jednorazowa (brak cyklu - brak MRR, nie zero).
 */
export function catalogMrrMinor(
  plan: CatalogPlanInput,
  seats: number,
  discountMinor = 0,
): number | null {
  const quote = catalogPlanQuote(plan, seats);
  if (!quote) return null;
  const cycle = cycleOfCatalogEntry(quote.entry);
  if (!cycle) return null;
  return mrrMinorFromAmount(Math.max(quote.amountCents - Math.max(discountMinor, 0), 0), cycle);
}

/** Migawka kwoty operatora na wierszu subskrypcji (podstawa `provider`). */
export interface ProviderPriceSnapshot {
  unitAmountMinor: number;
  quantity: number;
  discountMinorPerPeriod: number;
  /** ISO; `null` = rabat bez końca. */
  discountEndsAt: string | null;
}

/**
 * MRR z migawki operatora: cena jednostkowa × ilość − rabat, dopóki trwa.
 * Ta sama reguła co `subscription_mrr_minor` w SQL (ilość co najmniej 1).
 */
export function providerMrrMinor(
  snapshot: ProviderPriceSnapshot,
  entry: CatalogPriceEntry,
  at: Date = new Date(),
): number | null {
  const cycle = cycleOfCatalogEntry(entry);
  if (!cycle) return null;
  const qty = Math.max(Math.trunc(snapshot.quantity) || 1, 1);
  const discountActive =
    snapshot.discountMinorPerPeriod > 0 &&
    (snapshot.discountEndsAt === null || Date.parse(snapshot.discountEndsAt) > at.getTime());
  const amount = Math.max(
    snapshot.unitAmountMinor * qty - (discountActive ? snapshot.discountMinorPerPeriod : 0),
    0,
  );
  return mrrMinorFromAmount(amount, cycle);
}

// ── Most MRR ────────────────────────────────────────────────────────────────

/** Tolerancja uzgodnienia mostu: 0,5 % (SPEC §8.3, reguła `data_quality.ledger_drift`). */
export const BRIDGE_TOLERANCE = 0.005;

/** Składniki mostu jednej waluty (kwoty ze znakiem, jednostki drobne). */
export interface BridgeParts {
  startMinor: number;
  openingMinor: number;
  newMinor: number;
  expansionMinor: number;
  reactivationMinor: number;
  contractionMinor: number;
  churnMinor: number;
  endMinor: number;
}

/**
 * Rozjazd mostu: koniec − (start + otwarcie + Σ ruchów). W poprawnej księdze
 * 0 z konstrukcji (SQL liczy oba końce z tych samych ruchów); różny od zera
 * znaczy rozjazd kontraktu albo odczyt dwóch różnych chwil.
 */
export function bridgeResidualMinor(parts: BridgeParts): number {
  return (
    parts.endMinor -
    (parts.startMinor +
      parts.openingMinor +
      parts.newMinor +
      parts.expansionMinor +
      parts.reactivationMinor +
      parts.contractionMinor +
      parts.churnMinor)
  );
}

/**
 * Czy most się domyka w tolerancji ±0,5 % (względem większego z końców; przy
 * obu końcach zerowych dopuszczalne jest wyłącznie zero).
 */
export function bridgeReconciles(parts: BridgeParts, tolerance = BRIDGE_TOLERANCE): boolean {
  const residual = Math.abs(bridgeResidualMinor(parts));
  const scale = Math.max(Math.abs(parts.endMinor), Math.abs(parts.startMinor + parts.openingMinor));
  if (scale === 0) return residual === 0;
  return residual <= scale * tolerance;
}

/** Nowe MRR netto bez salda otwarcia (backfill nie jest sprzedażą). */
export function netNewMrrMinor(parts: BridgeParts): number {
  return (
    parts.newMinor +
    parts.expansionMinor +
    parts.reactivationMinor +
    parts.contractionMinor +
    parts.churnMinor
  );
}
