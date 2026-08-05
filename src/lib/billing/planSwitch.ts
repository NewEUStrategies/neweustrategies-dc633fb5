// Zestawienie ścieżek zmiany planu wyprowadzone z lookup_key (czytelnego
// identyfikatora ceny u operatora), a NIE z kwoty w bazie: kwota może się
// różnić po stronie operatora, natomiast lookup_key i ranga katalogu są
// stabilne między sandboxem a produkcją. Dzięki temu „wyżej/niżej" na stronie
// planu znaczy dokładnie to samo, co proracja liczona przy zmianie subskrypcji.
//
// Moduł czysty (bez zależności serwerowych i UI) - dzięki temu testowalny i
// współdzielony przez widok profilu oraz przyszłe ekrany sprzedażowe.
import {
  catalogEntryByPriceId,
  catalogPriceForPlan,
  planChangeDirection,
  type CatalogPriceEntry,
} from "@/lib/billing/catalog";
import type { AccessPlan } from "@/lib/billing/types";

export type PlanSwitchDirection = "upgrade" | "downgrade";

export interface PlanSwitchOption {
  plan: AccessPlan;
  /** Czytelny identyfikator ceny u operatora (Stripe `lookup_key`). */
  lookupKey: string;
  entry: CatalogPriceEntry;
  direction: PlanSwitchDirection;
}

export interface PlanSwitchBoardModel {
  /** lookup_key bieżącego planu - null, gdy brak subskrypcji lub planu w katalogu. */
  currentLookupKey: string | null;
  currentEntry: CatalogPriceEntry | null;
  upgrades: PlanSwitchOption[];
  downgrades: PlanSwitchOption[];
}

/** Plany rozliczane cyklicznie - jednorazowe zakupy nie są ścieżką zmiany. */
const RECURRING = new Set<AccessPlan["interval"]>(["two_weeks", "month", "quarter", "year"]);

/**
 * Dzieli aktywne plany na ścieżkę w górę i w dół względem bieżącego lookup_key.
 * Plany bez odpowiednika w katalogu cen są pomijane - bez lookup_key nie da się
 * ich kupić ani porównać rangą, więc pokazanie ich kończyłoby się błędem.
 */
export function buildPlanSwitchBoard(
  plans: readonly AccessPlan[],
  currentPlan: AccessPlan | null | undefined,
): PlanSwitchBoardModel {
  const currentEntry = currentPlan ? catalogPriceForPlan(currentPlan) : null;
  const currentLookupKey = currentEntry?.priceId ?? null;

  const upgrades: PlanSwitchOption[] = [];
  const downgrades: PlanSwitchOption[] = [];

  for (const plan of plans) {
    if (!plan.active || !RECURRING.has(plan.interval)) continue;
    const entry = catalogPriceForPlan(plan);
    if (!entry) continue;
    if (currentLookupKey && entry.priceId === currentLookupKey) continue;

    // Brak bieżącego planu = wszystko jest wejściem „w górę" (pierwszy zakup).
    const direction: PlanSwitchDirection = !currentLookupKey
      ? "upgrade"
      : planChangeDirection(currentLookupKey, entry.priceId) === "downgrade"
        ? "downgrade"
        : "upgrade";

    const option: PlanSwitchOption = { plan, lookupKey: entry.priceId, entry, direction };
    if (direction === "upgrade") upgrades.push(option);
    else downgrades.push(option);
  }

  upgrades.sort((a, b) => a.entry.rank - b.entry.rank);
  downgrades.sort((a, b) => b.entry.rank - a.entry.rank);

  return { currentLookupKey, currentEntry, upgrades, downgrades };
}

/** Czy dany lookup_key jest znany katalogowi (bezpieczeństwo wywołania zmiany). */
export function isKnownLookupKey(lookupKey: string | null | undefined): boolean {
  return catalogEntryByPriceId(lookupKey) !== null;
}
