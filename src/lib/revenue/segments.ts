// SEGMENT DANYCH PRZYCHODU - lustro SQL `revenue_segment_of_tier(text)`
// (najnowsza definicja: migracja 20261020160000, I9b). Ruch MRR, migawka
// dzienna i dane wejściowe niosą segment wyliczony z `tier_key` W BAZIE;
// panel liczy ten sam podział dla etykiet, filtrów i podpowiedzi. Dwie
// definicje są nieuniknione (SQL liczy historię, TS opisuje ją w UI), więc
// pilnuje ich test `segmentsParity.test.ts` - zmiana mapy to jedna linia tu
// i jedna w SQL (nowa migracja), inaczej CI jest czerwone.
//
// REGUŁA (decyzja właściciela 2026-10-20, Z-01): segment wynika z TYPU
// KLIENTA, nie z ceny planu.
//   * konto organizacyjne (flaga `corporate_seats` albo umowa instytucjonalna
//     lub firmowa) -> `b2b_institution`: Zespół, Partner Biznesowy,
//     Enterprise, partnerzy instytucjonalni, Krąg Założycieli i NGO;
//   * płatna cykliczna subskrypcja osoby po cenie katalogowej ->
//     `b2c_individual`: Członek, Członek Pro;
//   * płatna cykliczna subskrypcja osoby w stawce ulgowej -> `b2c_reduced`:
//     student, kadra akademicka;
//   * bezpłatne, grzecznościowe, jednorazowe i bez planu -> `other`:
//     czytelnik, wspierający (status po darowiźnie), Rada Instytutu (cena
//     „od", umowa osoby bez planu), Decision Lab, klucze nieznane.
// DLACZEGO TYP KLIENTA: segmenty służą do ocen churnu i ARPA, a benchmarki
// B2B i B2C różnią się kilkukrotnie - organizacja w stawce ulgowej (NGO)
// odchodzi i płaci jak B2B, nie jak klient indywidualny, a partner wrzucony
// do `other` zaniżał B2B i mieszał się z kontami bezpłatnymi.
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
  partner: "b2b_institution",
  partner_general: "b2b_institution",
  presidents_circle: "b2b_institution",
  ngo: "b2b_institution",
};

/** Segment warstwy; `null`/nieznany klucz → `other` (jak SQL). */
export function revenueSegmentOfTier(tierKey: string | null | undefined): RevenueDataSegment {
  if (!tierKey || !Object.hasOwn(REVENUE_SEGMENT_BY_TIER, tierKey)) return "other";
  return REVENUE_SEGMENT_BY_TIER[tierKey as TierKey] ?? "other";
}
