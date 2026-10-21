// Persony i scenariusze symulatora czytelnika (SPEC §2.2 `access`: „symulator
// czytelnika (5 person)").
//
// PERSONA = `PaywallViewer` (kontrakt S3), nie nowy model. Symulator podaje
// ją do TEGO SAMEGO komponentu `Paywall` co artykuł (`preview={{ viewer }}`),
// więc ściana w hubie i ściana u czytelnika to jeden kod - poprawka oferty
// widoczna w podglądzie jest poprawką w artykule.
//
// RANGI Z INWENTARZA, NIE Z GŁOWY. „Członek niższej warstwy" to najwyższa
// warstwa poniżej progu treści, „subskrybent" - najniższa warstwa, która próg
// spełnia; obie z listy warstw najemcy (`admin_revenue_access_inventory`).
// Brak takiej warstwy = persona niedostępna (z powodem), a nie zmyślona ranga.
//
// CZY PERSONA W OGÓLE ZOBACZY ŚCIANĘ. Dostęp liczy serwer
// (`has_content_access`); podgląd odtwarza tylko jego zarys, żeby nie
// pokazywać ściany komuś, kto przeszedłby przez bramkę: próg rangi →
// ranga ≥ próg; treść płatna bez progu → jakakolwiek płatna warstwa;
// „dla zalogowanych" → zalogowany; hasło → nikt (formularz hasła).
//
// MODUŁ CZYSTY (wyłącznie `import type`).
import type { ContentAccessRule } from "@/hooks/useContentAccess";
import type { PaywallViewer } from "@/lib/access/paywallOffer";
import type {
  AccessInventoryDto,
  AccessInventoryMode,
  AccessInventoryTier,
} from "@/lib/revenue/access/dto";

export const READER_PERSONAS = [
  "guest",
  "signedIn",
  "lowerRank",
  "subscriber",
  "orgMember",
] as const;
export type ReaderPersona = (typeof READER_PERSONAS)[number];

/** Scenariusz podglądu: kształt reguły z inwentarza (tryb i próg rangi). */
export interface ReaderScenario {
  id: string;
  mode: Exclude<AccessInventoryMode, "public">;
  minTierRank: number;
}

/** Scenariusz zastępczy, gdy żadna treść nie ma bramki - treść płatna bez progu. */
export const SAMPLE_SCENARIO: ReaderScenario = { id: "paid:0", mode: "paid", minTierRank: 0 };

/** Scenariusze z inwentarza: każda para (tryb, próg) z bramką, bez duplikatów. */
export function readerScenarios(inventory: AccessInventoryDto): ReaderScenario[] {
  const seen = new Map<string, ReaderScenario>();
  for (const row of inventory.rows) {
    if (row.mode === "public" || row.count === 0) continue;
    const id = `${row.mode}:${row.minTierRank}`;
    if (!seen.has(id)) seen.set(id, { id, mode: row.mode, minTierRank: row.minTierRank });
  }
  const order: Record<ReaderScenario["mode"], number> = { paid: 0, members: 1, password: 2 };
  return [...seen.values()].sort(
    (a, b) => order[a.mode] - order[b.mode] || a.minTierRank - b.minTierRank,
  );
}

/** Reguła podglądu - stały identyfikator, zero planów: ofertę dobiera `Paywall`. */
export function previewRule(scenario: ReaderScenario, teaser: string): ContentAccessRule {
  return {
    id: "revenue-hub-preview",
    entity_type: "post",
    entity_id: "00000000-0000-4000-8000-000000000000",
    mode: scenario.mode,
    plan_ids: [],
    one_time_price_cents: null,
    one_time_currency: null,
    teaser_pl: teaser,
    teaser_en: teaser,
    min_tier_rank: scenario.minTierRank,
    metering_policy: "inherit",
    has_password: scenario.mode === "password",
  };
}

function sortedTiers(tiers: readonly AccessInventoryTier[]): AccessInventoryTier[] {
  return [...tiers].filter((tier) => tier.active).sort((a, b) => a.rank - b.rank);
}

/**
 * Persona jako `PaywallViewer`; `null` = takiej persony nie da się zbudować
 * z warstw najemcy (np. brak warstwy poniżej progu).
 */
export function personaViewer(
  persona: ReaderPersona,
  scenario: ReaderScenario,
  tiers: readonly AccessInventoryTier[],
  orgName: string,
): PaywallViewer | null {
  const paid = sortedTiers(tiers).filter((tier) => tier.rank > 0);
  switch (persona) {
    case "guest":
      return { signedIn: false, tierRank: 0 };
    case "signedIn":
      return { signedIn: true, tierRank: 0 };
    case "orgMember":
      return { signedIn: true, tierRank: 0, org: { name: orgName } };
    case "lowerRank": {
      const below = paid.filter((tier) => tier.rank < scenario.minTierRank);
      const tier = below[below.length - 1];
      return tier ? { signedIn: true, tierRank: tier.rank, tierKey: tier.key } : null;
    }
    case "subscriber": {
      const tier = paid.find((t) => t.rank >= Math.max(scenario.minTierRank, 1));
      return tier ? { signedIn: true, tierRank: tier.rank, tierKey: tier.key } : null;
    }
  }
}

/** Zarys decyzji serwera: czy persona przechodzi przez bramkę (ściany nie widzi). */
export function personaHasAccess(viewer: PaywallViewer, scenario: ReaderScenario): boolean {
  if (scenario.mode === "password") return false;
  if (scenario.minTierRank > 0) return viewer.tierRank >= scenario.minTierRank;
  if (scenario.mode === "members") return viewer.signedIn;
  return viewer.tierRank > 0;
}
