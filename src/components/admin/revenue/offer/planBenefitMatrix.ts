// Model macierzy plan × benefit (SPEC §2.2 `offer`, konflikty P20).
//
// CO PORÓWNUJEMY. Karta cennika obiecuje benefity (`benefits[].capability_key`
// warstwy), a o dostępie decydują flagi warstwy (`features`) i bramki, które
// je czytają (`TIER_CAPABILITIES`, `isEnforcedCapability`). Konflikt P20 to:
//   * `broken`     - obietnica, której warstwa nie włącza (klient płaci za coś,
//                    czego nie dostanie);
//   * `decorative` - obietnica włączona, ale bez bramki w systemie (nic jej
//                    nie egzekwuje - dziś to tylko marketing).
// Ta sama definicja co reguła `catalog.promise_without_gate` (S7-A), więc
// macierz i Diagnostyka mówią o tych samych konfliktach.
//
// KOLUMNA = PLAN, KOMÓRKA = WARSTWA PLANU. Plan sprzedaje uprawnienia swojej
// warstwy; plan miesięczny i roczny tej samej warstwy mają identyczne
// komórki, ale konflikt liczymy RAZ na parę (warstwa, uprawnienie) - inaczej
// dwa plany jednej warstwy podwajałyby licznik.
//
// MODUŁ CZYSTY: rejestr uprawnień (`capabilities.ts`) i typy - bez Reacta.
import { TIER_CAPABILITIES, isEnforcedCapability } from "@/lib/billing/capabilities";

export type BenefitCell = "ok" | "broken" | "decorative" | "silent" | "none";

export interface MatrixTier {
  key: string;
  rank: number;
  /** Flagi `features` = true. */
  featureKeys: readonly string[];
  /** `benefits[].capability_key` - obietnice karty cennika. */
  capabilityKeys: readonly string[];
}

export interface MatrixPlan {
  planId: string;
  tierKey: string | null;
  interval: string;
  priceCents: number;
  currency: string;
  active: boolean;
  forSale: boolean;
}

export interface MatrixColumn {
  plan: MatrixPlan;
  /** Warstwa planu; `null` = plan bez warstwy (albo warstwa nieistniejąca). */
  tier: MatrixTier | null;
  cells: readonly BenefitCell[];
}

export interface PlanBenefitMatrixModel {
  /** Wiersze: uprawnienia w kolejności rejestru, potem spoza rejestru (alfabetycznie). */
  capabilities: readonly string[];
  columns: readonly MatrixColumn[];
  /** Konflikty P20 - raz na parę (warstwa, uprawnienie). */
  conflicts: number;
}

/** Komórka jednej warstwy dla jednego uprawnienia. */
export function benefitCell(tier: MatrixTier | null, capability: string): BenefitCell {
  if (tier === null) return "none";
  const promised = tier.capabilityKeys.includes(capability);
  const enabled = tier.featureKeys.includes(capability);
  if (promised && !enabled) return "broken";
  if (promised) return isEnforcedCapability(capability) ? "ok" : "decorative";
  return enabled ? "silent" : "none";
}

export function isConflict(cell: BenefitCell): boolean {
  return cell === "broken" || cell === "decorative";
}

const REGISTRY_ORDER: ReadonlyMap<string, number> = new Map(
  TIER_CAPABILITIES.map((c, index) => [c.key, index]),
);

/**
 * Macierz z aktywnych planów i warstw. Wiersz trafia do macierzy, gdy
 * jakakolwiek warstwa planu go obiecuje albo włącza - uprawnienie, którego
 * nikt nie sprzedaje, byłoby pustym wierszem.
 */
export function planBenefitMatrix(
  plans: readonly MatrixPlan[],
  tiers: readonly MatrixTier[],
): PlanBenefitMatrixModel {
  const byKey = new Map(tiers.map((tier) => [tier.key, tier]));
  const active = plans
    .filter((plan) => plan.active)
    .map((plan) => ({ plan, tier: plan.tierKey ? (byKey.get(plan.tierKey) ?? null) : null }))
    .sort(
      (a, b) =>
        (a.tier?.rank ?? Number.MAX_SAFE_INTEGER) - (b.tier?.rank ?? Number.MAX_SAFE_INTEGER) ||
        a.plan.currency.localeCompare(b.plan.currency) ||
        a.plan.priceCents - b.plan.priceCents,
    );

  const used = new Set<string>();
  for (const { tier } of active) {
    if (!tier) continue;
    for (const key of [...tier.featureKeys, ...tier.capabilityKeys]) used.add(key);
  }
  const capabilities = [...used].sort((a, b) => {
    const ra = REGISTRY_ORDER.get(a);
    const rb = REGISTRY_ORDER.get(b);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.localeCompare(b);
  });

  const conflictPairs = new Set<string>();
  const columns = active.map(({ plan, tier }) => {
    const cells = capabilities.map((capability) => benefitCell(tier, capability));
    cells.forEach((cell, index) => {
      if (tier && isConflict(cell)) conflictPairs.add(`${tier.key}\u0000${capabilities[index]}`);
    });
    return { plan, tier, cells };
  });

  return { capabilities, columns, conflicts: conflictPairs.size };
}

/** Okresy planu w słowniku zakładek; okres spoza listy panel pokazuje surowo. */
export const INTERVAL_KEY: Readonly<Record<string, string>> = {
  two_weeks: "adminRevenue.offer.interval.two_weeks",
  month: "adminRevenue.offer.interval.month",
  quarter: "adminRevenue.offer.interval.quarter",
  year: "adminRevenue.offer.interval.year",
  one_time: "adminRevenue.offer.interval.one_time",
};
