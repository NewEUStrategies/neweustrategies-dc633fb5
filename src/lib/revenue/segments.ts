// SEGMENT DANYCH PRZYCHODU - lustro SQL `revenue_segment_of_tier(text)`
// (migracja 20261020090500). Ruch MRR, migawka dzienna i dane wejściowe niosą
// segment wyliczony z `tier_key` W BAZIE; panel liczy ten sam podział dla
// etykiet, filtrów i podpowiedzi. Dwie definicje są nieuniknione (SQL liczy
// historię, TS opisuje ją w UI), więc pilnuje ich test `segmentsParity.test.ts`
// - zmiana mapy to jedna linia tu i jedna w SQL, inaczej CI jest czerwone.
//
// Warstwy spoza mapy (czytelnik, wspierający, NGO, rada, partnerzy, krąg,
// jednorazowy Decision Lab) wpadają do `other` ŚWIADOMIE: SPEC N6 liczy
// segmenty z ceny planu, a partnerzy instytucjonalni mają umowy indywidualne
// - wpisanie ich do `b2b_institution` zawyżyłoby ARPA segmentu B2B.
import type { TierKey } from "@/lib/billing/tierRanks";

/** Segmenty danych - wartości CHECK `mrr_movements.segment`. */
export const REVENUE_DATA_SEGMENTS = [
  "b2c_individual",
  "b2c_reduced",
  "b2b_institution",
  "other",
] as const;
export type RevenueDataSegment = (typeof REVENUE_DATA_SEGMENTS)[number];

/**
 * Warstwy przypisane do segmentu innego niż `other`. Klucze spoza mapy
 * (także nieznane katalogowi) to `other` - tak samo jak `ELSE 'other'` w SQL.
 */
export const REVENUE_SEGMENT_BY_TIER: Readonly<
  Partial<Record<TierKey, Exclude<RevenueDataSegment, "other">>>
> = {
  student: "b2c_reduced",
  educator: "b2c_reduced",
  member: "b2c_individual",
  pro: "b2c_individual",
  team: "b2b_institution",
  business: "b2b_institution",
  corporate: "b2b_institution",
};

/** Segment warstwy; `null`/nieznany klucz → `other` (jak SQL). */
export function revenueSegmentOfTier(tierKey: string | null | undefined): RevenueDataSegment {
  if (!tierKey || !Object.hasOwn(REVENUE_SEGMENT_BY_TIER, tierKey)) return "other";
  return REVENUE_SEGMENT_BY_TIER[tierKey as TierKey] ?? "other";
}
